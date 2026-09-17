// pages/order-detail/order-detail.js
//
// 单件云打印订单的详情页。数据只来自 GET /me/print-orders/:orderId
//（needAuth + requireOwned 归属校验）。其中 pickupStatus==='pending' 时带回的
// pickupCode 就是**到机码** —— 拿着它就能到一体机上取件。所以本页和 print-pickup、
// orders 同属"屏幕上会出现本人凭证"的那一类，必须守住身份与请求代次。
//
// 此前本页只有 onLoad 里的一发请求，**没有任何身份生命周期**，四种真实链路全漏：
//   · 换人 / 登出后回到本页：上一位的到机码、文件名、金额原样留在屏幕上等着下一位看；
//   · utils/request.js 拿到 401 会静默续签，续签失败就 auth.logout() —— 全程没有任何
//     生命周期回调，页面还停在前台，那张码属于一个已经不存在的会话；
//   · 切后台 / 离开本页时在途的那一发回来照样写进 data，把刚清掉的码原样写回去；
//   · 重复进入 / 重试时两发乱序返回，旧的那发盖掉新的。
//
// 判据全部复用 utils/page-guard.js，与 print-pay / print-pickup 同一口径，不另起一套：
//   身份（resolveAccountState）+ 代次（onHide/onUnload/换人 +1）+ 逐通道 latest-wins。
// 其中"同一个人的 JWT 自然到点"必须与"换人 / 主动登出"分开 —— 前者要放行请求让
// request.js 去补签（enduser JWT 只签 30 分钟，早上下单下午来看详情必然命中），
// 后者要当场清场。那一层由 page-guard 的 RESIGNIN_ELIGIBLE 判据负责。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { createLifecycleGuard, isMemberIdentity, resolveAccountState, sameAccount } = require('../../utils/page-guard')

const STATUS_MAP = {
  pending:   '待取件',
  claimed:   '待取件',
  printing:  '打印中',
  completed: '已完成',
  failed:    '打印失败',
  cancelled: '已取消',
}

const STATUS_TONE = {
  pending: 'wheat', claimed: 'wheat', printing: 'teal',
  completed: 'ok', failed: 'danger', cancelled: 'neutral',
}

const ERROR_TITLE_DEFAULT = '加载失败，点此重试'
const ERROR_TITLE_SWITCHED = '账号已切换'
const ERROR_TITLE_SIGNED_OUT = '登录已失效'

const MSG_SWITCHED = '当前账号与打开这张订单时的不是同一个，已停止显示订单详情与到机码。请到「我的 · 打印订单」重新进入。'
const MSG_SIGNED_OUT = '登录已失效，请重新登录后再查看订单详情与到机码。'

function fmtCode(raw) {
  if (!raw) return ''
  const s = String(raw).replace(/\s/g, '').toUpperCase()
  // groups 判空：纯空白入参 replace 后为空串，match 返回 null，直接 .join 会 THROW
  const groups = s.match(/.{1,2}/g)
  return groups ? groups.join('-') : ''
}

function fmtPrice(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n === 0) return '免费'
  return '¥' + (n / 100).toFixed(2)
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function buildSpec(item) {
  const parts = []
  if (item.paperSize)     parts.push(String(item.paperSize).toUpperCase())
  if (item.colorMode)     parts.push(item.colorMode === 'color' ? '彩色' : '黑白')
  if (item.copies)        parts.push(`${item.copies} 份`)
  if (item.billablePages) parts.push(`共 ${item.billablePages} 页`)
  return parts.join(' · ') || '—'
}

function canCancelCloudOrder(raw) {
  return !raw.status
    && raw.payStatus === 'unpaid'
    && raw.pickupStatus === 'pending'
}

