// utils/order-submission-reconcile.js
//
// 「本机留着的这些下单标识，服务端那边到底落成了什么」—— 两条建单链共用的核对引擎。
//
// ## 它修的是哪一个真实故障
//
// 两条链（材料包 `POST /orders/package`、单件 `POST /me/print-orders`）都遵守同一条
// 硬规则：**未落定的记录一条都不淘汰**。一条记录"未落定"意味着 POST 可能已经到了服务端
// 而响应丢在了路上 —— 本机先忘掉它，下一次同参数提交就会铸新键，服务端再建一张订单、
// 再收一次钱。所以 `ensureKey` 在未落定记录达到 `MAX_PENDING_RECORDS`（20）时
// **拒绝铸新键**（fail-closed），一条既有记录都不删。
//
// 这条规则本身是对的，但它此前**没有出口**：20 条一旦攒满，这台设备上**所有**材料包 /
// 单件打印就永久打不出去了 —— 而那 20 条里绝大多数其实根本没在服务端建成任何订单
// （网络断了、请求被拒、进程被杀在 POST 之前）。用户看到的是一句「本机还有太多没有落定
// 的下单记录」，重试一万次都一样，卸载重装是唯一的出路。
//
// ## 唯一合法的判据：服务端的墓碑，不是本机的时间
//
// 服务端 2026-09-17 补上了 `POST /me/print-orders/submissions/resolve`
// （`services/api/src/member-print-orders/order-submission-ledger.ts`）。它按**本人**
// 范围逐个回答一个键：
//
//   - `created`     —— 本人名下确有一张订单挂着这个键。本机只需把 orderId 记回去，
//                      之后走既有的「查一次原单」恢复路径，**不是**再 POST 一次。
//   - `processing`  —— 服务端有一份**还活着**的处理租约（60s）。这一条必须原样留着：
//                      那次提交正在服务端跑，清掉它 = 下一次铸新键 = 第二张订单。
//   - `not_created` —— 服务端已经**先立墓碑再回答**：这个键被登记成 abandoned，
//                      之后任何带着它的 POST 都会 409，再也建不出订单。
//                      **只有这一档**允许本机清掉那一格。
//
// 换句话说：清一条记录的权力完全在服务端手里。本机的超时、记录年龄、4xx、5xx、
// 本地时钟、任何"宽限期"都**不是**证据，一条都不许据此清。这不是保守，是算过账的：
// 清错一条的代价是用户被收两次钱，而留着一条的代价只是这台设备上少一个名额。
//
// ## 为什么是共用模块而不是各写一份
//
// 两条链的本机表是**独立命名空间**（键空间在服务端共用，本机分表的理由见各自模块顶部），
// 但"怎么核对"这件事逐条相同：选哪些记录、怎么按键对号入座、哪一档才准清。写两份的代价
// 已经在这个仓库里发生过一次 —— 两份各自漂移，然后只有一份被修。
//
// 本模块**不碰存储、不碰 wx、不 require 任何幂等模块**（那会成环，
// verify-miniapp-static 的依赖环检查会红）。存储读写一律经调用方传进来的 `port`，
// 于是它可以被纯粹地单测，也不会把某一条链的表读进另一条链。

/**
 * 一次最多核对多少个键。**必须 ≤ 服务端 `ORDER_SUBMISSION_RESOLVE_MAX_KEYS`**：
 * 服务端 DTO 是 `@ArrayMaxSize(20)`，超了整批 400，于是"名额满了"这条故障不但没解开，
 * 还多一个看不懂的失败。正好等于 `MAX_PENDING_RECORDS`，所以满额那一批一次能核完。
 */
const MAX_RESOLVE_KEYS = 20

/**
 * 自动触发（进页面 / 回前台）的冷却期。显式触发（用户按下按钮、提交被名额闸拦住）
 * 一律 `force: true` 绕过它 —— 那两处都是用户刚做过一个动作，必须给他当下的真值。
 *
 * 冷却只防一件事：`onShow` 在一次交互里连着触发两三次，每次都打一发 POST。
 */
