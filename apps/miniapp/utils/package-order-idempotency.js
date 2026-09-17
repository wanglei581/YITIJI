// utils/package-order-idempotency.js
//
// **材料包**建单（POST /orders/package）的幂等键。一次「下单意图」对应一个 UUID：
// 请求失败、补签失败、响应丢在路上、小程序被杀掉重进 —— 只要还是同一位用户、同一份
// 材料包，就一律复用同一个键，由服务端按 `(endUserId, idempotencyKey)` 回放**同一张**
// 订单和**同一个到机码**，而不是再建一张、再收一次钱。
//
// 服务端契约（services/api/src/member-print-orders/package-order.service.ts，
// 2026-09-17 `dd1434d89`）：
//   - Header `idempotency-key`，UUID 形态（版本位 1-8、变体位 8/9/a/b），缺了直接 400
//     `IDEMPOTENCY_KEY_REQUIRED`，形状不对 400 `IDEMPOTENCY_KEY_INVALID`；
//   - 同键 + 同 payload 指纹 → 回放原单原码；
//   - 同键 + **不同**参数 → 409 `IDEMPOTENCY_KEY_REUSED`，且**不会**建第二张。
//
// **为什么不复用 utils/print-order-idempotency.js**：那一份服务的是单件云打印
// （POST /me/print-orders），指纹是 `{fileId, terminalId, copies, colorMode, duplex}`——
// 一个文件、没有 pageRange。材料包是多文件有序，服务端 hash 的是
// `{terminalId, fileIds[], pageRanges[], copies, colorMode, duplex}`。
// **服务端那一侧的键空间是共用的**：两条链都把键写进 `Order.idempotencyKey`，共用同一个
// `@@unique([endUserId, idempotencyKey])` —— 不存在"每条链一个独立唯一约束"这回事。
// 本机分两张表的理由与服务端约束无关，是本地这一侧的两件事：① 两条链的指纹**字段集
// 不同**，混在一张表里就得靠字段形状去猜"这一格属于哪条链"；② 未落定名额与恢复记录
// 是按表计的，共用一张表会让一条链的在途提交挤掉另一条链的（挤掉 = 下一次铸新键 =
// 第二张订单）。所以这里是独立命名空间（见 STORE_KEY），行为口径则逐条照抄那一份已经收口过的
// 硬化结论（读失败 fail-closed、写完读回核对、未落定不淘汰、并发铸键串行化、
// 随机数有界超时）—— 每一条都对应一次真实的「多一张订单、多收一次钱」。
//
// 只存 `{account, fingerprint, key, orderId, createdAt}`。**不存到机码、不存文件名、
// 不存金额** —— 那三样分别是取件凭证、常含本人姓名的求职材料标题、本人订单状态，
// 落在本机存储里就是共用设备上的下一位能读到的东西（CLAUDE.md §11）。恢复一张订单
// 只需要 orderId，页面会自己带登录态去 `GET /orders/package/:id`（requireOwned）回读。

const storage = require('./storage')
const { isMemberIdentity } = require('./page-guard')

/**
 * 本机存储键。**与单件链的 `zyd_print_order_idem` 是两格，不是一格。**
 *
 * 理由**不是**"服务端有两个唯一约束" —— 服务端只有一个：两条链的键都落在
 * `Order.idempotencyKey` 上，共用 `@@unique([endUserId, idempotencyKey])`。
 * 分表是本地这一侧的需要：两条链的指纹字段集不同（单件是单文件、没有 pageRange），
 * 而未落定名额与恢复记录都是按表计的 —— 共用一张表，一条链的在途提交会挤掉另一条链的，
 * 而挤掉一条未落定记录就是下一次铸新键、服务端再建一张订单。
 *
 * 也不进 utils/storage.js 的 KEYS 表 —— 那张表是"跨页共享的业务状态"，
 * 而这条记录只服务于材料包建单这一条链，由本模块独占读写。
 */
const STORE_KEY = 'zyd_package_order_idem'

