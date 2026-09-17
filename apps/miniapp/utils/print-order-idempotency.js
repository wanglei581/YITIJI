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
//
// 三件事共同的形状：代码都在，但都没走到"确认它生效"那一步。
//
// ── 2026-09-15 复审：③ 的第一版只在**这个进程活着**的时候成立 ──────────────
//
// ③ 当时的做法是"铸键时把这一格钉住（pin），钉住的不参与淘汰"，而钉子是一个模块级
//    的内存 Map。小程序被杀掉重进（真实链路里最常见的那一种：用户切走、系统回收、
//    扫码跳转回来）之后，内存里的钉子一个都不剩，那条**未落定**的记录于是退回成
//    "最旧的、没有 orderId 的" 一条 —— 正好排在淘汰队列最前面。它一旦被挤掉，
//    下一次提交就会铸一个新键，服务端按新键再建一张订单、再扣一笔钱。
//    换句话说：保护只存在于"不需要保护的那段时间"里。
//
//    现在保护**只由落盘的数据本身**决定，与内存无关：一条记录的 `orderId === ''`
//    就是"这次提交还没落定"，`orderId` 非空就是"服务端确有其单"。前者在 TTL 之内
//    **一条都不淘汰**；总量由两条独立的名额分别兜住（MAX_PENDING_RECORDS /
//    MAX_SETTLED_RECORDS）。未落定的名额用尽时**拒绝铸新键**（fail-closed），
//    而不是挤掉一条在飞的 —— 拒绝的代价是用户重试一次，挤掉的代价是第二张订单。
//    钉子（pins / PIN_TTL_MS / isPinned）随之整个删掉：它已经不承担任何判据了。
//
// ④ **clearRecord 只写不读、而且什么都不返回。** 调用方（print-pay.startNewOrder）
//    照着它"清掉了"的假设把页面解锁，而存储可能一个字节都没写进去 —— 于是下一次提交
//    复用那个旧键，服务端一遍遍回放那张早已作废的订单，用户永远打不出东西。
//    现在它写完**读回来确认那一格真的不在了**，并返回布尔；清不掉就保持锁定。
//
// ⑤ **落盘核对漏了 orderId。** persist 此前只核 account/fingerprint/key 三项，
//    而 rememberOrderId 要写进去的恰恰是第四项。写失败（记录被淘汰、存储被拦截）时
//    前三项照样核得上，于是"orderId 没存住"被当成存住了 —— 页面跳走、跳转成功回调
//    又把整条记录清掉，用户回到这一页时既没有锁也没有键。
//
// ⑥ **设备时钟往回拨会让一条好记录当场作废。** loadAll 此前要求 `now - createdAt >= 0`，
//    时钟回跳之后自己写的记录落在"未来"、被整条丢掉 —— 又是一个新键、一张新订单。
//    现在未来时间戳一律按**未过期**处理（形状不对的 createdAt 仍然作废，那是坏数据
//    不是时钟问题），存储上界改由**条数**兜住，不依赖任何关于时间方向的假设。
//
// ── 2026-09-15 R9：上面六条全部假设"读得出来" ─────────────────────────────
//
// ⑦ **一次读失败会把别人那条未落定的记录抹掉。** `utils/storage.js` 的 `get()` 在
//    `wx.getStorageSync` 抛异常时吞掉异常返回 fallback —— 于是"这一次根本没读到"和
//    "本机确实没有记录"在 `loadAll` 里压成了同一个 `[]`。而本模块**每一次写入都是
//    读-改-写回全量**：以一个假的空数组为基底写回去，盘上那条未落定的记录（它的 POST
//    可能已经到了服务端、只是响应丢在路上）就此消失。代价和 ③ 完全一样 —— 下一次同参数
//    提交铸一个新键，服务端再建一张订单、再扣一笔钱 —— 而且这一次连"名额满了拒绝"
//    那道闸都绕过去了：数出来的未落定条数同样是 0。
//    三个写入口（`ensureKey` / `rememberOrderId` / `clearRecord`）各自都能触发：
//    `clearRecord` 最狠，它会把**整张表**写成空。
//    现在 `loadAll()` 在读失败时返回 `null`（不是 `[]`），三个写入口一律 fail-closed：
//    一个字节都不写、如实返回失败，让调用方保持锁定。读恢复之后同一条链照常继续。

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
 * **未落定**（`orderId === ''`）的记录最多留几条。
 *
 * 这一档一条都不淘汰 —— 它们各自代表一次"POST 可能已经到了服务端、而响应丢在路上"
 * 的提交，丢掉任何一条都等于让下一次提交铸一个新键、让服务端再建一张订单。
 * 所以名额用尽时的处置是**拒绝铸新的键**（见 `ensureKey` 的 fail-closed 分支），
 * 不是挤掉一条在飞的：拒绝的代价是用户重试一次，挤掉的代价是第二张订单、第二笔钱。
 *
 * 取 20 是一个够宽的上界：它要在同一台设备、同一个 TTL（7 天）窗口里被填满，
 * 得有 20 次"提交出去了但从来没拿到过 orderId"的尝试。真到了那一步，用户面对的
 * 本来就不是一个能靠再提交一次解决的问题。
 */