const RECONCILE_COOLDOWN_MS = 30 * 1000

/**
 * 「这个键此刻正被本进程带着出门」的保护期。
 *
 * 为什么需要它：服务端的 resolve 对一个**它没见过**的键会**先立墓碑**再回 `not_created`。
 * 而本机 `markSubmitted` 是在 POST **之前**同步标记的 —— 这两件事之间有一段真空：
 * 键已经标成"已提交"，请求却还在路上、服务端还没建出那条 ledger 行。此刻去核对它，
 * 墓碑会抢在请求前面落下，那次本来会成功的提交就变成 409 `IDEMPOTENCY_KEY_ABANDONED`。
 *
 * 所以本进程自己知道正在飞的键，一律先不核。**这不是"按年龄决定清不清"** ——
 * 它只决定"什么时候去问"，问出来的答案照旧只有服务端说了算。过了保护期最坏的结果也
 * 只是那一次提交被公平地判成 abandoned（服务端此时不会建单，不会多一张订单、多一笔钱）。
 *
 * 取值大于服务端租约（60s）：租约还活着时服务端会如实回 `processing`，那才是正确答案。
 */
const INFLIGHT_GUARD_MS = 90 * 1000

/** 建单那一发 409 的三种成因。取值与服务端错误码一一对应，见 classifySubmitConflict。 */
const CONFLICT_REUSED = 'reused'
const CONFLICT_ABANDONED = 'abandoned'
const CONFLICT_IN_PROGRESS = 'in_progress'

const OUTCOME_CREATED = 'created'
const OUTCOME_PROCESSING = 'processing'
const OUTCOME_NOT_CREATED = 'not_created'

/** 服务端允许的三种结论。**表外的一切取值一律忽略**（fail-closed，见 indexItems）。 */
const OUTCOMES = [OUTCOME_CREATED, OUTCOME_PROCESSING, OUTCOME_NOT_CREATED]

/**
 * 一次核对的结局。每一档都必须能被调用方分辨 —— 把它们压成一个布尔，页面就只能
 * 写出「操作未完成，请稍后重试」，而这几档的可执行下一步完全不同。
 */
const STATUS = {
  /** 没有一个确定的会员身份：一个键都不许碰（别人的记录就在同一张表里）。 */
  identity: 'identity',
  /** 本机读不出这张表：证明不了任何事，一条都不动。 */
  unreadable: 'store_unreadable',
  /** 没有需要核对的记录（或都在保护期内）。 */
  idle: 'idle',
  /** 冷却期内，这一次没有真的去问。 */
  cooldown: 'cooldown',
  /** 请求失败（网络 / 401 / 5xx）：**一条都没清**。 */
  failed: 'failed',
  /** 响应形状不对：同样一条都没清。 */
  malformed: 'malformed',
  /** 真的核过了一批。 */
  done: 'done',
}

/** `port.namespace + account` → 在途的那一次核对。两个页面实例共用同一发，不各打一次。 */
const running = new Map()

/** `port.namespace + account` → 上一次真的问过服务端的时刻，只用来做冷却。 */
const lastRun = new Map()

/** 冷却表不许无界增长（一台设备上的账号有限，但"有限"不等于"有上界"）。 */
const LAST_RUN_MAX = 16

function rememberRun(slot, at) {
  lastRun.set(slot, at)
  if (lastRun.size <= LAST_RUN_MAX) return
  const oldest = lastRun.keys().next()
  if (!oldest.done) lastRun.delete(oldest.value)
}