/**
 * 记录寿命 7 天。取值不是拍的：服务端材料包到机码的有效期就是 7 天
 *（package-order.service.ts 的 `PICKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000`）。
 * 本机记录活得比它短就会在码还有效时先失忆；活得更长只是白占存储 ——
 * 与服务端取同一个数，是唯一一个不需要再解释的选择。
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * **未落定**（`orderId === ''`）的记录最多留几条。
 *
 * 这一档一条都不淘汰 —— 每一条都代表一次「POST 可能已经到了服务端、而响应丢在路上」
 * 的提交，丢掉任何一条都等于让下一次提交铸一个新键、让服务端再建一张订单。名额用尽时
 * 的处置是**拒绝铸新键**（见 `ensureKey`）：拒绝的代价是用户重试一次，挤掉的代价是
 * 第二张订单、第二笔钱。取 20 是够宽的上界 —— 要在同一台设备、同一个 TTL（7 天）窗口
 * 里填满，得有 20 次「提交出去了但从来没拿到过 orderId」。与单件链取同一个数。
 */
const MAX_PENDING_RECORDS = 20

/**
 * **已落定**（`orderId` 非空）的记录最多留几条。
 *
 * 这一档可以淘汰：服务端确有其单，最坏结果是用户在同一份材料包上再下一张 ——
 * 而不是像未落定那一档，丢掉之后连「上一次到底建没建成」都无从判断。同档内留最新的。
 */
const MAX_SETTLED_RECORDS = 20

/**
 * 等 `wx.getRandomValues` 回调的上限。它只有回调形态，而调用方在等它的这段时间里
 * 按钮是锁的、屏幕上盖着「创建订单中…」。真机上 success/fail 至少会来一个，但那是
 * 约定不是保证（低版本基础库、被拦截的 API、宿主异常）。没有这道上限，页面就永远停在
 * 提交中 —— 既没有订单，也没有出口。超时按**失败**处理：宁可让用户重试一次。
 */
const RANDOM_TIMEOUT_MS = 8000

/** 本机存储这一刻读不出来。与"名额满了"分成两句：那一句说的是"你之前提交过太多次"。 */
const STORE_UNREADABLE_MESSAGE = '读不到本机的下单记录，为避免重复下单已中止提交。请稍后重试，或先到「我的 · 打印订单」确认之前的提交结果'

/** 未落定名额用尽。见 MAX_PENDING_RECORDS。 */
const PENDING_FULL_MESSAGE = '本机还有太多没有落定的材料包下单记录，为避免重复下单已中止提交。请先到「我的 · 打印订单」确认之前几次提交的结果'

/**
 * 盘上这一格的键**服务端已经不接受了**（大写 / 形状被改坏），而它已经带着 orderId。
 *
 * 这一种只能 fail-closed：那个键换不回原单（400），而铸一个新键就是第二张订单、
 * 第二笔钱。记录**不清**（orderId 还指得回那张真实存在的订单），页面照它锁住并指路。
 */
const STALE_KEY_SETTLED_MESSAGE = '本机这一单的下单标识已经不是服务端接受的形态，但它对应的订单可能已经建好了。为避免重复下单已中止提交，请到「我的 · 打印订单」确认后再操作'

/**
 * 服务端接受的键形态：**只认小写十六进制**。
 *
 * 2026-09-17 `daa1f5484` 把服务端的 `IDEMPOTENCY_KEY_RE` 去掉了 `/i`，理由是
 * **大小写不在唯一键里**：`Order` 的 `@@unique(endUserId, idempotencyKey)` 是
 * 区分大小写的 TEXT，于是同一个 UUID 的大写写法在服务端是**另一个键** —— 它不会
 * 回放原单，会再建一张、再收一次钱。服务端选择直接 400 `IDEMPOTENCY_KEY_INVALID`
 * 而**不** `toLowerCase()`（悄悄改写请求会让"我发的键"和"服务端记的键"不是一个东西）。
 * 本地这一份必须跟着收紧到同一形态，否则大写键会一路走到 wx.request，
 * 用户看到的只是一句被翻译过的「请稍后重试」，重试多少次都一样。
 */
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * 「这一格看起来是本模块写下的一条记录」的**宽**判据（大小写不敏感）。
 *
 * 它只决定一件事：这条记录**要不要留在盘上**。不决定那个键还能不能拿去 POST ——
 * 那个判据是上面的 `KEY_RE`。两者必须分开：只用 `KEY_RE` 过滤的话，一条键形态不合
 * （大写 / 被改坏）但**已经带着 orderId** 的记录会在下一次读-改-写回全量时被整条抹掉，
 * 而它恰恰是唯一还指得回那张真实订单的线索 —— 抹掉它，用户同参数再提交一次就是第二张单。
 */
