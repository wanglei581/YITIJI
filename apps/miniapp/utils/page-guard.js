// utils/page-guard.js
// 页面生命周期 + 请求代次守卫。纯函数模块，**不依赖 wx / auth**，因此可以直接在 node 里
// 被真实执行（scripts/tests/page-lifecycle.test.mjs 用的就是这一份实现，不是替身）。
//
// 它解决的是材料包四页与「打印订单」页共有的一类缺陷：异步请求发出之后，页面可能已经
// 换了人（A 登出 / B 登录）、已经切后台、已经卸载，或者同一条链已经被重新发起过一次。
// 这些情况下旧响应的 then / catch / finally 仍会照常执行，并把上一位用户的订单、到机码、
// 文件名写回 data。已经清掉的凭证会被"复活"，已经翻新的状态会被旧值顶掉。
//
// `loading` 布尔锁挡不住这件事 —— 它只能挡"并发发起第二次"，挡不住"迟到的第一次"：
// 请求发出时锁是开的，回调执行时锁早就被别的路径清掉了。
//
// 三层判据，缺一不可：
//
//   ① 身份快照（identity）：请求发出时记下会员 id，回调时与**当时的**当前 id 逐字比对。
//      这一层不依赖任何生命周期回调先触发 —— 即使切用户没有经过 onHide，
//      A 的响应也一样进不来。
//   ② 代次（generation）：身份变化与 onHide / onUnload 都会 +1。
//      于是"切后台那一刻仍在途的请求"在切回来之后也不会突然写进来（到机码尤其致命：
//      _clearCredentials 刚把码清掉，迟到的响应会把它原样写回去）。
//   ③ 逐通道序号（sequence）：同一条链重复发起时只认最新一次（latest-wins）。
//      旧响应晚到不得覆盖新响应，终态不被回滚。
//
// 通道（channel）按"会互相覆盖同一批 data 字段的请求链"划分，不是按接口划分。
// 例如「打印订单」页的单件分区与材料包分区各占一个通道：它们写的是不同字段、
// 有各自的游标，一个的重发不该让另一个的在途响应失效。

/**
 * 会员身份键。**三态，必须分清**，不能合并成布尔：
 *
 *   未登录              → `''`
 *   登录了但拿不到 id   → `'!'`（不可用；fail-closed）
 *   正常                → `'u:<id>'`
 *
 * 中间那一态是这里存在的全部理由。`'u:' + (user.id || '')` 会在 id 缺失时退化成
 * `'u:'` —— 一个**所有 id 缺失会话共享**的键。共用设备上两个人先后遇到这种会话，
 * 第二个人会拿第一个人的 `ownerKey` 对上草稿，直接读到别人的文件名；
 * 请求代次也会认为"没换人"，于是上一位在途的响应照常写进来。
 *
 * 所以 id 缺失一律判为不可用：不发本人数据的请求、不读不写草稿、不显示到机码，
 * 让用户重新登录一次（那会重新签发带 id 的会话）。宁可多一次登录，不可错认一个人。
 *
 * @param {{isLoggedIn: () => boolean, getUser: () => any}} auth utils/auth.js
 * @returns {string}
 */
function memberIdentityKey(auth) {
  if (!auth || !auth.isLoggedIn()) return ''
  const user = auth.getUser()
  const id = user && user.id !== undefined && user.id !== null ? String(user.id) : ''
  if (!id) return IDENTITY_UNUSABLE
  return 'u:' + id
}

/** 登录了但拿不到会员 id。见 memberIdentityKey。 */
const IDENTITY_UNUSABLE = '!'

/** 这个身份键能不能用来读写本人数据。`''`（未登录）与 `'!'`（无 id）都不能。 */
function isMemberIdentity(key) {
  return typeof key === 'string' && key.slice(0, 2) === 'u:' && key.length > 2
}

/**
 * 建一个页面级守卫。每个 Page 实例一个，放在实例字段上（不要放 data —— setData
 * 会把它序列化，而它持有闭包状态）。
 *
 * @returns {{
 *   activate: () => void,
 *   deactivate: () => void,
 *   isActive: () => boolean,
 *   generation: () => number,
 *   identity: () => string,
 *   setIdentity: (next: unknown) => boolean,
 *   issue: (channel: string, meta?: object) => object,
 *   accepts: (token: object, currentIdentity?: unknown) => boolean,
 * }}
 */
