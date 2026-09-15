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

  return {
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
}

module.exports = { createLifecycleGuard }