const KEY_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** 这个键还能不能拿去 POST（服务端只认小写）。 */
function isReusableKey(key) {
  return typeof key === 'string' && KEY_RE.test(key)
}

/**
 * 参与指纹的字段，**与服务端 fingerprintPackageOrderPayload 逐字同一组**。
 * 服务端 hash 的是 `{terminalId, fileIds, pageRanges, copies, colorMode, duplex}`。
 * 本地少看一项，用户改了那一项再提交就必然 409；多看一项，则会在服务端认为没变时
 * 白白换一个新键，于是"响应丢了再点一次"又变回两张订单。
 */
const FINGERPRINT_FIELDS = ['terminalId', 'fileIds', 'pageRanges', 'copies', 'colorMode', 'duplex']

/** 正在铸键的 `slot → Promise`。模块级，两个重叠的页面实例共用同一个在途铸键。 */
const minting = new Map()

/** 每段带长度前缀（`5:f-abc`）：id 不是本模块生成的，不能假设里面没有某个分隔符。 */
function seg(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `${text.length}:${text}`
}

/**
 * `pageRange` 的规范化，**与服务端 `canonicalizePackagePageRange` 同一条判据**：
 * 缺失 / `''` 一律为 null（报价那条链同样是 `file.pageRange ? ... : 省略`）。
 * 本地把这三种形态一律编码成空串 —— 它们在服务端本来就是同一件事，必须落在同一段上，
 * 否则「省略 pageRange」与「pageRange: ''」会算出两个指纹、铸出两个键、建出两张订单。
 */
function canonicalPageRange(pageRange) {
  return pageRange ? String(pageRange) : ''
}

/**
 * 材料包下单载荷 → 本地指纹。入参就是**要发出去的那个 body**，不是另拼一份 ——
 * 两处各拼一份迟早会分叉成「按一种参数算指纹、按另一种参数下单」。
 *
 * 本地指纹**不是**服务端那个 sha256，也不需要是：它只用来回答"这还是不是上次那一单"，
 * 字段集一致就够了（由 FINGERPRINT_FIELDS 钉住）。归一与服务端逐条对齐：
 *   - terminalId：**原样**（服务端 hash 的也是 dto.terminalId，不是解析后的终端主键）；
 *   - files：**有序**的 fileId 与 pageRange，顺序变了就是另一单（服务端同样按序 map）；
 *   - copies：数字与字符串统一（`2` 与 `'2'` 发出去是同一个 DTO）；
 *   - colorMode：`bw` → `black_white`；duplex：`single` → `simplex`
 *     （服务端 normalizeParams 的同一对别名，别名不归一会让一次重试白铸新键）。
 * **不含** filename / amount / quoteId：服务端一个都不 hash，多看一项就是多一张订单。
 *
 * @param {{terminalId?:string, files?:Array<{fileId?:string,pageRange?:string}>,
 *          params?:{copies?:number,colorMode?:string,duplex?:string}}} payload
 * @returns {string} 空串表示这份载荷不足以标识一单（调用方必须当失败处理）
 */
function fingerprintOf(payload) {
  const source = payload || {}
  const params = source.params || {}
  const files = Array.isArray(source.files) ? source.files : []
  if (!source.terminalId || !files.length) return ''
  const fileIds = []
  const pageRanges = []
  for (const file of files) {
    if (!file || !file.fileId) return ''
    fileIds.push(seg(file.fileId))
    pageRanges.push(seg(canonicalPageRange(file.pageRange)))
  }
  const colorMode = params.colorMode === 'bw' ? 'black_white' : params.colorMode
  const duplex = params.duplex === 'single' ? 'simplex' : params.duplex
  return [
    seg(source.terminalId),
    seg(fileIds.join(',')),
    seg(pageRanges.join(',')),
    seg(String(Math.max(1, Number(params.copies) || 1))),
    seg(colorMode),
    seg(duplex),
  ].join('|')
}

