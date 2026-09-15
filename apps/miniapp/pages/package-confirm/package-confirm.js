// pages/package-confirm/package-confirm.js
//
// 材料包第三步：服务端报价 → 确认 → 建单拿到机码。
//
// 这页去掉了两样**伪造能力**的东西：
//
//   ① 支付方式选择器（「微信支付 / 余额支付」，微信支付默认选中）。
//      材料包全链没有在线支付：钱是到一体机上现场付的（pickup-order.service 接受
//      unpaid/paying 的到机码，出纸前才硬卡 payStatus !== 'paid'）。放一个默认选中的
//      「微信支付」等于暗示这一步会扣款。全链禁止 wx.requestPayment。
//   ② 「合计 待确认」这种占位金额。金额现在来自服务端多行报价（POST /orders/quote
//      的 lines 契约），前端不做任何单价乘法。
//
// 提交载荷仍然只有 fileId / pageRange：服务端 CreatePackageOrderDto 是白名单校验
// （forbidNonWhitelisted），多带一个 filename / pageCount / totalAmount 就整单 400。
// 这不是接口疏漏而是刻意的 —— DTO 注释写明「页数、金额与文件名全部由服务端查证，
// 前端传值不作为事实」，让前端报页数报金额本身就是错的（那会成为计费口径被前端左右的入口）。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const pkg = require('../../utils/package-order')

/**
 * 报价用的打印参数。
 *
 * **必须逐字对齐服务端 PackageOrderService.normalizeParams 的产物**：
 * bw→black_white、single→simplex，其余固定 A4 / auto / standard / fit / 1。
 * 对不上就会出现「预览按一种参数报价、建单按另一种参数计价」的分叉。
 */
function quoteParams(packageData) {
  const colorMode = packageData.colorMode === 'color' ? 'color' : 'black_white'
  const duplex = packageData.duplex === 'double' ? 'double' : 'simplex'
  return {
    copies: packageData.copies || 1,
    colorMode,
    duplex,
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
  }
}

