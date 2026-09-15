// pages/print-pay/print-pay.js
//
// 单件云打印的最后一步：确认参数 → 建 Order-only 订单 → 去到机码页。
//
// 本页收到的 URL **只有 fileId / storeId / store（终端公开显示名）/ copies** 四项。
// 文件名与金额此前是从上一页拼在 URL 里传过来的，现在一律向服务端取：
//   - 金额与页数走 `POST /orders/quote`（与 print-upload 同一条报价链，服务端识别真实
//     页数并按 PriceConfig 计价）。前端不做任何单价乘法，也不把调用方给的数字当事实。
//   - 文件名走 `GET /me/documents`（本人文件元数据，带登录态）。
// 为什么非改不可：求职材料的文件名里常常就写着本人姓名（「张三的简历.pdf」），
// 而金额是本人订单状态。它们进了 URL，一条构造出来或转发出去的链接就能在别人手机上
// 把这些渲染出来。与 package-confirm → package-code、orders → print-pickup 同一口径。
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { createLifecycleGuard, isMemberIdentity, resolveAccountState, sameAccount } = require('../../utils/page-guard')

// MP-07 改法 (a)：标签只显示即将建单的真实参数，不从 query 猜彩色/双面。
// 与 print-upload.verifiedPrintParams 锁死同一组（verify-miniapp-static 抽取字面量）。
// 彩色/双面尚未通过真机验收，不能做 (b) 把 query 透传到报价/建单——那会按彩色收费或 400。
const ORDER_COLOR_MODE = 'black_white'
const ORDER_DUPLEX = 'simplex'

/**
 * 报价参数。**与下面 createCloudPrintOrder 用的是同两个常量**，
 * 两条链共用一个出口，就不可能出现「按一种参数报价、按另一种参数计价」。
 * 其余固定值与 print-upload 的 verifiedPrintParams 逐字一致。
 */
function quoteParams(copies) {
  return {
    copies,
    colorMode: ORDER_COLOR_MODE,
    duplex: ORDER_DUPLEX,
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
  }
}

function colorLabelOf(colorMode) {
  return colorMode === 'color' ? '彩色' : '黑白'
}

function duplexLabelOf(duplex) {
  return duplex === 'simplex' ? '单面' : '双面'
}

/** 分 → 元字符串。0 分是真的免费（试运营价目），不是「未知」，两者必须分开。 */
function formatYuan(amountCents) {
  return (amountCents / 100).toFixed(2)
}