/** `(account, fingerprint)` 的槽位键。同一条理由带长度前缀。 */
function slotOf(account, fingerprint) {
  return `${seg(account)}|${fingerprint}`
}

/**
 * ArrayBuffer(16) → `xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`。
 *
 * **产物一定是小写**：`Number.prototype.toString(16)` 只吐小写十六进制，而服务端的
 * 唯一键区分大小写（见 KEY_RE）。铸完还会被 `KEY_RE.test()` 再核一遍 —— 那一道既挡
 * 形状，也挡大小写，所以这条性质不是靠注释维持的。
 */
function formatUuidV4(randomValues) {
  const bytes = new Uint8Array(randomValues)
  if (bytes.length < 16) throw new Error('安全随机数长度不足')
  const b = bytes.slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x40          // 版本位 = 4
  b[8] = (b[8] & 0x3f) | 0x80          // 变体位 = 10xx → 8 / 9 / a / b
  const hex = []
  for (let i = 0; i < 16; i += 1) hex.push((b[i] + 0x100).toString(16).slice(1))
  return [
    hex.slice(0, 4).join(''), hex.slice(4, 6).join(''), hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''), hex.slice(10, 16).join(''),
  ].join('-')
}

/**
 * 16 字节真随机 → UUID v4。
 *
 * **不用 Math.random**：它不是密码学随机，多个端在同一毫秒进入本页时有真实的碰撞面，
 * 而碰撞意味着两个人的两次下单共用一个幂等键 —— 第二个人要么拿到别人的订单（同指纹），
 * 要么直接 409（不同指纹）。取不到就**失败**，不退回任何弱随机。
 *
 * 落定一次就不再落定（`settled`）：`success` 之后宿主仍会调 `complete`，而 `complete`
 * 分支本身是为"只回 complete、不回 success/fail"那种实现准备的兜底。两者叠在一起时
 * 必须是后来者无效，否则一次成功的铸键会被紧随其后的 complete 覆盖成失败。
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
          try { key = formatUuidV4(res && res.randomValues) } catch (e) { failed(e); return }
          succeed(key)
        },
        fail: () => failed(new Error('获取安全随机数失败，请稍后重试')),
        // 只回 complete、不回 success/fail 的实现存在（也包括被宿主拦截后直接收尾）。
        // 走到这里若还没落定，就说明一个字节都没拿到 —— 当失败处理。
        complete: () => failed(new Error('获取安全随机数失败，请稍后重试')),
      })
    } catch (e) {
      // 同步抛也要收进同一个出口，否则 timer 一直挂着、调用方也拿不到 reject。
      failed(e)
    }
  })
}

/**
 * 读全量并就地丢掉过期 / 形状不对的条目。
 *
 * **读失败返回 `null`，不是 `[]`。** 两者在 `storage.get` 那一层是同一个 fallback，
 * 而本模块每一次写入都是"读 → 改 → 写回全量"：以一个假的空数组为基底写回去，盘上
 * 那条未落定的记录（POST 可能已经到了服务端）就此消失 —— 下一次同参数提交铸一个新键，
 * 服务端再建一张订单。所以三分而不是二分：只有「本机确实没有这一格」才是空表。
 *
 * **未来的 createdAt 一律当作未过期**：设备时钟会往回跳（手动改时间、NTP 回退），
 * 跳完之后这台设备自己刚写下的记录就落在"未来"。而"记录看起来来自未来"从来不是
 * "这个键不该再用"的证据。形状不对的 createdAt（NaN / 非数字）仍然作废 —— 那是坏数据。
 *
 * @returns {?Array} 读到了返回（已过滤的）记录数组；**这一次根本没读到**返回 null
 */