function createLifecycleGuard() {
  let generation = 0
  let identity = ''
  let active = false
  /** @type {Record<string, number>} channel → 最新一次发起的序号 */
  const latest = {}

  const normalize = (value) => (value === null || value === undefined ? '' : String(value))

  // 具名而不是直接 `return {}`：adoptIdentity 要在守卫内部回落到 setIdentity，
  // 走 `this.` 会在守卫被解构出去时断掉。
  const guard = {
    /** onLoad / onShow：页面可以接收响应了。 */
    activate() {
      active = true
    },

    /**
     * onHide / onUnload：页面不再接收任何响应。
     * 同时 +1 代次 —— 只置 active=false 不够：切回来时会重新 activate，
     * 那些在后台期间发出的响应就又"合法"了。
     */
    deactivate() {
      active = false
      generation += 1
    },

    isActive() {
      return active
    },

    generation() {
      return generation
    },

    identity() {
      return identity
    },

    /**
     * 登记当前身份（会员 id；未登录传空串）。
     * @returns {boolean} 身份是否发生了变化 —— 调用方据此清空上一位用户的数据。
     *   变化时 +1 代次，在途的旧身份请求就此全部作废。
     */
    setIdentity(next) {
      const key = normalize(next)
      if (key === identity) return false
      identity = key
      generation += 1
      return true
    },

    /**
     * **补签升级**：`''` → `'u:<id>'`，不 +1 代次。
     *
     * 这不是换人，而是「请求发出时本地恰好没有可用会话（enduser JWT 只签 30 分钟），
     * request.js 拿到 401 静默补签成功后写回了同一位」的正常形态。走 setIdentity 会
     * +1 代次，把那条**刚刚被救回来**的响应连同页面一起作废 —— 页面就停在 loading 上，
     * 既没有请求在跑也没有出口（这正是 R4-1 修过、R5 又在别的页上重现的那个形态）。
     *
     * 只接受这一个方向。其余一律退回 setIdentity（照常 +1 代次作废在途请求），
     * 免得有人拿它把 `'u:A'` 悄悄换成 `'u:B'` 而 A 的在途响应仍然有效。
     *
     * @returns {boolean} 身份是否被改写
     */
    adoptIdentity(next) {
      const key = normalize(next)
      if (key === identity) return false
      if (identity !== '' || !isMemberIdentity(key)) return guard.setIdentity(key)
      identity = key
      return true
    },

    /**
     * 发起一次请求前领一个令牌。回调里拿它去 accepts() 换"能不能写"。
     * @param {string} channel 通道名（同通道后发起的会让先发起的失效）
     * @param {object} [meta] 附加到令牌上的字段（例如 orderId），由调用方自行比对
     */
    issue(channel, meta) {
      const name = normalize(channel) || 'default'
      const seq = (latest[name] || 0) + 1
      latest[name] = seq
      const token = { channel: name, seq, generation, identity }
      if (meta) {
        for (const key of Object.keys(meta)) token[key] = meta[key]
      }
      return token
    },

    /**
     * 这个响应还能不能写进 data。
     *
     * @param {object} token issue() 发的令牌
     * @param {unknown} [currentIdentity] 回调**执行那一刻**重新读出来的会员 id。
     *   传了就逐字比对（推荐：这是唯一不依赖生命周期回调的那一层）；不传则跳过该层。
     */
    accepts(token, currentIdentity) {
      if (!token || !active) return false
      if (token.generation !== generation) return false
      if (latest[token.channel] !== token.seq) return false
      if (arguments.length > 1 && normalize(currentIdentity) !== token.identity) return false
      return true
    },
  }

  return guard
}

