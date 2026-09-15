// utils/print-order-idempotency.js
//
// 单件云打印建单的**幂等键**。一次「下单意图」对应一个 UUID：请求失败、补签失败、
// 响应丢在路上、页面被杀掉重进 —— 只要还是同一位用户、同一组参数，就一律复用同一个键，
// 由服务端 `(endUserId, idempotencyKey)` 回放**同一张**订单，而不是再建一张、再扣一笔。
//
// 服务端契约（services/api/src/member-print-orders/member-print-order-create.service.ts）：
//   - Header `idempotency-key`，UUID 形态（版本位 1-8、变体位 8/9/a/b），缺了直接 400；
//   - 同键 + 同 payload 指纹 → 回放原单；
//   - 同键 + **不同**参数 → 409 `IDEMPOTENCY_KEY_REUSED`。
// 最后一条决定了本地必须自己判「参数变没变」，而且要按**同一组字段**判：
// 服务端 hash 的是 `{fileId, terminalId, copies, colorMode, duplex}`，本地少看一项，
// 用户改了那一项再提交就必然 409；多看一项，则会在服务端认为没变时白白换一个新键，
// 于是"响应丢了再点一次"又变回两张订单。
//
// 本地指纹**不是**服务端那个 sha256，也不需要是：它只用来回答"这还是不是上次那一单"。
// 刻意不引第三方 hash —— 字段集一致就够了，而字段集本身由下面这行常量钉住。
//
// 存什么、不存什么：只存 `{account, fingerprint, key, orderId, createdAt}`。
// **不存到机码、不存文件名、不存金额** —— 那三样分别是取件凭证、常含本人姓名的
// 求职材料标题、本人订单状态，落在本机存储里就是共用设备上的下一位能读到的东西
//（CLAUDE.md §11）。恢复一张订单只需要 orderId，页面会自己带登录态去服务端回读。
//
// ── 2026-09-15 收口：三件"看着都做了、其实没做成"的事 ────────────────────────
//
// ① **落盘只是调了一次 set，没人确认它真的写进去了。** `utils/storage.js` 的 `set()`
//    在 `wx.setStorageSync` 抛异常时吞掉异常返回 `false`（存储满、被系统清理、隐私
//    模式都会命中），而本模块此前直接忽略这个返回值，照样把记录交给调用方去 POST。
//    于是订单在服务端建成了、键却一个字节都没落在本机 —— 响应一丢，下一次提交铸一个
//    新键，服务端按新键再建一张。**幂等键的全部价值就在"它落住了"这一件事上**，
//    所以现在：写完读回来逐字核对 account/fingerprint/key，核不上就 reject，
//    调用方一个 POST 都不许发。
// ② **同一组参数可以被并发铸出两个键。** 取随机数是异步的，两个重叠的调用
//    （两个页面实例、或一次重进 + 一次重试）会各自走到"没有记录 → 铸一个"，
//    后落盘的那个还会把先落盘的挤掉。两个键 = 两张订单 = 两笔钱。现在按
//    account+fingerprint 在模块内串行化：重叠的调用共用同一个在途 Promise。
// ③ **淘汰会把"正在飞"的那条记录挤掉。** 淘汰此前只按 createdAt 留最新 20 条，
//    而最需要留住的恰恰不是最新的那条，是**已经 POST 出去、还没落定**的那条。
//    现在铸键时把它钉住（pin），钉住的不参与淘汰；名额只在没钉住的那批里回收，
//    并且优先丢"既没有 orderId、又没被钉住"的最旧那些。
//
// 三件事共同的形状：代码都在，但都没走到"确认它生效"那一步。

const storage = require('./storage')
const { isMemberIdentity } = require('./page-guard')

/**
 * 本机存储键。**不进 utils/storage.js 的 KEYS 表**：那张表是"跨页共享的业务状态"，
 * 而这条记录只服务于建单这一条链，由本模块独占读写。
 */
const STORE_KEY = 'zyd_print_order_idem'

/** 记录寿命。服务端的到机码有效期远短于此，这里只保证不无限期堆在用户手机上。 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 没被钉住的记录最多留几条。**这不是存储总上限** —— 上限是本值加上当前被钉住的条数，
 * 见 `retain()`。钉住的那些每条最多活 `PIN_TTL_MS`，并且在 `rememberOrderId` /
 * `clearRecord` 落定时立刻释放，所以总量仍然有界。
 */