function loadAll() {
  const result = storage.read(STORE_KEY)
  if (!result.ok) return null
  if (!result.found) return []
  if (!Array.isArray(result.value)) return null
  const now = Date.now()
  return result.value.filter((row) => row
    && typeof row === 'object'
    && isMemberIdentity(row.account)
    // 键形态按**宽**判据留，按**严**判据用（见 KEY_SHAPE_RE）。
    // 唯一被当场丢掉的是「键已经不可用、而且还没落定」那一种：它既复用不了
    // （服务端 400），也没有 orderId 可指 —— 留着只会把这一格永久堵死。
    && typeof row.key === 'string' && KEY_SHAPE_RE.test(row.key)
    && (isReusableKey(row.key) || !!row.orderId)
    && typeof row.fingerprint === 'string' && row.fingerprint !== ''
    && typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
    && now - row.createdAt < TTL_MS)
}

/**
 * 淘汰。**判据不是"谁最新"，是"丢了会不会多出一张订单"**，而且只看落盘的数据本身
 *（内存里的任何"钉子"在小程序被杀掉重进之后一个都不剩，而那恰是最需要它的时刻）：
 *   ① `orderId === ''` 未落定 —— TTL 之内**一条都不淘汰**，总量由 `ensureKey` 在入口
 *      处 fail-closed 兜住；
 *   ② `orderId` 非空 已落定 —— 服务端确有其单，可以淘汰，同档内留最新的。
 *
 * `protect` 是"这一次正在写的那条"。它必须留下来，否则 `persist` 的读回核对会失败在
 * 一个与存储好坏无关的原因上（刚写进去就被自己的淘汰挤掉）。
 */
