// pages/print-pickup/print-pickup.js
//
// 单件云打印订单的取件页。**唯一数据来源是 GET /me/print-orders/:orderId**
// （needAuth + requireOwned 归属校验）。
//
// 此前本页从 URL 读 pickupCode / expiresAt / amountCents / taskStatus / orderNo
// 做首屏渲染与失败兜底。到机码是去一体机取件的凭证：它进了 URL，一条构造出来的链接、
// 或一张转发出去的卡片，就能在别人手机上渲染出一张带码的取件页 —— 而金额与有效期
// 同样是本人订单状态，不该由调用方"告诉"本页。现在只收 orderId，其余一律向服务端取。
// 与材料包的 package-code 同一口径。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard')
const { PICKUP_CODE_RE, createPickupQrMatrix, normalizePickupCode } = require('../../utils/pickup-qrcode')

const POLL_INTERVAL_MS = 3000
const TERMINAL_STATES = new Set(['completed', 'failed', 'expired', 'cancelled', 'abandoned'])

function parseAmountCents(value) {
  if (value === undefined || value === null || value === '') return null
  const amountCents = Number(value)
  return Number.isSafeInteger(amountCents) && amountCents >= 0 ? amountCents : null
}

function formatCode(raw) {
  if (!raw) return ''
  const value = String(raw).replace(/\s/g, '').toUpperCase()
  const groups = value.match(/.{1,2}/g)
  return groups ? groups.join('-') : ''
}

function formatCountdown(ms) {
  if (ms <= 0) return '已过期'
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return hours > 0 ? `${hours}小时${minutes}分钟后过期` : `${Math.max(1, minutes)}分钟后过期`
}

function resolveOrderState(order) {
  const pickupStatus = String(order.pickupStatus || '')
  const taskStatus = String(order.taskStatus || '')
  const isFreeOrder = parseAmountCents(order.amountCents) === 0

  if (pickupStatus === 'expired' || taskStatus === 'expired') {
    return { key: 'expired', title: '到机码已过期', detail: '请返回打印订单重新发起打印。', showQr: false }
  }
  if (pickupStatus === 'cancelled' || taskStatus === 'cancelled') {
    return { key: 'cancelled', title: '订单已取消', detail: '本次到机码已经失效。', showQr: false }
  }
  if (taskStatus === 'failed') {
    return { key: 'failed', title: '打印失败', detail: '请查看终端提示，或联系现场工作人员处理。', showQr: false }
  }
  if (taskStatus === 'abandoned') {
    return { key: 'abandoned', title: '打印任务已终止', detail: '请返回订单页重新发起，或联系现场工作人员处理。', showQr: false }
  }
  if (taskStatus === 'completed') {
    return { key: 'completed', title: '打印已完成', detail: '请及时取走纸张并检查是否齐全。', showQr: false }
  }
  if (taskStatus === 'printing') {
    return { key: 'printing', title: '正在打印', detail: '终端已经开始出纸，请在设备旁等候。', showQr: false }
  }
  if (pickupStatus === 'used' || taskStatus === 'pending' || taskStatus === 'claimed') {
    return { key: 'queued', title: '已进入打印队列', detail: '终端已核销并创建打印任务，请等待出纸。', showQr: false }
  }
  if (pickupStatus === 'claimed' || taskStatus === 'awaiting_payment') {
    return isFreeOrder
      ? { key: 'awaiting_release', title: '已扫码，正在进入打印队列', detail: '免费试运营订单无需付款，请在终端旁等待。', showQr: false }
      : { key: 'awaiting_payment', title: '已扫码，等待现场支付', detail: '请在一体机确认订单并完成现场支付。', showQr: false }
  }
  return { key: 'pending', title: '等待终端扫码', detail: '将二维码对准一体机扫码器，或手动输入到机码。', showQr: true }
}

