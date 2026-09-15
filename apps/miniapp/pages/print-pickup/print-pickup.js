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
const { isMemberIdentity, resolveAccountState, sameAccount } = require('../../utils/page-guard')
const { PICKUP_CODE_RE, createPickupQrMatrix, normalizePickupCode } = require('../../utils/pickup-qrcode')

const POLL_INTERVAL_MS = 3000
const TERMINAL_STATES = new Set(['completed', 'failed', 'expired', 'cancelled', 'abandoned'])

/**
 * 屏幕上那张码还能被信任多久（毫秒）。
 *
 * 轮询失败时的取舍：用户此刻正站在一体机前，一次网络抖动就把码撤下是实打实的能力退化；
 * 可**一旦他把码扫掉**，服务端就不再下发 pickupCode，而我们恰好因为拉不到状态而不知道
 * 这件事 —— 继续显示的是一张已经被核销的码。它还会带着倒计时和"等待终端扫码"的说明，
 * 用户会反复去扫一张不可能再被受理的码。
 *
 * 所以只在「最近一次**服务端确认**还够新」时保留：抖动（3 秒一轮，容得下四五次失败）
 * 照常显示，持续拉不到状态则把凭证清零并说清原因。判据是「多久没被确认过」，
 * 不是「失败了几次」—— 后者会被一次成功的空响应重置，而我们要的是新鲜度。
 */
const CODE_TRUST_WINDOW_MS = 15000

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

/**
 * 归属存疑时给用户的话。
 *
 * 和"换了账号"分开写：那一句说的是"我知道换了人"，这一句说的是**"我认不出这一页
 * 该属于谁"** —— 后者更弱，也更该说实话。两句的落点都是「我的 · 打印订单」：
 * 那里会用当前这位的登录态重新列一遍，属于他的订单自然在，不属于他的自然不在。
 */
const OWNER_AMBIGUOUS_MESSAGE = '这张到机码是用另一次登录打开的，现在无法确认它属于谁，已停止显示。请到「我的 · 打印订单」重新进入。'