/**
 * 账号状态机：把「同一个账号的 JWT 自然过期」与「主动登出 / 换了人」分开。
 *
 * 为什么非分开不可 —— `auth.getToken()` 在 JWT 过期时会先 `clearSession()`（token 与
 * user 一起清）再返回 null。于是从 `memberIdentityKey()` 看出去，**自然过期与主动登出
 * 完全同形**：两者都是 `'u:A' → ''`。凭证页只要把这一跳判成"换了人"，就会当场清掉
 * 屏幕上那张到机码、写一句「登录已失效」、并且**一个请求都不发** —— 于是
 * `utils/request.js` 里那套 401 静默补签永远没有机会执行。而这恰好是取件链最关键的
 * 一刻：enduser JWT 只签 30 分钟，中午下单、下午走到一体机前打开取件页，命中的就是
 * 这一跳。用户手上有一张服务端仍然认的码，页面却告诉他"登录已失效"。
 *
 * 唯一能把两者分开的是 `RESIGNIN_ELIGIBLE`：`clearSession()` 不动它，只有
 * `auth.logout()`（用户主动登出 / 补签失败）才撤销它。它写在本机存储里，页面**无法
 * 凭空制造**（只有 `auth.saveSession()` 会写），所以它是一个可信的持久判据。
 *
 * 调用方必须自己持有 `snapshot`（上一次见到的稳定账号键），并且**在任何一次破坏性
 * token 读取之前**就已经持有它 —— 过期发生之后再去读，账号 id 已经被清掉了。
 * 快照只放内存（Page 实例字段），不落 storage：它本身就是"这台设备上刚才是谁"，
 * 而且必须在换人/登出时当场销毁（`account: ''`）。
 *
 * @param {{isLoggedIn:()=>boolean, getUser:()=>any, canSilentResignin:()=>boolean}} auth utils/auth.js
 * @param {string} snapshot 调用方持有的稳定账号键（`'u:<id>'`），没有则 `''`
 * @returns {{state:'ok'|'resignable'|'changed'|'unusable', identity:string, account:string, changed:boolean}}
 *   - `ok`         当前是一个确定的会员身份，且与快照是同一位（或快照本来就为空）。
 *   - `resignable` 本地已无可用会话，但没有主动登出、补签资格仍在：
 *                  **必须放行真实请求**，让 request.js 去静默补签一次。已经显示出来的
 *                  本人凭证照常留着 —— 没有任何人登出，它仍然属于当前这位。
 *   - `changed`    真的换了人（`u:A → u:B`）、主动登出、或掉成 `'!'`（登录着却没有会员 id）：
 *                  调用方必须当场清场，并且**不得**自动补签。
 *   - `unusable`   从没登录 / 已登出 / 无会员 id，且屏幕上本来也没有本人数据。fail-closed。
 *   `account` 是调用方应当继续持有的快照；`changed` / `unusable` 时为 `''`（快照销毁）。
 */
function resolveAccountState(auth, snapshot) {
  const identity = memberIdentityKey(auth)
  const previous = isMemberIdentity(snapshot) ? snapshot : ''

  if (isMemberIdentity(identity)) {
    // 快照为空 → 确定的本人：这是**补签成功后的正常形态**，不是换人。
    // 不可用态下调用方一个字节的本人数据都没显示过，没有旧内容会被下一位"继承"。
    if (previous && previous !== identity) {
      return { state: 'changed', identity, account: '', changed: true }
    }
    return { state: 'ok', identity, account: identity, changed: false }
  }

  // 拿不到确定身份。`'!'`（登录着却没有会员 id）**一律不给补签资格**：那是一个认不出
  // 人的会话，放行请求等于拿一个所有 id 缺失会话共享的键去要本人数据。
  const resignable = identity === '' && !!(auth && auth.canSilentResignin && auth.canSilentResignin())
  if (previous) {
    return resignable
      ? { state: 'resignable', identity, account: previous, changed: false }
      : { state: 'changed', identity, account: '', changed: true }
  }
  return resignable
    ? { state: 'resignable', identity, account: '', changed: false }
    : { state: 'unusable', identity, account: '', changed: false }
}

/**
 * 令牌上的账号键与**回调那一刻**的账号键是不是同一位。
 *
 * 只放行一种不相等：`''` → `'u:<id>'`。那是"请求发出时本地恰好没有可用会话、
 * 回调时补签已经成功"，见 adoptIdentity。反方向（`'u:A'` → `''`）不在这里放行 ——
 * 调用方在 resolveAccountState 里已经用 RESIGNIN_ELIGIBLE 把自然过期与主动登出分开，
 * 自然过期时快照原样是 `'u:A'`，根本不会走到这一步。
 */
function sameAccount(tokenAccount, currentAccount) {
  const from = tokenAccount === null || tokenAccount === undefined ? '' : String(tokenAccount)
  const to = currentAccount === null || currentAccount === undefined ? '' : String(currentAccount)
  if (from === to) return true
  return from === '' && isMemberIdentity(to)
}

module.exports = {
  createLifecycleGuard,
  memberIdentityKey,
  isMemberIdentity,
  IDENTITY_UNUSABLE,
  resolveAccountState,
  sameAccount,
}
