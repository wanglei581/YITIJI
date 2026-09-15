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

const storage = require('./storage')
const { isMemberIdentity } = require('./page-guard')

/**
 * 本机存储键。**不进 utils/storage.js 的 KEYS 表**：那张表是"跨页共享的业务状态"，
 * 而这条记录只服务于建单这一条链，由本模块独占读写。
 */
const STORE_KEY = 'zyd_print_order_idem'

/** 记录寿命。服务端的到机码有效期远短于此，这里只保证不无限期堆在用户手机上。 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 最多留几条。按 createdAt 淘汰最旧的，避免反复改参数把存储撑大。 */
const MAX_RECORDS = 20

/** 与服务端 assertMemberPrintOrderIdempotencyKey 的 IDEMPOTENCY_KEY_RE 同形。 */
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 参与指纹的字段，**与服务端 fingerprintMemberPrintOrderPayload 逐字同一组**。
 * 改这里就必须同时改那边，否则两侧对「参数变没变」的判断会分叉 —— 分叉的两个方向
 * 都有代价，见文件头。
 */
const FINGERPRINT_FIELDS = ['fileId', 'terminalId', 'copies', 'colorMode', 'duplex']

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
 * 16 字节真随机 → UUID v4。
 *
 * **不用 Math.random**：它不是密码学随机，多个端在同一毫秒进入本页时有真实的碰撞面，
 * 而碰撞意味着两个人的两次下单共用一个幂等键 —— 第二个人会被服务端当成第一个人的重试，
 * 要么拿到别人的订单（同指纹），要么直接 409（不同指纹）。
 *
 * `wx.getRandomValues` 只有异步形态，所以本函数返回 Promise。取不到就**失败**，
 * 不退回任何弱随机：没有可靠的键就不该发这个请求（服务端也会 400 挡下来）。
 */
function randomUuidV4() {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.getRandomValues !== 'function') {
      reject(new Error('当前微信版本不支持安全随机数，无法安全地提交订单，请升级微信后重试'))
      return
    }
    wx.getRandomValues({
      length: 16,
      success: (res) => {
        try {
          resolve(formatUuidV4(res && res.randomValues))
        } catch (e) {
          reject(e)
        }
      },
      fail: () => reject(new Error('获取安全随机数失败，请稍后重试')),
    })
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

function saveAll(rows) {
  const kept = rows.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RECORDS)
  storage.set(STORE_KEY, kept)
  return kept
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
 * **铸出来就立刻落盘，然后才轮到调用方去 POST。** 顺序反过来（先发请求、成功再存）
 * 等于把"响应丢了"这一种情况原样留着：那正是最需要幂等键的时刻。
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
  return randomUuidV4().then((key) => {
    const record = { account, fingerprint, key, orderId: '', createdAt: Date.now() }
    saveAll(loadAll().concat([record]))
    return record
  })
}

/**
 * 记下服务端给回来的 orderId。
 *
 * 调用方必须在**判断"当前页面还接不接收这条响应"之前**就调它：那两件事的对象根本不同 ——
 * 记录属于**发起这次提交的那位账号**，而页面此刻可能已经换人了。先判页面再存，
 * 就会在"A 的回调晚于换人"时直接 return，于是服务端那张订单已经建成、
 * 而 A 手上一条线索都没有，A 重进本页只会再提交一次。
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
  saveAll(rows)
  return record
}

/**
 * 丢掉这条记录。**只有在用户确实被送到了到机码页之后才该调**：
 * 200 一到就清的话，跳转失败就把唯一能找回这张订单的线索也一起丢了，
 * 而页面还留在原地 —— 用户只会再点一次。
 */
function clearRecord(account, fingerprint) {
  if (!isMemberIdentity(account) || !fingerprint) return
  const rows = loadAll()
  const kept = rows.filter((row) => !(row.account === account && row.fingerprint === fingerprint))
  if (kept.length !== rows.length) saveAll(kept)
}

module.exports = {
  FINGERPRINT_FIELDS,
  KEY_RE,
  TTL_MS,
  STORE_KEY,
  fingerprintOf,
  findRecord,
  ensureKey,
  rememberOrderId,
  clearRecord,
  formatUuidV4,
}
