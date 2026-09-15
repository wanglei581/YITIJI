// pages/package-code/package-code.js
//
// 材料包到机码页。**唯一数据来源是 GET /orders/package/:id**。
//
// 为什么不从 URL 读：到机码是拿去一体机取件的凭证。若它来自 URL，一条构造出来的链接、
// 或一张转发出去的「创建成功」卡片，就能在别人手机上渲染出一张带码的成功页。
// 服务端 requireOwned 归属校验：非本人订单 404 PACKAGE_ORDER_NOT_FOUND（连存在性都不
// 泄漏），未登录 401 —— 前端必须真的去问它。
//
// 本页也是「订单可找回」的落点：从「我的 · 打印订单」的材料包分区点进来时同样只带
// orderId，由这里重新核一次。这正是材料包此前不敢开放的那一环 —— 之前用户离开后
// 手上只剩一个到机码，而到机码不能反查订单。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const pkg = require('../../utils/package-order')
const { createPickupQrMatrix, PICKUP_CODE_RE } = require('../../utils/pickup-qrcode')

const QR_SIZE_PX = 180

Page({
  data: {
    // 默认 false：模板里的「材料包已创建」是写死的，必须等服务端确认订单存在且属于
    // 当前账号之后才允许渲染。
    ready: false,
    loading: false,
    loadError: '',
    loadErrorTitle: '',
    loadRecover: '',
    statusBarHeight: 20,
    orderId: '',
    orderNo: '',
    pickupCode: '',
    fileCount: 0,
    expireTime: '',
    amountText: '',
    statusLabel: '',
    statusTone: 'neutral',
    payStatus: '',
    pickupStatus: '',
    taskStatus: '',
    showQr: false,
    qrStatus: 'loading',   // loading | ready | error
    qrSizePx: QR_SIZE_PX,
    onsiteNotice: pkg.PACKAGE_ONSITE_NOTICE,
    noCancelNotice: pkg.PACKAGE_NO_CANCEL_NOTICE,
  },

  onLoad(options) {
    const orderId = options.orderId ? decodeURIComponent(options.orderId) : ''
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      orderId,
    })
  },

  onReady() {
    this._pageReady = true
    if (this.data.showQr) this._drawPickupQr()
  },

  onShow() {
    // 每次回到本页都重新向服务端核一遍：订单可能已被核销、已过期，或者换了登录账号。
    this.loadOrder()
  },

  /**
   * 离开或切后台时把凭证从内存里清掉。
   *
   * 到机码不写 storage、不进 URL、不做本地缓存 —— 共用设备上把码留在页面数据里，
   * 下一位用户从后台切回来就能看到上一位的码。回到本页时会重新向服务端取。
   * paymentSessionToken 虽然在详情响应里，但本页**从不 setData**，因此也不会被持久化。
   */
  onHide() {
    this._clearCredentials()
  },

  onUnload() {
    this._clearCredentials()
  },

  _clearCredentials() {
    // `_codeRaw` 是画二维码用的明文副本，必须和 data 里的码一起清 ——
    // 只清 data 的话，切后台再回来那一帧会用上一位用户的码重绘出一张可扫的二维码。
    this._codeRaw = ''
    this.setData({ pickupCode: '', showQr: false, qrStatus: 'loading', ready: false })
  },

  loadOrder() {
    const { orderId } = this.data
    if (!orderId) {
      this.setData({
        ready: false, loading: false,
        loadErrorTitle: '缺少订单信息',
        loadError: '这条链接没有带订单号，本页不展示任何到机码。可以到「我的 · 打印订单」里找回自己的材料包订单。',
        loadRecover: 'orders',
      })
      return
    }
    if (!auth.isLoggedIn()) {
      this.setData({
        ready: false, loading: false,
        loadErrorTitle: '请先登录',
        loadError: '到机码只对订单本人显示，请登录后再查看。',
        loadRecover: 'login',
      })
      return
    }
    this.setData({ loading: true, loadError: '', loadErrorTitle: '', loadRecover: '' })
    api.getPackageOrder(orderId)
      .then((order) => {
        const status = pkg.resolvePackageStatus(order)
        // 服务端的 visibleCode 判据（pending 且未过期）已经决定了给不给码；
        // 前端不做第二套判据，只忠实反映「有没有拿到」。
        const code = order && order.pickupCode ? String(order.pickupCode) : ''
        const codeUsable = PICKUP_CODE_RE.test(code)
        this.setData({
          ready: true,
          loading: false,
          orderNo: (order && order.orderNo) || '',
          pickupCode: pkg.formatPickupCode(code),
          fileCount: Array.isArray(order && order.items) ? order.items.length : 0,
          expireTime: pkg.formatExpireAt(order && order.expiresAt),
          amountText: pkg.formatAmount(order && order.amountCents),
          statusLabel: status.label,
          statusTone: status.tone,
          payStatus: (order && order.payStatus) || '',
          pickupStatus: (order && order.pickupStatus) || '',
          taskStatus: (order && order.taskStatus) || '',
          showQr: codeUsable,
          qrStatus: codeUsable ? 'loading' : 'error',
        }, () => {
          this._codeRaw = codeUsable ? code : ''
          if (codeUsable) this._drawPickupQr()
        })
      })
      .catch((err) => {
        // 不把服务端错误体当文案（utils/user-error.js 的判据），也绝不在查不到订单时
        // 退回 URL 里的值渲染成功页 —— 那等于把洞原样留着。
        const shown = pkg.describePackageError(err, '订单信息加载失败，请稍后重试。')
        this.setData({
          ready: false,
          loading: false,
          pickupCode: '',
          showQr: false,
          loadErrorTitle: shown.title,
          loadError: shown.text,
          loadRecover: shown.recover,
        })
      })
  },

  /**
   * 本地离线编码到机码二维码，与 print-pickup 同一套实现（utils/pickup-qrcode.js）。
   * 此处此前是一个写死「二维码」字样的占位方框 —— 用户以为有码可扫，到了机器前才发现
   * 只能手输。没有真码时明确说「二维码不可用，请手输下方到机码」。
   */
  _drawPickupQr() {
    if (!this._pageReady || !this.data.showQr || !this._codeRaw) return
    let matrix
    try {
      matrix = createPickupQrMatrix(this._codeRaw)
    } catch (_) {
      this.setData({ qrStatus: 'error' })
      return
    }
    wx.createSelectorQuery().in(this).select('#package-qr').fields({ node: true, size: true }).exec((result) => {
      const target = result && result[0]
      if (!target || !target.node) {
        this.setData({ qrStatus: 'error' })
        return
      }
      const canvas = target.node
      const context = canvas.getContext('2d')
      const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : { pixelRatio: 1 }
      const pixelRatio = Math.max(1, windowInfo.pixelRatio || 1)
      const size = this.data.qrSizePx
      canvas.width = Math.round(size * pixelRatio)
      canvas.height = Math.round(size * pixelRatio)
      context.scale(pixelRatio, pixelRatio)
      context.fillStyle = '#FFFFFF'
      context.fillRect(0, 0, size, size)
      const quietZone = 4
      const cellSize = Math.floor(size / (matrix.length + quietZone * 2))
      const drawSize = cellSize * (matrix.length + quietZone * 2)
      const offset = Math.floor((size - drawSize) / 2)
      context.fillStyle = '#15100C'
      matrix.forEach((row, y) => row.forEach((dark, x) => {
        if (dark) context.fillRect(
          offset + (x + quietZone) * cellSize,
          offset + (y + quietZone) * cellSize,
          cellSize,
          cellSize,
        )
      }))
      this.setData({ qrStatus: 'ready' })
    })
  },

  retryLoad() {
    this.loadOrder()
  },

  recover(e) {
    const target = e.currentTarget.dataset.recover
    if (target === 'login') return wx.navigateTo({ url: '/pages/launch/launch' })
    if (target === 'orders') return this.viewOrders()
    this.loadOrder()
  },

  /**
   * 去「我的 · 打印订单」。
   *
   * 这里此前跳的是 order-detail —— 那页读 `/me/print-orders/:orderId`，而该端点的
   * requireOwned 过滤把材料包排除在外（材料包 sourceFileId 为 null），点了只会拿到
   * PRINT_ORDER_NOT_FOUND。材料包的落点是打印订单页的材料包分区。
   */
  viewOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  copyCode() {
    if (!this.data.pickupCode) return
    wx.setClipboardData({
      data: this.data.pickupCode,
      success() { wx.showToast({ title: '到机码已复制', icon: 'success' }) },
    })
  },

  copyOrderNo() {
    if (!this.data.orderNo) return
    wx.setClipboardData({
      data: this.data.orderNo,
      success() { wx.showToast({ title: '订单号已复制', icon: 'success' }) },
    })
  },

  // 不提供 onShareAppMessage：这页原本可以把「材料包创建成功」当作分享标题转发出去，
  // 而收到的人打开的是一张没有任何订单支撑的成功页。到机码是取件凭证，不做分享。
})