Page({
  data: {
    statusBarHeight: 20,
    q: {},
    files: [{ name: '本人文件', price: '—' }],
    fee: { total: '—' },
    isFreeOrder: false,
    submitting: false,
    colorMode: ORDER_COLOR_MODE,
    duplex: ORDER_DUPLEX,
    colorLabel: '黑白',
    duplexLabel: '单面',
    pageCountLabel: '待服务端核定',
    copiesLabel: 1,
    // 报价状态：idle | loading | ready | error。金额与页数只有 ready 时才是真的。
    quoteState: 'idle',
    quoteError: '',
    // 订单已建成后的锁。再 POST 一次就是第二张订单（/me/print-orders 没有幂等键）。
    createdLocked: false,
  },

  onLoad(opts) {
    const q = opts || {}
    const copies = Number(q.copies) > 0 ? Number(q.copies) : 1
    // 稳定账号快照。**只放内存**，并且必须在任何一次破坏性 token 读取之前就存在：
    // auth.getToken() 在 JWT 过期时会连 user 一起清掉，事后再去读就没有账号 id 了。
    this._account = ''
    // 报价链的代次守卫（latest-wins）。**建单链不走它** —— 见 continueFlow：
    // 建单的判据只能是"这次尝试绑给了哪位账号"，切后台绝不能让已经建成的订单丢掉。
    this._guard = createLifecycleGuard()
    this._guard.activate()
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight || 20,
      q,
      colorMode: ORDER_COLOR_MODE,
      duplex: ORDER_DUPLEX,
      colorLabel: colorLabelOf(ORDER_COLOR_MODE),
      duplexLabel: duplexLabelOf(ORDER_DUPLEX),
      copiesLabel: copies,
    })
    this._loadQuote()
    this._loadFileName()
  },

  /**
   * 账号判定。判据是 page-guard.resolveAccountState 那一份（见那里的长注释）。
   *
   * 本页此前用的是「发起时记一个 `memberIdentityKey()`，回调时再读一次逐字比对」。
   * 它挡得住换人，**挡不住同一个人的 JWT 在这条链在途期间到点**：`auth.getToken()`
   * 过期时会先 `clearSession()` 把 token 与 user 一起清掉，于是回调那一刻读到的是
   * `''`，与发起时的 `'u:A'` 不等 —— 被判成"换了人"。对建单链来说这是要命的：
   * 服务端那张订单已经建出来了，而本页**不锁 `_createdOrderId`、还把按钮解开**，
   * 用户以为没下成，再点一次就是第二张订单和第二笔钱（`POST /me/print-orders`
   * 没有幂等键）。
   *
   * @returns {'changed'|'unusable'|'resignable'|'ok'} changed 时本函数已经复位了本页
   *   与上一位绑定的全部状态（建单锁 / 提交锁 / 报价 / 文件名），调用方不要再覆盖。
   */
  _resolveAccount() {
    const resolved = resolveAccountState(auth, this._account)
    if (resolved.state === 'changed') {
      this._account = ''
      this._resetForAccountChange(isMemberIdentity(resolved.identity))
      return 'changed'
    }
    this._account = resolved.account
    // 补签升级（`''` → `'u:<id>'`）不 +1 代次：那条刚被 request.js 救回来的报价响应
    // 正在路上，作废它只会让金额永远停在「正在核定」。adoptIdentity 只放行这一个方向。
    this._guard.adoptIdentity(resolved.account)
    return resolved.state
  },

  /**
   * 换了人 / 主动登出：把与上一位绑定的一切当场复位。
   *
   * 三件事缺一不可：
   *   ① 建单锁（`_createdOrderId` / `_createAttempt` / `createdLocked`）—— 留着的话
   *      B 的页面要么被 A 的订单锁死按不动，要么点「订单已创建」被带去 A 的到机码页。
   *   ② 提交锁（`submitting`）—— 留着 B 的按钮永远按不动。
   *   ③ 屏幕上属于 A 的展示（文件名常常就写着本人姓名、金额是本人订单状态）。
   *
   * `_guard.setIdentity('')` 会 +1 代次，把 A 在途的报价 / 文件名请求一并作废。
   */
  _resetForAccountChange(switched) {
    // 上一位的提交遮罩必须当场收起：本页已经复位成一张空白确认页，屏幕上却还盖着
    // 一张「正在提交…」——而那次提交已经不属于任何人了。
    this._releaseLoading(this._createAttempt)
    this._guard.setIdentity('')
    this._createdOrderId = null
    this._createAttempt = null
    this.setData({
      submitting: false,
      createdLocked: false,
      isFreeOrder: false,
      pageCountLabel: '待服务端核定',
      'fee.total': '—',
      'files[0].name': '本人文件',
      'files[0].price': '—',
      quoteState: 'error',
      quoteError: switched
        ? '当前账号与打开这一页时的不是同一个，已停止显示上一位的文件与金额。请返回重新选择文件。'
        : '登录状态已失效，请重新登录后返回重新选择文件。',
    })
  },

  /** 异步响应还能不能写进 data：账号没变（含补签升级）+ 本通道最新一次。 */
  _accepts(token) {
    const state = this._resolveAccount()
    if (state === 'changed' || state === 'unusable') {
      // 'changed' 时 _resolveAccount 已经复位并写好说明。'unusable' 没有人写 ——
      // 而金额那一块很可能正**为这条报价**转着圈，只 return 就是永远「正在核定」。
      if (state === 'unusable') this._failClosedQuote(token)
      return false
    }
    if (!sameAccount(token && token.identity, this._account)) return false
    return this._guard.accepts(token)
  },

  /**
   * 报价因身份不可用被拒收时，把金额那一块从「正在核定」里解出来。
   *
   * 触发它的是补签**失败**那条路：进入本页时 JWT 已经过期（快照还是空的），报价因为仍有
   * 补签资格而照常发出；`utils/request.js` 补签失败时调 `auth.logout()` **撤销资格**，
   * 再把原始 401 抛回来 —— 于是回调这一刻从 `'resignable'` 掉成 `'unusable'`，
   * 这一跳里快照始终是 `''`，不算换人，没有任何人把 `quoteState` 写回去。
   * 停在 `'loading'` 会同时锁死两条路：模板只在 `'error'` 时才给「重新核价」，
   * 而 `retryQuote` 又只在 `quoteState !== 'loading'` 时才动。
   *
   * 只管报价通道：文件名那条链失败本来就是静默的（它只是一个让用户确认"我选的是哪一份"
   * 的标签），在这里替它写一个金额错误会答非所问。
   * 也只在这条报价仍是当前那一条时才写 —— 切后台与 latest-wins 各有接手路径，
   * `_guard.accepts(token)` 一次把这两条都问掉。
   */
  _failClosedQuote(token) {
    if (!token || token.channel !== 'quote') return
    if (!this._guard.accepts(token)) return
    this.setData({
      quoteState: 'error',
      quoteError: auth.isLoggedIn()
        ? '当前会话缺少会员标识，无法核定本人订单金额。请重新登录一次。'
        : '登录状态已失效，请重新登录后再核价。',
    })
  },

  /**
   * 切后台 / 回前台。
   *
   * 回前台必须重新核一次账号：用户完全可能在这一页停留期间被静默登出，或者在另一页
   * 换了账号 —— 全程没有任何回调会通知本页，而屏幕上还挂着上一位的文件名、金额，
   * 以及一把指向上一位订单的建单锁。
   */
  onShow() {
    this._guard.activate()
    this._resolveAccount()
  },

  // 只在真正离开本页时作废在途的报价。**不在 onHide 作废**：建单成功后本页会
  // redirectTo 到取件页，而报价链断在半路只会让金额停在「正在核定」——
  // 切后台对一次报价来说不是安全边界（金额是本人自己的），换人才是，那条由
  // _resolveAccount 的 setIdentity 管。
  onUnload() {
    this._guard.deactivate()
  },

  /**
   * 服务端报价。金额与页数的**唯一来源**。
   *
   * 报价失败不挡下单：建单时服务端会自己计价，挡住等于用一次展示失败取消一次真实能力。
   * 但页面绝不本地补一个数字顶上 —— 只如实写「待服务端核定」（CLAUDE.md §9 不伪造能力）。
   */
  _loadQuote() {
    const { fileId } = this.data.q
    if (!fileId) {
      this.setData({ quoteState: 'error', quoteError: '这条链接没有带文件，请返回重新选择。' })
      return
    }
    const state = this._resolveAccount()
    // 'changed' 时 _resolveAccount 已经复位并写好说明，不要再覆盖它。
    if (state === 'changed') return
    if (state === 'unusable') {
      this.setData({
        quoteState: 'error',
        quoteError: auth.isLoggedIn()
          ? '当前会话缺少会员标识，无法核定本人订单金额。请重新登录一次。'
          : '金额由服务端按本人订单核定，请登录后再核价。',
      })
      return
    }
    // 'resignable'（JWT 自然过期但没人登出）照常发：request.js 拿到 401 会静默补签
    // 一次再重发。在本页先拦下来，金额就永远停在「正在核定」。
    //
    // 令牌是 R5 补上的第二层：此前这条链只比对身份，同一位用户连点两次「重新核价」
    // 时，先发的那次若后回来就会把后发那次的金额盖掉（服务端识别页数的耗时并不固定）。
    const token = this._guard.issue('quote')
    this.setData({ quoteState: 'loading', quoteError: '' })
    api.quoteMyPrintOrder(fileId, quoteParams(this.data.copiesLabel))
      .then((quote) => {
        if (!this._accepts(token)) return
        const amountCents = Number(quote && quote.amountCents)
        const billablePages = Number(quote && quote.billablePages)
        if (!Number.isSafeInteger(amountCents) || amountCents < 0
          || !Number.isSafeInteger(billablePages) || billablePages < 1) {
          throw new Error('服务端报价缺少有效页数或金额')
        }
        const isFreeOrder = amountCents === 0
        const total = isFreeOrder ? '免费' : formatYuan(amountCents)
        this.setData({
          quoteState: 'ready',
          quoteError: '',
          isFreeOrder,
          pageCountLabel: `${billablePages} 页`,
          'fee.total': total,
          'files[0].price': total,
        })
      })
      .catch((err) => {
        if (!this._accepts(token)) return
        this.setData({
          quoteState: 'error',
          quoteError: (err && err.message) || '暂时取不到服务端报价，金额将在到机时以服务端核定为准。',
        })
      })
  },

  retryQuote() {
    if (this.data.quoteState !== 'loading') this._loadQuote()
  },

  /**
   * 文件名只从**本人文件库**取，不从 URL 取。
   *
   * 取不到（翻页范围外、接口失败）就保留中性的「本人文件」，不猜、不回显 URL 里的值。
   * 这一步失败完全不影响下单：它只是一个让用户确认"我选的是哪一份"的标签。
   */
  _loadFileName() {
    const { fileId } = this.data.q
    if (!fileId) return
    const state = this._resolveAccount()
    // 与报价同口径：'resignable' 照常发，交给 request.js 补签。
    if (state === 'changed' || state === 'unusable') return
    const token = this._guard.issue('filename')
    api.getMyDocuments({ pageSize: 20 })
      .then((page) => {
        if (!this._accepts(token)) return
        const items = Array.isArray(page && page.items) ? page.items : (Array.isArray(page) ? page : [])
        const hit = items.find((doc) => doc && doc.id === fileId)
        if (hit && hit.filename) this.setData({ 'files[0].name': hit.filename })
      })
      .catch(() => {
        // 静默：标签取不到不该在确认页弹一个与下单无关的错误。
      })
  },

  /**
   * 收起**这次尝试自己挂上去的**那张遮罩。
   *
   * `wx.hideLoading()` 不是栈，它无条件掀掉当前屏幕上那一张，不管是谁挂的。于是
   * A 的迟到回调只要先调一次，就会把 B 正在进行的那次提交的遮罩掀掉 —— B 的按钮还锁着、
   * 请求还在飞，屏幕上却什么都没有了，用户会以为已经结束。所以遮罩要认主：
   * 谁挂的谁收，尝试被换掉之后就不再碰它。
   */
  _releaseLoading(attempt) {
    if (!attempt || !attempt.loading) return
    attempt.loading = false
    // 遮罩已经归后来那次提交了（换人复位之后 B 又点了一次）：不许碰。
    if (this._createAttempt && this._createAttempt !== attempt) return
    wx.hideLoading()
  },

  /**
   * 订单已经建出来之后的统一出口。
   *
   * 存在的唯一理由：**再 POST 一次就是第二张订单**（`POST /me/print-orders` 没有幂等键）。
   * 所以一旦拿到 orderId，本页就不再是一个可以下单的页面 —— 按钮变灰，
   * 并把恢复动作指向「我的 · 打印订单」，那里能找回这张订单、点进去就是到机码页。
   */
  _lockAfterCreated(orderId) {
    this._createdOrderId = orderId
    if (this._createAttempt) this._createAttempt.settled = true
    this._releaseLoading(this._createAttempt)
    this.setData({ submitting: false, createdLocked: true })
  },

  toOrders() {
    wx.navigateTo({ url: '/pages/orders/orders', fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },

  continueFlow() {
    const q = this.data.q
    if (this.data.submitting) return
    // 已经建过单：不再发第二次 POST，直接把人送去找那张订单。
    if (this._createdOrderId) { this._lockAfterCreated(this._createdOrderId); return }
    // 上一次尝试还没落定：POST 可能已经到了服务端，订单可能已经建出来了。
    // 这一条不能只靠 data.submitting —— 它是 setData 出去的，任何一条路径把它写回
    // false（R5 之前"换了人"那一支就是这么干的）按钮就又能按了，而服务端那张订单还在。
    if (this._createAttempt && !this._createAttempt.settled) return
    if (!q.fileId || !q.storeId) {
      wx.showModal({ title: '参数不完整', content: '请返回重新选择文件和终端。', showCancel: false })
      return
    }
    const state = this._resolveAccount()
    if (state === 'changed') return
    if (state !== 'ok') {
      // 建单必须有一个确定的会员身份：它会在服务端落一张带钱的订单。
      // 不像报价那样放行 'resignable' —— 报价拿错身份只是显示错，建单拿错身份是错账。
      wx.showModal({
        title: '请先登录',
        content: '下单前需要确认是本人账号，请重新登录一次再提交。',
        showCancel: false,
      })
      return
    }
    // **在 POST 发出之前**就把这一次尝试绑给当前这位账号。
    //
    // 回调那一刻的本地身份完全可能已经不可用（enduser JWT 只签 30 分钟，
    // 用户在确认页上多看两眼就到点了）。判据若是"回调时再读一次身份"，
    // 自然过期会被读成换人：订单其实已经建出来了，本页却不锁、还把按钮解开 ——
    // 用户以为没下成，再点一次就是第二张订单和第二笔钱（没有幂等键）。
    // 绑在尝试上的账号是发出那一刻的真值，过期清不掉它。
    const attempt = { account: this._account, settled: false, loading: true }
    this._createAttempt = attempt
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在提交…', mask: true })
    api.createCloudPrintOrder({
      fileId: q.fileId,
      terminalId: q.storeId,
      copies: Math.max(1, Number(q.copies) || 1),
      // 与上面 quoteParams 逐字同源（同两个常量）：报价与计价不会分叉。
      colorMode: 'black_white',
      duplex: 'simplex',
    }).then(order => {
      // 归属判定必须排在 hideLoading **之前**：hideLoading 无条件掀掉当前那张遮罩，
      // A 的迟到回调一旦先调它，掀掉的就是 B 正在进行的那次提交的遮罩。
      if (this._resolveAccount() === 'changed' || this._createAttempt !== attempt) {
        this._releaseLoading(attempt)
        return
      }
      this._releaseLoading(attempt)
      const orderId = (order && order.id) || ''
      if (!orderId) throw new Error('服务端未返回订单号')
      // 走到这里账号仍是发起时那位（含"JWT 刚好在途中自然过期"这一种）。
      // 从这一行起，这张订单在服务端已经存在：本页永远不许再 POST 第二次。
      // 锁必须在 redirectTo **之前**设 —— 跳转失败（或同步抛）时页面还留在这里，
      // 不设锁的话用户只会以为没下成，然后再点一次，于是多出一张订单和一笔钱。
      this._createdOrderId = orderId
      attempt.settled = true
      // 只把 orderId 交给下一页。到机码 / 金额 / 有效期 / 订单号 / 任务状态一律由
      // print-pickup 自己带登录态向 GET /me/print-orders/:orderId 取（requireOwned 归属校验）。
      wx.redirectTo({
        url: '/pages/print-pickup/print-pickup?orderId=' + encodeURIComponent(orderId),
        fail: () => this._lockAfterCreated(orderId),
      })
    }).catch(err => {
      // 同上：先判归属，再动遮罩。
      // 真的换了人 / 登出：这张订单（如果建成了）属于上一位，不锁当前这位的页面、
      // 也不把他带去别人的到机码。上一位的订单不会丢，它已落库，本人可从
      // 「我的 · 打印订单」找回。_resolveAccount 在 'changed' 时已经把这次尝试连同
      // 建单锁一起复位了，所以这里用"尝试还是不是刚才那一次"判定，
      // B 因此可以安全地发起自己的那一次。
      if (this._resolveAccount() === 'changed' || this._createAttempt !== attempt) {
        this._releaseLoading(attempt)
        return
      }
      this._releaseLoading(attempt)
      // 订单已经建成、只是后续动作抛错（例如 redirectTo 同步抛）：
      // 不能当成"下单失败"让用户重来 —— 重来就是第二张订单。
      if (this._createdOrderId) { this._lockAfterCreated(this._createdOrderId); return }
      // 这一次确实没建成（网络失败 / 服务端拒绝）：解开尝试锁，让用户可以重试。
      attempt.settled = true
      this._createAttempt = null
      this.setData({ submitting: false })
      wx.showModal({ title: '提交失败', content: (err && err.message) || '请稍后重试', showCancel: false })
    })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