function retain(rows, protect) {
  const sorted = rows.slice().sort((a, b) => b.createdAt - a.createdAt)
  const pending = sorted.filter((row) => !row.orderId)
  const settled = sorted.filter((row) => !!row.orderId)
  const isProtected = (row) => !!protect
    && row.account === protect.account
    && row.fingerprint === protect.fingerprint
  const keptSettled = settled.filter(isProtected)
    .concat(settled.filter((row) => !isProtected(row)))
    .slice(0, MAX_SETTLED_RECORDS)
  return pending.concat(keptSettled).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 这一格**确实不在**存储里了吗。读不回一个数组一律返回 false ——
 * 证明不了它不在，就当它还在。
 */
function slotAbsent(account, fingerprint) {
  const back = storage.get(STORE_KEY, null)
  if (!Array.isArray(back)) return false
  return !back.some((row) => row && typeof row === 'object'
    && row.account === account && row.fingerprint === fingerprint)
}

/**
 * 落盘。**写完必须读回来核对**，不能只看 `storage.set` 的返回值：
 * 它只在抛异常时返回 false，而"没抛异常但也没写进去"（存储被系统回收、被隐私策略
 * 拦截）在真机上同样存在，从返回值上完全看不出来。这条链的全部价值就在于键**真的还在**。
 *
 * **四项都核，`orderId` 不能漏**：`rememberOrderId` 那一次写入要落的恰恰是第四项，
 * 只核前三项时"orderId 没存住"会被当成存住了。
 *
 * @returns {?Array} 成功返回实际保留下来的那份；失败返回 null（调用方必须当失败处理）
 */
function persist(rows, verify) {
  // 基底必须是**真的读出来的那一份**：写回一个凭空造出来的全量 = 抹掉盘上所有在飞的键。
  if (!Array.isArray(rows)) return null
  const kept = retain(rows, verify)
  if (storage.set(STORE_KEY, kept) !== true) return null
  if (!verify) return kept
  const back = storage.get(STORE_KEY, null)
  if (!Array.isArray(back)) return null
  const hit = back.find((row) => row && typeof row === 'object'
    && row.account === verify.account
    && row.fingerprint === verify.fingerprint
    && row.key === verify.key
    && String(row.orderId || '') === String(verify.orderId || ''))
  return hit ? kept : null
}

/**
 * 找当前这位、这一份材料包的记录。**账号必须逐字相等**，而且必须是一个确定的会员键
 * （`'u:<id>'`）。松一格的代价很具体：共用设备上 B 会复用 A 的幂等键去 POST，服务端按
 * `(endUserId, key)` 查不到 B 的记录 → 给 B 建一张新单；哪天服务端改成按键全局查，
 * B 会直接拿到 A 的订单和到机码。读不到时返回 null（= "没有可复用的记录"）——
 * 这一格是**只读**用途，真正危险的是三个写入口，它们各自单独判。
 */
function findRecord(account, fingerprint) {
  if (!isMemberIdentity(account) || !fingerprint) return null
  const rows = loadAll()
  if (!rows) return null
  return rows.find((row) => row.account === account && row.fingerprint === fingerprint) || null
}

/**
 * 这一批记录里有几条是**未落定**的。跨账号一起数：名额守的是"这台设备上的存储"，
 * 而存储是所有人共用的。按账号分别计数等于共用设备上没有上界。
 */
function pendingCount(rows) {
  return rows.filter((row) => !row.orderId).length
}

/**
 * 拿到这一次下单该用的键：同账号同材料包复用，否则新铸一个。
 *
 * **铸出来必须先真的落住，然后才轮到调用方去 POST。** 顺序反过来（先发请求、成功再存）
 * 等于把"响应丢了"这一种情况原样留着 —— 那正是最需要幂等键的时刻。而"落住"的判据是
 * 读回来核对过，不是调用过一次 set。落不住就 reject：调用方一个 POST 都不许发。
 * 同槽位的重叠调用共用同一个在途 Promise（两个页面实例、或"重进 + 重试"叠在一起时，
 * 各自铸一个键就是两张订单、两笔钱）。
 *
 * @returns {Promise<{account:string, fingerprint:string, key:string, orderId:string, createdAt:number}>}
 */
function ensureKey(account, fingerprint) {
  if (!isMemberIdentity(account)) {
    return Promise.reject(new Error('没有确定的会员身份，不能建立幂等键'))
  }
  if (!fingerprint) return Promise.reject(new Error('缺少材料包订单参数指纹'))
  // 先确认本机这一刻**读得动**。读不到时下面每一步都会得出一个假结论：
  // "没有可复用的记录"（→ 铸新键）、"未落定 0 条"（→ 名额闸失效）、
  // "全量就是这一条"（→ 写回去把别人在飞的那条抹掉）。三个假结论叠起来正好是
  // "服务端再建一张订单、再收一次钱"。
  const rows = loadAll()
  if (!rows) return Promise.reject(new Error(STORE_UNREADABLE_MESSAGE))
  const hit = rows.find((row) => row.account === account && row.fingerprint === fingerprint)
  if (hit && isReusableKey(hit.key)) return Promise.resolve(hit)
  // 走到这里只有一种可能：这一格已经落定（有 orderId），而它的键是服务端已经不接受的
  // 形态 —— loadAll 只让这一种活下来（键不可用且未落定的那一种当场就丢掉了，见那里）。
  // 不复用（400 换不回原单），也不铸新键（那是第二张订单），更不清记录（orderId 还有用）。
  if (hit) return Promise.reject(new Error(STALE_KEY_SETTLED_MESSAGE))
  // 未落定的名额满了：**拒绝铸新键**，一条既有记录都不删。腾名额只能从未落定那一档腾，
  // 而那一档每一条都代表一次"POST 可能已经到了服务端"的提交。被拒绝的用户重试一次就好；
  // 被挤掉的那一单，用户永远不知道自己被收了两次钱。
  if (pendingCount(rows) >= MAX_PENDING_RECORDS) {
    return Promise.reject(new Error(PENDING_FULL_MESSAGE))
  }
  const slot = slotOf(account, fingerprint)
  const running = minting.get(slot)
  if (running) return running

  const pending = randomUuidV4().then((key) => {
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      throw new Error('生成的订单标识不合法，订单没有提交，请稍后重试')
    }
    // 取随机数这段时间里存储可能已经读不动了。写之前必须**重新读一次并确认读得动**：
    // 这是写回全量的基底，基底假了就是抹别人的记录。
    const base = loadAll()
    if (!base) throw new Error(STORE_UNREADABLE_MESSAGE)
    // 这段时间里别的路径完全可能已经把这一格写好了。真有就用它，不覆盖 —— 覆盖等于换键。
    const settled = base.find((row) => row.account === account && row.fingerprint === fingerprint)
    if (settled && isReusableKey(settled.key)) return settled
    // 同上：这段时间里冒出来的那一格若带着一个服务端不接受的键，一样只能 fail-closed。
    if (settled) throw new Error(STALE_KEY_SETTLED_MESSAGE)
    // 别的**槽位**也可能把名额占满。再判一次：这一步的代价只是白铸一个键，
    // 而放行的代价是挤掉一条在飞的记录。
    if (pendingCount(base) >= MAX_PENDING_RECORDS) throw new Error(PENDING_FULL_MESSAGE)
    const record = { account, fingerprint, key, orderId: '', createdAt: Date.now() }
    if (!persist(base.concat([record]), record)) {
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
 * 记下服务端给回来的 orderId。调用方必须在**判断"当前页面还接不接收这条响应"之前**
 * 就调它：那两件事的对象根本不同 —— 记录属于**发起这次提交的那位账号**，而页面此刻
 * 可能已经换人了。先判页面再存，就会在"A 的回调晚于换人"时直接 return，于是服务端
 * 那张订单已经建成、而 A 手上一条线索都没有。
 *
 * @returns {?object} 成功返回落住的那条记录；**失败返回 null，调用方必须当真**：
 *   订单在服务端是真的，但本机已经指不回它了 —— 此时既不能解锁重试（那是第二张订单），
 *   也不能当没事发生。
 */
function rememberOrderId(account, fingerprint, key, orderId) {
  if (!isMemberIdentity(account) || !fingerprint || !orderId) return null
  if (typeof key !== 'string' || !KEY_RE.test(key)) return null
  const rows = loadAll()
  // 读不到就一个字节都不写：这里写回去的是**全量**，拿一条孤零零的新记录当全量写下去，
  // 盘上别人那条未落定的记录就没了。
  if (!rows) return null
  const at = rows.findIndex((row) => row.account === account && row.fingerprint === fingerprint)
  const record = at >= 0
    ? Object.assign({}, rows[at], { key, orderId: String(orderId) })
    : { account, fingerprint, key, orderId: String(orderId), createdAt: Date.now() }
  if (at >= 0) rows[at] = record
  else rows.push(record)
  if (!persist(rows, record)) return null
  return record
}

/**
 * 丢掉这条记录。**只有在用户确实被送到了到机码页、或服务端已经证明这个键与当前参数
 * 对不上（409）之后才该调**：200 一到就清的话，跳转失败就把唯一能找回这张订单的线索
 * 也一起丢了，而页面还留在原地 —— 用户只会再点一次。
 *
 * **返回布尔，判据是读回来那一格真的不在了。** `storage.set` 在"没抛异常也没写进去"时
 * 同样返回 true；调用方照着"清掉了"的假设解锁，下一次提交就会复用那个旧键。无条件写
 * 一次（而不是"有变化才写"）：raw 里可能还留着 loadAll 已滤掉、slotAbsent 仍看得见的
 * 同槽位残留（过期的、形状不对的），它们本来也该一起被清掉。
 *
 * @returns {boolean} true = 读回来确认这一格不在了；false = 没清掉，调用方必须保持锁定。
 */
function clearRecord(account, fingerprint) {
  if (!isMemberIdentity(account) || !fingerprint) return false
  const rows = loadAll()
  // 读不到就**什么都不写**：这一处是三个写入口里最狠的一个 —— 读失败时 rows 会是一个
  // 假的空数组，于是它把**整张表**写成空，这台设备上所有账号所有在飞的键一起没了。
  if (!rows) return false
  const kept = rows.filter((row) => !(row.account === account && row.fingerprint === fingerprint))
  if (storage.set(STORE_KEY, retain(kept, null)) !== true) return false
  return slotAbsent(account, fingerprint)
}

module.exports = {
  STORE_KEY,
  KEY_RE,
  KEY_SHAPE_RE,
  isReusableKey,
  STALE_KEY_SETTLED_MESSAGE,
  TTL_MS,
  MAX_PENDING_RECORDS,
  MAX_SETTLED_RECORDS,
  RANDOM_TIMEOUT_MS,
  FINGERPRINT_FIELDS,
  PENDING_FULL_MESSAGE,
  STORE_UNREADABLE_MESSAGE,
  fingerprintOf,
  findRecord,
  ensureKey,
  rememberOrderId,
  clearRecord,
  formatUuidV4,
}
