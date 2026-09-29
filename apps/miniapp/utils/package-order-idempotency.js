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
// 只存 `{account, fingerprint, key, orderId, createdAt, submittedAt}`。**不存到机码、
// 不存文件名、不存金额** —— 那三样分别是取件凭证、常含本人姓名的求职材料标题、本人订单状态，
// 落在本机存储里就是共用设备上的下一位能读到的东西（CLAUDE.md §11）。恢复一张订单
// 只需要 orderId，页面会自己带登录态去 `GET /orders/package/:id`（requireOwned）回读。

const storage = require('./storage')
const { isMemberIdentity } = require('./page-guard')
const reconcileEngine = require('./order-submission-reconcile')

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

// ── 不变量：**退出登录 / "清除本机数据" 不得删掉未落定的行** ─────────────────
//
// 给以后想加「退出登录顺手清本机数据」「设置页清缓存」这类功能的人看。
// 未落定（`orderId === ''`）的行**不许被那类功能删掉**，哪怕删它的理由是
// "这是用户自己的数据、用户自己要求清的"。
//
// 一条未落定的记录代表一次「POST 可能已经到了服务端、而响应丢在路上」的提交。
// 删掉它，用户带同一份材料包再提交一次就会铸一个新键，服务端按新键**正常建一张新单**
//（它只按 `(endUserId, idempotencyKey)` 回放，认的是键不是内容）—— 两张订单、两笔钱。
// 而清本机数据的那一刻，恰恰谁都还不知道上一次到底建成没有。
//
// 现状（2026-09-17）：`utils/auth.js` 的 `logout()` 只删 token / user / 补签资格，
// `pages/settings/settings.js` 的退出也只调它 —— 本机**没有**任何一处批量清空这张表，
// 本文件也不提供批量入口（唯一的删除是 `clearRecord`，按 `(account, fingerprint)`
// 逐格删，且只在"确实跳到到机码页了"或"服务端已用 409 证明这个键对不上"之后才调）。
// 要新增批量清除能力，先把这条不变量搬到那个入口上：可以删已落定的（`orderId` 非空，
// 服务端确有其单，最坏是用户在同一份材料包上再下一张），未落定的一条都不能碰。
// 不要为了实现"清干净"而放宽它。
// ──────────────────────────────────────────────────────────────────────

/**
 * **只有"证明得了从来没发出去过"的那一档记录**才按这个寿命过期，7 天。
 *
 * 这个数此前管的是**全部**记录，那是错的。服务端那一侧的
 * `@@unique(endUserId, idempotencyKey)` 是**永久**挂在 Order 行上的，没有任何过期
 * 清理；本机记录一到 7 天就整条消失，于是「POST 已经出门、响应丢在路上、orderId
 * 还没落定」的那一格会在服务端仍然认得那个键的时候被本机忘掉 —— 用户带同一份材料包
 * 再提交，铸的是**新键**，服务端按新键正常建**第二张**订单、再收一次钱。
 * 而且不需要真的等满 7 天：设备时钟往前跳一下（手动改时间、NTP 校正），或者恰好
 * 卡在边界上的那一毫秒，就立刻走到这一格。
 *
 * 现在的判据是 `wasSubmitted`：一条记录只要**可能**已经出门过 —— 已经落定
 *（有 orderId）、`markSubmitted` 已经把它标成"即将 POST"、或者它是旧版本写下的、
 * 根本没有这个标记的记录 —— 就**永远不因本机时间被淘汰**。
 *
 * 剩下的那一档（铸出来、落住了，但 `markSubmitted` 之前就失败、一个 POST 都没发过）
 * 才按这个 TTL 过期：它证明得了自己没出过门，留着只会把未落定名额白白占住。
 *
 * 取 7 天仍与服务端到机码有效期（`package-order.service.ts` 的 `PICKUP_TTL_MS`）同一个
 * 数：一个从没发出去的键留得比那更久没有任何意义。
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

/**
 * 键已经落住了，但"这个键即将出门"这件事没能记进本机（见 `markSubmitted`）。
 *
 * 这一句对应的是一个**没有发生过的 POST**：标记落不住就意味着这个键一旦出门，
 * 本机会在 7 天后把它忘掉 —— 到那时用户再提交就是第二张订单。所以宁可在这里停住。
 */