/** 统一形状的结果对象。字段齐全，调用方不必到处判 undefined。 */
function makeResult(status, patch) {
  const base = {
    status,
    /** 这一次真的发出去核对的键有几个 */
    checked: 0,
    /** 服务端说"确有其单"、且本机成功把 orderId 记回去了的 */
    created: 0,
    /** 服务端说"还在处理中"，原样留着的 */
    processing: 0,
    /** 服务端已立墓碑、本机也读回来证明清掉了的 —— 只有它真的腾出了名额 */
    freed: 0,
    /** 服务端说"确有其单"，但本机没能把 orderId 记回去（存储写不进去） */
    unsaved: 0,
    /** 该清却没清成（存储写不进去 / 这一格已经被别的路径换了键） */
    blocked: 0,
    /** 服务端没回这个键、或对同一个键回了自相矛盾的两条：原样留着 */
    unknown: 0,
    /** created 那一档的明细，调用方据此把页面锁到那张订单上 */
    orders: [],
    /** failed 那一档的原始错误，调用方据此分辨 401 / 网络 */
    error: null,
  }
  if (patch) {
    for (const key of Object.keys(patch)) base[key] = patch[key]
  }
  return base
}

/**
 * 选出这一批要核对的记录。**只选「已提交、还没落定」的那一档。**
 *
 * 逐条排除的理由：
 *   - `orderId` 非空 —— 已经落定，没什么要问的（而且它占的是已落定名额，本来可淘汰）；
 *   - 本进程正带着它出门（`port.isInFlight`）—— 见 INFLIGHT_GUARD_MS；
 *   - 同一个键出现在两格 —— 分不清答案该写回哪一格，**两格都不动**（fail-closed）。
 *     真出现这种形态说明盘上的数据已经坏了，猜一格写回去就是把订单指给错误的参数。
 *
 * 调用方（各幂等模块的 `pendingSubmissions`）已经过滤掉"铸了键但一个 POST 都没发过"
 * 的那一档 —— 去核对它等于给一个还没用过的键立墓碑，那次提交就白废了。
 *
 * @param {Array} rows 已确认读得到的记录（`{account, fingerprint, key, orderId}`）
 * @param {{isInFlight: function(string, number): boolean}} port
 * @param {number} now
 * @returns {Array<{key: string, fingerprint: string}>} 至多 MAX_RESOLVE_KEYS 条
 */
function selectPending(rows, port, now) {
  if (!Array.isArray(rows)) return []
  const seen = Object.create(null)
  const duplicated = Object.create(null)
  for (const row of rows) {
    const key = row && row.key
    if (typeof key !== 'string' || !key) continue
    if (seen[key]) duplicated[key] = true
    seen[key] = true
  }
  const picked = []
  for (const row of rows) {
    if (picked.length >= MAX_RESOLVE_KEYS) break
    if (!row || typeof row !== 'object') continue
    const key = row.key
    const fingerprint = row.fingerprint
    if (typeof key !== 'string' || !key) continue
    if (typeof fingerprint !== 'string' || !fingerprint) continue
    if (row.orderId) continue
    if (duplicated[key]) continue
    if (port && typeof port.isInFlight === 'function' && port.isInFlight(key, now)) continue
    picked.push({ key, fingerprint })
  }
  return picked
}

/**
 * 响应 → `key → item` 的**严格**索引。
 *
 * 这一层的全部职责就是"不许一条看不懂的数据变成一次清除"：
 *   - 整体形状不对（不是 `{items: [...]}`）→ 返回 null，**整批作废**，一条都不动；
 *   - 没要过的键 → 直接忽略（服务端多回了什么都与本机无关）；
 *   - 同一个键回了两条 → 那两条互相矛盾，这个键**整个作废**（写成 null，调用方跳过）；
 *   - `outcome` 不在三档之内 → 作废；
 *   - `created` 却没给 orderId → 作废（清不清都轮不到它，但"已建成"必须指得出哪一张）。
 *
 * 原型链用 `Object.create(null)`：键来自网络，不让 `__proto__` 之类的取值改到原型上。
 *
 * @returns {?object} key → item（或 null 表示这个键作废）；整批作废时返回 null
 */
