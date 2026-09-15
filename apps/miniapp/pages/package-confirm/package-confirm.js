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
const { createLifecycleGuard, memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard')

/**
 * 报价用的打印参数。
 *
 * 单双面与色彩**只能**经 `pkg.toWireDuplex` / `pkg.toWireColorMode` 出去，
 * 建单那一步用的是同一对函数 —— 两条链共用一个出口，就不可能出现
 * 「预览按一种参数报价、建单按另一种参数计价」的分叉。
 *
 * 此前这里写的是 `duplex === 'double' ? 'double' : 'simplex'`，
 * 而报价 DTO 的 `@IsIn` 白名单里**根本没有 `'double'`**（simplex /
 * duplex_long_edge / duplex_short_edge），建单 DTO 也没有。也就是说选了双面的
 * 材料包在报价那一步就必然 400 —— 双面这个选项从来没有真正工作过。
 * 其余固定 A4 / auto / standard / fit / 1，与服务端 normalizeParams 的产物一致。
 */
function quoteParams(packageData) {
  return {
    copies: packageData.copies || 1,
    colorMode: pkg.toWireColorMode(packageData.colorMode),
    duplex: pkg.toWireDuplex(packageData.duplex),
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
    // 默认**不勾选**。模板里那句是「我已阅读并同意《打印服务协议》」并链到
    // /pages/legal/legal —— 那是一份法律文件的同意，预先替用户勾上等于替他声明
    // 「已阅读」。本仓库同类同意的既有口径就是显式勾选：`pages/launch/launch.js`
    // 的 `agreed: false`、`pages/self-explore` 的「（必选）」。本页此前是唯一的例外。
    agreedToTerms: false,
  },

  onLoad() {
    // 身份快照存在守卫里而不是 data 上：data 的初值恒为未登录，用它做对比会让
    // 首次 onShow 把「未登录→已登录」当成刚登录，于是每次进页面都多发一次报价。
    this._guard = createLifecycleGuard()
    this._guard.activate()
    this._guard.setIdentity(this._identityKey())
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 44, isLoggedIn: auth.isLoggedIn() })
    this._loadOrderData()
  },

  /**
   * 当前身份的稳定快照。三态：`''` 未登录 / `'!'` 登录但无 id（不可用）/ `'u:<id>'`。
   * 不可用时本页一个字节的草稿都不读、不写、不报价 —— 见 page-guard.memberIdentityKey。
   */
  _identityKey() {
    return memberIdentityKey(auth)
  },

  /** 当前身份能不能用来读写本人数据。 */
  _identityUsable() {
    return isMemberIdentity(this._identityKey())
  },

  /** 报价这类「只影响本页显示」的链：身份没变 + 页面在前台 + 是最新一次请求。 */
  _accepts(token) {
    return this._guard.accepts(token, this._identityKey())
  },

  /**
   * 建单这条链只按**身份**判定，不看前台/后台。
   *
   * 因为订单已经在服务端建出来了：切后台不该让本页永远卡在「提交中…」，
   * 更不该让用户以为没下成又下一单。只有换了人才必须停手。
   */
  _sameIdentity(token) {
    return !!token && this._identityKey() === token.identity
  },

  onShow() {
    this._guard.activate()
    const loggedIn = auth.isLoggedIn()
    // 身份变了（刚登录 / 刚登出 / 换了账号）：草稿必须按**新**身份重新核一遍归属，
    // 不能沿用上一次解析出来的文件列表。setIdentity 同时 +1 代次，
    // 上一位在途的报价与建单响应一并作废。
    //
    // 「从登录页回来自动重新核价」也落在这条路径上：用户按了「去登录」、登录成功、
    // 返回本页，身份从空串变成会员 id，这里会重新解析草稿并重新核价 ——
    // 他已经做完了我们要求的事，页面不能还停在那条「登录已失效」。
    if (this._guard.setIdentity(this._identityKey())) {
      this.setData({ isLoggedIn: loggedIn })
      this._resetForIdentity()
      this._loadOrderData()
      return
    }
    this.setData({ isLoggedIn: loggedIn })
    // 切后台会作废在途的报价。回来后若还停在「正在核价」**且那次确实已经作废**，
    // 才重发；否则页面会永远显示核价中，而其实一个请求都没有在跑。
    //
    // 「确实已经作废」这半句不能省：onLoad 刚发出的那次报价也是 loading，
    // 而紧随其后的首次 onShow 必然跑到这里 —— 只看 quoteState 会把同一份材料包
    // 连报两次价（服务端要真去识别一遍页数，白算一次）。
    if (this.data.draftState === 'draft'
      && this.data.quoteState === 'loading'
      && !this._guard.accepts(this._quoteToken)) this._loadQuote()
  },

  onHide() {
    this._guard.deactivate()
  },

  onUnload() {
    this._guard.deactivate()
  },

  /**
   * 身份变了（刚登录 / 刚登出 / 换了账号）：把**属于上一位**的页面状态复位。
   *
   * 这三样都不在 `_loadOrderData()` / `_clearDraftView()` 的清理范围里，
   * 而每一样留给下一位都会造成一个具体的坏结果：
   *
   *   `_createdOrderId` —— 它是实例字段，不是 data。一旦设上，本页就永久锁成
   *      「订单已创建，请不要重复下单」：`_loadQuote()` 首行直接 return，
   *      于是新用户看到的是一张**他从没下过的订单**的提示，而且他自己的材料包
   *      再也走不到「确认下单」——报价永远不会变成 ready。
   *   `submitting`      —— 上一位按下「确认下单」那一刻的按钮锁。留着就是一个
   *      写着「提交中…」且按不动的页面，而并没有任何请求在跑。
   *   `agreedToTerms`   —— 那是**上一位本人**对《打印服务协议》的同意。替下一位
   *      保留这个勾选，等于替他声明「我已阅读并同意」——与本页默认不勾选同一条理由。
   */
  _resetForIdentity() {
    this._createdOrderId = null
    this.setData({ submitting: false, agreedToTerms: false })
  },

  /**
   * 进入「没有可确认的材料包」，并把已经渲染出来的文件名、服务点与金额一起清干净。
   * 只改 draftState 不清 files 的话，模板某一帧仍可能拿旧数组渲染。
   */
  _clearDraftView() {
    this._packageData = null
    this._storeData = null
    this.setData({
      draftState: 'missing',
      quoteState: 'idle',
      files: [],
      storeName: '',
      storeAddress: '',
      orderSummary: { fileCount: 0, copies: 1, colorLabel: '黑白', duplexLabel: '单面' },
      quoteAmountText: '',
      quotePages: 0,
      quoteErrorTitle: '', quoteErrorText: '', quoteRecover: '',
      submitErrorTitle: '', submitErrorText: '', submitRecover: '',
      submitting: false,
    })
  },

  /**
   * 解析草稿。**先验身份，再碰草稿。**
   *
   * `temp_package_data` 是本机存储，同一台手机上谁都读得到。不先核归属就解析，
   * 会出现两种越界：未登录深链打开本页，直接把上一位留下的文件名渲染出来；
   * 或者 B 登录后打开本页，看到的是 A 的材料清单。
   * 所以：未登录一律不解析；归属对不上就**同步删掉**再进失败态 ——
   * 留着它等于把同一个洞原样留给下一次打开。
   */
  _loadOrderData() {
    this._packageData = null
    this._storeData = null
    const identity = this._identityKey()
    // 未登录、或登录了却拿不到会员 id：一律不碰草稿。后者尤其要拦 ——
    // 那种会话的身份键在所有人之间共享，照它比对 ownerKey 会直接放行别人的草稿。
    if (!isMemberIdentity(identity)) {
      this._clearDraftView()
      return
    }
    const packageData = wx.getStorageSync('temp_package_data') || {}
    const files = (Array.isArray(packageData.files) ? packageData.files : []).filter((f) => f && f.fileId)
    const ownerKey = String(packageData.ownerKey || '')
    // 归属对不上，或者是旧版本留下的、根本没有归属标记的草稿：删掉，一个文件名都不渲染。
    if (!ownerKey || ownerKey !== identity) {
      wx.removeStorageSync('temp_package_data')
      wx.removeStorageSync('temp_selected_store')
      this._clearDraftView()
      return
    }
    const storeData = wx.getStorageSync('temp_selected_store') || {}
    // 服务点必须属于**同一个人的同一份草稿**，否则这一单会下到用户这次没选过的机器上。
    const storeBound = !!storeData.id
      && String(storeData.ownerKey || '') === identity
      && String(storeData.draftId || '') === String(packageData.draftId || '')
    if (!storeBound) {
      if (storeData.id) wx.removeStorageSync('temp_selected_store')
      this._clearDraftView()
      return
    }

    if (!files.length) {
      this._clearDraftView()
      return
    }

    this._packageData = packageData
    this._storeData = storeData
    this.setData({
      draftState: 'draft',
      submitErrorTitle: '', submitErrorText: '', submitRecover: '',
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
    // 订单已经建出来了就不再核价：留着一条会重新变 ready 的路径，等于把
    // 「确认下单」按钮再点亮一次，而再点一次就是第二张订单（服务端没有幂等键）。
    if (this._createdOrderId) return
    if (!this._identityUsable()) {
      this.setData({
        quoteState: 'error',
        quoteErrorTitle: auth.isLoggedIn() ? '登录状态不完整' : '登录已失效',
        quoteErrorText: '请重新登录后再核价下单。',
        quoteRecover: 'login',
      })
      return
    }
    const packageData = this._packageData
    const storeData = this._storeData
    if (!packageData || !storeData) return
    const token = this._guard.issue('quote')
    // 留痕给 onShow 判「这次报价是不是已经作废」，避免首次进入重复报价。
    this._quoteToken = token
    this.setData({ quoteState: 'loading', quoteErrorTitle: '', quoteErrorText: '', quoteRecover: '' })
    api.quotePackageOrder({
      terminalId: storeData.id,
      files: this.data.files.map((f) => ({ fileId: f.fileId })),
      params: quoteParams(packageData),
    })
      .then((quote) => {
        // 迟到的报价到此为止：换了人、切了后台，或已经重新核过一次价。
        // 旧报价写进来就是"按别人的文件算出来的金额显示给当前这位"。
        if (!this._accepts(token)) return
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
        if (!this._accepts(token)) return
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

  /**
   * 订单已经建出来之后的统一出口。
   *
   * 这条路径存在的唯一理由：**再 POST 一次就是第二张订单**（服务端 CreatePackageOrder
   * 没有幂等键）。所以一旦拿到 orderId，本页就不再是一个可以下单的页面 ——
   * 把报价打成 error（按钮随之变灰），并把恢复动作指到「我的 · 打印订单」，
   * 那里的材料包分区能找回这张订单、点进去就是到机码页。
   */
  _lockAfterCreated(orderId) {
    this._createdOrderId = orderId
    this.setData({
      submitting: false,
      quoteState: 'error',
      quoteErrorTitle: '订单已创建，请不要重复下单',
      quoteErrorText: '材料包订单已经建好了，只是这一步没能自动跳转。到「我的 · 打印订单」的材料包分区就能找回它，点进去即是到机码。',
      quoteRecover: 'orders',
      submitErrorTitle: '',
      submitErrorText: '',
      submitRecover: '',
    })
  },

  submitOrder() {
    if (this.data.submitting) return
    // 已经建过单：不再发第二次 POST，直接把人送去找那张订单。
    if (this._createdOrderId) { this._lockAfterCreated(this._createdOrderId); return }
    if (!this.data.agreedToTerms) {
      wx.showToast({ title: '请阅读并同意服务协议', icon: 'none' })
      return
    }
    if (!this._identityUsable()) { this.toLogin(); return }
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

    const token = this._guard.issue('submit')
    this.setData({ submitting: true, submitErrorTitle: '', submitErrorText: '', submitRecover: '' })
    wx.showLoading({ title: '创建订单中…', mask: true })
    api.createPackageOrder({
      terminalId: this._storeData.id,
      files,
      // **与报价逐字同源**：同一对 pkg.toWire* 函数。两条链各写一份映射，
      // 迟早会出现"按一种参数报价、按另一种参数计价"。
      params: {
        colorMode: pkg.toWireColorMode(this._packageData.colorMode),
        duplex: pkg.toWireDuplex(this._packageData.duplex),
        copies: this._packageData.copies || 1,
      },
    })
      .then((order) => {
        wx.hideLoading()
        const orderId = (order && order.orderId) || ''
        if (!orderId) throw new Error('服务端未返回订单号')
        // 换了人：**不碰当前这位的任何东西** —— storage 不动，`_createdOrderId` 也不设。
        //
        // 此前这里先无条件 `this._createdOrderId = orderId` 再判身份，两个后果：
        // ① B 的页面被 A 的订单永久锁死（见 _resetForIdentity 里对这个字段的说明）；
        // ② 下面那两个 removeStorageSync 会删掉 B 自己刚做好的草稿。
        // 上一位的订单不会丢：它已落库，本人可从「我的 · 打印订单」材料包分区找回。
        if (!this._sameIdentity(token)) return
        // 从这一行起，这张订单在服务端已经存在：本页永远不许再 POST 第二次。
        // 放在 redirectTo 之前，是为了让下面 catch 里那条「跳转同步抛」的兜底能认出它。
        this._createdOrderId = orderId
        // 同一个人：这份草稿已被这张订单消费掉，清干净。
        // 清理放在跳转**之前**：原先放在 redirectTo 的 success 回调里，跳转一旦没触发
        // （异常路径、页面已被替换），草稿就永远留在本机，下一位打开确认页还能看到。
        wx.removeStorageSync('temp_package_data')
        wx.removeStorageSync('temp_selected_store')
        // 只把 orderId 交给下一页。到机码 / 金额 / 有效期一律由 package-code 自己带登录态
        // 向服务端查（GET /orders/package/:id 有 requireOwned 归属校验），不经 URL 传递 ——
        // 否则一条构造出来的链接或一张转发出去的卡片就能渲染出一张带到机码的「创建成功」页。
        //
        // 跳转失败必须接住：不接的话页面会永远停在「提交中…」，而订单其实已经建好了 ——
        // 用户只会以为没下成，然后再点一次。
        wx.redirectTo({
          url: '/pages/package-code/package-code?orderId=' + encodeURIComponent(orderId),
          fail: () => this._lockAfterCreated(orderId),
        })
      })
      .catch((err) => {
        wx.hideLoading()
        // **先判身份再谈锁**。顺序反过来就是一个新缺陷：换了人之后迟到的那条失败
        // （或"订单已建成但跳转抛错"）会把 `_lockAfterCreated` 打在 B 的页面上，
        // 让 B 看到一张他没下过的订单，并且再也下不了自己的单。
        if (!this._sameIdentity(token)) return
        // 订单已经建成、只是后续动作抛错（例如 redirectTo 同步抛）：
        // 同样不能当成"下单失败"让用户重来。
        if (this._createdOrderId) { this._lockAfterCreated(this._createdOrderId); return }
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