const SUBMIT_MARK_FAILED_MESSAGE = '本机没能记下这次提交，为避免重复下单已中止提交。请稍后重试，或先到「我的 · 打印订单」确认之前的提交结果'

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
 * 这条记录**可能已经出门过**吗 —— 也就是"这个键有没有可能已经到过服务端"。
 *
 * 这是 TTL 的唯一开关（见 `TTL_MS`）：返回 true 的记录**永远不因本机时间被淘汰**，
 * 因为服务端那一侧的 `(endUserId, idempotencyKey)` 是永久的，本机先忘掉就等于
 * 下一次同参数提交铸新键、服务端再建一张订单、再收一次钱。
 *
 * 三种都算"出过门"，判据全部只看落盘的字段（内存里的任何标记在小程序被杀掉重进
 * 之后一个都不剩，而那正是最需要它的时刻）：
 *   ① `orderId` 非空 —— 服务端确实回过一张订单；
 *   ② `submittedAt !== 0` —— `markSubmitted` 在 POST **之前**同步标过它；
 *   ③ **没有**这个字段（`undefined !== 0`）—— 旧版本写下的记录。旧代码是"铸完立刻
 *      POST"，证明不了它没发过，只能按发过处理。形状被改坏的取值（字符串 / NaN）
 *      同样落在这一档：`!== 0` 成立，保守地当作出过门。
 *
 * 唯一返回 false 的是本版写下、且 `markSubmitted` 还没成功过的那一格 —— 只有它
 * 证明得了自己一个 POST 都没发过，也只有它允许按 TTL 过期。
 */
function wasSubmitted(row) {
  return !!(row && (row.orderId || row.submittedAt !== 0))
}

/**
 * 参与指纹的字段，**与服务端 fingerprintPackageOrderPayload 逐字同一组、同一个顺序**。
 * 服务端 hash 的是 `{terminalId, fileIds, pageRanges, copies, colorMode, duplex}`。
 * 本地少看一项，用户改了那一项再提交就必然 409；多看一项，则会在服务端认为没变时
 * 白白换一个新键，于是"响应丢了再点一次"又变回两张订单。
 *
 * **这不是一行注释，是运行期真值**：`fingerprintOf` 按本表逐项取段拼出指纹
 *（见那里的 `FINGERPRINT_NORMALIZERS`），本表改一个字、删一项或换一次顺序，
 * 算出来的指纹就跟着变。此前这一行只是说明，而 `fingerprintOf` 里另外硬写了同一组
 * 字段 —— 两处能各改各的，于是"字段集与服务端一致"是一条**没有任何东西在维持**的
 * 假不变量。跨端漂移由
 * `scripts/tests/package-order-idempotency.test.mjs` 那条真解析服务端源码的断言守住。
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
  // 每个声明字段一条归一规则。**键必须逐字等于 FINGERPRINT_FIELDS 里的名字** ——
  // 下面按那张表取值，表里有而这里没有的字段会让整次提交 fail-closed（见下）。
  const values = {
    terminalId: source.terminalId,
    fileIds: fileIds.join(','),
    pageRanges: pageRanges.join(','),
    copies: String(Math.max(1, Number(params.copies) || 1)),
    colorMode: params.colorMode === 'bw' ? 'black_white' : params.colorMode,
    duplex: params.duplex === 'single' ? 'simplex' : params.duplex,
  }
  const parts = []
  for (let i = 0; i < FINGERPRINT_FIELDS.length; i += 1) {
    const field = FINGERPRINT_FIELDS[i]
    // 声明了一个字段却没给它归一规则：**当作"这份载荷算不出指纹"处理**，不是悄悄跳过。
    // 跳过会算出一个"少看了一项"的指纹 —— 用户改了那一项再提交，本地以为是同一单、
    // 复用旧键，服务端算出另一个指纹直接 409，重试多少次都一样。
    if (!Object.prototype.hasOwnProperty.call(values, field)) return ''
    parts.push(seg(values[field]))
  }
  return parts.join('|')
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
    // **过期只淘汰"证明得了从来没发出去过"的那一档**（见 TTL_MS / wasSubmitted）。
    // 已落定的、已标记过即将出门的、以及旧版本留下的没有标记的，一律不因本机时间被淘汰：
    // 服务端认那个键是永久的，本机先忘掉就是下一次铸新键、服务端再建一张订单。
    && (wasSubmitted(row) || now - row.createdAt < TTL_MS))
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
    && String(row.orderId || '') === String(verify.orderId || '')
    // 第五项：`markSubmitted` 那一次写入要落的恰恰是它。不核的话"标记没写进去"会被
    // 当成写进去了 —— 而那一格正是"键出门之后本机还会在 7 天后忘掉它"的那一格。
    && wasSubmitted(row) === wasSubmitted(verify))
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
    // `submittedAt: 0` 是"键铸出来了，但一个 POST 都还没发过"的**可证明**标记 ——
    // 只有带着它的记录允许按 TTL 过期。调用方在 POST 之前必须先 `markSubmitted`
    // 把它改掉，否则这个键出门之后本机会在 7 天后忘记它（= 第二张订单）。
    const record = { account, fingerprint, key, orderId: '', createdAt: Date.now(), submittedAt: 0 }
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
 * 在 POST **发出去之前**同步把这一格标成"这个键即将出门"，并**读回来核对**。
 *
 * 为什么必须有这一步：本机这张表要淘汰"铸出来但从没用过"的键（否则一次失败的提交
 * 会把未落定名额永久占住），而"从没用过"只能由本机自己记下来 —— 服务端那一侧的
 * `(endUserId, idempotencyKey)` 是永久的，它不会告诉我们"这个键你没发过"。
 * 标记一旦落住，这条记录就退出 TTL 淘汰，哪怕设备时钟往前跳了一年也还在
 *（见 `TTL_MS` / `wasSubmitted`）。
 *
 * **落不住就一个 POST 都不许发**（调用方按返回值 fail-closed）。理由是这两条代价
 * 完全不对称：不发的代价是用户重试一次；发了而标记没落住的代价是这个键在 7 天后
 * 被本机忘掉，用户带同一份材料包再提交就铸新键、服务端再建一张订单、再收一次钱。
 *
 * **键必须逐字对上盘上那一格**：对不上说明这一格已经被别的路径换过键了，此刻要发
 * 出去的那个键并没有落住 —— 那正是"订单建成了却再也找不回来"的那一种。
 *
 * 已经算出过门的记录（已落定 / 已标过 / 旧版本没有这个字段）直接返回 true，不写盘：
 * 它们本来就已经退出 TTL 淘汰，再写一次只会白白多一次可能失败的存储操作。
 *
 * @returns {boolean} true = 盘上确认这一格已经标住；false = 没标住，调用方**不许 POST**
 */