const MAX_RECORDS = 20

/**
 * 一条刚铸出来的记录被钉住多久。
 *
 * 钉住期间它不参与淘汰：这段时间里它的 POST 可能正在飞，也可能已经到了服务端而响应
 * 丢在路上 —— 两种情况下把它淘汰掉，都等于让下一次提交铸一个新键，服务端于是再建
 * 一张订单。取 30 分钟是照 enduser JWT 的签发时长（`member-print-orders.module.ts`
 * 的 `expiresIn:'30m'`）：超过这个时长用户无论如何都得重新登录一次，本页那次在途的
 * 提交早已不可能还在飞。落定（拿到 orderId 或被清掉）时会提前释放，不必等满。
 */
const PIN_TTL_MS = 30 * 60 * 1000

/**
 * 等 `wx.getRandomValues` 回调的上限。
 *
 * 它是个**只有回调形态**的异步接口，而调用方（print-pay）在等它的这段时间里按钮是
 * 锁的、屏幕上盖着「正在提交…」的遮罩。真机上 `success` / `fail` 至少会来一个，但
 * "至少来一个"是约定不是保证：低版本基础库、被拦截的 API、宿主异常都可能让两个回调
 * 一个都不来。没有这道上限，页面就永远停在提交中 —— 既没有订单，也没有出口。
 * 超时按**失败**处理（fail-closed）：宁可让用户重试一次，也不拿一个来路不明的键去建单。
 */
const RANDOM_TIMEOUT_MS = 8000

/** 与服务端 assertMemberPrintOrderIdempotencyKey 的 IDEMPOTENCY_KEY_RE 同形。 */
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 参与指纹的字段，**与服务端 fingerprintMemberPrintOrderPayload 逐字同一组**。
 * 改这里就必须同时改那边，否则两侧对「参数变没变」的判断会分叉 —— 分叉的两个方向
 * 都有代价，见文件头。
 */
const FINGERPRINT_FIELDS = ['fileId', 'terminalId', 'copies', 'colorMode', 'duplex']

/**
 * 正在铸键的 `slot → Promise`。**模块级**，所以两个重叠的页面实例共用同一个在途铸键。
 * 铸完（成功或失败）立刻删掉，失败不缓存 —— 存储恢复之后下一次必须能重新试。
 */
const minting = new Map()

/**
 * 被钉住的 `slot → 到期时间戳`。钉住的记录不参与淘汰，见 `retain()` 与 `PIN_TTL_MS`。
 * 只放内存：进程重启后本来也不会再有"正在飞的那次 POST"。
 */
const pins = new Map()

/**
 * 规范化指纹。数字与字符串统一成字符串再拼，`copies: 2` 与 `copies: '2'`
 * 必须算同一单 —— 它们发给服务端的是同一个 DTO。
 *
 * 每段带长度前缀（`5:f-abc`）而不是挑一个"应该不会出现"的分隔符：
 * fileId / terminalId 是服务端发的 id，本模块无权假设它们里面没有某个字符。
 * 猜错的后果是两组**不同**参数算出同一个指纹 —— 于是第二组会复用第一组的幂等键，
 * 被服务端当成"同键不同参数"直接 409，而用户看到的只是一句下单失败。
 * 长度前缀不需要任何假设。
 */
function fingerprintOf(payload) {
  const source = payload || {}
  return FINGERPRINT_FIELDS
    .map((field) => {
      const value = source[field]
      const text = field === 'copies'
        ? String(Math.max(1, Number(value) || 1))
        : (value === null || value === undefined ? '' : String(value))
      return `${text.length}:${text}`
    })
    .join('|')
}

/**
 * `(account, fingerprint)` 的槽位键。与 `fingerprintOf` 同一条理由带长度前缀：
 * 账号键与指纹都不是本模块生成的，不能假设它们里面没有某个分隔符。
 */
function slotOf(account, fingerprint) {
  return `${String(account).length}:${account}|${fingerprint}`
}