Page({
  _countdownTimer: null,
  _pollTimer: null,
  _polling: false,
  _pageReady: false,
  _visible: true,
  // 归属存疑（粘性）。见 _resolveIdentity 里 bindOwner 那一段。
  _ownerAmbiguous: false,
  // 请求代次。身份变化 / 归属存疑都会 +1，在途的那一发就此不再属于本页任何状态。
  _requestEpoch: 0,
  // 当前在途那一发的令牌（对象身份即标识）。它不等于 `_polling`：
  // `_polling` 只回答"要不要再打一发"，令牌回答"回来的这条是不是那一发"。
  _inflight: null,
  // 本页自己把用户送去登录页之后的一次性回程标记。见 recover / onShow。
  _loginHandoff: false,

  data: {
    statusBarHeight: 20,
    state: 'loading', // loading | ready | error
    errorMsg: '',
    // 错误态的可执行下一步：'login' 去登录 / 'retry' 重新加载 / 'orders' 去我的打印订单。
    // 只给一句「加载失败」等于把解法藏起来 —— 登录已失效时按一百次「重新加载」也不会好。
    errorAction: 'retry',
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
    // 稳定账号快照。**只放内存**，并且要在任何一次破坏性 token 读取之前就存在 ——
    // auth.getToken() 在 JWT 过期时会连 user 一起清掉，事后再去读就没有账号 id 了。
    this._account = ''
    // 开页那位（不随清场销毁）与"已经换给别人了"的粘性标记。见 _resolveIdentity。
    this._openerAccount = ''
    this._foreignBlocked = false
    // 归属存疑（粘性）、请求代次、在途令牌、登录回程标记：都必须在这里显式初始化 ——
    // 留成 undefined 时 `token.epoch !== this._requestEpoch` 会恒真，把本人的响应也挡掉。
    this._ownerAmbiguous = false
    this._requestEpoch = 0
    this._inflight = null
    this._loginHandoff = false

    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      orderId,
      fromOrders: q.source === 'orders',
      qrSizePx,
      qrStatus: 'loading',
      state: orderId ? 'loading' : 'error',
      errorMsg: orderId ? '' : '这条链接没有带订单号，本页不展示任何到机码。请回到「我的 · 打印订单」重新进入。',
      errorAction: orderId ? 'retry' : 'orders',
    })

    // onLoad 的这一次判定是**绑定开页那位**的两个合法时刻之一（见 _resolveIdentity）：
    // 本页刚被导航打开，此刻确定登录着的那位就是把这张 orderId 带进来的那位。
    if (orderId) this._refreshOrder(true, true)
  },

  /**
   * 身份判定。**四态，不能压成布尔**，判据是 page-guard.resolveAccountState 那一份。
   *
   *   'changed'    真的换了人（u:A → u:B）/ 主动登出 / 掉成「登录着却没有会员 id」。
   *                本函数已经清场并写好说明，调用方直接返回。
   *   'ok'         当前是一个确定的会员身份：可以取数，可以显示码。
   *   'resignable' 本地已经没有可用 token（enduser JWT 只签 30 分钟，中午下单下午到机器
   *                前打开必然已经过期），但**仍有补签资格**（曾登录过且没有主动登出）。
   *   'unusable'   从没登录 / 已登出 / 无会员 id，且本页本来也没显示过任何本人数据。
   *
   * R4 修掉了"未登录/无 id/过期三种情况合流成永久 loading"；**R5 修的是它的另一半**：
   * 当时 'resignable' 只在「当前身份与快照**相等**」时才可能出现，而快照存的是上一次
   * 读到的原始身份键。于是"码已经显示出来之后 JWT 才自然过期"这条真实路径 ——
   * 快照 `'u:A'`、当前 `''`（getToken() 过期时先 clearSession 把 user 一起清了）——
   * 恰好落进最后那条「从确定的本人掉成不可用」，被当成主动登出：当场清码、写一句
   * 「登录已失效」、**一个请求都不发**，于是 request.js 的 401 静默补签永远没机会跑。
   * 用户手上那张码服务端其实还认。
   *
   * 现在快照改成**稳定账号快照** `this._account`（只放内存，换人/登出时当场销毁），
   * 自然过期与主动登出由 RESIGNIN_ELIGIBLE 这面持久旗子区分 —— 页面造不出这面旗子。
   */
  _resolveIdentity(bindOwner) {
    const resolved = resolveAccountState(auth, this._account)

    // 开这一页的是谁，单独记一份，**不随清场销毁**（this._account 在换人/登出时必须
    // 当场销毁，它是"上一次见到谁"的快照）。
    //
    // ── R9：**绑定的时机比绑定本身更要紧。** ──────────────────────────────
    // 上一版是"只要看见一个确定的会员键、而且还没绑过，就把它认作开页那位"。它默认了
    // "能看见的那位一定是开页那位" —— 而这个默认在一条真实且高频的路径上不成立：
    // 打开本页时 A 的 enduser JWT（只签 30 分钟）**已经**自然到点，于是快照、开页账号、
    // 发起账号三个全是空串，请求照常带着补签资格发出去（R4-1 起就是这么设计的，
    // 不能改）。在途期间 B 登录、回到本页 —— `onShow` 走到这一行时 `_openerAccount`
    // 还是空的，于是**后来登录的 B 被记成了开页那位**；A 的迟到 200 回来时，
    // 开页那位、当前这位全都指向 B，归属判定一路放行，A 的取件凭证就画在了 B 的屏幕上。
    // R8-B3 钉住的三条判据一条都没救到它：那三条全在 `'resignable'` 分支里，
    // 而这条路走的是 `'ok'`。
    //
    // 所以绑定只发生在两个**说得清因果**的时刻，由调用方传 bindOwner 指定：
    //   ① `onLoad` 的第一次判定 —— 本页刚被导航打开，此刻确定登录着的那位就是它的主人；
    //   ② 本页**自己打出去的那一发**（发出时归属未定）的回调里，且页面仍然可见 ——
    //      那个身份是 request.js 为**这一发**静默补签回来的，因果落在本页自己身上；
    //      页面不可见时不绑，那段时间里发生的登录与本页无关（用户已经去了别的页）。
    // 外加一个一次性窗口：本页自己把用户送去登录页之后回来的第一次 onShow（见 onShow）。
    if (isMemberIdentity(resolved.account) && !this._openerAccount && bindOwner === true) {
      this._openerAccount = resolved.account
    }

    // 认不出主人的时候冒出来的确定身份：**说不清**它是不是这张 orderId 的主人。
    // 说不清就不写屏、不发请求，并把在途那一发的代次作废（它的归属同样说不清）。
    //
    // 粘性。本页此后一律 fail-closed —— 用户从「我的 · 打印订单」重新进来会拿到一页
    // 干净的新实例，那时的绑定是说得清的（那条路已由 R9-A2 钉住）。代价是
    // "开页时已过期、且恰好在那一发请求飞着的时候被切走/被别人登录"要多走一次导航；
    // 收益是这一页从此不可能把一张取件凭证画给一个认不出来的会话。
    if (isMemberIdentity(resolved.account) && !this._openerAccount && !this._ownerAmbiguous) {
      this._ownerAmbiguous = true
      this._invalidateInflight()
    }

    // 「换成了别人」的判据是**当前这位是不是开页那位**，不是"这一跳里身份变没变"。
    //
    // 后者只认得 A→B 这一种连续跳变，认不出真实链路里更常见的那一种：
    // A 登出（`'u:A' → ''`，快照被清成 `''`）→ B 登录 → 回到本页 onShow。
    // 那一跳在状态机眼里是 `'' → 'u:B'` = 一次正常的补签升级 = `'ok'`，
    // 于是本页会拿着**开页那位**的 orderId、带着 B 的登录态去
    // GET /me/print-orders/:orderId（服务端 requireOwned 必然 404，但请求已经代表 B
    // 发出去了）。按"当前这位是谁"判就没有这个缺口：中间隔了几跳都一样。
    const foreign = isMemberIdentity(this._openerAccount)
      && isMemberIdentity(resolved.identity)
      && resolved.identity !== this._openerAccount

    // 开页那位自己回来了：解除粘性封锁。登出不粘（identity 为 `''`），
    // 所以同一位 A 登出再登回来照样能恢复这一页。
    if (this._foreignBlocked && isMemberIdentity(resolved.identity) && !foreign) {
      this._foreignBlocked = false
    }

    if (this._ownerAmbiguous || foreign || resolved.state === 'changed') {
      // 真的换了人，或主动登出（补签资格已被撤销），或归属根本说不清：
      // **当场清掉屏幕上的码**。真实链路里这一步没有任何生命周期回调 ——
      // request.js 续签失败时调 auth.logout()，页面还停在前台，而那张已经渲染好的码
      // 属于一个已经不存在的会话。共用设备上就是下一位看到它。
      if (foreign) this._foreignBlocked = true
      // 身份一变，在途那一发就不再属于本页任何状态：代次作废 + **当场把去重锁交还**。
      // 只清屏不放锁的话，「重新加载」会是一个按不动的按钮，要等那发不属于任何人的
      // 请求自己落定 —— 而什么时候落定是网络说了算。
      this._invalidateInflight()
      this._account = ''
      this._stopTimers()
      this._clearCredentials()
      const switched = this._ownerAmbiguous || foreign || isMemberIdentity(resolved.identity)
      this.setData({
        state: 'error',
        refreshing: false,
        errorMsg: this._ownerAmbiguous
          ? OWNER_AMBIGUOUS_MESSAGE
          : (switched
            ? '当前账号与打开这张到机码时的不是同一个，已停止显示。请到「我的 · 打印订单」重新进入。'
            : '登录已失效，请重新登录后再查看到机码。'),
        errorAction: switched ? 'orders' : 'login',
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
    return resolved.state
  },

  /**
   * 这条**成功**响应的归属说得清吗 —— 它属于当前还在看这一页的这位吗。
   *
   * 只有 `'ok'` 与 `'resignable'` 两种状态可能放行，而且**两种走的是同一组判据**。
   *
   * `'resignable'` 为什么必须能放行：请求在 `'ok'` 状态下带着 A 的登录态发出去 →
   * 服务端按 requireOwned 校验过归属、返回 200 → 而就在响应回来的路上，A 的 enduser
   * JWT（只签 30 分钟）自然到点。没有任何人登出，服务端那张码也还是好的。R5 之前
   * 这里只认 `state === 'ok'`，于是把这条**刚刚被服务端确认过属于 A** 的响应当成
   * "身份说不清"，当场清码、写一句「请登录」—— 用户站在一体机前，手里的码没了，
   * 而它其实一直有效。
   *
   * `'ok'` 为什么**不能**无条件放行（R9 修的就是这一行）：`'ok'` 只说"此刻有一个确定
   * 的会员身份"，它不说这个身份和**这一发请求**、和**这一页的 orderId** 是什么关系。
   * 开页时 JWT 已经过期的那条路上（快照 / 开页账号 / 发起账号三个全是空串），
   * 在途期间换上来的 B 同样会让 `_resolveIdentity` 返回 `'ok'` —— 于是 A 的迟到 200
   * 被判成"属于当前这位"，画在了 B 的屏幕上。
   *
   * 四条判据，缺一不可（顺序即代价从低到高）：
   *   ① **代次**：`token.epoch` 仍是当前代次。身份变化 / 归属存疑都会 +1，
   *      在途那一发就此作废 —— 这是唯一一条不依赖"回调时读到谁"的判据。
   *   ② **归属没存疑**（也没被粘性 foreign 封锁）。
   *   ③ **当前这位**是一个确定的会员键，并且**就是开页那位** —— 本页的 orderId 属于他。
   *   ④ **发起这一发的那位**与**发出时的开页那位**都对得上当前这位。只放行一种不相等：
   *      `'' → 'u:<id>'`（`sameAccount`），也就是"发出时本地认不出人、回来时
   *      request.js 为这一发补签成功"。而这一种能被采信，靠的正是 ① ——
   *      中途只要有别的身份冒出来，代次早就不一样了。
   *
   * `'changed'` / `'unusable'` 与 401 一律不走这里。
   *
   * @param {string} state `_resolveIdentity` 在**回调那一刻**重新判出来的状态
   * @param {?{account:string, opener:string, epoch:number}} token 发请求前领的令牌
   */
  _ownsResponse(state, token) {
    if (state !== 'ok' && state !== 'resignable') return false
    if (!token || token.epoch !== this._requestEpoch) return false
    if (this._ownerAmbiguous || this._foreignBlocked) return false
    const account = this._account
    if (!isMemberIdentity(account)) return false
    if (account !== this._openerAccount) return false
    return sameAccount(token.opener, account) && sameAccount(token.account, account)
  },

  /**
   * 把凭证与它的一切派生物清零。
   *
   * `expiresAt` / `countdown` 必须跟着清：留着它们，下一次 `_resumeVisibleWork()`
   * 会照着一个早就不属于当前状态的时间重新起倒计时，而那行倒计时说的是"这张码还有效"。
   */
  _clearCredentials() {
    this._codeConfirmedAt = 0
    this.setData({
      showQr: false,
      code: '',
      codeRaw: '',
      qrStatus: 'loading',
      expiresAt: 0,
      countdown: '',
    })
  },

  /**
   * 让在途的那一发彻底失去归属：代次 +1，并把去重锁**当场交还**给本页。
   *
   * 两件事缺一不可：
   *   - 只 +1 代次不放锁：`_polling` 会一直按着，直到那发已经不属于任何人的请求自己
   *     落定 —— 而什么时候落定是网络说了算。这段时间里「重新加载」是个按不动的按钮，
   *     原来那位重新进来也只能干等（R9-A2 钉的就是这一条）。
   *   - 只放锁不 +1 代次：那发迟到的响应回来时 `_inflight` 已经换人，写不进来，
   *     但 `_ownsResponse` 也就失去了"它属于哪一轮"这条最硬的判据。
   */
  _invalidateInflight() {
    this._requestEpoch += 1
    this._inflight = null
    this._polling = false
  },

  /**
   * 这条回调还属于当前这一轮吗 —— 属于就把去重锁交还给本页。
   *
   * 不属于（代次已被身份变化 / 归属存疑作废，或本页已经另发了一发）时**什么都不碰**：
   * 那把锁此刻可能正锁着另一发新的请求，替它把锁掀掉等于放行第二发并发请求。
   * 用令牌的**对象身份**比对，不是比代次 —— 同一代次里也可能有先后两发。
   */
  _settleRequest(token) {
    if (!token || this._inflight !== token) return false
    this._inflight = null
    this._polling = false
    return true
  },

  /**
   * 身份不可用：fail-closed 到一页**说得清、点得动**的错误态。
   *
   * 两句话分开：「没登录」和「登录了但会话缺会员标识」补救动作相同（重新登录一次），
   * 但说成同一句会让后者以为自己没登录、反复确认自己已经登录着。
   */
  _failClosedForIdentity() {
    // 身份已经不可用：在途那一发（如果还有）同样不再属于本页，代次作废 + 放锁。
    this._invalidateInflight()
    this._stopTimers()
    this._clearCredentials()
    this.setData({
      state: 'error',
      refreshing: false,
      errorMsg: auth.isLoggedIn()
        ? '当前会话缺少会员标识，无法确认这张订单是不是本人的。请重新登录一次再查看到机码。'
        : '到机码只对订单本人显示，请登录后再查看。',
      errorAction: 'login',
    })
  },

  onReady() {
    this._pageReady = true
    this._drawPickupQr()
  },

  onShow() {
    this._visible = true
    // 本页自己把用户送去登录页（`errorAction === 'login'` → recover）之后的**第一次**
    // 回来：那次登录是本页发起的，因果说得清，所以允许把结果认作本页的主人 ——
    // 否则"没登录 → 去登录 → 回来"这条最普通的路会永远停在 fail-closed 上。
    //
    // 三重收窄，免得它变成一个常开的口子：**一次性**（读完即撤）、只在本页确实把人
    // 送出去过时才有、并且**要求此刻没有任何请求在飞**（有在飞的就是 R9-A 那条路：
    // 那一发的归属本来就说不清，不能让一次登录替它把主人认下来）。
    const handoff = this._loginHandoff === true && !this._polling
    this._loginHandoff = false
    // 每一次回到前台都交给 `_refreshOrder`，由它**先判身份再决定要不要发请求**
    //（顺序见那里的长注释）。没有 orderId 时它原地返回：那一页从来没显示过任何本人数据。
    if (this.data.orderId) this._refreshOrder(false, handoff)
  },

  /**
   * 切后台。**不清凭证**，只停掉定时器。
   *
   * 这一条是权衡过的，不是漏掉的：
   *   - 清掉的收益几乎为零。页面不可见的这段时间里没有人能看到那张码；而"看得见"的
   *     那一刻（回前台）`onShow` 的第一件事就是 `_refreshOrder` → `_resolveIdentity`，
   *     换人 / 登出会在同一个同步调用里把码清掉，根本轮不到渲染出来给下一位看。
   *   - 清掉的代价是实打实的能力退化。用户正站在一体机前，切出去看一眼短信验证码、
   *     接个电话、被系统切走 —— 回来时那张码没了，要等一次网络往返才重新出现，
   *     而这条链最关键的场景恰恰就是"人已经在机器前了"。
   *
   * 凭证的新鲜度另有一道防线（`CODE_TRUST_WINDOW_MS`）：后台停留久了，
   * `_codeConfirmedAt` 自然变旧，回来第一次轮询失败就会撤码并说清原因。
   */
  onHide() {
    this._visible = false
    this._stopTimers()
  },

  onUnload() {
    this._visible = false
    this._stopTimers()
  },

  _refreshOrder(initial, bindOwner) {
    if (!this.data.orderId) return
    // **身份判定必须排在"已经有一发在飞"的早退之前。**
    //
    // 反过来（上一版）会留下一个只靠网络快慢决定长短的暴露窗口：A 的码已经画在屏幕上、
    // 一发轮询正在飞（`_polling === true`），此时 A 登出、B 登录、回到本页 ——
    // `onShow` 调进来，第一行就因为 `_polling` 直接 return，于是身份**根本没被判过**：
    // 清场没发生、码原样留在屏幕上，一直留到那发请求自己落定为止。而"自己落定"什么时候
    // 发生是网络说了算：慢响应、弱网重试、服务端卡住，都能把这个窗口拉到几十秒以上，
    // 而这几十秒里屏幕上挂着的是**上一位的取件凭证**，就在共用设备的下一位面前。
    //
    // 判完再早退：'changed' / 'unusable' 两支都会把码清干净，'ok' / 'resignable'
    // 才轮到"已经有一发在飞就不重复发"这条纯粹的去重逻辑。
    const identityState = this._resolveIdentity(bindOwner === true)
    // 'changed' 时 _resolveIdentity 已经清场并写好了说明，不要再覆盖它
    //（归属存疑也走这一支：它同样清了场、同样写好了说明）。
    if (identityState === 'changed') return
    if (identityState === 'unusable') { this._failClosedForIdentity(); return }
    // 身份没问题，但这一格已经有一发在飞：不重复打，等它回来。
    if (this._polling) return
    // 'ok' 与 'resignable' 都真的发请求。
    //
    // 'resignable' 这一条是本轮的关键：本地 token 已经自然过期（enduser JWT 只签 30 分钟），
    // 但用户并没有登出。**必须让请求真的进 request.js** —— 那里拿到 401 会静默续签一次
    // 再重发，用户全程无感。在本页先把它拦下来，等于把一个能自己修好的过期会话，
    // 变成一页永远转不完的 loading；而这恰好是取件这条链最关键的一刻
    //（中午下单、下午走到一体机前打开取件页，命中的就是这一条）。
    // 这一发是**带着谁的登录态、替哪一位、在哪一代次**发出去的。三样都绑在令牌上，
    // 过期清不掉它 —— 回调那一刻再去读身份，读到的可能是一个已经被 clearSession
    // 清空的会话，也可能是**在途期间刚登录进来的另一位**（R9-A 那条路）。
    const token = { account: this._account, opener: this._openerAccount, epoch: this._requestEpoch }
    const requestAccount = token.account
    this._polling = true
    this._inflight = token
    if (initial) this.setData({ state: 'loading', errorMsg: '' })
    else this.setData({ refreshing: true })

    api.getCloudPrintOrder(this.data.orderId)
      .then((order) => {
        // 这一发还属于当前这一轮吗。不属于就**一个字段都不碰**（连锁都不碰：
        // 它此刻可能正锁着另一发）。这是迟到响应的第一道、也是唯一不依赖"读到谁"的门。
        if (!this._settleRequest(token)) return
        // 回调执行**那一刻**重新判一次身份。这一层不依赖任何生命周期回调：
        // 换人 / 登出可以完全不经过 onHide。
        //
        // `bindOwner` 只在这一发**发出时归属未定**（`token.opener === ''`）且页面仍然
        // 可见时给 true：那个身份是 request.js 为这一发补签回来的，因果落在本页身上，
        // 这是本页唯一能把它认作主人的机会（见 _resolveIdentity）。页面不可见时不绑 ——
        // 那段时间里发生的登录与本页无关。
        const state = this._resolveIdentity(token.opener === '' && this._visible)
        if (state === 'changed') return
        // 请求成功但归属说不清：不显示任何码。
        // 宁可多一次登录，不可把一张凭证显示给一个认不出来的会话。
        if (!this._ownsResponse(state, token)) { this._failClosedForIdentity(); return }
        // 走到这里身份要么全程没变，要么是"不可用 → 本人"这一种升级
        //（补签成功后重发拿回来的响应，就是当前这位的）。两种都可以写。
        if (!this._visible || !order) return
        // 码只认服务端这一次给的值。`|| this.data.codeRaw` 会让服务端已经撤码
        // （核销后 pickupCode 不再下发）的订单继续显示上一次那张码。
        const pickupCode = normalizePickupCode(order.pickupCode)
        const hasCode = PICKUP_CODE_RE.test(pickupCode)
        const status = resolveOrderState(order)
        // 有效期同样只认这一次服务端给的值。`|| this.data.expiresAt` 会在核销后
        //（服务端不再下发 pickupCodeExpiresAt）保留上一轮那个时间，于是一张已经被
        // 消费掉的码还挂着"还有 47 分钟过期"的倒计时 —— 与上面那条"码只认服务端"
        // 是同一条理由，漏掉它等于只关了半扇门。
        const expiresAtMs = order.pickupCodeExpiresAt ? new Date(order.pickupCodeExpiresAt).getTime() : 0
        const expiresAt = Number.isFinite(expiresAtMs) ? expiresAtMs : 0
        const shouldRedraw = status.showQr && hasCode && pickupCode !== this.data.codeRaw
        const amountCents = parseAmountCents(order.amountCents)
        // 这一刻服务端确认过这张码。轮询失败时的信任窗口从这里起算。
        this._codeConfirmedAt = Date.now()

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
          expiresAt,
          // 码撤下时倒计时也必须跟着撤：它是这张码的说明文字，留着就是在替一张
          // 已经不显示（或已经被核销）的码继续宣称"还有效"。
          countdown: status.showQr && hasCode ? this.data.countdown : '',
          qrStatus: shouldRedraw ? 'loading' : this.data.qrStatus,
        }, () => {
          if (this.data.showQr) this._drawPickupQr()
          this._resumeVisibleWork()
        })
      })
      .catch((err) => {
        if (!this._settleRequest(token)) return
        // 与成功分支同一条 bindOwner 规则：失败的是这一次取数，而"身份是 request.js
        // 为这一发补签回来的"这件事同样成立。两边不一致的话，一次 500 就会把一页
        // 本来说得清归属的取件页永久判成"认不出主人"。
        const state = this._resolveIdentity(token.opener === '' && this._visible)
        if (state === 'changed') return
        if (!this._visible) return
        if (err && err.statusCode === 401) {
          // 走到这里说明 request.js 的静默续签也没救回来（它续签失败时会 auth.logout()），
          // 或者本来就没有补签资格。两种都必须**当场清掉屏幕上的码**：
          // 401 之后我们既证明不了这张码还有效，也证明不了会话还是原来那位。
          this._stopTimers()
          this._clearCredentials()
          this.setData({
            state: 'error',
            refreshing: false,
            errorMsg: '登录已失效，请重新登录后再查看到机码',
            errorAction: 'login',
          })
          return
        }
        if (state === 'unusable') { this._failClosedForIdentity(); return }
        // 网络/服务端失败：**保留最近一次从服务端取到的状态**（那是真值，不是 URL 里的值），
        // 只把失败说清楚。首次就失败时没有任何可保留的东西，进错误态 —— 不再有
        // "退回 URL 里的码离线绘码"这条路，因为 URL 里已经不带码了。
        const fallbackAvailable = this.data.state === 'ready'
        // 但凭证不跟着"保留"无限久：见 CODE_TRUST_WINDOW_MS。用户在机器前扫掉码之后，
        // 服务端就不再下发它；我们恰好因为拉不到状态而不知道，于是继续显示一张
        // 已经被核销的码 —— 还带着倒计时和「等待终端扫码」。超过信任窗口就清零并说明，
        // 页面其余部分（最近一次的状态标题、订单号）照常留着。
        const codeStale = this.data.showQr
          && Date.now() - (this._codeConfirmedAt || 0) > CODE_TRUST_WINDOW_MS
        if (codeStale) {
          this._stopTimers()
          this._clearCredentials()
        }
        this.setData({
          state: fallbackAvailable ? 'ready' : 'error',
          refreshing: false,
          errorMsg: codeStale
            ? '已经有一会儿没能和服务端确认这张到机码了。为避免你拿着一张可能已被核销的码去扫，先撤下显示，请恢复网络后重新加载。'
            : ((err && err.message) || '订单状态加载失败，请稍后重试'),
          errorAction: 'retry',
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

    // 把"要画哪个码、画给谁、属于哪一轮"在**进入异步之前**钉死。
    // `exec` 的回调跨帧才回来，中间这张码完全可能已经被换掉（核销后重取）、被撤下
    // （过期 / 轮询失联），或者整页已经换了人。package-code 早就有这三道，取件页一直没有。
    const code = this.data.codeRaw
    const owner = this._openerAccount
    const epoch = this._requestEpoch

    let matrix
    try {
      matrix = createPickupQrMatrix(code)
    } catch (_) {
      this.setData({ qrStatus: 'error' })
      return
    }

    wx.createSelectorQuery().in(this).select('#pickup-qr').fields({ node: true, size: true }).exec((result) => {
      // 迟到的这一笔既不该画，也**不该把画布说成 'ready' 或 'error'** —— 那两个字都是
      // 在替"现在屏幕上这张码"下结论，而它可能已经是另一张、或者根本不该显示。
      // 说成 ready 最贵：用户会照着一张作废的码去扫。
      if (this.data.codeRaw !== code || !this.data.showQr) return
      if (this._openerAccount !== owner || this._requestEpoch !== epoch) return
      if (this._ownerAmbiguous || this._foreignBlocked) return
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
        // 过期与核销走同一个出口：凭证连同有效期一起清零，再写状态说明。
        this._clearCredentials()
        this.setData({
          countdown: '已过期',
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

  /**
   * 错误态的可执行下一步。与 package-code / package-confirm 同一口径：
   * 按 `errorAction` 分流，不给「请重试」一条死路 —— 登录已失效时，
   * 按一百次「重新加载」也只会再失败一百次。
   */
  recover() {
    const target = this.data.errorAction
    // 本页自己把用户送去登录：记一次性回程标记，回来的第一次 onShow 才允许
    // 把登录结果认作本页的主人（见 onShow / _resolveIdentity）。
    if (target === 'login') { this._loginHandoff = true; wx.navigateTo({ url: '/pages/launch/launch' }); return }
    if (target === 'orders') { this.toOrders(); return }
    this.retry()
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