function markSubmitted(account, fingerprint, key) {
  if (!isMemberIdentity(account) || !fingerprint) return false
  if (typeof key !== 'string' || !KEY_RE.test(key)) return false
  const rows = loadAll()
  // 读不到就一个字节都不写：这里写回去的是**全量**（见 persist），以一个假的空数组
  // 为基底写回去会抹掉盘上别人那条在飞的记录。读不到也证明不了这一格标住了。
  if (!rows) return false
  const at = rows.findIndex((row) => row.account === account && row.fingerprint === fingerprint)
  if (at < 0) return false
  if (rows[at].key !== key) return false
  // 这个键**即将出门**：登记进在途表，核对引擎在保护期内不会去问服务端要它的结论。
  // 少了这一步，一次正常提交可能在请求还在路上时被自己立了墓碑（见 INFLIGHT_GUARD_MS）。
  if (wasSubmitted(rows[at])) { submissionPort.noteInFlight(key); return true }
  const record = Object.assign({}, rows[at], { submittedAt: Date.now() })
  rows[at] = record
  if (!persist(rows, record)) return false
  submissionPort.noteInFlight(key)
  return true
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
  // 落定了就不再是"在途"：留着只会让这一格白白躲开核对（它已经有 orderId，本来也不该被核）。
  submissionPort.forgetInFlight(key)
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
  const dropped = rows.filter((row) => row.account === account && row.fingerprint === fingerprint)
  const kept = rows.filter((row) => !(row.account === account && row.fingerprint === fingerprint))
  if (storage.set(STORE_KEY, retain(kept, null)) !== true) return false
  if (!slotAbsent(account, fingerprint)) return false
  // 这一格真的没了，它那个键也就不在途了。漏掉这一步只会让在途表留一条到期自清的垃圾，
  // 不影响正确性；但留着它会让**新铸的**同名键（理论上）多等一个保护期才被核对。
  for (const row of dropped) submissionPort.forgetInFlight(row.key)
  return true
}

/**
 * 给 utils/order-submission-reconcile.js 用的存储口子。
 *
 * **本机这张表唯一的"腾名额"入口就在这里**，而且它自己不做任何判断：什么时候清、清哪
 * 一格，全部由服务端的墓碑（resolve 的 `not_created` / 409 `IDEMPOTENCY_KEY_ABANDONED`）
 * 决定。本机的时间、记录年龄、4xx、5xx、任何"宽限期"都不是证据 —— 清错一条的代价是
 * 用户被收两次钱，留着一条的代价只是这台设备上少一个名额。
 *
 * 判断逻辑只有 `createSubmissionPort` 那一份（两条链共用），这里只把本表的原语交进去。
 */
const submissionPort = reconcileEngine.createSubmissionPort({
  namespace: STORE_KEY,
  loadAll,
  persist,
  isMemberIdentity,
  wasSubmitted,
  isReusableKey,
})

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
  SUBMIT_MARK_FAILED_MESSAGE,
  wasSubmitted,
  fingerprintOf,
  findRecord,
  ensureKey,
  markSubmitted,
  rememberOrderId,
  clearRecord,
  formatUuidV4,
  submissionPort,
}