/** 这个槽位此刻是不是被钉住的（顺带清掉已经到期的钉子）。 */
function isPinned(slot, now) {
  const until = pins.get(slot)
  if (until === undefined) return false
  if (until <= now) {
    pins.delete(slot)
    return false
  }
  return true
}

/**
 * 16 字节真随机 → UUID v4。
 *
 * **不用 Math.random**：它不是密码学随机，多个端在同一毫秒进入本页时有真实的碰撞面，
 * 而碰撞意味着两个人的两次下单共用一个幂等键 —— 第二个人会被服务端当成第一个人的重试，
 * 要么拿到别人的订单（同指纹），要么直接 409（不同指纹）。
 *
 * `wx.getRandomValues` 只有异步形态，所以本函数返回 Promise。取不到就**失败**，
 * 不退回任何弱随机：没有可靠的键就不该发这个请求（服务端也会 400 挡下来）。
 *
 * 落定一次就不再落定（`settled`）：`success` 之后宿主仍会调 `complete`，而
 * `complete` 分支本身是为"只回 complete、不回 success/fail"那种实现准备的兜底。
 * 两者叠在一起时必须是后来者无效，否则一次成功的铸键会被紧随其后的 complete 覆盖成失败。
 */
function randomUuidV4() {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.getRandomValues !== 'function') {
      reject(new Error('当前微信版本不支持安全随机数，无法安全地提交订单，请升级微信后重试'))
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('获取安全随机数超时，订单没有提交，请稍后重试'))
    }, RANDOM_TIMEOUT_MS)
    const settle = (finish) => (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      finish(value)
    }
    const succeed = settle(resolve)
    const failed = settle(reject)
    try {
      wx.getRandomValues({
        length: 16,
        success: (res) => {
          let key
          try {
            key = formatUuidV4(res && res.randomValues)
          } catch (e) {
            failed(e)
            return
          }
          succeed(key)
        },
        fail: () => failed(new Error('获取安全随机数失败，请稍后重试')),
        // 只回 complete、不回 success/fail 的实现存在（也包括被宿主拦截后直接收尾的
        // 情况）。走到这里若还没落定，就说明一个字节都没拿到 —— 当失败处理。
        // 正常路径上 complete 晚于 success/fail，那时 settled 已经是 true，本行无效。
        complete: () => failed(new Error('获取安全随机数失败，请稍后重试')),
      })
    } catch (e) {
      // 同步抛（接口不存在的变体、参数被宿主拒绝）也要收进同一个出口，
      // 否则 timer 会一直挂着，页面也拿不到 reject。
      failed(e)
    }
  })
}

