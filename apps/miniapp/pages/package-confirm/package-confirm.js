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
// 提交载荷**当前只有 fileId**。`pageRange` 是服务端 `CreatePackageOrderDto` 预留的
// 可选字段（后端已按有序 pageRange 计费并入幂等指纹），但这条链上还没有任何一处让用户
// 选页码 —— 所以现在发出去的每一个 file 都只带 fileId，`pageRange` 属于将来才会用上的
// 契约，不是本页此刻的行为。（此处旧注释写的是「只有 fileId / pageRange」，会被读成
// 本页已经在传页码；本轮只更正这句话，不为此新增任何页码 UI 或行为。）
//
// 载荷之所以这么窄：服务端 DTO 是白名单校验（forbidNonWhitelisted），多带一个
// filename / pageCount / totalAmount 就整单 400。这不是接口疏漏而是刻意的 ——
// DTO 注释写明「页数、金额与文件名全部由服务端查证，前端传值不作为事实」，
// 让前端报页数报金额本身就是错的（那会成为计费口径被前端左右的入口）。
//
// 2026-09-17：这一页此前**一个幂等键都不带**。服务端 `POST /orders/package` 补上
// Idempotency-Key 之后（dd1434d89），不带就是 400；补上之前，它的代价是"响应丢在路上、
// 用户再点一次"必然多出第二张订单和第二次收款。键的铸造、落盘与复用见
// utils/package-order-idempotency.js；本页只负责三件事：**先落住键再 POST**、
// **拿到 orderId 先落盘再跳转**、以及重进本页时**先核对再决定要不要放开按钮**。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const pkg = require('../../utils/package-order')
const idem = require('../../utils/package-order-idempotency')
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
    this._submitAttempt = null
    this._verifyingOrderId = ''
    this._needsFreshKey = false
    this._serverLostOrder = false
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
    // 先看本机记不记得这一份材料包已经建成过一张单，再决定要不要核价。
    // 顺序不能反：`_loadQuote()` 一旦把 quoteState 打成 ready，「确认下单」就亮了，
    // 而此刻我们还不知道服务端那边是不是已经有一张同样的订单。
    this._restoreCreatedOrder()
    this._loadQuote()
  },

  /**
   * 建单载荷。**这是它唯一的构造点** —— 幂等指纹算的和 POST 发出去的必须是同一个对象。
   * 两处各拼一份，迟早会分叉成「按一种参数算指纹、按另一种参数下单」：本地以为没变而
   * 服务端算出另一个指纹 → 409；或者反过来白铸一个新键 → 第二张订单。
   *
   * 载荷形状仍然只有 fileId：服务端 `CreatePackageOrderDto` 是白名单校验，多一个字段
   * 整单 400；页数与金额由服务端查证，前端传值不作为事实。
   */
  _orderPayload() {
    const packageData = this._packageData
    const storeData = this._storeData
    if (!packageData || !storeData || !storeData.id) return null
    const files = this.data.files.map((f) => ({ fileId: f.fileId }))
    if (!files.length || files.some((f) => !f.fileId)) return null
    return {
      terminalId: storeData.id,
      files,
      // **与报价逐字同源**：同一对 pkg.toWire* 函数。两条链各写一份映射，
      // 迟早会出现"按一种参数报价、按另一种参数计价"。
      params: {
        colorMode: pkg.toWireColorMode(packageData.colorMode),
        duplex: pkg.toWireDuplex(packageData.duplex),
        copies: packageData.copies || 1,
      },
    }
  },

  /**
   * 重进本页时恢复「这一单已经建成」。
   *
   * 触发它的是三种真实处境：上一次 200 回来时跳转失败、小程序被系统回收后重进、
   * 以及扫码 / 分享跳走再回来。三种的共同点是**服务端那张订单已经存在**，而页面自己
   * 什么都不记得了 —— 不恢复就会再提交一次，而那一次带着同一个键过去只会回放原单，
   * 用户却会一直停在一个"看起来没下成"的页面上反复点。
   *
   * 只读**当前这位**的记录：findRecord 要求账号逐字相等且是确定的会员键。
   */
  _restoreCreatedOrder() {
    if (this._createdOrderId || this._serverLostOrder) return
    const account = this._identityKey()
    if (!isMemberIdentity(account)) return
    const payload = this._orderPayload()
    if (!payload) return
    const record = idem.findRecord(account, idem.fingerprintOf(payload))
    if (!record || !record.orderId) return
    // **先锁再核**：核对期间一次 POST 都不许发 —— 这一刻我们恰恰还不知道那张订单
    // 是不是活的，放开按钮就是在不确定时多建一张。
    this._createdOrderId = record.orderId
    this._lockAfterCreated(record.orderId)
    this._verifyCreatedOrder(record.orderId)
  },

  /**
   * 向服务端核一次「那张已建成的订单还在不在」，判据只认服务端。
   *
   * 走既有的 `GET /orders/package/:id`（requireOwned：非本人 404、未登录 401），
   * **不信任任何经 URL 传进来的到机码或金额** —— 那条路一张构造出来的链接就能伪造。
   *   - 查到了 → 直接把人送到机码页，**不再 POST 第二次**；
   *   - 服务端明确说本人没有这张订单（404） → 那个 orderId 再也换不出东西，解开锁，
   *     让用户可以用**同一个键**重新提交（服务端查不到该键就会正常建一张新单）；
   *   - 查不出来（网络 / 401 / 5xx） → **继续锁着**。查询失败证明不了任何事，
   *     而这里只要放开一格，代价就是同一份材料包的第二张订单、第二次收款。
   */
  _verifyCreatedOrder(orderId) {
    if (!orderId || this._verifyingOrderId === orderId) return
    // 账号与指纹在**发起这一发之前**取定：回调那一刻页面可能已经换人，而这条记录
    // 属于发起时的那一位。拿回调时的身份去清记录，清掉的会是另一个人的那一格。
    const account = this._identityKey()
    const payload = this._orderPayload()
    const fingerprint = payload ? idem.fingerprintOf(payload) : ''
    this._verifyingOrderId = orderId
    const token = this._guard.issue('restore')
    api.getPackageOrder(orderId)
      .then(() => {
        if (!this._sameIdentity(token) || this._createdOrderId !== orderId) return
        this._verifyingOrderId = ''
        // 草稿已被这张订单消费掉，清干净再跳：留着它，用户从到机码页回到本页还能
        // 再下一单，而那一单是真的第二张（记录已随跳转成功清掉，键也换新了）。
        wx.removeStorageSync('temp_package_data')
        wx.removeStorageSync('temp_selected_store')
        wx.redirectTo({
          url: '/pages/package-code/package-code?orderId=' + encodeURIComponent(orderId),
          success: () => this._forgetIdempotencyRecord(account, fingerprint),
          fail: () => this._lockAfterCreated(orderId),
        })
      })
      .catch((err) => {
        if (!this._sameIdentity(token) || this._createdOrderId !== orderId) return
        this._verifyingOrderId = ''
        if (err && err.statusCode === 404 && err.code === 'PACKAGE_ORDER_NOT_FOUND') {
          // **本机那条记录里的键留着不动。** 它现在没有绑住任何订单，下一次同参数提交
          // 带着它过去，服务端按 (endUserId, key) 查不到就会正常建一张新单 —— 而不是
          // 回放。清掉键才会多出第二张（新键 + 服务端那张万一还在）。
          this._createdOrderId = null
          this._serverLostOrder = true
          this._loadQuote()
        }
        // 其余一律保持锁定：_lockAfterCreated 已经把「订单已创建」写在屏幕上了。
      })
  },

  /**
   * 跳走之后丢掉本机那条幂等记录。**刻意不看返回值**：到这一行页面已经在跳走了，
   * 写任何错误态都只是写给一个看不见的页面。清不掉的后果也已经被别处兜住 ——
   * 那条记录里的 orderId 指向一张真实存在的订单，用户带同一份材料包回来时会被
   * `_restoreCreatedOrder` 锁住并向服务端核一次，只多一次核对，不会多一张订单。
   */
  _forgetIdempotencyRecord(account, fingerprint) {
    if (!isMemberIdentity(account) || !fingerprint) return
    idem.clearRecord(account, fingerprint)
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

  /**
   * 同一把锁，只换一句解释：订单建成了，但 orderId 没能落进本机记录。
   *
   * 为什么不给 `_lockAfterCreated` 加一个参数：那条出口是这一页最要紧的一处不变量，
   * 门禁按 `_lockAfterCreated(orderId)` 的形状钉着它。这里复用它再改两行文案，
   * 锁的语义就只有一个来源，不会出现"两条锁路径其中一条忘了设 _createdOrderId"。
   *
   * 文案必须说实话：默认那句写的是"只是没能自动跳转"，而这一支真正发生的是
   * **本机存不下这张订单的线索**，用户在这台手机上再也找不回它 —— 只能去订单列表。
   */
  _lockAfterCreatedUnsaved(orderId) {
    this._lockAfterCreated(orderId)
    this.setData({
      quoteErrorText: '材料包订单已经建好了，但这台手机没能把它记下来（存储可能已满或被系统清理），所以没有自动跳转。请到「我的 · 打印订单」的材料包分区找回这张订单，点进去即是到机码；不要重复提交。',
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

    const payload = this._orderPayload()
    const account = this._identityKey()
    const fingerprint = payload ? idem.fingerprintOf(payload) : ''
    if (!payload || !fingerprint) {
      this.setData({ draftState: 'missing' })
      return
    }
    // 本机已经记着这一份材料包建成过一张单：**一个 POST 都不发**，改去核对那一张。
    // 这一条排在最前面（且是同步读），因为再 POST 一次的代价不是"多一个请求"——
    // 服务端会按同一个键回放，而页面会在用户眼前把一张旧订单说成刚建成的。
    const known = idem.findRecord(account, fingerprint)
    if (known && known.orderId && !this._serverLostOrder) {
      this._createdOrderId = known.orderId
      this._lockAfterCreated(known.orderId)
      this._verifyCreatedOrder(known.orderId)
      return
    }
    // 服务端说过这个键配的是另一组参数（409 IDEMPOTENCY_KEY_REUSED）。**换新键之前
    // 必须先把旧记录清掉，而且读回来确认真的清掉了** —— 清不掉就会复用旧键，
    // 下一次仍然 409；而"以为清掉了就换新键"更糟：旧键那张单还在，新键又建一张。
    if (this._needsFreshKey) {
      if (!idem.clearRecord(account, fingerprint)) {
        this.setData({
          submitting: false,
          submitErrorTitle: '本机没能清掉上一次的下单标识',
          submitErrorText: '手机存储可能已满或被系统清理。为避免重复下单，这一步先锁着。请清理一些存储空间后再点一次「确认下单」；已经建成的订单可到「我的 · 打印订单」查看。',
          submitRecover: 'orders',
        })
        return
      }
      this._needsFreshKey = false
    }
    // 上一次尝试还没落定：POST 可能已经到了服务端。这一条不能只靠 data.submitting ——
    // 它是 setData 出去的，任何一条路径把它写回 false 按钮就又能按了。
    if (this._submitAttempt && !this._submitAttempt.settled) return

    const token = this._guard.issue('submit')
    // 尝试锁必须**同步**设上：铸幂等键要等 wx.getRandomValues 的回调，
    // 这中间用户完全来得及再点一次；锁排在异步之后就等于没锁。
    const attempt = { account, fingerprint, key: '', settled: false }
    this._submitAttempt = attempt
    this.setData({ submitting: true, submitErrorTitle: '', submitErrorText: '', submitRecover: '' })
    wx.showLoading({ title: '创建订单中…', mask: true })
    // **先拿键、先落盘，然后才 POST。** 顺序反过来（先发请求、成功了再记键）会把
    // "响应丢在路上"这一种原样留着，而那正是最需要幂等键的时刻。落不住就 reject，
    // 一个 POST 都不发 —— 键没落住的订单一旦建成就再也找不回来了。
    idem.ensureKey(account, fingerprint)
      .then((record) => {
        attempt.key = record.key
        return api.createPackageOrder(payload, { idempotencyKey: record.key })
      })
      .then((order) => {
        wx.hideLoading()
        const orderId = (order && order.orderId) || ''
        // **先把 orderId 落进"发起这次提交的那位"的记录，再判当前页面还接不接收它。**
        // 两件事的对象根本不同：记录属于 attempt.account，而页面此刻可能已经换人了。
        // 先判页面再落盘的话，"A 的回调晚于换人"会直接 return —— 服务端那张订单已经
        // 建成，A 手上却一条线索都没有，A 回来只会再提交一次。
        // **落盘失败必须当真**：rememberOrderId 写完把 orderId 一起读回来核对，
        // 核不上返回 null —— 那时订单是真的，而本机已经指不回它了。
        const recoveryUnsaved = !!orderId
          && !idem.rememberOrderId(attempt.account, attempt.fingerprint, attempt.key, orderId)
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
        attempt.settled = true
        // 同一个人：这份草稿已被这张订单消费掉，清干净。
        // 清理放在跳转**之前**：原先放在 redirectTo 的 success 回调里，跳转一旦没触发
        // （异常路径、页面已被替换），草稿就永远留在本机，下一位打开确认页还能看到。
        wx.removeStorageSync('temp_package_data')
        wx.removeStorageSync('temp_selected_store')
        // orderId 没能落进本机记录。**这一支不跳转、不解锁、不重试**：跳转成功的回调会
        // 把整条记录清掉，而此刻记录里剩下的正是唯一还有用的东西 —— 那个幂等键。
        // 清掉它，用户带同一份材料包回来时会铸一个新键，服务端于是再建一张、再收一次钱。
        if (recoveryUnsaved) { this._lockAfterCreatedUnsaved(orderId); return }
        // 只把 orderId 交给下一页。到机码 / 金额 / 有效期一律由 package-code 自己带登录态
        // 向服务端查（GET /orders/package/:id 有 requireOwned 归属校验），不经 URL 传递 ——
        // 否则一条构造出来的链接或一张转发出去的卡片就能渲染出一张带到机码的「创建成功」页。
        //
        // 跳转失败必须接住：不接的话页面会永远停在「提交中…」，而订单其实已经建好了 ——
        // 用户只会以为没下成，然后再点一次。
        wx.redirectTo({
          url: '/pages/package-code/package-code?orderId=' + encodeURIComponent(orderId),
          // **确实跳走了才清记录。** 拿到 200 就清的话，跳转失败会把唯一能找回这张
          // 订单的线索一起丢掉，而页面还留在原地 —— 用户只会再点一次。
          success: () => this._forgetIdempotencyRecord(attempt.account, attempt.fingerprint),
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
        // 这一次确实没建成：解开尝试锁，让用户可以重试 —— **带着同一个键**。
        // 网络失败 / 5xx / 补签失败一律不清记录：那个键此刻可能正绑着一张已经建成、
        // 只是响应丢在路上的订单，清掉它下一次就会铸新键、再建一张。
        attempt.settled = true
        this._submitAttempt = null
        // 服务端说这个键配的是另一组参数（同键不同指纹）。**绝不拿旧键重试** ——
        // 重试一万次都是同一个 409。也不自动换新键：换键就是再建一张订单，那必须由
        // 用户自己按下「确认下单」才算数。这里只把状态摆好并说清下一步。
        if (err && err.statusCode === 409 && err.code === 'IDEMPOTENCY_KEY_REUSED') {
          this._needsFreshKey = true
          this.setData({
            submitting: false,
            submitErrorTitle: '这次提交的打印参数和上一次对不上',
            submitErrorText: '本机留着的下单标识是上一次那组参数的，服务端因此拒绝了这次提交（它不会重复建单）。再点一次「确认下单」会换一个新标识重新提交；上一次那张订单如果建成了，可到「我的 · 打印订单」查看。',
            submitRecover: 'orders',
          })
          return
        }
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