Page({
  _countdownTimer: null,
  _pollTimer: null,
  _polling: false,
  _pageReady: false,
  _visible: true,

  data: {
    statusBarHeight: 20,
    state: 'loading', // loading | ready | error
    errorMsg: '',
    orderId: '',
    fromOrders: false,
    orderNo: '',
    taskStatus: '',
    pickupStatus: '',
    statusKey: 'pending',
    statusTitle: '等待终端扫码',
    statusDetail: '',
    showQr: false,
    code: '',
    codeRaw: '',
    expiresAt: 0,
    amountCents: null,
    isFreeOrder: false,
    countdown: '',
    qrSizePx: 216,
    qrStatus: 'loading',
    refreshing: false,
  },

  onLoad(opts) {
    const q = opts || {}
    // 只认 orderId；source 只是返回路径提示，不是凭证也不是状态。
    const orderId = q.orderId ? decodeURIComponent(q.orderId) : ''
    const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : { windowWidth: 375 }
    const qrSizePx = Math.round(Math.max(188, Math.min(232, windowInfo.windowWidth * 0.56)))
    this._identity = this._identityKey()

    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      orderId,
      fromOrders: q.source === 'orders',
      qrSizePx,
      qrStatus: 'loading',
      state: orderId ? 'loading' : 'error',
      errorMsg: orderId ? '' : '这条链接没有带订单号，本页不展示任何到机码。请回到「我的 · 打印订单」重新进入。',
    })

    if (orderId) this._refreshOrder(true)
  },

  /** 当前身份的稳定快照。三态；不可用时本页不取也不显示任何码。 */
  _identityKey() {
    return memberIdentityKey(auth)
  },

  /**
   * 身份在本页停留期间变了就**当场清掉屏幕上的码**。
   *
   * 真实链路：`utils/request.js` 在 401 且仍有补签资格时静默续签一次，
   * 续签失败会 `auth.logout()` —— 全程没有任何生命周期回调，页面还停在前台，
   * 而那张已经渲染好的码属于一个已经不存在的会话。共用设备上就是下一位看到它。
   * 续签**成功**时身份不变，这里什么都不会发生（不影响 request.js 的续签设计）。
   *
   * @returns {boolean} 身份是否仍然可用且未变
   */
  _enforceIdentity() {
    const identity = this._identityKey()
    if (identity !== this._identity) {
      this._identity = identity
      this._stopTimers()
      this.setData({
        state: 'error',
        refreshing: false,
        showQr: false,
        code: '',
        codeRaw: '',
        qrStatus: 'loading',
        errorMsg: identity
          ? '当前账号与打开这张到机码时的不是同一个，已停止显示。请到「我的 · 打印订单」重新进入。'
          : '登录已失效，请重新登录后再查看到机码。',
      })
      return false
    }
    return isMemberIdentity(identity)
  },

  onReady() {
    this._pageReady = true
    this._drawPickupQr()
  },

  onShow() {
    this._visible = true
    if (!this._enforceIdentity()) return
    if (this.data.orderId) this._refreshOrder(false)
  },

  onHide() {
    this._visible = false
    this._stopTimers()
  },

  onUnload() {
    this._visible = false
    this._stopTimers()
  },

  _refreshOrder(initial) {
    if (!this.data.orderId || this._polling) return
    if (!this._enforceIdentity()) return
    const identity = this._identity
    this._polling = true
    if (initial) this.setData({ state: 'loading', errorMsg: '' })
    else this.setData({ refreshing: true })

    api.getCloudPrintOrder(this.data.orderId)
      .then((order) => {
        this._polling = false
        // 换了人 / 登出：这条响应属于上一个会话，一个字都不能写进来。
        if (this._identityKey() !== identity) { this._enforceIdentity(); return }
        if (!this._visible || !order) return
        // 码只认服务端这一次给的值。`|| this.data.codeRaw` 会让服务端已经撤码
        // （核销后 pickupCode 不再下发）的订单继续显示上一次那张码。
        const pickupCode = normalizePickupCode(order.pickupCode)
        const hasCode = PICKUP_CODE_RE.test(pickupCode)
        const status = resolveOrderState(order)
        const expiresAt = order.pickupCodeExpiresAt ? new Date(order.pickupCodeExpiresAt).getTime() : this.data.expiresAt
        const shouldRedraw = status.showQr && hasCode && pickupCode !== this.data.codeRaw
        const amountCents = parseAmountCents(order.amountCents)

        this.setData({
          state: 'ready',
          errorMsg: '',
          refreshing: false,
          orderNo: order.orderNo || this.data.orderNo,
          taskStatus: order.taskStatus || '',
          pickupStatus: order.pickupStatus || '',
          amountCents,
          isFreeOrder: amountCents === 0,
          statusKey: status.key,
          statusTitle: status.title,
          statusDetail: status.detail,
          showQr: status.showQr && hasCode,
          codeRaw: status.showQr && hasCode ? pickupCode : '',
          code: status.showQr && hasCode ? formatCode(pickupCode) : '',
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
          qrStatus: shouldRedraw ? 'loading' : this.data.qrStatus,
        }, () => {
          if (this.data.showQr) this._drawPickupQr()
          this._resumeVisibleWork()
        })
      })
      .catch((err) => {
        this._polling = false
        if (this._identityKey() !== identity) { this._enforceIdentity(); return }
        if (!this._visible) return
        if (err && err.statusCode === 401) {
          // 走到这里说明 request.js 的静默续签也没救回来（它续签失败时会 auth.logout()），
          // 身份检查上面已经做过一次；能落到这行只剩"本来就没登录"这一种。
          this._stopTimers()
          this.setData({
            state: 'error',
            refreshing: false,
            showQr: false,
            code: '',
            codeRaw: '',
            errorMsg: '登录已失效，请重新登录后再查看到机码',
          })
          return
        }
        // 网络/服务端失败：**保留最近一次从服务端取到的状态**（那是真值，不是 URL 里的值），
        // 只把失败说清楚。首次就失败时没有任何可保留的东西，进错误态 —— 不再有
        // "退回 URL 里的码离线绘码"这条路，因为 URL 里已经不带码了。
        const fallbackAvailable = this.data.state === 'ready'
        this.setData({
          state: fallbackAvailable ? 'ready' : 'error',
          refreshing: false,
          errorMsg: (err && err.message) || '订单状态加载失败，请稍后重试',
        }, () => {
          if (fallbackAvailable) {
            if (this.data.showQr) this._drawPickupQr()
            this._resumeVisibleWork()
          }
        })
      })
  },

  _resumeVisibleWork() {
    if (!this._visible || this.data.state !== 'ready') return
    if (this.data.showQr && this.data.expiresAt > 0) this._startCountdown()
    else this._stopCountdown()
    if (this.data.orderId && !TERMINAL_STATES.has(this.data.statusKey)) this._schedulePoll()
    else this._stopPoll()
  },

  _schedulePoll() {
    this._stopPoll()
    if (!this._visible || !this.data.orderId || TERMINAL_STATES.has(this.data.statusKey)) return
    this._pollTimer = setTimeout(() => this._refreshOrder(false), POLL_INTERVAL_MS)
  },

  _drawPickupQr() {
    if (!this._pageReady || this.data.state !== 'ready' || !this.data.showQr || !this.data.codeRaw) return

    let matrix
    try {
      matrix = createPickupQrMatrix(this.data.codeRaw)
    } catch (_) {
      this.setData({ qrStatus: 'error' })
      return
    }

    wx.createSelectorQuery().in(this).select('#pickup-qr').fields({ node: true, size: true }).exec((result) => {
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

  _startCountdown() {
    this._stopCountdown()
    const tick = () => {
      const ms = this.data.expiresAt - Date.now()
      if (ms <= 0) {
        this.setData({
          countdown: '已过期',
          showQr: false,
          codeRaw: '',
          code: '',
          statusKey: 'expired',
          statusTitle: '到机码已过期',
          statusDetail: '请返回打印订单重新发起打印。',
        })
        this._stopTimers()
        return
      }
      this.setData({ countdown: formatCountdown(ms) })
    }
    tick()
    if (this.data.showQr) this._countdownTimer = setInterval(tick, 60000)
  },

  _stopCountdown() {
    if (this._countdownTimer) clearInterval(this._countdownTimer)
    this._countdownTimer = null
  },

  _stopPoll() {
    if (this._pollTimer) clearTimeout(this._pollTimer)
    this._pollTimer = null
  },

  _stopTimers() {
    this._stopCountdown()
    this._stopPoll()
  },

  retry() {
    if (this.data.orderId) this._refreshOrder(true)
    else this.toOrders()
  },

  toOrders() {
    if (this.data.fromOrders) {
      wx.navigateBack({ fail() { wx.redirectTo({ url: '/pages/orders/orders' }) } })
      return
    }
    wx.redirectTo({ url: '/pages/orders/orders' })
  },

  home() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  back() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