const MAX_PENDING_RECORDS = 20

/**
 * **已落定**（`orderId` 非空）的记录最多留几条。
 *
 * 这一档可以淘汰：服务端确有其单，最坏结果是用户在同一组参数上再下一张 —— 而不是
 * 像未落定那一档那样，丢掉之后连"上一次到底建没建成"都无从判断。同档内留最新的。
 */
const MAX_SETTLED_RECORDS = 20

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

/**
 * 本机存储这一刻读不出来时给用户的话。
 *
 * 和"名额满了"分成两句：那一句说的是"你之前提交过太多次"，这一句说的是"本机现在
 * 读不了"。压成一句会让用户去「我的 · 打印订单」找一批根本不存在的历史提交。
 * 两句都指向同一个可执行的下一步 —— 因为无论哪种，再点一次都不会好。
 */
const STORE_UNREADABLE_MESSAGE = '读不到本机的下单记录，为避免重复下单已中止提交。请稍后重试，或先到「我的 · 打印订单」确认之前的提交结果'

/** 未落定名额用尽。见 MAX_PENDING_RECORDS。 */
const PENDING_FULL_MESSAGE = '本机还有太多没有落定的下单记录，为避免重复下单已中止提交。请先到「我的 · 打印订单」确认之前几次提交的结果'

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
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

/**
 * 读全量并就地丢掉过期 / 形状不对的条目。
 *
 * **未来的 createdAt 一律当作未过期**，不当作坏数据。判据此前是
 * `now - createdAt >= 0 && now - createdAt < TTL_MS`，那条 `>= 0` 假设了设备时钟只会
 * 往前走。真实设备上它会往回跳（用户手动改时间、时区/NTP 同步回退、双卡切换运营商
 * 时间），跳完之后**这台设备自己刚写下的那条记录**就落在"未来"，被整条丢掉 ——
 * 于是下一次提交铸一个新键，服务端按新键再建一张订单。而"记录看起来来自未来"这件事
 * 本身，从来不是"这个键不该再用"的证据。
 *
 * 形状不对的 createdAt（NaN / Infinity / 非数字）仍然一律作废：那不是时钟问题，
 * 是坏数据 —— 拿它算任何时间差都得不到可信的结论。
 *
 * 存储上界不靠时间兜（见 `retain`），所以这里放宽不会让记录无限堆积。
 *
 * **读失败返回 `null`，不是 `[]`。** 两者在 `storage.get` 那一层是同一个 fallback，
 * 而本模块每一次写入都是"读 → 改 → 写回全量"：以一个假的空数组为基底写回去，盘上
 * 那条未落定的记录（POST 可能已经到了服务端）就此消失 —— 下一次同参数提交铸一个新键，
 * 服务端再建一张订单。所以调用方必须先判 `null`，判不出来就一个字节都不许写。
 *
 * @returns {?Array} 读到了返回（已过滤的）记录数组；**这一次根本没读到**返回 null
 */