function toDetail(raw) {
  const status = raw.status || raw.taskStatus || ''
  const pickupRaw = (!raw.status && raw.pickupStatus === 'pending') ? (raw.pickupCode || '') : ''
  return {
    fileName:     raw.fileName || '打印文件',
    store:        raw.terminalDisplayName || raw.terminalName || raw.storeName || '打印服务终端',
    spec:         buildSpec(raw),
    price:        fmtPrice(raw.amountCents),
    statusLabel:  STATUS_MAP[status] || status || '未知',
    statusTone:   STATUS_TONE[status] || 'neutral',
    pickup:       fmtCode(pickupRaw),
    createdAt:    fmtTime(raw.createdAt),
    payStatus:    raw.payStatus || '',
    pickupStatus: raw.pickupStatus || '',
    canCancel:    canCancelCloudOrder(raw),
  }
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    error: '',
    errorTitle: ERROR_TITLE_DEFAULT,
    detail: null,
    cancelling: false,
  },

  onLoad(options) {
    this._orderId = (options && options.orderId) || ''
    this._toDetail = toDetail
    // 稳定账号快照。**只放内存**，并且必须在任何一次破坏性 token 读取之前就存在 ——
    // auth.getToken() 在 JWT 过期时会连 user 一起清掉，事后再去读就没有账号 id 了。
    this._account = ''
    // 开页那位（不随清场销毁）与「已经换给别人了」的粘性标记。见 _resolveAccount。
    this._openerAccount = ''
    this._foreignBlocked = false
    // 取消链的去重锁。必须显式初始化：留成 undefined 不影响判断，但显式写出来才能
    // 和 _clearSensitive 里的释放对上。
    this._cancelLock = false
    this._guard = createLifecycleGuard()
    this._guard.activate()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    // **绑定开页那位的唯一时刻**：本页刚被导航打开，此刻登录着的那位就是把这张
    // orderId 带进来的那位。之后任何身份跳变都能被 resolveAccountState 与 foreign 判据
    // 看出来。取数交给紧随其后的 onShow —— 真机上 onLoad 之后必然走一次 onShow，
    // 两边都发就是同一份详情连打两发。
    this._resolveAccount(true)
  },

  /**
   * 账号判定 + **当场清场**。每个入口和每个异步回调都要过这里。
   * 判据是 page-guard.resolveAccountState 那一份（四态，见那里的长注释）。
   *
   * @param {boolean} [bindOwner] 只有 onLoad 传 true。
   * @returns {'changed'|'unusable'|'resignable'|'ok'} 'changed' 时本函数已经清场并写好
   *   说明，调用方直接返回，不要再覆盖。
   */
  _resolveAccount(bindOwner) {
    const resolved = resolveAccountState(auth, this._account)

    if (isMemberIdentity(resolved.account) && !this._openerAccount && bindOwner === true) {
      this._openerAccount = resolved.account
    }

    // 「换成了别人」的判据是**当前这位是不是开页那位**，不是"这一跳里身份变没变"。
    // 后者只认得 A→B 这一种连续跳变，认不出更常见的那一种：A 登出（快照被清成 ''）
    // → B 登录 → 回到本页 onShow。那一跳在状态机眼里是 '' → 'u:B' = 一次正常的补签
    // 升级 = 'ok'，于是本页会拿着**开页那位**的 orderId、带着 B 的登录态去请求
    //（服务端 requireOwned 必然 404，但请求已经代表 B 发出去了）。
    const foreign = isMemberIdentity(this._openerAccount)
      && isMemberIdentity(resolved.identity)
      && resolved.identity !== this._openerAccount

    // 开页那位自己回来了：解除粘性封锁。登出不粘（identity 为 ''），
    // 所以同一位登出再登回来照样能恢复这一页。
    if (this._foreignBlocked && isMemberIdentity(resolved.identity) && !foreign) {
      this._foreignBlocked = false
    }

    if (foreign || resolved.state === 'changed') {
      if (foreign) this._foreignBlocked = true
      this._account = ''
      // 身份一变，在途那一发就不再属于本页任何状态：setIdentity('') +1 代次，
      // 把上一位在途的详情 / 取消请求一并作废。只清 data 不作废请求的话，
      // 那几个迟到的响应会把上一位的到机码原样写回来。
      this._guard.setIdentity('')
      const switched = foreign || isMemberIdentity(resolved.identity)
      this._clearSensitive({
        loading: false,
        errorTitle: switched ? ERROR_TITLE_SWITCHED : ERROR_TITLE_SIGNED_OUT,
        error: switched ? MSG_SWITCHED : MSG_SIGNED_OUT,
      })
      return 'changed'
    }

    // 已经换给别人、而现在既不是开页那位也不是别人（登出 / 会话缺 id）：
    // 保持已经写好的说明，一个请求都不发。
    if (this._foreignBlocked) {
      this._account = ''
      return 'changed'
    }

    // 'ok' 采纳新账号；'resignable' 原样留住上一位的快照（那正是"还是同一位"的凭据，
    // 丢了它下一次就会把自然过期误判成登出）；'unusable' 快照本来就是空。
    this._account = resolved.account
    // 补签升级（'' → 'u:<id>'）不 +1 代次：那条刚被 request.js 救回来的响应正在路上，
    // 作废它只会让页面永远停在 loading。adoptIdentity 只放行这一个方向。
    this._guard.adoptIdentity(resolved.account)
    return resolved.state
  },

  /** 这条响应还能不能写进 data：账号没变（含补签升级）+ 页面在前台 + 本通道最新一次。 */
  /**
   * 代次 / 通道 / 账号三层。**不回答"这一页是谁的"** —— 那是 _confirmOwner 的事。
   *
   * 失败响应只走这一层：写一句错误文案不涉及任何本人数据，不该要求归属；
   * 更要紧的是失败**不得**建立归属 —— 服务端恰恰拒绝了这个账号。
   */
  _verifyChannel(token) {
    const state = this._resolveAccount()
    if (state === 'changed') return false
    if (state === 'unusable') {
      // 'changed' 时 _resolveAccount 已经写好说明，'unusable' 没有人写 ——
      // 而页面很可能正**为这条响应**停在「正在加载订单详情…」上，只 return 就是永远转圈。
      this._failClosed()
      return false
    }
    if (!sameAccount(token && token.identity, this._account)) return false
    return this._guard.accepts(token)
  },

  /**
   * 成功响应能不能写屏。'accept' | 'confirm' | 'drop'
   *
   * 比 _verifyChannel 多问一句**这一页到底是谁的** —— 而这一句恰恰是代次 / 通道 /
   * 账号三层合起来也回答不了的（见 R12 的长注释）。
   */
  _verify(token) {
    if (!this._verifyChannel(token)) return 'drop'
    if (this._confirmOwner(token)) return 'accept'

    // 归属没能建立。只有「发出时归属未定」那一发值得追一发确认请求：它已经把
    // request.js 的 401 静默补签触发过一次，此刻本地可能已经有确定账号了。
    // 发出时就带着确定账号的那一发走到这里只说明归属对不上（比如开页那位不是这位），
    // 一律丢弃 —— 否则确认请求自己又会触发确认，成为一个打不完的循环。
    return isMemberIdentity(token && token.identity) ? 'drop' : 'confirm'
  },

  /**
   * 归属由**服务端**认下来 —— 这是本页唯一能在 onLoad 之外建立 `_openerAccount` 的路。
   *
   * 判据是"这一发是**带着哪个已知账号**发出去的"，不是"回调这一刻本地是谁"。后者是
   * R10 栽的那一跤：`auth.saveSession` 不需要任何生命周期回调，于是在途期间静默登录
   * 进来的另一位会被原样读成"补签回来的本人"。这一条不依赖回调时读到的任何东西：
   *   ① `token.identity` 在**发出请求之前**就是一个确定的会员键；
   *   ② 服务端的 requireOwned 按发出这一发时的登录态校验了归属，并返回了 200；
   *   ③ 这中间没有发生过身份跳变 —— 快照非空时 `resolveAccountState` 看得见
   *      `'u:A' → 'u:B'`，那一跳会先一步走 'changed' 清场，根本到不了这里；
   *      这里再核一次 `token.identity === this._account` 把它钉死。
   *
   * `_openerAccount === ''` 就是"这一页还没有人认领"—— 那时任何响应都不许写屏。
   * 这一句必须**无条件**问，不能挪到成功之后"顺手补登记"：R11 就是那么写的，
   * 于是归属未定那一发照样先把 A 的到机码渲染给了 B。
   */
  _confirmOwner(token) {
    if (this._openerAccount) return this._openerAccount === this._account
    if (!isMemberIdentity(token && token.identity)) return false
    if (token.identity !== this._account) return false
    this._openerAccount = token.identity
    return true
  },

  /**
   * 追一发确认请求。
   *
   * 调用时机只有一处：一发**发出时归属未定**的请求刚刚成功落定。它的 200 什么都
   * 证明不了，但它已经把 request.js 的 401 静默补签触发过一次；如果此刻本地已经有了
   * 确定账号，就拿它再问服务端一次 —— 那一发才是能定归属的那一发。
   *
   * 这就是"过期开页"要多走一个来回的地方。多出来的那一次往返换掉的是一条永久
   * fail-closed：本人照常能恢复显示，而别人只会拿到服务端的 404。
   */
  _requestOwnerConfirmation() {
    if (!this._guard.isActive()) return
    // 本地仍然认不出人（补签也没救回来）：没有账号可以拿去问，只能 fail-closed。
    if (!isMemberIdentity(this._account)) { this._failClosed(); return }
    this._load()
  },

  /**
   * 清掉屏幕上属于某一位的一切：到机码、文件名（常常就写着本人姓名）、金额、
   * 终端、状态，以及那把「正在取消…」的遮罩锁。
   *
   * 这些字段全挂在 detail 上，所以 detail 置空即清场；cancelling 单独放，
   * 留着它 B 的按钮会永远按不动。
   */
  _clearSensitive(patch) {
    const next = { detail: null, cancelling: false }
    if (patch) {
      for (const key of Object.keys(patch)) next[key] = patch[key]
    }
    this.setData(next)
  },

  /** 身份不可用（从没登录 / 已登出 / 登录着却拿不到会员 id）：fail-closed。 */
  _failClosed() {
    this._clearSensitive({
      loading: false,
      errorTitle: ERROR_TITLE_SIGNED_OUT,
      error: MSG_SIGNED_OUT,
    })
  },

  onShow() {
    this._guard.activate()
    // 回前台必须重新核一次账号并重新取数：用户完全可能在本页停留期间被静默登出，
    // 或者在另一页换了账号 —— 全程没有任何回调会通知本页，而屏幕上还挂着上一位的
    // 到机码。同一位账号则照常刷新（订单状态、到机码有效性都会在这期间变）。
    this._load()
  },

  // 切后台 / 离开本页：在途请求全部作废（deactivate 会 +1 代次），**并且当场把
  // 凭证从 data 里清掉**。只作废请求不清 data 是不够的：一体机与共用手机上，
  // 上一位切出去之后那张到机码仍然留在页面对象里，回到本页的第一帧就会把它画出来。
  // 下一次 onShow 会重新取数，真属于当前这位的详情会再写回来。
  onHide() {
    this._guard.deactivate()
    // 页面还活着，切回来时会**先按 data 渲染一帧**再走 onShow —— 所以这里必须走
    // setData 让视图层真的清掉，否则回到本页的第一帧就是上一位的到机码。
    this._clearSensitive({ loading: true, error: '', errorTitle: ERROR_TITLE_DEFAULT })
  },

  onUnload() {
    this._guard.deactivate()
    // **这里不走 setData。** 页面正在销毁：视图不会再渲染一帧，而真机上对已卸载的
    // 页面调 setData 会被框架告警（也确实没有意义）。这一步要的只是"别让这个页面
    // 对象继续持有上一位的凭证"—— 直接把内存里那一份清掉即可，效果与 setData 等价。
    // 「迟到的响应不得复活凭证」由上一行的 deactivate() 保证（active=false 且代次 +1），
    // 不依赖这里清没清。
    this.data.detail = null
    this.data.cancelling = false
  },

  _load() {
    const state = this._resolveAccount()
    if (state === 'changed') return
    if (state === 'unusable') { this._failClosed(); return }
    if (!this._orderId) {
      this.setData({ loading: false, errorTitle: '无法打开订单', error: '订单 ID 缺失' })
      return
    }
    const token = this._guard.issue('detail', { orderId: this._orderId })
    this.setData({ loading: true, error: '', errorTitle: ERROR_TITLE_DEFAULT })
    api.getCloudPrintOrder(this._orderId)
      .then((raw) => {
        // _verify 内部会**先执行**账号判定：换人 / 前台静默登出时，光丢弃这条响应
        // 不够 —— 屏幕上已经渲染出来的到机码要在这一刻就清掉。
        const verdict = this._verify(token)
        // 这一发发出时归属未定：它的 200 证明不了这一页是谁的。追一发带着确定账号的
        // 确认请求，由服务端来回答归属；在那之前一个字节都不写屏。
        if (verdict === 'confirm') { this._requestOwnerConfirmation(); return }
        if (verdict !== 'accept') return
        this.setData({
          loading: false,
          cancelling: false,
          detail: toDetail(raw),
        })
      })
      .catch((err) => {
        // 401 走到这里说明 request.js 连静默续签都没救回来（它续签失败时会 auth.logout()）。
        // 那一刻起页面上的到机码属于一个已经不存在的会话 —— _verify 里的账号判定
        // 会当场把它清掉，不必等用户离开本页再回来。
        //
        // 失败**不追确认请求、也不建立归属**：确认请求是为"归属未定那一发成功了、
        // 但证明不了归属"准备的。失败时既没有归属可证，也没有内容可写；照追就会在
        // 服务端持续 404（B 拿着 A 的 orderId）时变成一个打不完的循环。
        if (!this._verifyChannel(token)) return
        this.setData({
          loading: false,
          errorTitle: ERROR_TITLE_DEFAULT,
          error: (err && err.message) || '加载失败，请稍后重试',
        })
      })
  },

  retry() { this._load() },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.navigateTo({ url: '/pages/orders/orders' }) } })
  },

  toPrint() {
    wx.navigateTo({ url: '/pages/documents/documents' })
  },

  cancelOrder() {
    const detail = this.data.detail
    if (!this._orderId || !detail || !detail.canCancel || this.data.cancelling) return
    // 换人 / 登出之后不该再弹出一张写着上一位订单的确认框。
    const state = this._resolveAccount()
    if (state === 'changed' || state === 'unusable') return
    wx.showModal({
      title: '取消订单',
      content: '取消后到机码立即失效，且不能恢复。确定取消这张未付款订单？',
      confirmText: '确认取消',
      cancelText: '再想想',
      confirmColor: '#b5643c',
      success: (res) => {
        if (!res.confirm) return
        this._submitCancel()
      },
    })
  },

  _submitCancel() {
    if (this._cancelLock) return
    const detail = this.data.detail
    if (!this._orderId || !detail || !detail.canCancel) return
    // 确认框停留期间完全可能已经换了人：这里再判一次，不要拿 B 的登录态去取消 A 的订单。
    const state = this._resolveAccount()
    if (state === 'changed' || state === 'unusable') return
    this._cancelLock = true
    // 取消**独占一个通道**：详情刷新（onShow 每次都会发）不该让在途的取消失效，
    // 反过来也一样 —— 两者写的是同一批字段，但有各自的因果。
    const token = this._guard.issue('cancel', { orderId: this._orderId })
    this.setData({ cancelling: true })
    api.cancelCloudPrintOrder(this._orderId)
      .then((raw) => {
        if (this._verify(token) !== 'accept') return
        // **跨通道因果**：取消成功意味着服务端此刻已经把到机码作废了（本页自己那句
        // 「取消后到机码立即失效，且不能恢复」说的就是这件事）。而**更早发出、
        // 仍在途**的那一发详情带着取消之前的 pending + 到机码，它在自己通道上还是
        // "最新一次"，逐通道 latest-wins 拦不住它 —— 落地就是把一张已经失效的码
        // 重新画回屏幕，连「取消订单」按钮都会跟着解开。
        //
        // 在 detail 通道上空领一个序号（不发请求）：latest-wins 随即把所有更早的
        // 详情响应判成过期。用的是守卫本来就有的那套判据，不另起一个状态。
        this._guard.issue('detail')
        this.setData({
          cancelling: false,
          detail: toDetail(raw),
        })
      })
      .catch((err) => {
        if (!this._verifyChannel(token)) return
        this.setData({ cancelling: false })
        wx.showModal({
          title: '取消失败',
          content: (err && err.message) || '请稍后重试',
          showCancel: false,
        })
      })
      // 去重锁**无条件**交还：被守卫丢弃的那一发也必须放锁，否则"再取消一次"会是一个
      // 按不动的按钮。屏幕上的 cancelling 遮罩由清场那一步收起（_clearSensitive）。
      .then(() => { this._cancelLock = false })
  },
})