function indexItems(payload, requestedKeys) {
  if (!payload || typeof payload !== 'object') return null
  const items = payload.items
  if (!Array.isArray(items)) return null
  const wanted = Object.create(null)
  for (const key of requestedKeys) wanted[key] = true
  const byKey = Object.create(null)
  const seen = Object.create(null)
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const key = item.key
    if (typeof key !== 'string' || !wanted[key]) continue
    if (seen[key]) { byKey[key] = null; continue }
    seen[key] = true
    if (OUTCOMES.indexOf(item.outcome) < 0) { byKey[key] = null; continue }
    if (item.outcome === OUTCOME_CREATED && (typeof item.orderId !== 'string' || !item.orderId)) {
      byKey[key] = null
      continue
    }
    byKey[key] = item
  }
  return byKey
}

function textOf(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * 把服务端的结论逐条落到本机那一格上。
 *
 * **账号用的是发起这一次核对时定下的那个**，不是"页面现在是谁"。这两件事的对象根本
 * 不同：这批记录属于发起者，而请求往返期间完全可能已经换了人 / 登出了。按"现在是谁"
 * 去写，写到的会是另一个人的那几格；而原样跳过则会把发起者那条已经被服务端钉死的记录
 * 永久留在盘上 —— 那正是这次要修的缺陷。两个写入口（`adoptResolvedOrder` /
 * `clearSubmittedKey`）都逐字核账号，别人的记录一个字节都碰不到。
 */
function applyItems(port, account, selected, payload) {
  const byKey = indexItems(payload, selected.map((item) => item.key))
  if (!byKey) return makeResult(STATUS.malformed, { checked: selected.length })
  let created = 0
  let processing = 0
  let freed = 0
  let unsaved = 0
  let blocked = 0
  let unknown = 0
  const orders = []
  for (const slot of selected) {
    const item = byKey[slot.key]
    // 服务端没回这个键、或回得自相矛盾：**原样留着**。少一条答案从来不是"它不存在"。
    if (!item) { unknown += 1; continue }
    if (item.outcome === OUTCOME_PROCESSING) { processing += 1; continue }
    if (item.outcome === OUTCOME_CREATED) {
      const adopted = port.adoptResolvedOrder(account, slot.fingerprint, slot.key, item.orderId)
      if (adopted) created += 1
      else unsaved += 1
      orders.push({
        key: slot.key,
        fingerprint: slot.fingerprint,
        orderId: item.orderId,
        orderKind: textOf(item.orderKind),
        pickupStatus: textOf(item.pickupStatus),
        payStatus: textOf(item.payStatus),
        taskStatus: textOf(item.taskStatus),
        adopted,
      })
      continue
    }
    // 走到这里只剩 not_created：服务端已经用墓碑把这个键钉死了，它再也建不出订单。
    // **这是唯一允许清的一档**，而且清的是"这一格 + 这个键"，不是整张表、也不是这一格
    // 现在恰好装着的任何键。
    if (port.clearSubmittedKey(account, slot.fingerprint, slot.key)) freed += 1
    else blocked += 1
  }
  return makeResult(STATUS.done, {
    checked: selected.length, created, processing, freed, unsaved, blocked, unknown, orders,
  })
}

/**
 * 核对一次。
 *
 * @param {object} port 由各幂等模块提供的存储口子：
 *   `namespace`（本机表名，用来把两条链的在途核对分开）、
 *   `identityUsable(account)`、`pendingSubmissions(account)`（读不到返回 null）、
 *   `isInFlight(key, now)`、`adoptResolvedOrder(...)`、`clearSubmittedKey(...)`
 * @param {string} account 会员身份键（`'u:<id>'`）
 * @param {function(Array<string>): Promise} resolveKeys 真正去问服务端的那一发
 * @param {{force?: boolean, now?: number}} [opts] force 绕过冷却（用户刚做过动作时必须绕）
 * @returns {Promise<object>} 恒 resolve，**永不 reject** —— 调用方是失败路径上的收尾，
 *   再抛一次只会把页面卡在「提交中…」。失败信息在 `status` / `error` 里。
 */
function reconcile(port, account, resolveKeys, opts) {
  const options = opts || {}
  const now = typeof options.now === 'number' ? options.now : Date.now()
  if (!port || typeof port.identityUsable !== 'function') return Promise.resolve(makeResult(STATUS.identity))
  if (!port.identityUsable(account)) return Promise.resolve(makeResult(STATUS.identity))
  if (typeof resolveKeys !== 'function') return Promise.resolve(makeResult(STATUS.failed))
  const slot = `${port.namespace}|${account}`
  // 两个页面实例（或"重进 + 重试"）叠在一起时共用同一发：各打一次不但白费请求，
  // 还会让第二发对同一批键再立一次墓碑判定。
  const inflight = running.get(slot)
  if (inflight) return inflight
  if (!options.force) {
    const at = lastRun.get(slot)
    // `now >= at` 这半句不能省：设备时钟往回跳之后 `now - at` 恒为负，冷却会永远成立，
    // 于是自动核对再也不会发生 —— 而它恰恰是这条链唯一的自愈路径。
    if (at !== undefined && now >= at && now - at < RECONCILE_COOLDOWN_MS) {
      return Promise.resolve(makeResult(STATUS.cooldown))
    }
  }
  // 读不出这张表就一条都不动：读失败证明不了"本机没有记录"，而这条链上每一次写都要
  // 拿读出来的那一份当基底。
  const rows = port.pendingSubmissions(account)
  if (!Array.isArray(rows)) return Promise.resolve(makeResult(STATUS.unreadable))
  const selected = selectPending(rows, port, now)
  if (!selected.length) return Promise.resolve(makeResult(STATUS.idle))
  const keys = selected.map((item) => item.key)
  const task = Promise.resolve()
    .then(() => resolveKeys(keys))
    .then((payload) => applyItems(port, account, selected, payload))
    // 请求失败（网络 / 401 / 5xx）、或落盘那一步自己抛了：**一条都没清**，如实说出来。
    .catch((error) => makeResult(STATUS.failed, { checked: selected.length, error: error || null }))
    .then((result) => {
      running.delete(slot)
      rememberRun(slot, Date.now())
      return result
    })
  running.set(slot, task)
  return task
}

/**
 * 一次核对的结果 → 用户能照着做的一句话 + 一个**真的有下一步**的动作。
 *
 * 这一段是 P2 那个死循环的正面修复：此前本机这几种失败（名额满、读不出表、标不住）
 * 全部落到页面兜底的「操作未完成 / 请稍后重试」，按钮一律写着「重新核价」——
 * 而重新核价对这几种失败一件事都不改变，用户只能反复点。
 *
 * recover 取值沿用各页既有的那一组，新增两个：
 *   'reconcile' 再核对一次（服务端还在处理 / 这一次没问成）
 *   'resubmit'  再提交一次（名额已经腾出来了，下一步就是用户自己按下去）
 *
 * @param {object} result reconcile() 的返回值
 * @param {{submitLabel?: string}} [context] 本页那个主按钮叫什么（两条链文案不同）
 */
function describeReconcileResult(result, context) {
  const submitLabel = (context && context.submitLabel) || '确认下单'
  const res = result || makeResult(STATUS.failed)
  if (res.status === STATUS.identity) {
    return {
      title: '登录状态已失效',
      text: '无法核对本机留下的下单记录。请重新登录后再试；已经建成的订单可到「我的 · 打印订单」查看。',
      recover: 'login',
    }
  }
  if (res.status === STATUS.unreadable) {
    return {
      title: '读不到本机的下单记录',
      text: '手机存储可能已满或被系统清理。为避免重复下单，这一步先停住。请清理一些存储空间后再试；已经建成的订单可到「我的 · 打印订单」查看。',
      recover: 'orders',
    }
  }
  if (res.status === STATUS.failed) {
    const statusCode = res.error && res.error.statusCode
    if (statusCode === 401) {
      return {
        title: '登录已失效，核对没有完成',
        text: '核对本机下单记录需要登录状态。请重新登录后再核对一次；这一次没有改动本机任何记录。',
        recover: 'login',
      }
    }
    return {
      title: '暂时核对不上本机的下单记录',
      text: '网络或服务端暂时不可用，这一次没有改动本机任何记录。请恢复网络后再核对一次。',
      recover: 'reconcile',
    }
  }
  if (res.status === STATUS.malformed) {
    return {
      title: '核对结果看不懂，已经停住',
      text: '服务端这次返回的核对结果不完整，为避免误删本机记录，一条都没有改动。请稍后再核对一次。',
      recover: 'reconcile',
    }
  }
  if (res.status === STATUS.cooldown || res.status === STATUS.idle) {
    return {
      title: '本机暂时没有可核对的提交',
      text: `之前那几次提交要么仍在发送中，要么还没有发出去过，现在核对不了它们。请稍等片刻，再点一次「${submitLabel}」。`,
      recover: 'resubmit',
    }
  }
  if (res.created > 0 || res.unsaved > 0) {
    const total = res.created + res.unsaved
    return {
      title: `找回了 ${total} 张已经建成的订单`,
      text: '之前那几次提交其实已经在服务端建成了订单，不是没下成。请到「我的 · 打印订单」查看它们，不要重复提交。',
      recover: 'orders',
    }
  }
  if (res.freed > 0) {
    return {
      title: `已核对完毕，释放了 ${res.freed} 条记录`,
      text: `服务端确认这 ${res.freed} 次提交都没有建成订单，本机已经把它们清掉。现在可以再点一次「${submitLabel}」。`,
      recover: 'resubmit',
    }
  }
  if (res.processing > 0) {
    return {
      title: '上一次的提交还在服务端处理中',
      text: `服务端说还有 ${res.processing} 次提交正在处理，现在再下一单可能变成两张。请稍等片刻再核对一次。`,
      recover: 'reconcile',
    }
  }
  return {
    title: '核对完了，但本机这几条记录还不能清',
    text: '服务端没有给出这几条提交的确定结论，为避免重复下单，本机把它们原样留着。请稍后再核对一次；已经建成的订单可到「我的 · 打印订单」查看。',
    recover: 'reconcile',
  }
}

/**
 * 建单那一发回来的 409，到底是哪一种 —— 三种的处置**完全相反**，压成一句
 *「请稍后重试」会在其中两种上造成真实损失。
 *
 *   - `reused`      同键配了另一组参数。旧键换不回这一单，必须换新键，而换键是一次
 *                   下单决定，只能由用户自己再按一次（页面不替他做）。
 *   - `abandoned`   服务端已经给这个键立了墓碑（`IDEMPOTENCY_KEY_ABANDONED`）。
 *                   这是**服务端亲口证明的 not_created**：带着它的 POST 再也建不出
 *                   订单，所以本机这一格可以安全地清掉。这一条和 resolve 的
 *                   `not_created` 是同一件事的两个入口，判据同样在服务端手里。
 *   - `in_progress` 服务端那份处理租约**还活着**（`IDEMPOTENCY_IN_PROGRESS`）。
 *                   那次提交正在跑，它完全可能马上就建成一张订单 —— 此刻清记录、
 *                   换新键就是第二张订单、第二笔钱。只能等，一个字节都不许改。
 *
 * @returns {string} 'reused' | 'abandoned' | 'in_progress' | ''（不是这三种）
 */
function classifySubmitConflict(err) {
  if (!err || err.statusCode !== 409) return ''
  const code = err.code
  if (code === 'IDEMPOTENCY_KEY_REUSED') return CONFLICT_REUSED
  if (code === 'IDEMPOTENCY_KEY_ABANDONED') return CONFLICT_ABANDONED
  if (code === 'IDEMPOTENCY_IN_PROGRESS') return CONFLICT_IN_PROGRESS
  return ''
}

/**
 * `abandoned` / `in_progress` 两种冲突给用户看的话。**两条链共用**，因为这两句要说的
 * 事实与是哪条链无关；只有主按钮叫什么不同，从 `submitLabel` 传进来。
 *
 * `reused` 不在这里：那一条各页已有自己的文案，且要连带说明"上一张如果建成了去哪找"。
 */
function describeSubmitConflict(kind, context) {
  const submitLabel = (context && context.submitLabel) || '确认下单'
  if (kind === CONFLICT_ABANDONED) {
    return {
      title: '上一次的提交已经作废',
      text: `服务端确认上一次提交没有建成订单，并且它的下单标识已经失效。本机已经把它清掉，现在再点一次「${submitLabel}」会用一个新的标识重新提交。`,
      recover: 'resubmit',
    }
  }
  if (kind === CONFLICT_IN_PROGRESS) {
    return {
      title: '上一次的提交还在服务端处理中',
      text: '同一次提交正在服务端处理，现在再下一单可能变成两张。请稍等片刻再核对一次；如果它建成了，会出现在「我的 · 打印订单」里。',
      recover: 'reconcile',
    }
  }
  return null
}

/**
 * 用一条链的存储原语拼出 `reconcile()` 要的那个 `port`。
 *
 * **只有这一份实现**：两条链的本机表是独立命名空间，但"怎么挑要核对的记录、怎么按键
 * 对号入座、什么时候才准清"逐条相同。各写一份的代价这个仓库已经付过一次 ——
 * 两份各自漂移，然后只有一份被修。所以这里收口成工厂，两边传各自的 `loadAll` /
 * `persist` 进来。本模块因此仍然不 require 任何幂等模块、也不碰 storage / wx。
 *
 * @param {{
 *   namespace: string,
 *   loadAll: function(): ?Array,
 *   persist: function(Array, ?object): ?Array,
 *   isMemberIdentity: function(*): boolean,
 *   wasSubmitted: function(object): boolean,
 *   isReusableKey: function(*): boolean,
 * }} deps
 */
function createSubmissionPort(deps) {
  const { namespace, loadAll, persist, isMemberIdentity, wasSubmitted, isReusableKey } = deps
  /** key → 本进程把它标成"即将出门"的时刻。见 INFLIGHT_GUARD_MS。 */
  const inFlight = new Map()

  /** 找这一格。**账号与指纹都必须逐字相等** —— 松一格就会写到别人那一格上。 */
  const indexOfSlot = (rows, account, fingerprint) => rows.findIndex((row) => row
    && row.account === account && row.fingerprint === fingerprint)

  const forget = (key) => { inFlight.delete(key) }

  return {
    namespace,

    identityUsable: (account) => isMemberIdentity(account),

    /**
     * 「这个键此刻正被本进程带着出门」。进程被杀之后这张表自然是空的 —— 那是**对的**：
     * 那一刻本机确实没有请求在飞，该不该立墓碑完全由服务端的租约说了算。
     */
    noteInFlight(key) {
      if (typeof key === 'string' && key) inFlight.set(key, Date.now())
    },
    forgetInFlight: forget,
    isInFlight(key, now) {
      const at = inFlight.get(key)
      if (at === undefined) return false
      // 过了保护期就当它不在飞了：漏掉一次 forgetInFlight（POST 抛在了意料之外的地方）
      // 不该让这一格永久躲开核对 —— 那等于把这条唯一的自愈路径关掉。
      // 时钟往回跳时 `now - at` 为负，同样按"还在飞"处理（保守一侧）。
      if (now - at >= INFLIGHT_GUARD_MS) { inFlight.delete(key); return false }
      return true
    },

    /**
     * 这一位名下**已提交、还没落定**的那一档。读不出表返回 null（≠ 空数组）：
     * 读失败证明不了"本机没有记录"，调用方据此整批停手。
     */
    pendingSubmissions(account) {
      const rows = loadAll()
      if (!rows) return null
      return rows.filter((row) => row
        && row.account === account
        && !row.orderId
        && wasSubmitted(row))
    },

    /**
     * 服务端说这个键名下确有一张订单：把 orderId 记回这一格。
     *
     * **键必须逐字还在那一格上**。对不上说明这一格已经被别的路径换过键了，这条答案
     * 说的不是它 —— 写下去就是把一张订单指给一组它并不对应的参数。
     */
    adoptResolvedOrder(account, fingerprint, key, orderId) {
      if (!isMemberIdentity(account) || !fingerprint || !orderId) return false
      if (!isReusableKey(key)) return false
      const rows = loadAll()
      if (!rows) return false
      const at = indexOfSlot(rows, account, fingerprint)
      if (at < 0) return false
      if (rows[at].key !== key) return false
      // 已经落定过了：只有落的是同一张才算成功。落的是另一张说明这一格早已属于
      // 另一次提交，这条答案不该覆盖它。
      if (rows[at].orderId) return String(rows[at].orderId) === String(orderId)
      const record = Object.assign({}, rows[at], { orderId: String(orderId) })
      rows[at] = record
      if (!persist(rows, record)) return false
      forget(key)
      return true
    },

    /**
     * **本模块唯一一处删除。** 前提只有一个：服务端已经用墓碑证明这个键建不出订单
     *（resolve 的 `not_created`，或建单那一发的 409 `IDEMPOTENCY_KEY_ABANDONED`）。
     *
     * 即便如此仍然逐条设防，每一条都对应一次"多一张订单、多一笔钱"：
     *   - 这一格已经不在了 → 返回 true：名额本来就已经腾出来了，这正是我们要的结果；
     *   - 这一格现在装的是**另一个键** → 不删：墓碑说的不是它；
     *   - 这一格**已经落定**（有 orderId）→ 不删：它指着一张真实存在的订单，
     *     而那是用户找回这一单的唯一线索；
     *   - 写完必须**读回来证明**这一格真的不在了：`storage.set` 在"没抛异常也没写进去"
     *     时照样返回 true，照着假设解锁，下一次提交会复用那个已经作废的键。
     */
    clearSubmittedKey(account, fingerprint, key) {
      if (!isMemberIdentity(account) || !fingerprint) return false
      if (typeof key !== 'string' || !key) return false
      const rows = loadAll()
      if (!rows) return false
      const at = indexOfSlot(rows, account, fingerprint)
      if (at < 0) { forget(key); return true }
      if (rows[at].key !== key) return false
      if (rows[at].orderId) return false
      const kept = rows.filter((row, index) => index !== at)
      if (!persist(kept, null)) return false
      const back = loadAll()
      if (!Array.isArray(back)) return false
      if (back.some((row) => row
        && row.account === account && row.fingerprint === fingerprint && row.key === key)) return false
      forget(key)
      return true
    },
  }
}

module.exports = {
  MAX_RESOLVE_KEYS,
  RECONCILE_COOLDOWN_MS,
  INFLIGHT_GUARD_MS,
  OUTCOMES,
  OUTCOME_CREATED,
  OUTCOME_PROCESSING,
  OUTCOME_NOT_CREATED,
  STATUS,
  CONFLICT_REUSED,
  CONFLICT_ABANDONED,
  CONFLICT_IN_PROGRESS,
  classifySubmitConflict,
  describeSubmitConflict,
  createSubmissionPort,
  selectPending,
  indexItems,
  reconcile,
  describeReconcileResult,
}