function loadAll() {
  const result = storage.read(STORE_KEY)
  // 三分，不是二分。**只有"本机确实没有这一格"才是空表**（wx 在 key 不存在时返回 `''`）。
  // 读抛异常、或者读出来是 `null` / 对象 / 字符串 / 数字，都只说明**这一次读到的东西
  // 不是这张表** —— 它证明不了盘上没有记录。上一版把后者折进 `return []`，于是
  // 三个写入口照样以"空表"为基底写回全量，盘上那条未落定的记录（POST 可能已经到了
  // 服务端）被一次读异常抹掉，代价和读失败那一条一模一样。
  if (!result.ok) return null
  if (!result.found) return []
  if (!Array.isArray(result.value)) return null
  const raw = result.value
  const now = Date.now()
  return raw.filter((row) => row
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
 * 淘汰。**判据不是"谁最新"，是"丢了会不会多出一张订单"。**
 *
 * 而这条判据必须只看**落盘的数据本身**，不能看任何内存状态。上一版看的是一个模块级
 * 的钉子 Map（铸键时钉住、落定时释放），于是"保护"在小程序被杀掉重进之后一个都不剩 ——
 * 而那恰恰是最需要它的时刻：进程都没了，那条未落定的记录是唯一还知道"上一次提交用的是
 * 哪个键"的东西。重进之后它退回成"最旧的、没有 orderId 的"一条，正好排在淘汰队列最前面。
 *
 * 现在只有两档，判据就写在记录里：
 *   ① `orderId === ''` —— **未落定**：POST 可能正在飞，也可能已经到了服务端而响应丢在
 *      路上。**一条都不淘汰**（TTL 之内）。这一档的总量由 `ensureKey` 在入口处
 *      fail-closed 兜住（名额满了就拒绝铸新键），不靠淘汰兜。
 *   ② `orderId` 非空 —— **已落定**：服务端确有其单，最坏结果是用户在同一组参数上再下
 *      一张。可以淘汰，同档内留最新的 MAX_SETTLED_RECORDS 条。
 *
 * `protect` 是"这一次正在写的那条记录"。它必须留下来，否则 `persist` 的读回核对会
 * 失败在一个与存储好坏无关的原因上（刚写进去就被自己的淘汰挤掉），而调用方只能把它
 * 报成"本机写不进去"。
 *
 * @param {Array} rows 已经过 loadAll 过滤的记录
 * @param {number} now 仅用于稳定排序的时间基准
 * @param {?{account:string, fingerprint:string}} protect 本次写入的目标记录
 */
function retain(rows, now, protect) {
  const sorted = rows.slice().sort((a, b) => b.createdAt - a.createdAt)
  const pending = []
  const settled = []
  for (const row of sorted) {
    if (row.orderId) settled.push(row)
    else pending.push(row)
  }
  const isProtected = (row) => !!protect
    && row.account === protect.account
    && row.fingerprint === protect.fingerprint
  const keptSettled = []
  // 名额先留给这一次正在写的那条，其余按最新排。未落定的那一档整份留下，不参与。
  for (const row of settled.filter(isProtected).concat(settled.filter((r) => !isProtected(r)))) {
    if (keptSettled.length >= MAX_SETTLED_RECORDS) break
    keptSettled.push(row)
  }
  return pending.concat(keptSettled).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 这一格**确实不在**存储里了吗。
 *
 * 判据只能是"再读一遍，raw 里没有任何一条 account+fingerprint 对得上的记录"。
 * 读不回一个数组（存储被清、被拦截、读出来是别的东西）一律返回 false ——
 * 证明不了它不在，就当它还在。调用方据此保持锁定，而不是解锁后铸一个新键。
 */
function slotAbsent(account, fingerprint) {
  const back = storage.get(STORE_KEY, null)
  if (!Array.isArray(back)) return false
  return !back.some((row) => row
    && typeof row === 'object'
    && row.account === account
    && row.fingerprint === fingerprint)
}

/**
 * 落盘。**写完必须读回来核对**，不能只看 `storage.set` 的返回值。
 *
 * `utils/storage.js` 的 `set()` 只在 `wx.setStorageSync` 抛异常时返回 `false`；
 * 而"没抛异常但也没写进去"（存储被系统回收、被隐私策略拦截）在真机上同样存在，
 * 从返回值上完全看不出来。这条链的全部价值就在于键**真的还在**，所以判据只能是
 * 「再读一遍，那条记录逐字还在」。
 *
 * **四项都核，`orderId` 不能漏。** 只核 account/fingerprint/key 时，
 * `rememberOrderId` 那一次写入要落的恰恰是第四项：写没写进去，前三项照样核得上。
 * 于是"orderId 没存住"会被当成存住了 —— 页面照常跳走，跳转成功回调又把整条记录清掉，
 * 用户回到这一页时既没有锁也没有键。
 *
 * @param {Array} rows 要保存的全量记录
 * @param {?{account:string, fingerprint:string, key:string, orderId:string}} verify 必须能读回来的那条
 * @returns {?Array} 成功返回实际保留下来的那份；失败返回 null（调用方必须当失败处理）
 */
function persist(rows, verify) {
  // 基底必须是**真的读出来的那一份**。调用方读不到时会传 null 进来（而不是硬凑一个
  // 空数组），这里一并挡住：写回一个凭空造出来的全量 = 抹掉盘上所有在飞的键。
  if (!Array.isArray(rows)) return null
  const kept = retain(rows, Date.now(), verify)
  if (storage.set(STORE_KEY, kept) !== true) return null
  if (!verify) return kept
  const back = storage.get(STORE_KEY, null)
  if (!Array.isArray(back)) return null
  const hit = back.find((row) => row
    && typeof row === 'object'
    && row.account === verify.account
    && row.fingerprint === verify.fingerprint
    && row.key === verify.key
    && String(row.orderId || '') === String(verify.orderId || ''))
  return hit ? kept : null
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
  const rows = loadAll()
  // 读不到时返回 null（= "没有可复用的记录"）。这一格是**只读**用途，返回 null 不会
  // 写坏任何东西；真正危险的是写入口，它们各自单独判（见 ensureKey / rememberOrderId /
  // clearRecord），绝不拿一个"读不到"当成"本机没有"。
  if (!rows) return null
  return rows.find((row) => row.account === account && row.fingerprint === fingerprint) || null
}

/**
 * 这一批记录里有几条是**未落定**的（`orderId === ''`）。
 *
 * 跨账号一起数：名额守的是"这台设备上的存储"，而存储是所有人共用的。按账号分别计数
 * 等于给每个登录过的账号各开一份名额，共用设备上就没有上界了。
 *
 * 参数是**调用方已经确认读得出来**的那一份，不在这里自己读：自己读就得自己决定
 * "读不到算几条"，而那个问题没有安全答案 —— 算 0 会放行铸键（正是要防的），
 * 算满会把一次普通的读抖动说成"本机记录太多"。判据留在调用方那里。
 */
function pendingCount(rows) {
  return rows.filter((row) => !row.orderId).length
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
  // 先确认本机这一刻**读得动**。读不到时下面每一步都会得出一个假结论：
  // "没有可复用的记录"（→ 铸新键）、"未落定 0 条"（→ 名额闸失效）、
  // "全量就是这一条"（→ 写回去把别人在飞的那条抹掉）。三个假结论叠起来正好是
  // "服务端再建一张订单、再扣一笔钱"。
  const rows = loadAll()
  if (!rows) return Promise.reject(new Error(STORE_UNREADABLE_MESSAGE))
  const hit = rows.find((row) => row.account === account && row.fingerprint === fingerprint)
  if (hit && isReusableKey(hit.key)) return Promise.resolve(hit)
  // 走到这里只有一种可能：这一格已经落定（有 orderId），而它的键是服务端已经不接受的
  // 形态 —— loadAll 只让这一种活下来（键不可用且未落定的那一种当场就丢掉了，见那里）。
  // 不复用（400 换不回原单），也不铸新键（那是第二张订单），更不清记录（orderId 还有用）。
  if (hit) return Promise.reject(new Error(STALE_KEY_SETTLED_MESSAGE))
  // 未落定的名额满了：**拒绝铸新键**，一条既有记录都不删。
  //
  // 这是本模块唯一一处"宁可不让用户下单"的地方，因为另一条路更贵：腾名额只能从
  // 未落定那一档里腾，而那一档每一条都代表一次"POST 可能已经到了服务端"的提交 ——
  // 删掉任何一条，下一次同参数提交就会铸一个新键，服务端于是再建一张订单、再扣一笔。
  // 被拒绝的用户重试一次就好；被挤掉的那一单，用户永远不知道自己被扣了两次。
  // 注意这一段排在 findRecord 命中之后：同一格已经有记录时照常复用，名额满了也不影响。
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
    // 取随机数这段时间里存储可能已经读不动了（也可能刚才那一次只是侥幸读到）。
    // 写之前必须**重新读一次并确认读得动**：这是写回全量的基底，基底假了就是抹别人的记录。
    const base = loadAll()
    if (!base) throw new Error(STORE_UNREADABLE_MESSAGE)
    // 取随机数这段时间里，别的路径完全可能已经把这一格写好了（例如一次失败重试的
    // 回退路径）。真有就用它，不覆盖 —— 覆盖等于换一个键。
    const settled = base.find((row) => row.account === account && row.fingerprint === fingerprint)
    if (settled && isReusableKey(settled.key)) return settled
    // 同上：这段时间里冒出来的那一格若带着一个服务端不接受的键，一样只能 fail-closed。
    if (settled) throw new Error(STALE_KEY_SETTLED_MESSAGE)
    // 取随机数期间别的**槽位**也可能把名额占满（不同参数、另一个页面实例）。
    // 再判一次：这一步的代价只是白铸一个键，而放行的代价是挤掉一条在飞的记录。
    if (pendingCount(base) >= MAX_PENDING_RECORDS) {
      throw new Error(PENDING_FULL_MESSAGE)
    }
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
 * 记下服务端给回来的 orderId。
 *
 * 调用方必须在**判断"当前页面还接不接收这条响应"之前**就调它：那两件事的对象根本不同 ——
 * 记录属于**发起这次提交的那位账号**，而页面此刻可能已经换人了。先判页面再存，
 * 就会在"A 的回调晚于换人"时直接 return，于是服务端那张订单已经建成、
 * 而 A 手上一条线索都没有，A 重进本页只会再提交一次。
 *
 * 落盘成功，这条记录就从"未落定"那一档挪进"已落定"那一档（见 retain）：它不再需要
 * 被无条件保护，因为它已经能指回服务端那张真实存在的订单了。
 *
 * @returns {?object} 成功返回落住的那条记录；**失败返回 null，调用方必须当真**：
 *   订单在服务端是真的，但本机已经指不回它了。此时既不能解锁重试（那是第二张订单），
 *   也不能当没事发生 —— 见 print-pay.continueFlow 的 `_lockAfterCreated` 分支。
 */
function rememberOrderId(account, fingerprint, key, orderId) {
  if (!isMemberIdentity(account) || !fingerprint || !orderId) return null
  if (typeof key !== 'string' || !KEY_RE.test(key)) return null
  const rows = loadAll()
  // 读不到就一个字节都不写。这里写回去的是**全量**：拿一条孤零零的新记录当全量写下去，
  // 盘上别人那条未落定的记录（POST 可能已经到了服务端）就没了。返回 null 的代价是
  // 调用方按"没存住"处理（页面锁定并指向「我的 · 打印订单」）—— 那正是正确的处置。
  if (!rows) return null
  const at = rows.findIndex((row) => row.account === account && row.fingerprint === fingerprint)
  const record = at >= 0
    ? Object.assign({}, rows[at], { key, orderId: String(orderId) })
    : { account, fingerprint, key, orderId: String(orderId), createdAt: Date.now() }
  if (at >= 0) rows[at] = record
  else rows.push(record)
  // persist 现在连 orderId 一起核回来。核不上就返回 null —— 调用方必须当"没存住"处理：
  // 服务端那张订单是真的（它刚刚返回了 orderId），但本机已经指不回它了。
  if (!persist(rows, record)) return null
  return record
}

/**
 * 丢掉这条记录。**只有在用户确实被送到了到机码页、或服务端已经证明原单走到终态之后
 * 才该调**：200 一到就清的话，跳转失败就把唯一能找回这张订单的线索也一起丢了，
 * 而页面还留在原地 —— 用户只会再点一次。
 *
 * **返回布尔，而且判据是读回来那一格真的不在了。** 上一版只调一次 `saveAll` 就当清掉了，
 * 什么都不返回；而 `utils/storage.js` 的 `set()` 在"没抛异常也没写进去"时同样返回 true。
 * 调用方（print-pay.startNewOrder）照着这个假设把页面解锁，于是下一次提交复用那个旧键，
 * 服务端一遍遍回放那张早已取消 / 过期的订单 —— 用户面对一个能按的按钮，却永远打不出东西。
 *
 * 无条件写一次（而不是"有变化才写"）：raw 里可能还留着 loadAll 已经滤掉、但
 * `slotAbsent` 仍然看得见的同槽位残留（过期的、形状不对的）。写的是 loadAll 的结果，
 * 它们本来也该一起被清掉。
 *
 * @returns {boolean} true = 读回来确认这一格不在了；false = 没清掉，调用方必须保持锁定。
 */
function clearRecord(account, fingerprint) {
  if (!isMemberIdentity(account) || !fingerprint) return false
  const rows = loadAll()
  // 读不到就**什么都不写**。这一处是三个写入口里最狠的一个：读失败时 `rows` 会是
  // 一个假的空数组，`kept` 也是空，于是它把**整张表**写成空 —— 这台设备上所有账号
  // 所有在飞的幂等键一起没了。返回 false（"证不出它不在"）让调用方保持锁定，
  // 读恢复之后同一个按钮能真的把它清掉。
  if (!rows) return false
  const kept = rows.filter((row) => !(row.account === account && row.fingerprint === fingerprint))
  if (storage.set(STORE_KEY, retain(kept, Date.now(), null)) !== true) return false
  return slotAbsent(account, fingerprint)
}

module.exports = {
  FINGERPRINT_FIELDS,
  KEY_RE,
  KEY_SHAPE_RE,
  isReusableKey,
  STALE_KEY_SETTLED_MESSAGE,
  TTL_MS,
  MAX_PENDING_RECORDS,
  MAX_SETTLED_RECORDS,
  RANDOM_TIMEOUT_MS,
  STORE_KEY,
  fingerprintOf,
  findRecord,
  ensureKey,
  rememberOrderId,
  clearRecord,
  formatUuidV4,
}