/** ArrayBuffer(16) → `xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`。 */
function formatUuidV4(randomValues) {
  const bytes = new Uint8Array(randomValues)
  if (bytes.length < 16) throw new Error('安全随机数长度不足')
  const b = bytes.slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x40          // 版本位 = 4
  b[8] = (b[8] & 0x3f) | 0x80          // 变体位 = 10xx → 8 / 9 / a / b
  const hex = []
  for (let i = 0; i < 16; i += 1) hex.push((b[i] + 0x100).toString(16).slice(1))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

/** 读全量并就地丢掉过期 / 形状不对的条目。 */
function loadAll() {
  const raw = storage.get(STORE_KEY, null)
  if (!Array.isArray(raw)) return []
  const now = Date.now()
  return raw.filter((row) => row
    && typeof row === 'object'
    && isMemberIdentity(row.account)
    && typeof row.key === 'string' && KEY_RE.test(row.key)
    && typeof row.fingerprint === 'string' && row.fingerprint !== ''
    && typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
    && now - row.createdAt >= 0 && now - row.createdAt < TTL_MS)
}

/**
 * 淘汰。**判据不是"谁最新"，是"丢了会不会多出一张订单"。**
 *
 * 按这条判据排出来的三档，从最不能丢到最可以丢：
 *   ① 被钉住的（刚铸出来、POST 很可能正在飞）—— 一条都不淘汰。它们的数量由用户在
 *      一次会话里真实发起过几次提交决定，且每条最多活 PIN_TTL_MS，所以不会无限增长。
 *   ② 有 orderId 的 —— 服务端确有其单。丢了它，用户回到同一组参数时会铸一个新键，
 *      服务端认不出这是同一次意图，于是再建一张。
 *   ③ 既没被钉住、又没有 orderId 的 —— 一次没发出去 / 已经失败的提交意图，可以丢。
 *
 * 只按 createdAt 留最新 N 条（本函数的上一版）恰好把 ① 排在最前面淘汰：一条刚发出
 * POST 的记录只要后面又有 N 条更新的写入（重进页面、改参数、另一个页面实例），
 * 它就是最旧的那条。
 *
 * @param {Array} rows 已经过 loadAll 过滤的记录
 * @param {number} now
 */
function retain(rows, now) {
  const sorted = rows.slice().sort((a, b) => b.createdAt - a.createdAt)
  const pinned = []
  const evictable = []
  for (const row of sorted) {
    if (isPinned(slotOf(row.account, row.fingerprint), now)) pinned.push(row)
    else evictable.push(row)
  }
  if (evictable.length <= MAX_RECORDS) return sorted
  const budgeted = []
  // 名额先给有 orderId 的（同档内仍然留最新），剩下的才轮到没有 orderId 的。
  for (const row of evictable.filter((r) => r.orderId).concat(evictable.filter((r) => !r.orderId))) {
    if (budgeted.length >= MAX_RECORDS) break
    budgeted.push(row)
  }
  return pinned.concat(budgeted).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 落盘。**写完必须读回来核对**，不能只看 `storage.set` 的返回值。
 *
 * `utils/storage.js` 的 `set()` 只在 `wx.setStorageSync` 抛异常时返回 `false`；
 * 而"没抛异常但也没写进去"（存储被系统回收、被隐私策略拦截）在真机上同样存在，
 * 从返回值上完全看不出来。这条链的全部价值就在于键**真的还在**，所以判据只能是
 * 「再读一遍，那条记录逐字还在」。
 *
 * @param {Array} rows 要保存的全量记录
 * @param {?{account:string, fingerprint:string, key:string}} verify 必须能读回来的那条
 * @returns {?Array} 成功返回实际保留下来的那份；失败返回 null（调用方必须当失败处理）
 */
function persist(rows, verify) {
  const kept = retain(rows, Date.now())
  if (storage.set(STORE_KEY, kept) !== true) return null
  if (!verify) return kept
  const back = storage.get(STORE_KEY, null)
  if (!Array.isArray(back)) return null
  const hit = back.find((row) => row
    && typeof row === 'object'
    && row.account === verify.account
    && row.fingerprint === verify.fingerprint
    && row.key === verify.key)
  return hit ? kept : null
}

function saveAll(rows) {
  return persist(rows, null)
}

/**
 * 找当前这位、这一组参数的记录。
 *
 * **账号必须逐字相等**，而且必须是一个确定的会员键（`'u:<id>'`）。
 * 松一格的代价很具体：共用设备上 B 会复用 A 的幂等键去 POST，服务端按
 * `(endUserId, key)` 查不到 B 的记录 → 给 B 建一张新单（键白占），
 * 或者更糟 —— 如果哪天服务端改成按键全局查，B 会直接拿到 A 的订单。
 */
function findRecord(account, fingerprint) {
  if (!isMemberIdentity(account) || !fingerprint) return null
  return loadAll().find((row) => row.account === account && row.fingerprint === fingerprint) || null
}

/**
 * 拿到这一次下单该用的键：同账号同参数复用，否则新铸一个。
 *
 * **铸出来必须先真的落住，然后才轮到调用方去 POST。** 顺序反过来（先发请求、成功再存）
 * 等于把"响应丢了"这一种情况原样留着：那正是最需要幂等键的时刻。而"落住"的判据是
 * 读回来核对过，不是调用过一次 set —— 见 `persist`。落不住就 reject：调用方一个
 * POST 都不许发，因为那张订单一旦建成就再也找不回来了。
 *
 * 同一个槽位的重叠调用共用同一个在途 Promise：两个页面实例、或"重进 + 重试"叠在一起
 * 时，此前会各自铸一个键、后写的还会把先写的挤掉 —— 两个键就是两张订单、两笔钱。
 *
 * @returns {Promise<{account:string, fingerprint:string, key:string, orderId:string, createdAt:number}>}
 */
function ensureKey(account, fingerprint) {
  if (!isMemberIdentity(account)) {
    return Promise.reject(new Error('没有确定的会员身份，不能建立幂等键'))
  }
  if (!fingerprint) return Promise.reject(new Error('缺少订单参数指纹'))
  const hit = findRecord(account, fingerprint)
  if (hit) return Promise.resolve(hit)
  const slot = slotOf(account, fingerprint)
  const running = minting.get(slot)
  if (running) return running

  const pending = randomUuidV4().then((key) => {
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      throw new Error('生成的订单标识不合法，订单没有提交，请稍后重试')
    }
    // 取随机数这段时间里，别的路径完全可能已经把这一格写好了（例如一次失败重试的
    // 回退路径）。真有就用它，不覆盖 —— 覆盖等于换一个键。
    const settled = findRecord(account, fingerprint)
    if (settled) return settled
    const record = { account, fingerprint, key, orderId: '', createdAt: Date.now() }
    // 先钉住再落盘：钉住的记录不参与淘汰，否则这条刚写进去的记录可能在同一次
    // persist 里就被挤掉，然后 persist 的读回核对失败 —— 症状会被记成"存储写不进去"。
    pins.set(slot, Date.now() + PIN_TTL_MS)
    if (!persist(loadAll().concat([record]), record)) {
      pins.delete(slot)
      throw new Error('订单标识没能保存到本机，为避免重复下单已中止提交，请重试一次')
    }
    return record
  })

  // 无论成败都要把在途项摘掉：失败缓存在这里的话，存储恢复之后也再铸不出键了。
  const guarded = pending.then(
    (record) => { minting.delete(slot); return record },
    (err) => { minting.delete(slot); throw err },
  )
  minting.set(slot, guarded)
  return guarded
}

/**
 * 记下服务端给回来的 orderId。
 *
 * 调用方必须在**判断"当前页面还接不接收这条响应"之前**就调它：那两件事的对象根本不同 ——
 * 记录属于**发起这次提交的那位账号**，而页面此刻可能已经换人了。先判页面再存，
 * 就会在"A 的回调晚于换人"时直接 return，于是服务端那张订单已经建成、
 * 而 A 手上一条线索都没有，A 重进本页只会再提交一次。
 *
 * 落盘成功才释放钉子：这一刻起这条记录靠 orderId 自己挣到了第二档的名额（见 retain），
 * 不再需要占着钉子。落盘失败则保持钉住 —— 那条记录仍然是"在飞的那次提交"。
 */
function rememberOrderId(account, fingerprint, key, orderId) {
  if (!isMemberIdentity(account) || !fingerprint || !orderId) return null
  if (typeof key !== 'string' || !KEY_RE.test(key)) return null
  const rows = loadAll()
  const at = rows.findIndex((row) => row.account === account && row.fingerprint === fingerprint)
  const record = at >= 0
    ? Object.assign({}, rows[at], { key, orderId: String(orderId) })
    : { account, fingerprint, key, orderId: String(orderId), createdAt: Date.now() }
  if (at >= 0) rows[at] = record
  else rows.push(record)
  if (!persist(rows, record)) return null
  pins.delete(slotOf(account, fingerprint))
  return record
}

/**
 * 丢掉这条记录。**只有在用户确实被送到了到机码页、或服务端已经证明原单走到终态之后
 * 才该调**：200 一到就清的话，跳转失败就把唯一能找回这张订单的线索也一起丢了，
 * 而页面还留在原地 —— 用户只会再点一次。
 */
function clearRecord(account, fingerprint) {
  if (!isMemberIdentity(account) || !fingerprint) return
  const rows = loadAll()
  const kept = rows.filter((row) => !(row.account === account && row.fingerprint === fingerprint))
  if (kept.length !== rows.length && saveAll(kept)) {
    pins.delete(slotOf(account, fingerprint))
  }
}

module.exports = {
  FINGERPRINT_FIELDS,
  KEY_RE,
  TTL_MS,
  MAX_RECORDS,
  PIN_TTL_MS,
  RANDOM_TIMEOUT_MS,
  STORE_KEY,
  fingerprintOf,
  findRecord,
  ensureKey,
  rememberOrderId,
  clearRecord,
  formatUuidV4,
}