Page({
  data: {
    statusBarHeight: 44,
    isLoggedIn: false,
    submitting: false,

    // draft | missing —— 深链直进、草稿被清都属 missing，必须能说清并可恢复
    draftState: 'draft',
    storeName: '',
    storeAddress: '',
    files: [],
    orderSummary: {
      fileCount: 0,
      copies: 1,
      colorLabel: '黑白',
      duplexLabel: '单面',
    },

    quoteState: 'idle',   // idle | loading | ready | error
    quoteAmountText: '',
    quotePages: 0,
    quoteErrorTitle: '',
    quoteErrorText: '',
    quoteRecover: '',

    submitErrorTitle: '',
    submitErrorText: '',
    submitRecover: '',

    onsiteNotice: pkg.PACKAGE_ONSITE_NOTICE,
    noCancelNotice: pkg.PACKAGE_NO_CANCEL_NOTICE,
    agreedToTerms: true,
  },

  onLoad() {
    // 登录态的「上一次取值」存在实例字段而不是 data 上：data 的初值恒为 false，
    // 用它做对比会让首次 onShow 把 false→true 当成「刚登录」，于是每次进页面都多发一次报价。
    this._wasLoggedIn = auth.isLoggedIn()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 44, isLoggedIn: this._wasLoggedIn })
    this._loadOrderData()
  },

  onShow() {
    const loggedIn = auth.isLoggedIn()
    const wasLoggedIn = this._wasLoggedIn
    this._wasLoggedIn = loggedIn
    this.setData({ isLoggedIn: loggedIn })
    // 从登录页回来后必须自动重新核价。否则用户按了「去登录」、登录成功、返回本页，
    // 看到的还是那条「登录已失效」——他已经做完了我们要求的事，页面却没反应。
    if (loggedIn && wasLoggedIn === false && this.data.draftState === 'draft') this._loadQuote()
  },

  _loadOrderData() {
    const packageData = wx.getStorageSync('temp_package_data') || {}
    const storeData = wx.getStorageSync('temp_selected_store') || {}
    const files = (Array.isArray(packageData.files) ? packageData.files : []).filter((f) => f && f.fileId)

    if (!files.length || !storeData.id) {
      this.setData({ draftState: 'missing', quoteState: 'idle' })
      return
    }

    this._packageData = packageData
    this._storeData = storeData
    this.setData({
      draftState: 'draft',
      storeName: storeData.name || '',
      storeAddress: storeData.address || '',
      files: files.map((f) => ({ fileId: f.fileId, name: f.name || '打印文件' })),
      orderSummary: {
        fileCount: files.length,
        copies: packageData.copies || 1,
        colorLabel: packageData.colorMode === 'color' ? '彩色' : '黑白',
        duplexLabel: packageData.duplex === 'double' ? '双面' : '单面',
      },
    })
    this._loadQuote()
  },

  /**
   * 服务端报价。**这一步就是建单前的 fail-closed 关口**：价目未配置
   * （PRICE_CONFIG_UNAVAILABLE）、彩色/双面未在该机验过（CAPABILITY_*）、
   * 打印机离线、文件已失效，都会在这里先暴露，而不是等用户按下「确认下单」。
   */
  _loadQuote() {
    if (!auth.isLoggedIn()) {
      this.setData({ quoteState: 'error', quoteErrorTitle: '登录已失效', quoteErrorText: '请重新登录后再核价下单。', quoteRecover: 'login' })
      return
    }
    const packageData = this._packageData
    const storeData = this._storeData
    if (!packageData || !storeData) return
    this.setData({ quoteState: 'loading', quoteErrorTitle: '', quoteErrorText: '', quoteRecover: '' })
    api.quotePackageOrder({
      terminalId: storeData.id,
      files: this.data.files.map((f) => ({ fileId: f.fileId })),
      params: quoteParams(packageData),
    })
      .then((quote) => {
        const amountCents = pkg.parseAmountCents(quote && quote.amountCents)
        const billablePages = Number(quote && quote.billablePages)
        if (amountCents === null || !Number.isSafeInteger(billablePages) || billablePages < 1) {
          throw new Error('服务端报价缺少有效页数或金额')
        }
        this.setData({
          quoteState: 'ready',
          quoteAmountText: pkg.formatAmount(amountCents),
          quotePages: billablePages,
        })
      })
      .catch((err) => {
        const shown = pkg.describePackageError(err, '服务端报价失败，请稍后重试。')
        this.setData({
          quoteState: 'error',
          quoteErrorTitle: shown.title,
          quoteErrorText: shown.text,
          quoteRecover: shown.recover,
        })
      })
  },

  retryQuote() {
    this._loadQuote()
  },

  /**
   * 回到第一步。优先 navigateBack 退两级回到**原来那个** package-create 实例 ——
   * 它还拿着用户勾好的文件。用 redirectTo 会换一个全新实例，选择全部丢失，
   * 而这条出口最常见的触发原因（隐私检查未过、文件失效）恰恰要求他只改其中一两个文件。
   * 栈形状不符合预期时（深链直进）才退回 redirectTo。
   */
  backToFiles() {
    wx.navigateBack({
      delta: 2,
      fail() { wx.redirectTo({ url: '/pages/package-create/package-create' }) },
    })
  },

  backToStore() {
    wx.navigateBack({
      delta: 1,
      fail() { wx.redirectTo({ url: '/pages/store-select/store-select' }) },
    })
  },

  toLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' })
  },

  toOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' })
  },

  /** 报价 / 提交失败后的恢复动作，按服务端错误码分流，不给「请重试」一条死路。 */
  recover(e) {
    const target = e.currentTarget.dataset.recover
    if (target === 'login') return this.toLogin()
    if (target === 'files' || target === 'privacy') return this.backToFiles()
    if (target === 'store') return this.backToStore()
    if (target === 'orders') return this.toOrders()
    this._loadQuote()
  },

  toggleAgreement(e) {
    this.setData({ agreedToTerms: e.detail.value.length > 0 })
  },

  viewTerms() {
    wx.navigateTo({ url: '/pages/legal/legal' })
  },

  submitOrder() {
    if (this.data.submitting) return
    if (!this.data.agreedToTerms) {
      wx.showToast({ title: '请阅读并同意服务协议', icon: 'none' })
      return
    }
    if (!auth.isLoggedIn()) { this.toLogin(); return }
    if (this.data.draftState === 'missing') { this.backToFiles(); return }
    if (this.data.quoteState !== 'ready') {
      wx.showModal({
        title: '还不能下单',
        content: this.data.quoteState === 'loading'
          ? '正在等服务端报价，请稍候。'
          : '服务端还没有给出这份材料包的金额，此时下单会被拒绝。请先解决上面的报价问题。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }

    const files = this.data.files.map((f) => ({ fileId: f.fileId }))
    if (!files.length || files.some((f) => !f.fileId)) {
      this.setData({ draftState: 'missing' })
      return
    }

    this.setData({ submitting: true, submitErrorTitle: '', submitErrorText: '', submitRecover: '' })
    wx.showLoading({ title: '创建订单中…', mask: true })
    api.createPackageOrder({
      terminalId: this._storeData.id,
      files,
      params: {
        colorMode: this._packageData.colorMode || 'bw',
        duplex: this._packageData.duplex || 'single',
        copies: this._packageData.copies || 1,
      },
    })
      .then((order) => {
        wx.hideLoading()
        const orderId = (order && order.orderId) || ''
        if (!orderId) throw new Error('服务端未返回订单号')
        // 只把 orderId 交给下一页。到机码 / 金额 / 有效期一律由 package-code 自己带登录态
        // 向服务端查（GET /orders/package/:id 有 requireOwned 归属校验），不经 URL 传递 ——
        // 否则一条构造出来的链接或一张转发出去的卡片就能渲染出一张带到机码的「创建成功」页。
        wx.redirectTo({
          url: '/pages/package-code/package-code?orderId=' + encodeURIComponent(orderId),
          success() {
            wx.removeStorageSync('temp_package_data')
            wx.removeStorageSync('temp_selected_store')
          },
        })
      })
      .catch((err) => {
        wx.hideLoading()
        const shown = pkg.describePackageError(err, '创建订单失败，请稍后重试。')
        this.setData({
          submitting: false,
          submitErrorTitle: shown.title,
          submitErrorText: shown.text,
          submitRecover: shown.recover,
        })
      })
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  // 不提供 onShareAppMessage：本页只对本人有意义，转发出去对收到的人只会是一页失败态。
})
