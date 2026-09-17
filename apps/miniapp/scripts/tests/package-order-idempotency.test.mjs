/**
 * 材料包建单幂等键的**真执行**测试（node:test）。
 *
 * 为什么必须真跑：这一批缺陷全是「代码看着都在，顺序一换就漏」——键落盘排在 POST
 * 之后、失败路径顺手把键清掉、换个人还能复用上一位的键、存储读不出来时按"本机没有
 * 记录"继续走。正则能证明某段守卫存在，证明不了**一次提交发了几个 POST、带的是不是
 * 同一个键**。所以这里把 utils 与页面源码都真的执行一遍。
 *
 * 做法与 page-lifecycle.test.mjs 同一套：node:vm 给页面源码一个最小沙箱，
 * package-order-idempotency / page-guard / package-order 用**真实实现**，只有
 * api / auth 是替身；utils/api.js 那一组则连 request.js 一起真跑，替身只到
 * wx.request 为止 ——「键到底进没进 Header」只有在那一层才看得见。
 *
 * 放在 scripts/tests/ 是刻意的（gates.mjs 把它排除在门禁脚本之外，不会被
 * verify-ci-gate-coverage 当成"写完没接线的门禁"）。由 `verify:package-order-idempotency`
 * 拉起，串在 verify:static 里进 CI。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

// utils/storage.js 读的是**全局** wx，而页面读的是自己沙箱里的 wx。两边必须是同一个
// 对象，否则真实的 idem 模块会读到一个空的（或上一条测试遗留的）存储。
let ACTIVE_WX = null
Object.defineProperty(globalThis, 'wx', { get: () => ACTIVE_WX, configurable: true })

const idem = requireMiniapp('../utils/package-order-idempotency.js')
const STORE_KEY = idem.STORE_KEY

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 最小 wx 替身。storage 是一个普通 Map，但**读写都可以被单独打坏** —— 真机上
 *  "读抛异常"与"没抛异常也没写进去"是两种故障，本模块对它们的处置也不同。 */
function createWx() {
  const storage = new Map()
  const calls = { requests: [], redirectTo: [], showLoading: [], hideLoading: 0, requestPayment: 0, random: 0 }
  const control = {
    readThrows: false,      // wx.getStorageSync 抛（存储被拦截）
    writeThrows: false,     // wx.setStorageSync 抛（存储满）
    writeSilentlyDrops: false, // 不抛异常、也没写进去（被系统回收 / 隐私策略）
    corruptIdemTable: false,   // 这一格读出来不是数组
    navFail: false,
    randomMode: 'ok',       // ok | silent | completeOnly | missing
  }
  let seed = 0
  const wx = {
    storage, calls, control,
    getStorageSync(key) {
      if (control.readThrows) throw new Error('getStorageSync failed')
      if (control.corruptIdemTable && key === STORE_KEY) return { notAnArray: true }
      return storage.has(key) ? storage.get(key) : ''
    },
    setStorageSync(key, value) {
      if (control.writeThrows) throw new Error('setStorageSync failed')
      if (control.writeSilentlyDrops) return
      storage.set(key, JSON.parse(JSON.stringify(value)))
    },
    removeStorageSync(key) { storage.delete(key) },
    // 按调用序号灌字节，于是每次 mint 出来的 UUID 都不同 —— "复用了同一个键"和
    // "又铸了一个新键"在断言里才分得开。**不是** Math.random：被测代码里也不许有。
    getRandomValues(opts) {
      calls.random += 1
      if (control.randomMode === 'silent') return
      if (control.randomMode === 'completeOnly') { if (opts.complete) opts.complete({}); return }
      seed += 1
      const bytes = new Uint8Array((opts && opts.length) || 16)
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (seed * 37 + i * 11) & 0xff
      if (opts && opts.success) opts.success({ randomValues: bytes.buffer })
      if (opts && opts.complete) opts.complete({})
    },
    redirectTo(opts) {
      calls.redirectTo.push(opts.url)
      if (control.navFail) { if (opts.fail) opts.fail({ errMsg: 'redirectTo:fail' }); return }
      if (opts.success) opts.success()
    },
    navigateTo() {}, navigateBack(opts) { if (opts && opts.fail) opts.fail({}) }, switchTab() {},
    showToast() {}, showModal() {},
    showLoading(opts) { calls.showLoading.push((opts && opts.title) || '') },
    hideLoading() { calls.hideLoading += 1 },
    requestPayment() { calls.requestPayment += 1 },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
  }
  return wx
}

/** 可切换身份的 auth 替身（page-guard.memberIdentityKey 只读这两个方法）。 */
function createAuth(initialId) {
  let user = initialId ? { id: initialId } : null
  return {
    setUser(id) { user = id ? { id } : null },
    isLoggedIn: () => !!user,
    getUser: () => user,
    getToken: () => 'token',
    canSilentResignin: () => false,
  }
}

/** 在沙箱里真实执行页面源码，返回一个可调用的页面实例。 */
function makePage(wx, { api, auth }) {
  ACTIVE_WX = wx
  const src = fs.readFileSync(path.join(MINIAPP, 'pages/package-confirm/package-confirm.js'), 'utf8')
  let pageDef = null
  const sandbox = {
    console, wx,
    Page: (def) => { pageDef = def },
    getApp: () => ({ globalData: { statusBarHeight: 20 } }),
    require: (id) => {
      const name = id.replace(/^.*\//, '').replace(/\.js$/, '')
      if (name === 'api') return api
      if (name === 'auth') return auth
      return requireMiniapp(`../utils/${name}.js`)
    },
    module: { exports: {} }, exports: {},
    setTimeout, clearTimeout, setInterval, clearInterval,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'package-confirm.js' })
  assert.ok(pageDef, 'package-confirm.js 没有调用 Page()')
  const page = Object.assign(Object.create(null), pageDef)
  page.data = JSON.parse(JSON.stringify(pageDef.data || {}))
  page.setData = function setData(patch) {
    for (const key of Object.keys(patch || {})) this.data[key] = patch[key]
  }
  return page
}

const DRAFT = { ownerKey: 'u:A', draftId: 'd1', copies: 1, colorMode: 'bw', duplex: 'single', files: [{ fileId: 'f1', name: '简历.pdf' }, { fileId: 'f2', name: '证书.pdf' }] }
const STORE = { id: 't-1', ownerKey: 'u:A', draftId: 'd1', name: '一号服务点', address: '某路 1 号' }
const PAYLOAD = { terminalId: 't-1', files: [{ fileId: 'f1' }, { fileId: 'f2' }], params: { colorMode: 'black_white', duplex: 'simplex', copies: 1 } }

function seedDraft(wx) {
  wx.storage.set('temp_package_data', JSON.parse(JSON.stringify(DRAFT)))
  wx.storage.set('temp_selected_store', JSON.parse(JSON.stringify(STORE)))
}

/**
 * 建单替身：记下每一次调用（含 opts），并交出一个由测试决定何时完成的 Promise。
 * 同时在**调用发生的那一刻**给存储拍一张快照 —— "键先落住再 POST" 只能在这一刻验，
 * 事后再看盘上有什么是看不出顺序的。
 */
function createApi(wx) {
  const calls = { create: [], get: [], quote: 0 }
  const api = {
    quotePackageOrder() { calls.quote += 1; return Promise.resolve({ amountCents: 100, billablePages: 2 }) },
    getPackageOrder(orderId) {
      const d = {}
      d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject })
      d.promise.catch(() => {})
      calls.get.push({ orderId, ...d })
      return d.promise
    },
    createPackageOrder(data, opts) {
      const d = {}
      d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject })
      d.promise.catch(() => {})
      calls.create.push({ data, opts, ...d, storageAtCall: JSON.parse(JSON.stringify(wx.storage.get(STORE_KEY) || [])) })
      return d.promise
    },
  }
  return { api, calls }
}

/** 走到「报价就绪 + 已勾协议」，也就是「确认下单」真的能按的那一刻。 */
async function openReadyPage(wx, api, auth) {
  const page = makePage(wx, { api, auth })
  page.onLoad()
  await flush()
  page.toggleAgreement({ detail: { value: ['agreed'] } })
  return page
}

const httpError = (statusCode, code, message) => Object.assign(new Error(message || code), { statusCode, code })

// ══════════════════════════════════════════════════════════════════════
// A. 指纹：与服务端 fingerprintPackageOrderPayload 同一组字段、同一套归一
// ══════════════════════════════════════════════════════════════════════

/**
 * 服务端 `fingerprintPackageOrderPayload` 里那个被 hash 的对象字面量，**按源码解析**
 * 出它的字段名与顺序。
 *
 * 为什么要解析而不是照抄一份常量：照抄的那一份改不改全凭人自觉，正是这次要消灭的
 * 那种"没有任何东西在维持的不变量"。这里的解析是确定性的：从函数声明处找到
 * `JSON.stringify({`，按括号深度只收第一层的 `key:`。深度一进内层（`dto.files.map(...)`
 * 那样的调用、数组、嵌套对象）就不再计入，所以 `canonicalizePackagePageRange(...)`
 * 这种带括号的值不会被误当成字段。
 *
 * **不比较 hash 字节**：服务端算的是 sha256(JSON)，本地是带长度前缀的分段串，两者
 * 本来就不该相等（也不需要相等）。要守的是"字段集 + 顺序 + 归一口径"这份契约 ——
 * 少一项 → 用户改了那一项本地却以为是同一单 → 复用旧键 → 服务端 409，重试无用；
 * 多一项 → 服务端认为没变而本地换了新键 → 第二张订单、第二笔钱。
 */
function parseApiFingerprintFields(src) {
  const at = src.indexOf('export function fingerprintPackageOrderPayload(')
  assert.ok(at >= 0, '服务端 fingerprintPackageOrderPayload 不见了（改名 / 挪走都要同步本地字段表）')
  const objAt = src.indexOf('JSON.stringify(', at)
  assert.ok(objAt > at, 'fingerprintPackageOrderPayload 里找不到被 hash 的那个对象字面量')
  const fields = []
  let depth = 0
  let token = ''
  for (let i = objAt + 'JSON.stringify'.length; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '(' || ch === '{' || ch === '[') { depth += 1; token = ''; continue }
    if (ch === ')' || ch === '}' || ch === ']') { depth -= 1; token = ''; if (depth === 0) break; continue }
    // depth 2 = `JSON.stringify(` 的括号 + 对象的 `{`，也就是对象的第一层。
    if (depth === 2 && /[A-Za-z0-9_$]/.test(ch)) { token += ch; continue }
    if (depth === 2 && ch === ':' && token) { fields.push(token); token = ''; continue }
    token = ''
  }
  return fields
}

test('指纹字段契约：本地这一组与服务端 fingerprintPackageOrderPayload 逐项同名同序', () => {
  const apiSrc = fs.readFileSync(
    path.join(MINIAPP, '../../services/api/src/member-print-orders/package-order.service.ts'), 'utf8')
  const serverFields = parseApiFingerprintFields(apiSrc)
  // 阳性对照：解析器真的解析出东西了。读数为 0 有两种可能（真没有 / 根本没测到），
  // 少了这一条，解析器一旦失灵就会和一个同样为空的本地表"对上"，断言恒真。
  assert.ok(serverFields.length >= 5, `解析器没取到服务端字段（拿到 ${JSON.stringify(serverFields)}）`)
  assert.deepEqual(serverFields, idem.FINGERPRINT_FIELDS,
    '两端字段集/顺序必须逐项相同：少一项 = 同键不同参 409，多一项 = 白铸新键 = 第二张订单')

  // 归一口径同样是契约的一部分（字段名对上、归一不同，照样两端算出不同的"是不是同一单"）。
  // 这三条在服务端都有唯一写法，逐字核对；本地那三条由 fingerprintOf 的真执行守住（下面几条）。
  assert.match(apiSrc, /colorMode: dto\.params\.colorMode === 'bw' \? 'black_white' : dto\.params\.colorMode/,
    '服务端仍把 bw 归一成 black_white')
  assert.match(apiSrc, /duplex: dto\.params\.duplex === 'single' \? 'simplex' : dto\.params\.duplex/,
    '服务端仍把 single 归一成 simplex')
  assert.match(apiSrc, /function canonicalizePackagePageRange\([\s\S]{0,200}pageRange \? pageRange : null/,
    '服务端 pageRange 仍按 truthiness 归一（缺失 / 空串同为一档）')
})

test('指纹：声明的字段表就是运行期真值（多一项 / 少一项都立刻改变行为，不是一行注释）', () => {
  const fields = idem.FINGERPRINT_FIELDS
  const base = idem.fingerprintOf(PAYLOAD)
  // 指纹**逐段**对应声明表：段数必须等于字段数。此前 fingerprintOf 里另写了一组硬编码
  // 字段，这条断言在那一版上同样会过，但那时它证明不了两者一致 —— 所以下面那条
  // "声明了没有归一规则的字段 → fail-closed" 才是真正把两者绑在一起的那一条。
  assert.equal(base.split('|').length, fields.length)

  const original = fields.slice()
  try {
    fields.push('quoteId')  // 声明一个没有归一规则的字段
    assert.equal(idem.fingerprintOf(PAYLOAD), '',
      '声明表里多出一个没有归一规则的字段 → 算不出指纹（fail-closed），而不是悄悄少看一项')
    fields.length = 0
    fields.push('terminalId', 'copies')
    const narrowed = idem.fingerprintOf(PAYLOAD)
    assert.equal(narrowed.split('|').length, 2, '砍掉字段立刻改变运行期产物')
    assert.notEqual(narrowed, base)
  } finally {
    fields.length = 0
    for (const f of original) fields.push(f)
    assert.equal(idem.fingerprintOf(PAYLOAD), base, '恢复原表后指纹逐字回到原值')
  }
})

test('指纹：bw/single 与 black_white/simplex 是同一个槽位（别名不归一 = 一次重试白铸新键）', () => {
  const canonical = idem.fingerprintOf(PAYLOAD)
  const aliased = idem.fingerprintOf({ ...PAYLOAD, params: { colorMode: 'bw', duplex: 'single', copies: 1 } })
  assert.equal(aliased, canonical)
  assert.notEqual(canonical, '')
})

test('指纹：缺 pageRange、pageRange 为空串、pageRange 为 null 三者同一槽位', () => {
  const base = idem.fingerprintOf(PAYLOAD)
  assert.equal(idem.fingerprintOf({ ...PAYLOAD, files: [{ fileId: 'f1', pageRange: '' }, { fileId: 'f2' }] }), base)
  assert.equal(idem.fingerprintOf({ ...PAYLOAD, files: [{ fileId: 'f1', pageRange: null }, { fileId: 'f2' }] }), base)
})

test('指纹：改了 pageRange 就是另一单（计费页数变了，同键会被服务端 409）', () => {
  const base = idem.fingerprintOf(PAYLOAD)
  const ranged = idem.fingerprintOf({ ...PAYLOAD, files: [{ fileId: 'f1', pageRange: '1' }, { fileId: 'f2' }] })
  const otherRange = idem.fingerprintOf({ ...PAYLOAD, files: [{ fileId: 'f1', pageRange: '1-2' }, { fileId: 'f2' }] })
  assert.notEqual(ranged, base)
  assert.notEqual(ranged, otherRange)
})

test('指纹：文件顺序、terminalId、copies 变了都是另一单；文件名 / 金额 / quoteId 一概不看', () => {
  const base = idem.fingerprintOf(PAYLOAD)
  assert.notEqual(idem.fingerprintOf({ ...PAYLOAD, files: [{ fileId: 'f2' }, { fileId: 'f1' }] }), base)
  assert.notEqual(idem.fingerprintOf({ ...PAYLOAD, terminalId: 't-2' }), base)
  assert.notEqual(idem.fingerprintOf({ ...PAYLOAD, params: { ...PAYLOAD.params, copies: 2 } }), base)
  // 服务端一个都不 hash：本地多看一项 = "响应丢了再点一次"变回两张订单。
  const noisy = {
    ...PAYLOAD,
    quoteId: 'q-1',
    amountCents: 999,
    files: [{ fileId: 'f1', filename: '简历.pdf' }, { fileId: 'f2', filename: '证书.pdf' }],
  }
  assert.equal(idem.fingerprintOf(noisy), base)
})

// ══════════════════════════════════════════════════════════════════════
// B. 键的铸造与落盘：只用 wx.getRandomValues、有界超时、写完读回核对
// ══════════════════════════════════════════════════════════════════════

test('铸键只走 wx.getRandomValues，形状合服务端正则，且先落住再返回', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const fp = idem.fingerprintOf(PAYLOAD)
  const record = await idem.ensureKey('u:A', fp)
  assert.equal(wx.calls.random, 1)
  assert.match(record.key, idem.KEY_RE)
  const rows = wx.storage.get(STORE_KEY)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].key, record.key)
  assert.equal(rows[0].orderId, '', '刚铸出来的键必须是"未落定"，它代表一次还没落定的提交')
  // 同账号同指纹再要一次：复用，**不再取随机数**。
  const again = await idem.ensureKey('u:A', fp)
  assert.equal(again.key, record.key)
  assert.equal(wx.calls.random, 1)
})

test('wx.getRandomValues 缺席 / 只回 complete / 一直不回调：一律 fail-closed，一个字节都不落盘', async (t) => {
  const missing = createWx(); ACTIVE_WX = missing
  delete missing.getRandomValues
  await assert.rejects(idem.ensureKey('u:A', 'fp-missing'))
  assert.equal(missing.storage.has(STORE_KEY), false)

  const completeOnly = createWx(); ACTIVE_WX = completeOnly
  completeOnly.control.randomMode = 'completeOnly'
  await assert.rejects(idem.ensureKey('u:A', 'fp-complete'))
  assert.equal(completeOnly.storage.has(STORE_KEY), false)

  // 两个回调一个都不来：必须有一道**有界**的超时，否则页面永远停在"创建订单中…"。
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const silent = createWx(); ACTIVE_WX = silent
  silent.control.randomMode = 'silent'
  const pending = idem.ensureKey('u:A', 'fp-silent')
  const seen = pending.then(() => 'resolved', () => 'rejected')
  t.mock.timers.tick(idem.RANDOM_TIMEOUT_MS + 1)
  assert.equal(await seen, 'rejected')
  t.mock.timers.reset()
  assert.equal(silent.storage.has(STORE_KEY), false)
})

test('存储读失败 / 读出来不是数组 / 写了没写进去：三种都 fail-closed，且不抹掉盘上已有的键', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const fpA = idem.fingerprintOf(PAYLOAD)
  const kept = await idem.ensureKey('u:A', fpA)

  wx.control.readThrows = true
  await assert.rejects(idem.ensureKey('u:A', 'fp-other'), /读不到本机的下单记录/)
  assert.equal(idem.findRecord('u:A', fpA), null, '读不出来时只能回答"没有可复用的记录"')
  assert.equal(idem.clearRecord('u:A', fpA), false, '证不出它不在，就不能说清掉了')
  wx.control.readThrows = false
  assert.equal(wx.storage.get(STORE_KEY).length, 1, '读失败期间一个字节都不许写回去')
  assert.equal(idem.findRecord('u:A', fpA).key, kept.key)

  wx.control.corruptIdemTable = true
  await assert.rejects(idem.ensureKey('u:A', 'fp-other'), /读不到本机的下单记录/)
  assert.equal(idem.clearRecord('u:A', fpA), false)
  wx.control.corruptIdemTable = false
  assert.equal(wx.storage.get(STORE_KEY).length, 1)

  // 没抛异常、也没写进去：storage.set 返回 true，只有"读回来核对"才发现得了。
  wx.control.writeSilentlyDrops = true
  await assert.rejects(idem.ensureKey('u:A', 'fp-new'), /没能保存到本机/)
  assert.equal(idem.rememberOrderId('u:A', fpA, kept.key, 'ord-x'), null, 'orderId 没存住必须如实返回 null')
  assert.equal(idem.clearRecord('u:A', fpA), false)
  wx.control.writeSilentlyDrops = false
  assert.equal(idem.findRecord('u:A', fpA).orderId, '', '那次"没写进去"确实一个字节都没落')
})

test('账号隔离：B 读不到、复用不了、也清不掉 A 的记录', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const fp = idem.fingerprintOf(PAYLOAD)
  const a = await idem.ensureKey('u:A', fp)
  assert.equal(idem.findRecord('u:B', fp), null, 'B 看不到 A 的那一格')
  assert.equal(idem.clearRecord('u:B', fp), true, 'B 清自己那一格是成功的（它本来就不存在）')
  assert.equal(idem.findRecord('u:A', fp).key, a.key, '而 A 的那一格必须原封不动')
  const b = await idem.ensureKey('u:B', fp)
  assert.notEqual(b.key, a.key, '同一份参数、不同账号，必须是两个键')
  // 身份不可用（未登录 `''` / 登录但拿不到 id `'!'`）一律拒绝铸键。
  await assert.rejects(idem.ensureKey('', fp), /没有确定的会员身份/)
  await assert.rejects(idem.ensureKey('!', fp), /没有确定的会员身份/)
})

test('未落定的记录不被淘汰；名额用尽时拒绝铸新键，而不是挤掉一条在飞的', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const first = await idem.ensureKey('u:A', 'fp-0')
  for (let i = 1; i < idem.MAX_PENDING_RECORDS; i += 1) await idem.ensureKey('u:A', `fp-${i}`)
  assert.equal(wx.storage.get(STORE_KEY).length, idem.MAX_PENDING_RECORDS)
  await assert.rejects(idem.ensureKey('u:A', 'fp-overflow'), /太多没有落定/)
  assert.equal(idem.findRecord('u:A', 'fp-0').key, first.key, '最旧的那条未落定记录必须还在')
  assert.equal(wx.storage.get(STORE_KEY).length, idem.MAX_PENDING_RECORDS, '被拒绝时一条都不许删')
})

// ══════════════════════════════════════════════════════════════════════
// C. api 层：键只走 Header，缺 / 形状不对在本地就挡下来
// ══════════════════════════════════════════════════════════════════════

test('createPackageOrder 把键放 Header、不放 body；200 / 201 都算成功', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const requests = []
  let status = 200
  wx.request = (opts) => { requests.push(opts); opts.success({ statusCode: status, data: { data: { orderId: 'ord-1' } } }) }
  const api = requireMiniapp('../utils/api.js')
  const key = '11111111-2222-4333-8444-555555555555'
  const ok = await api.createPackageOrder(PAYLOAD, { idempotencyKey: key })
  assert.equal(ok.orderId, 'ord-1')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].header['idempotency-key'], key)
  assert.ok(!JSON.stringify(requests[0].data).includes(key), '幂等键一个字节都不许进 body（白名单 DTO 会整单 400）')

  status = 201
  await api.createPackageOrder(PAYLOAD, { idempotencyKey: key })
  assert.equal(requests.length, 2, '201 同样要被当成成功，不能走失败分支')
})

test('缺键 / 形状不对：本地直接 reject，一个请求都不发', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const requests = []
  wx.request = (opts) => { requests.push(opts); opts.success({ statusCode: 200, data: { data: {} } }) }
  const api = requireMiniapp('../utils/api.js')
  for (const bad of [undefined, {}, { idempotencyKey: '' }, { idempotencyKey: 'not-a-uuid' }, { idempotencyKey: 42 }]) {
    await assert.rejects(api.createPackageOrder(PAYLOAD, bad), /必须携带幂等键/)
  }
  assert.equal(requests.length, 0)
})

/**
 * 这一条测的是 utils/request.js 的 401 静默补签重试，**不是页面**。
 *
 * 为什么它必须存在：建单这一发是 `needAuth: true`，而 enduser JWT 只签 30 分钟。
 * 「键落住了 → POST 出去 → 服务端说 401 → 补签成功 → 自动重试」是这条链上最常走的
 * 一次重试，而它整个发生在 request.js 内部，页面一无所知：页面拿到的只有最终那个
 * resolve。于是"重试时带的还是不是同一个幂等键"这件事，在页面层根本看不见 ——
 * 只有把替身下沉到 wx.request 才验得了。
 *
 * 带错了的代价是具体的：`Order` 的 `@@unique(endUserId, idempotencyKey)` 认的是键。
 * 重试若换一个新键，服务端不会回放原单 —— 它会**再建一张**，而第一发那个 401 完全
 * 可能只是补签之前的一次拒绝，那张单本来是能回放回来的。两张订单、两笔钱。
 *
 * 所以这里同时钉两件事：幂等键**逐字不变**，Authorization **必须换成补签后的新
 * token**。少了后一条，一个"401 之后原样重发一次、根本没补签"的实现也能让第一条绿。
 */
test('createPackageOrder：401 静默补签成功后自动重试 —— 换的是 Authorization，幂等键逐字不变', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  wx.login = (opts) => opts.success({ code: 'wx-code-1' })
  const auth = requireMiniapp('../utils/auth.js')
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  // exp 不同 → token 字符串不同，于是"重试带的是新 token 还是旧 token"分得开。
  const makeFakeJwt = (expSeconds) =>
    [b64url({ alg: 'none' }), b64url({ exp: Math.floor(Date.now() / 1000) + expSeconds }), 'sig'].join('.')
  const staleToken = makeFakeJwt(1800)
  const freshToken = makeFakeJwt(3600)
  assert.notEqual(staleToken, freshToken, '两个 token 必须真的不同，否则下面那条断言是恒真的')
  auth.saveSession({ token: staleToken, user: { id: 'A' } })

  const requests = []
  wx.request = (opts) => {
    requests.push(opts)
    if (opts.url.endsWith('/orders/package')) {
      const isRetry = requests.filter((r) => r.url.endsWith('/orders/package')).length > 1
      // 第一发 401：真机上这是"JWT 在用户填表那几分钟里到点了"，服务端拒绝一次。
      if (!isRetry) { opts.success({ statusCode: 401, data: {} }); return }
      opts.success({ statusCode: 200, data: { data: { orderId: 'ord-1' } } })
      return
    }
    if (opts.url.endsWith('/member/auth/wx-resignin')) {
      opts.success({ statusCode: 200, data: { data: { token: freshToken, user: { id: 'A' } } } })
      return
    }
    opts.fail && opts.fail({ errMsg: `unexpected request ${opts.url}` })
  }

  const api = requireMiniapp('../utils/api.js')
  const key = '11111111-2222-4333-8444-555555555555'
  const result = await api.createPackageOrder(PAYLOAD, { idempotencyKey: key })
  assert.equal(result.orderId, 'ord-1')

  const packageRequests = requests.filter((r) => r.url.endsWith('/orders/package'))
  assert.equal(packageRequests.length, 2, '第一次 401，静默补签成功后必须自动重试一次')
  assert.ok(requests.some((r) => r.url.endsWith('/member/auth/wx-resignin')), '中间确实补了一次签')
  assert.equal(packageRequests[0].header['idempotency-key'], key)
  assert.equal(packageRequests[1].header['idempotency-key'], key, '重试带的必须是同一个幂等键，不是重新铸一个')
  assert.equal(packageRequests[0].header.Authorization, `Bearer ${staleToken}`)
  assert.equal(packageRequests[1].header.Authorization, `Bearer ${freshToken}`,
    '重试必须带补签后的新 token —— 否则这只是一次原样重发，401 会原样再来一次')
  // Header 是每一发现造的对象，不是同一个引用被改了一个字段。
  assert.notEqual(packageRequests[0].header, packageRequests[1].header)
  // 键一个字节都不许进 body：白名单 DTO 见到多出来的字段会整单 400。
  for (const r of packageRequests) assert.ok(!JSON.stringify(r.data).includes(key))
})

// ══════════════════════════════════════════════════════════════════════
// D. 页面：真跑一次提交，看发了几个 POST、带的是不是同一个键
// ══════════════════════════════════════════════════════════════════════

test('页面：键在 POST 发出之前就已经落住，Header 带的就是盘上那一个', async () => {
  const wx = createWx(); seedDraft(wx)
  const { api, calls } = createApi(wx)
  const page = await openReadyPage(wx, api, createAuth('A'))
  page.submitOrder()
  await flush()

  assert.equal(calls.create.length, 1)
  const key = calls.create[0].opts.idempotencyKey
  assert.match(key, idem.KEY_RE)
  // **顺序**：调用发生的那一刻，盘上已经有这条记录了。
  assert.equal(calls.create[0].storageAtCall.length, 1)
  assert.equal(calls.create[0].storageAtCall[0].key, key)
  assert.equal(calls.create[0].storageAtCall[0].account, 'u:A')
  assert.ok(!JSON.stringify(calls.create[0].data).toLowerCase().includes('idempotenc'))
  assert.deepEqual(Object.keys(calls.create[0].data).sort(), ['files', 'params', 'terminalId'])
})

test('页面：响应丢了（网络失败）再点一次，带的是**同一个键**，记录一条都不清', async () => {
  const wx = createWx(); seedDraft(wx)
  const { api, calls } = createApi(wx)
  const page = await openReadyPage(wx, api, createAuth('A'))

  page.submitOrder()
  await flush()
  const firstKey = calls.create[0].opts.idempotencyKey
  calls.create[0].reject(httpError(-1, 'NETWORK_ERROR', '网络连接失败'))
  await flush()
  assert.equal(wx.storage.get(STORE_KEY).length, 1, '失败路径一律不清记录')

  page.submitOrder()
  await flush()
  assert.equal(calls.create.length, 2)
  assert.equal(calls.create[1].opts.idempotencyKey, firstKey, '重试必须复用同一个键，否则服务端会再建一张')

  // 这一次成功：orderId 必须在跳转**之前**落进记录。
  calls.create[1].resolve({ orderId: 'ord-1' })
  await flush()
  assert.equal(wx.calls.redirectTo.length, 1)
  assert.equal(wx.calls.redirectTo[0], '/pages/package-code/package-code?orderId=ord-1')
  assert.ok(!wx.calls.redirectTo[0].includes('pickupCode'), '到机码不经 URL 传递')
})

test('页面：重进（进程被杀过）且本机记着 orderId → 走 GET 核对，一个 POST 都不发', async () => {
  const wx = createWx(); seedDraft(wx); ACTIVE_WX = wx
  // 模拟"上一次 200 已经回来、orderId 已落盘，进程随后被杀"：草稿还在，记录也在。
  const fp = idem.fingerprintOf(PAYLOAD)
  const minted = await idem.ensureKey('u:A', fp)
  assert.ok(idem.rememberOrderId('u:A', fp, minted.key, 'ord-1'))

  const { api, calls } = createApi(wx)
  const page = makePage(wx, { api, auth: createAuth('A') })
  page.onLoad()
  await flush()

  assert.equal(calls.create.length, 0, '恢复路径一个 POST 都不许发')
  assert.equal(calls.get.length, 1)
  assert.equal(calls.get[0].orderId, 'ord-1')
  // 核对期间必须锁着：此刻还不知道那张订单是不是活的。
  assert.equal(page.data.quoteState, 'error')
  page.submitOrder()
  await flush()
  assert.equal(calls.create.length, 0, '核对期间用户再点，仍然不许 POST')

  calls.get[0].resolve({ orderId: 'ord-1', pickupStatus: 'pending' })
  await flush()
  assert.equal(wx.calls.redirectTo.length, 1)
  assert.equal(wx.calls.redirectTo[0], '/pages/package-code/package-code?orderId=ord-1')
  assert.equal(wx.storage.has('temp_package_data'), false, '草稿被这张订单消费掉，不能留给下一次再下一单')
})

test('页面：核对不上（网络 / 5xx）继续锁着；服务端明确 404 才解锁，并且仍用同一个键', async () => {
  const wx = createWx(); seedDraft(wx); ACTIVE_WX = wx
  const fp = idem.fingerprintOf(PAYLOAD)
  const minted = await idem.ensureKey('u:A', fp)
  idem.rememberOrderId('u:A', fp, minted.key, 'ord-gone')

  const { api, calls } = createApi(wx)
  const page = makePage(wx, { api, auth: createAuth('A') })
  page.onLoad(); await flush()
  page.toggleAgreement({ detail: { value: ['agreed'] } })

  calls.get[0].reject(httpError(500, 'INTERNAL_ERROR'))
  await flush()
  page.submitOrder(); await flush()
  assert.equal(calls.create.length, 0, '核不上就证明不了任何事，保持锁定')

  // 换一次：服务端明确说本人没有这张订单。
  const wx2 = createWx(); seedDraft(wx2); ACTIVE_WX = wx2
  const minted2 = await idem.ensureKey('u:A', fp)
  idem.rememberOrderId('u:A', fp, minted2.key, 'ord-gone')
  const second = createApi(wx2)
  const page2 = makePage(wx2, { api: second.api, auth: createAuth('A') })
  page2.onLoad(); await flush()
  second.calls.get[0].reject(httpError(404, 'PACKAGE_ORDER_NOT_FOUND'))
  await flush()
  page2.toggleAgreement({ detail: { value: ['agreed'] } })
  page2.submitOrder(); await flush()
  assert.equal(second.calls.create.length, 1)
  assert.equal(second.calls.create[0].opts.idempotencyKey, minted2.key,
    '那个键没有绑住任何订单，复用它服务端会正常建一张新单；换新键才会多出第二张')
})

test('页面：核对收到 401（补签失败已自动登出）——暴露去登录出口，订单锁与幂等键原样保留', async () => {
  const wx = createWx(); seedDraft(wx); ACTIVE_WX = wx
  const fp = idem.fingerprintOf(PAYLOAD)
  const minted = await idem.ensureKey('u:A', fp)
  idem.rememberOrderId('u:A', fp, minted.key, 'ord-x')

  const { api, calls } = createApi(wx)
  const auth = createAuth('A')
  const page = makePage(wx, { api, auth })
  page.onLoad(); await flush()
  assert.equal(page.data.quoteRecover, 'orders', '核对回来之前先是默认的"订单已创建"锁定文案')

  // 真实 request.js 在 needAuth:true 的请求上遇到 401 会先试静默补签，补签失败才把
  // 原始 401 抛回来 —— 而抛回来之前它已经调过 auth.logout()，身份从 'u:A' 掉成 ''。
  // 这里的 auth.setUser(null) 就是在模拟"回调这一刻，登出已经先一步发生了"。
  auth.setUser(null)
  calls.get[0].reject(httpError(401, ''))
  await flush()

  assert.equal(page.data.quoteRecover, 'login', '不能永远停在"订单已创建，请不要重复下单"')
  assert.equal(page.data.quoteState, 'error', '模板只在 error 分支渲染这段文案，不打成 error 就是一段看不见的话')
  assert.equal(idem.findRecord('u:A', fp).orderId, 'ord-x', '订单锁与幂等键不因 401 被清掉')
  assert.equal(calls.create.length, 0, '核不上的这一路，一个 POST 都不许发')

  // 「去登录」必须真的走得通：这条出口的价值全在它回来之后能重新核一次。
  // 真机路径是 navigateTo 登录页（本页 onHide）→ 登录成功 → 返回（onShow，身份从
  // '' 变回 'u:A'）→ 身份变化分支重新解析草稿 → _restoreCreatedOrder 重新锁 + 重核。
  page.onHide()
  page.onShow()                   // 仍未登录：这一跳只是把身份登记成 ''
  auth.setUser('A')               // 登录回来了
  page.onShow()
  await flush()
  assert.equal(calls.get.length, 2, '登录回来之后必须重新核对这张订单，而不是停在原地')
  assert.equal(calls.create.length, 0, '重新核对期间仍然一个 POST 都不发')
  calls.get[1].resolve({ orderId: 'ord-x', pickupStatus: 'pending' })
  await flush()
  assert.deepEqual(wx.calls.redirectTo, ['/pages/package-code/package-code?orderId=ord-x'],
    '核上了就把人送到到机码页 —— 这才是这条恢复动作真正的终点')
})

test('页面：核对遇到网络 / 5xx 会释放 _verifyingOrderId，后续显式重试可以再核一次；订单锁与键原样保留', async () => {
  const wx = createWx(); seedDraft(wx); ACTIVE_WX = wx
  const fp = idem.fingerprintOf(PAYLOAD)
  const minted = await idem.ensureKey('u:A', fp)
  idem.rememberOrderId('u:A', fp, minted.key, 'ord-x')

  const { api, calls } = createApi(wx)
  const page = makePage(wx, { api, auth: createAuth('A') })
  page.onLoad(); await flush()
  assert.equal(calls.get.length, 1)

  calls.get[0].reject(httpError(500, 'INTERNAL_ERROR'))
  await flush()
  assert.equal(page.data.quoteRecover, 'orders', '网络 / 5xx 不给登录出口，仍是默认锁定文案')
  assert.equal(idem.findRecord('u:A', fp).orderId, 'ord-x')

  // 「重新下单」在这一态**必须按不动**：服务端根本没有证明这张订单走到头了。
  // 按得动的代价是换一个新键、再建一张 —— 而原来那张可能还好端端活着。
  assert.equal(page.data.canStartNewOrder, false)
  page.startNewOrder(); await flush()
  assert.equal(idem.findRecord('u:A', fp).key, minted.key, '没有终态证明就不许清掉那一格')
  assert.equal(idem.findRecord('u:A', fp).orderId, 'ord-x')
  assert.equal(page.data.quoteRecover, 'orders', '也不许解锁')

  // 显式重试同一个 orderId：如果 _verifyingOrderId 没被释放，这一发在入口就会被挡掉。
  page._verifyCreatedOrder('ord-x')
  await flush()
  assert.equal(calls.get.length, 2, '5xx 之后必须能再核一次，而不是被 _verifyingOrderId 卡死')
  calls.get[1].resolve({ orderId: 'ord-x', pickupStatus: 'pending' })
  await flush()
  assert.equal(wx.calls.redirectTo.length, 1)
})

/**
 * 提交在途时身份**静默**变了 —— 一个 onHide / onShow 都没有。
 *
 * 真机上这不是罕见路径，而是最常走的那一条：enduser JWT 只签 30 分钟，
 * `auth.getToken()` 到点时会先 `clearSession()` 再返回 null，于是 `_identityKey()`
 * 从 `'u:A'` 掉成 `''`，全程没有任何生命周期回调（`utils/request.js` 补签失败时调的
 * `auth.logout()` 同样没有）。页面还停在前台，而它发出去的那一发的回调正要回来。
 *
 * 此前这里是一个光秃秃的 `return`：订单在服务端建成了，页面却把 `submitting` 永久
 * 留成 true —— 屏幕停在「提交中…」，没有任何请求在跑，`submitOrder()` 第一行
 * `if (this.data.submitting) return` 吞掉之后每一次点击。用户唯一的出路是杀掉小程序。
 */
test('页面：提交在途时会话静默失效（无生命周期回调）——迟到的成功/失败都结清这一发，登录回来还能把那张订单救回来', async () => {
  const fp = idem.fingerprintOf(PAYLOAD)

  // ① 迟到的成功（200）：订单**已经建成**，而页面上的身份已经不是发起它的那一位。
  {
    const wx = createWx(); seedDraft(wx)
    const { api, calls } = createApi(wx)
    const auth = createAuth('A')
    const page = await openReadyPage(wx, api, auth)
    page.submitOrder(); await flush()
    assert.equal(page.data.submitting, true)

    auth.setUser(null)                                   // 会话到点：'u:A' → ''
    calls.create[0].resolve({ orderId: 'ord-A' })
    await flush()

    assert.equal(wx.calls.redirectTo.length, 0, '身份已经不是发起这一发的那位，不许跳转')
    assert.equal(page.data.quoteErrorTitle, '', '这条路径一个字节的订单状态都不写到屏幕上')
    assert.equal(page.data.submitting, false, '不结清就永远停在「提交中…」，而没有任何请求在跑')
    assert.equal(page._submitAttempt, null, '尝试锁也要松开，否则第二道闸会继续吞掉点击')
    assert.equal(idem.findRecord('u:A', fp).orderId, 'ord-A',
      '订单线索必须留在发起者名下 —— 它是这张已建成的订单唯一还能被找回来的东西')

    // 登录回来。页面自己不会察觉这一跳 —— 守卫的身份快照从没见过中间那个 ''
    //（'u:A' → '' → 'u:A' 全程没有 onShow，回到前台时它和快照逐字相同），
    // 所以按钮照旧是亮的。**这不要紧，因为再点一次也建不出第二张订单**：
    // submitOrder 第一道同步闸读的就是本机那条记录，它带着 orderId，于是一个 POST
    // 都不发，改去核对那一张。这正是那条记录存在的全部理由。
    page.onHide(); auth.setUser('A'); page.onShow(); await flush()
    page.submitOrder(); await flush()
    assert.equal(calls.create.length, 1, '已经建成的那张订单不许再 POST 一次')
    assert.equal(calls.get.length, 1, '改去核对那一张')
    calls.get[0].resolve({ orderId: 'ord-A', pickupStatus: 'pending' })
    await flush()
    assert.deepEqual(wx.calls.redirectTo, ['/pages/package-code/package-code?orderId=ord-A'])
  }

  // ② 迟到的失败（网络错误）：这一发**可能建成了也可能没有**，所以那条未落定的记录
  //    一个字节都不能动 —— 它是"再点一次仍然复用同一个键"的唯一依据。
  {
    const wx = createWx(); seedDraft(wx)
    const { api, calls } = createApi(wx)
    const auth = createAuth('A')
    const page = await openReadyPage(wx, api, auth)
    page.submitOrder(); await flush()
    const firstKey = calls.create[0].opts.idempotencyKey

    auth.setUser(null)
    calls.create[0].reject(httpError(-1, 'NETWORK_ERROR'))
    await flush()

    assert.equal(wx.calls.redirectTo.length, 0)
    assert.equal(page.data.submitting, false, '失败那一路同样不许把页面焊在「提交中…」上')
    assert.equal(page._submitAttempt, null)
    const kept = idem.findRecord('u:A', fp)
    assert.equal(kept.key, firstKey, '未落定的那条记录一个字节都不许动')
    assert.equal(kept.orderId, '', '它就是"提交出去了、但不知道建没建成"的那一种')

    // 登录回来再点一次：必须还是同一个键。换新键 = 上一发万一建成了就变成两张订单。
    page.onHide(); auth.setUser('A'); page.onShow(); await flush()
    page.toggleAgreement({ detail: { value: ['agreed'] } })
    page.submitOrder(); await flush()
    assert.equal(calls.create.length, 2)
    assert.equal(calls.create[1].opts.idempotencyKey, firstKey, '重试复用同一个键，服务端才会回放而不是再建一张')
  }

  // ③ 真的换了人（A → B，同样没有任何生命周期回调）：B 的屏幕上不许出现 A 的任何东西，
  //    A 的记录不许被动，而 B 自己的材料包必须能照常下单 —— 用 B 自己的键。
  {
    const wx = createWx(); seedDraft(wx)
    const { api, calls } = createApi(wx)
    const auth = createAuth('A')
    const page = await openReadyPage(wx, api, auth)
    page.submitOrder(); await flush()
    const aKey = calls.create[0].opts.idempotencyKey

    auth.setUser('B')
    calls.create[0].resolve({ orderId: 'ord-A' })
    await flush()

    assert.equal(wx.calls.redirectTo.length, 0, 'A 的订单不许把 B 带去别人的到机码页')
    assert.equal(page.data.quoteErrorTitle, '', 'A 的锁定文案不许写到 B 的屏幕上')
    assert.equal(page.data.submitting, false)
    assert.equal(page._submitAttempt, null)
    const aRow = idem.findRecord('u:A', fp)
    assert.equal(aRow.key, aKey)
    assert.equal(aRow.orderId, 'ord-A', 'A 的订单线索原样保留（A 重新登录回来还要找得回）')

    // B 换上自己的草稿，走真机上必然会走的那一跳（离页再回来 → onShow 重新核归属）。
    const bDraft = { ...DRAFT, ownerKey: 'u:B', draftId: 'd-b', files: [{ fileId: 'bf1', name: 'B的简历.pdf' }] }
    wx.storage.set('temp_package_data', JSON.parse(JSON.stringify(bDraft)))
    wx.storage.set('temp_selected_store', { id: 't-9', ownerKey: 'u:B', draftId: 'd-b', name: '九号服务点', address: '某路 9 号' })
    page.onHide(); page.onShow(); await flush()
    page.toggleAgreement({ detail: { value: ['agreed'] } })
    page.submitOrder(); await flush()

    assert.equal(calls.create.length, 2, 'B 的点击不能被上一位那次尝试的锁挡住')
    assert.equal(calls.create[1].data.terminalId, 't-9', 'B 发出去的是 B 自己那份材料包')
    // 逐字段比，不用 deepEqual：载荷是沙箱里造的对象，跨 realm 的 deepStrictEqual 恒不相等。
    assert.equal(calls.create[1].data.files.length, 1)
    assert.equal(calls.create[1].data.files[0].fileId, 'bf1')
    const bKey = calls.create[1].opts.idempotencyKey
    assert.notEqual(bKey, aKey, '同一台设备、不同账号，必须是两个键')
    assert.match(bKey, idem.KEY_RE)
    assert.equal(idem.findRecord('u:A', fp).key, aKey, '全程 A 的那一格一个字节都没被动过')
  }
})

// ══════════════════════════════════════════════════════════════════════
// D2. 恢复出来的那张订单：200 回来之后**看状态再决定去哪**
//
// 本机那条记录活 7 天，而服务端的幂等键是**永久**挂在那张 Order 行上的
// （`@@unique(endUserId, idempotencyKey)`，没有过期清理）。这 7 天里订单完全可能
// 已经打完 / 打印失败 / 被终止 / 被取消 / 到机码过期 —— 继续拿同一个键去 POST
// 只会一遍遍回放那张作废的订单。上一版无条件 redirectTo，还顺手删草稿、并在跳转
// 成功回调里清掉本机记录：用户落在一张打不出东西的到机码页上，材料包也没了。
// ══════════════════════════════════════════════════════════════════════

/** 本机记着一张已建成的订单 → 打开本页 → 那一发核对 GET 已经发出去了。 */
async function openRestoredPage(orderId) {
  const wx = createWx(); seedDraft(wx); ACTIVE_WX = wx
  const fp = idem.fingerprintOf(PAYLOAD)
  const minted = await idem.ensureKey('u:A', fp)
  assert.ok(idem.rememberOrderId('u:A', fp, minted.key, orderId))
  const { api, calls } = createApi(wx)
  const auth = createAuth('A')
  const page = makePage(wx, { api, auth })
  page.onLoad(); await flush()
  assert.equal(calls.create.length, 0, '恢复路径一个 POST 都不发')
  assert.equal(calls.get.length, 1, '恢复路径先向服务端核一次')
  assert.equal(calls.get[0].orderId, orderId)
  return { wx, api, calls, auth, page, fp, key: minted.key }
}

const LIVE_ORDER = { pickupStatus: 'pending', taskStatus: 'pending_release', payStatus: 'unpaid' }

/**
 * 服务端真实会写出来的每一种**终态**（判据见 utils/package-order.js 的
 * terminalPackageReason）。恢复路径（D2：GET 核对）与建单回放路径（D3：POST 同键回放）
 * 共用这一张表 —— 两处各写一份，改的人只会改一边，于是"核对时认得出、回放时认不出"
 * 就成了一个只在其中一条路径上复现的缺陷，而那正是这两节要防的同一件事。
 */
const TERMINAL_STATUSES = [
  { taskStatus: 'completed', pickupStatus: 'used' },        // 纸已经出完
  { taskStatus: 'failed', pickupStatus: 'used' },           // 出纸失败
  { taskStatus: 'abandoned', pickupStatus: 'used' },        // 管理端终止
  { taskStatus: 'cancelled', pickupStatus: 'cancelled' },   // 已取消
  { taskStatus: 'expired', pickupStatus: 'expired' },       // 到机码过期
  { taskStatus: 'pending_release', pickupStatus: 'expired' }, // 只有取件侧到期
]

/** 还活着 / 正在履约 / 将来才会有的状态。这几档每一档放开重新下单，都是同一份材料包打两遍、收两次钱。 */
const ALIVE_STATUSES = [
  { pickupStatus: 'pending', taskStatus: 'pending_release', payStatus: 'unpaid' },      // 待到机
  { pickupStatus: 'claimed', taskStatus: 'awaiting_payment', payStatus: 'unpaid' },     // 一体机领走了，正在付款
  { pickupStatus: 'claimed', taskStatus: 'awaiting_payment', payStatus: 'closed' },     // 付款关了，码会被退回 pending
  { pickupStatus: 'used', taskStatus: 'pending', payStatus: 'paid' },                   // 已付款，任务刚进队列
  { pickupStatus: 'used', taskStatus: 'printing', payStatus: 'paid' },                  // 正在出纸
  { pickupStatus: 'quantum', taskStatus: 'schrodinger', payStatus: 'maybe' },           // 将来新增的状态：fail-closed
]

test('页面：核对的 200 回来时会话已经静默失效 —— 不跳转、不泄露订单数据、释放核对守卫，登录回来自动重核', async () => {
  const { wx, calls, auth, page, fp, key } = await openRestoredPage('ord-live')

  // 真机上这一跳没有任何生命周期回调：enduser JWT 只签 30 分钟，auth.getToken() 到点时
  // 先 clearSession() 再返回 null，_identityKey() 于是从 'u:A' 静默掉成 ''。
  // 服务端那一发**成功了**（它的 token 还在窗口内 / 本地判过期有 5 秒安全余量）。
  auth.setUser(null)
  calls.get[0].resolve({
    orderId: 'ord-live', orderNo: 'ORD-20260917-AAAA', pickupCode: '135790',
    expiresAt: '2026-09-24T12:00:00.000Z', ...LIVE_ORDER,
  })
  await flush()

  assert.equal(wx.calls.redirectTo.length, 0, '到机码页同样要登录，跳过去只会得到一页 401')
  assert.equal(page.data.quoteState, 'error')
  assert.equal(page.data.quoteRecover, 'login', '给一条走得通的出口，而不是停在「去我的打印订单」')
  assert.equal(page.data.canStartNewOrder, false, '核不上的时候不许把「重新下单」点亮')
  // **一个字节的订单数据都不许落到屏幕上**：这一刻页面上的身份已经不是本人了。
  const painted = JSON.stringify(page.data)
  assert.ok(!painted.includes('135790'), '到机码不许写进 data')
  assert.ok(!painted.includes('ORD-20260917-AAAA'), '订单号不许写进 data')
  // 草稿与幂等记录原样保留。
  assert.equal(wx.storage.has('temp_package_data'), true, '草稿不许在这一支被消费掉')
  assert.equal(idem.findRecord('u:A', fp).orderId, 'ord-live')
  assert.equal(idem.findRecord('u:A', fp).key, key)

  // 「去登录」必须真的走得通。真机顺序：navigateTo 登录页（onHide）→ 登录成功 →
  // 返回（onShow）。注意这一跳**不算身份变化** —— 守卫的快照始终是 'u:A'，它从没
  // 见过中间那个 ''，所以 setIdentity 返回 false。页面必须自己认出"我还锁着一张单"。
  page.onHide(); auth.setUser('A'); page.onShow(); await flush()
  assert.equal(calls.get.length, 2, '登录回来必须重新核对，而不是让那句「登录已失效」原地不动')
  assert.equal(calls.create.length, 0, '重新核对期间仍然一个 POST 都不发')
  calls.get[1].resolve({ orderId: 'ord-live', ...LIVE_ORDER })
  await flush()
  assert.deepEqual(wx.calls.redirectTo, ['/pages/package-code/package-code?orderId=ord-live'])
})

test('页面：核对的 200 回来时已经换成了 B —— B 的屏幕上不出现 A 的订单，核对守卫照样释放，A 的记录不动', async () => {
  const { wx, calls, auth, page, fp, key } = await openRestoredPage('ord-A')

  auth.setUser('B')
  calls.get[0].resolve({
    orderId: 'ord-A', orderNo: 'ORD-20260917-BBBB', pickupCode: '246802', ...LIVE_ORDER,
  })
  await flush()

  assert.equal(wx.calls.redirectTo.length, 0, 'A 的订单不许把 B 带去别人的到机码页')
  const painted = JSON.stringify(page.data)
  assert.ok(!painted.includes('246802') && !painted.includes('ORD-20260917-BBBB'),
    'A 的到机码 / 订单号一个字节都不许画到 B 的屏幕上')
  assert.equal(page.data.canStartNewOrder, false)
  assert.equal(page.data.quoteRecover, 'orders', '仍是进页面时那条默认锁定文案，这一支什么都不写')
  assert.equal(idem.findRecord('u:A', fp).key, key, 'A 的那一格一个字节都不许动')
  assert.equal(idem.findRecord('u:A', fp).orderId, 'ord-A')
  assert.equal(wx.storage.has('temp_package_data'), true, 'A 的草稿也不在这条路上被删')

  // **在途标记必须已经释放**，而这件事只有拿**同一张订单**再核一次才看得见：
  // 换一张订单去核根本不会碰到 `_verifyingOrderId === orderId` 那道闸。
  // 场景是 A 把手机拿回去、重新登录：身份回到 'u:A'（守卫快照始终是 'u:A'，这一跳
  // 不算身份变化），页面还锁着 ord-A —— 它必须能重新核一次，而不是被上一发的
  // 标记永久钉死在「订单已创建」上。
  auth.setUser('A')
  page.onHide(); page.onShow(); await flush()
  assert.equal(calls.get.length, 2, '同一张订单必须能重新核对（在途标记没释放的话这一发会被入口吞掉）')
  assert.equal(calls.get[1].orderId, 'ord-A')
  calls.get[1].resolve({ orderId: 'ord-A', ...LIVE_ORDER })
  await flush()
  assert.deepEqual(wx.calls.redirectTo, ['/pages/package-code/package-code?orderId=ord-A'])
})

test('页面：核对的失败回来时已经换成了 B —— 同样什么都不写，在途标记同样释放', async () => {
  const { wx, calls, auth, page, fp, key } = await openRestoredPage('ord-A')

  auth.setUser('B')
  calls.get[0].reject(httpError(500, 'INTERNAL_ERROR'))
  await flush()
  assert.equal(page.data.quoteRecover, 'orders', '这一支什么都不写，仍是进页面时那条默认锁定文案')
  assert.equal(page.data.canStartNewOrder, false)
  assert.equal(idem.findRecord('u:A', fp).key, key, 'A 的那一格一个字节都不许动')

  // 与成功那一路同一条判据：拿同一张订单再核一次，才验得到标记确实释放了。
  auth.setUser('A')
  page.onHide(); page.onShow(); await flush()
  assert.equal(calls.get.length, 2, '失败那一路同样不许把在途标记永久钉在这个 orderId 上')
  assert.equal(calls.get[1].orderId, 'ord-A')
  assert.equal(wx.calls.redirectTo.length, 0, '还没核出结果之前不跳转')
})

test('页面：服务端说这张订单已经走到终态 —— 不跳转、不删草稿、不动记录，只点亮一个由用户自己按的「重新下单」', async () => {
  // 服务端真实会写出来的每一种终态，逐一走一遍整页（表见 TERMINAL_STATUSES）。
  for (const status of TERMINAL_STATUSES) {
    const label = `${status.pickupStatus}/${status.taskStatus}`
    const { wx, calls, page, fp, key } = await openRestoredPage('ord-dead')
    calls.get[0].resolve({ orderId: 'ord-dead', payStatus: 'closed', ...status })
    await flush()

    assert.equal(wx.calls.redirectTo.length, 0, `${label}: 不许把人送去一张打不出东西的到机码页`)
    assert.equal(page.data.quoteState, 'error', label)
    assert.equal(page.data.quoteRecover, 'reorder', label)
    assert.equal(page.data.canStartNewOrder, true, `${label}: 服务端已经证明它走到头了`)
    assert.ok(page.data.quoteErrorTitle, `${label}: 要把"为什么"写在屏幕上`)
    // 草稿是他重新下单要用的东西；记录里那个 orderId 是他回订单列表核对旧单的线索。
    assert.equal(wx.storage.has('temp_package_data'), true, `${label}: 草稿不许删`)
    assert.equal(wx.storage.has('temp_selected_store'), true, `${label}: 服务点也不许删`)
    assert.equal(idem.findRecord('u:A', fp).key, key, `${label}: 页面自己绝不换键`)
    assert.equal(idem.findRecord('u:A', fp).orderId, 'ord-dead', label)
    // 点亮按钮 ≠ 已经重新下单：一个 POST 都还没发。
    assert.equal(calls.create.length, 0, `${label}: 换键必须由用户自己按下去`)
  }
})

test('页面：还活着 / 正在履约 / 看不懂的状态 —— 一律送到机码页，绝不点亮「重新下单」', async () => {
  // 这几档每一档放开重新下单，都是同一份材料包打两遍、收两次钱（表见 ALIVE_STATUSES）。
  for (const status of ALIVE_STATUSES) {
    const label = `${status.pickupStatus}/${status.taskStatus}`
    const { wx, calls, page, fp } = await openRestoredPage('ord-live')
    calls.get[0].resolve({ orderId: 'ord-live', ...status })
    await flush()
    assert.deepEqual(wx.calls.redirectTo, ['/pages/package-code/package-code?orderId=ord-live'],
      `${label}: 送到机码页，那里会忠实显示服务端给的状态`)
    assert.equal(page.data.canStartNewOrder, false, `${label}: 绝不放开第二张订单`)
    assert.equal(calls.create.length, 0, label)
    // 确实跳走了，草稿与记录才随之清掉（既有口径，不在本轮改）。
    assert.equal(wx.storage.has('temp_package_data'), false, label)
    assert.equal(idem.findRecord('u:A', fp), null, label)
  }
})

test('页面：「重新下单」清不掉本机那格就保持锁定 —— 一个 POST 都不发，旧键原样留着', async () => {
  const { wx, calls, page, fp, key } = await openRestoredPage('ord-dead')
  calls.get[0].resolve({ orderId: 'ord-dead', pickupStatus: 'expired', taskStatus: 'expired' })
  await flush()
  assert.equal(page.data.canStartNewOrder, true)

  // 存储写不进去（存满 / 被系统回收 / 被隐私策略拦截）：storage.set 照样返回 true，
  // 只有 clearRecord 的读回核对发现得了。
  wx.control.writeSilentlyDrops = true
  page.recover({ currentTarget: { dataset: { recover: 'reorder' } } })
  await flush()
  wx.control.writeSilentlyDrops = false

  assert.equal(idem.findRecord('u:A', fp).key, key, '没清掉就是没清掉，旧键原样还在')
  assert.equal(idem.findRecord('u:A', fp).orderId, 'ord-dead')
  assert.equal(page.data.quoteState, 'error', '保持锁定')
  assert.equal(page.data.canStartNewOrder, true, '按钮留着：存储压力常是一过性的，「再点一次」正是下一步')
  assert.match(page.data.quoteErrorText, /没能清掉/, '把"为什么"和"能做什么"一起写在屏幕上')
  assert.equal(calls.create.length, 0, '清不掉就复用旧键 = 服务端回放那张作废的订单，所以一个 POST 都不许发')

  // 清得掉的那一次：解锁并重新报价，但**仍然不发 POST**。
  page.recover({ currentTarget: { dataset: { recover: 'reorder' } } })
  await flush()
  assert.equal(idem.findRecord('u:A', fp), null, '这一次那一格真的没了')
  assert.equal(page.data.canStartNewOrder, false)
  assert.equal(page.data.quoteState, 'ready', '解锁后重新向服务端要一次报价，不沿用旧订单的金额')
  assert.equal(calls.create.length, 0, '换键之后仍要用户自己按「确认下单」')
})

test('页面：「重新下单」之后用户自己再按一次 —— 铸的是新键，只发一个 POST，别人那几格不动', async () => {
  const { wx, calls, page, fp, key } = await openRestoredPage('ord-dead')
  // 另一格（同账号另一份材料包）的在途记录：全程必须原封不动。
  const otherKey = await idem.ensureKey('u:A', 'fp-other-package')

  calls.get[0].resolve({ orderId: 'ord-dead', pickupStatus: 'used', taskStatus: 'completed', payStatus: 'paid' })
  await flush()
  assert.equal(page.data.canStartNewOrder, true)

  page.startNewOrder(); await flush()
  assert.equal(idem.findRecord('u:A', fp), null)
  assert.equal(idem.findRecord('u:A', 'fp-other-package').key, otherKey.key,
    '只清 (当前账号, 当前指纹) 那一格：别的那几格都可能正绑着一次在途提交')

  page.toggleAgreement({ detail: { value: ['agreed'] } })
  page.submitOrder(); await flush()
  assert.equal(calls.create.length, 1, '只发一个 POST')
  const fresh = calls.create[0].opts.idempotencyKey
  assert.notEqual(fresh, key, '必须是新键 —— 复用旧键只会让服务端回放那张已经打完的订单')
  assert.match(fresh, idem.KEY_RE)
  assert.equal(idem.findRecord('u:A', fp).key, fresh, '新键在 POST 发出之前就已经落住')
  assert.equal(idem.findRecord('u:A', 'fp-other-package').key, otherKey.key)

  calls.create[0].resolve({ orderId: 'ord-new' })
  await flush()
  assert.deepEqual(wx.calls.redirectTo, ['/pages/package-code/package-code?orderId=ord-new'])
})

test('页面：409 IDEMPOTENCY_KEY_REUSED 不重试旧键；换新键必须由用户再按一次，且先清掉旧记录', async () => {
  const wx = createWx(); seedDraft(wx)
  const { api, calls } = createApi(wx)
  const page = await openReadyPage(wx, api, createAuth('A'))

  page.submitOrder(); await flush()
  const oldKey = calls.create[0].opts.idempotencyKey
  calls.create[0].reject(httpError(409, 'IDEMPOTENCY_KEY_REUSED'))
  await flush()
  assert.equal(calls.create.length, 1, '409 之后不许自动重试（重试一万次都是同一个 409）')
  assert.ok(page.data.submitErrorTitle, '要把发生了什么写在屏幕上')

  // 清不掉旧记录时：一个 POST 都不发。
  wx.control.writeSilentlyDrops = true
  page.submitOrder(); await flush()
  assert.equal(calls.create.length, 1, '旧记录没清掉就换新键 = 旧键那张单还在、新键又建一张')
  wx.control.writeSilentlyDrops = false

  // 清得掉：这一次才铸新键，而且只发一个 POST。
  page.submitOrder(); await flush()
  assert.equal(calls.create.length, 2)
  assert.notEqual(calls.create[1].opts.idempotencyKey, oldKey)
  assert.match(calls.create[1].opts.idempotencyKey, idem.KEY_RE)
  assert.equal(wx.storage.get(STORE_KEY).length, 1, '换新键之后本机只剩这一条')
})

test('页面：成功之后跳转失败 / orderId 没落住，都不许再 POST 第二次', async () => {
  const navFailWx = createWx(); seedDraft(navFailWx); navFailWx.control.navFail = true
  const first = createApi(navFailWx)
  const page = await openReadyPage(navFailWx, first.api, createAuth('A'))
  page.submitOrder(); await flush()
  first.calls.create[0].resolve({ orderId: 'ord-1' })
  await flush()
  assert.equal(navFailWx.calls.redirectTo.length, 1)
  page.submitOrder(); page.submitOrder(); await flush()
  assert.equal(first.calls.create.length, 1, '跳转失败不是"没下成"，再点一次不许变成第二张订单')
  assert.equal(navFailWx.storage.get(STORE_KEY)[0].orderId, 'ord-1', '跳转没成功就不清记录')

  // orderId 落不进本机：订单是真的，页面必须锁住并指路，而不是解锁重试。
  const dropWx = createWx(); seedDraft(dropWx)
  const second = createApi(dropWx)
  const page2 = await openReadyPage(dropWx, second.api, createAuth('A'))
  page2.submitOrder(); await flush()
  dropWx.control.writeSilentlyDrops = true
  second.calls.create[0].resolve({ orderId: 'ord-2' })
  await flush()
  assert.equal(dropWx.calls.redirectTo.length, 0, '没落住就不跳转：跳转成功的回调会把唯一还有用的那个键清掉')
  assert.match(page2.data.quoteErrorText, /没能把它记下来/)
  dropWx.control.writeSilentlyDrops = false
  page2.submitOrder(); await flush()
  assert.equal(second.calls.create.length, 1, '已经建成的订单不许再 POST 一次')
})

test('页面：提交在途时换了人，B 不继承 A 的锁，也不复用 A 的键', async () => {
  const wx = createWx(); seedDraft(wx)
  const { api, calls } = createApi(wx)
  const auth = createAuth('A')
  const page = await openReadyPage(wx, api, auth)
  page.submitOrder(); await flush()
  const aKey = calls.create[0].opts.idempotencyKey

  // A 的响应还在路上时换成 B（真机上是「去登录页 → 换个账号 → 回到本页」）。
  auth.setUser('B')
  page.onShow()
  calls.create[0].resolve({ orderId: 'ord-A' })
  await flush()
  assert.equal(wx.calls.redirectTo.length, 0, 'A 的订单不许把 B 带去别人的到机码页')
  // A 的线索必须留下来：记录属于发起提交的那一位，A 重新登录回来还要找得回。
  const rows = wx.storage.get(STORE_KEY)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].account, 'u:A')
  assert.equal(rows[0].key, aKey)
  assert.equal(rows[0].orderId, 'ord-A')
  // B 的草稿归属对不上，页面进入 missing；就算它在，B 也只会铸自己的键（见账号隔离那条）。
  assert.equal(page.data.draftState, 'missing')
})

// ══════════════════════════════════════════════════════════════════════
// D3. 建单那一发 200 回来的**不一定是刚建成的订单**
//
// 服务端那个键是**永久**挂在 Order 行上的，而本机这一格只要还没落定 orderId
// （上一次响应丢在路上、进程被杀在 POST 与响应之间、rememberOrderId 写失败过一次），
// 下一次提交就带着**同一个键**过去，服务端按同键回放原单。到机码窗口取
// `min(now + 7 天, 文件有效期)`，比本机记录的 7 天 TTL 更窄 —— 于是"本机的键还在、
// 服务端那张订单已经作废"这一格是真的走得到的。
//
// 不看状态就跳的代价：用户落在一张打不出东西的到机码页上，而跳转那一路顺手删了草稿、
// 跳转成功的回调又清掉了本机记录 —— 他既没有旧订单的线索，也没有那份材料包了。
// 判据必须与恢复路径（D2）共用同一个 pkg.terminalPackageReason。
// ══════════════════════════════════════════════════════════════════════

/** 走到「POST 已经发出去、响应还没回来」那一刻 —— 服务端要回放的正是这个键。 */
async function openSubmittedPage() {
  const wx = createWx(); seedDraft(wx)
  const { api, calls } = createApi(wx)
  const auth = createAuth('A')
  const page = await openReadyPage(wx, api, auth)
  page.submitOrder(); await flush()
  const fp = idem.fingerprintOf(PAYLOAD)
  assert.equal(calls.create.length, 1, '一次提交只发一个 POST')
  assert.equal(idem.findRecord('u:A', fp).orderId, '',
    '响应还没回来：这一格是"未落定"，下一次同参数提交复用的就是它 —— 回放由此发生')
  return { wx, api, calls, auth, page, fp, key: calls.create[0].opts.idempotencyKey }
}

test('页面：建单 200 回放的是一张已经走到终态的旧订单 —— 不跳转、不删草稿、不动记录，只点亮由用户自己按的「重新下单」', async () => {
  for (const status of TERMINAL_STATUSES) {
    const label = `${status.pickupStatus}/${status.taskStatus}`
    const { wx, calls, page, fp, key } = await openSubmittedPage()
    calls.create[0].resolve({ orderId: 'ord-replayed', payStatus: 'closed', ...status })
    await flush()

    assert.equal(wx.calls.redirectTo.length, 0, `${label}: 不许把人送去一张打不出东西的到机码页`)
    assert.equal(page.data.quoteState, 'error', label)
    assert.equal(page.data.quoteRecover, 'reorder', label)
    assert.equal(page.data.canStartNewOrder, true, `${label}: 服务端已经证明它走到头了`)
    assert.ok(page.data.quoteErrorTitle, `${label}: 要把"为什么"写在屏幕上`)
    assert.equal(page.data.submitting, false, `${label}: 解开按钮锁，页面不许停在「提交中…」`)
    // 草稿是他重新下单要用的东西（删了就只能回第一步重选文件）；记录里那个 orderId
    // 是他回「我的 · 打印订单」核对旧单的线索。两样都必须留着。
    assert.equal(wx.storage.has('temp_package_data'), true, `${label}: 草稿不许删`)
    assert.equal(wx.storage.has('temp_selected_store'), true, `${label}: 服务点也不许删`)
    assert.equal(idem.findRecord('u:A', fp).key, key, `${label}: 页面自己绝不换键`)
    assert.equal(idem.findRecord('u:A', fp).orderId, 'ord-replayed',
      `${label}: orderId 照常落住 —— 那是重进本页时认得出这张旧单的线索`)
    // 点亮按钮 ≠ 已经重新下单：一个 POST 都还没补发。
    assert.equal(calls.create.length, 1, `${label}: 换键必须由用户自己按下去`)
    // 锁上之后即使再调一次 submitOrder（模板里这一刻按钮是 disabled 的，这里走的是
    // 代码里那道守卫）：同键回放只会把同一张作废订单再取一遍，所以一个 POST 都不许发。
    page.submitOrder(); await flush()
    assert.equal(calls.create.length, 1, `${label}: 已经锁住的页面不许再 POST`)
    assert.equal(wx.calls.redirectTo.length, 0, label)
  }
})

test('页面：建单 200 回来的是还活着 / 正在履约 / 看不懂的状态 —— 照旧送到机码页，绝不点亮「重新下单」', async () => {
  for (const status of ALIVE_STATUSES) {
    const label = `${status.pickupStatus}/${status.taskStatus}`
    const { wx, calls, page, fp } = await openSubmittedPage()
    calls.create[0].resolve({ orderId: 'ord-live', ...status })
    await flush()
    assert.deepEqual(wx.calls.redirectTo, ['/pages/package-code/package-code?orderId=ord-live'],
      `${label}: 送到机码页，那里会忠实显示服务端给的状态`)
    assert.equal(page.data.canStartNewOrder, false, `${label}: 绝不放开第二张订单`)
    assert.equal(calls.create.length, 1, label)
    // 确实跳走了，草稿与记录才随之清掉（既有口径，本轮不改）。
    assert.equal(wx.storage.has('temp_package_data'), false, label)
    assert.equal(wx.storage.has('temp_selected_store'), false, label)
    assert.equal(idem.findRecord('u:A', fp), null, label)
  }
})

test('页面：回放到终态之后，换键只能由用户自己按 —— 一按就是新键、只补一个 POST，别人那几格不动', async () => {
  const { wx, calls, page, fp, key } = await openSubmittedPage()
  // 另一格（同账号另一份材料包）的在途记录：全程必须原封不动。
  const otherKey = await idem.ensureKey('u:A', 'fp-other-package')

  calls.create[0].resolve({ orderId: 'ord-replayed', pickupStatus: 'expired', taskStatus: 'expired', payStatus: 'closed' })
  await flush()
  assert.equal(page.data.canStartNewOrder, true)
  assert.equal(calls.create.length, 1, '页面自己不会补发第二个 POST')

  page.startNewOrder(); await flush()
  assert.equal(idem.findRecord('u:A', fp), null, '这一格清掉了，下一次提交才会铸新键')
  assert.equal(idem.findRecord('u:A', 'fp-other-package').key, otherKey.key,
    '只清 (当前账号, 当前指纹) 那一格：别的那几格都可能正绑着一次在途提交')
  assert.equal(page.data.quoteState, 'ready', '解锁后重新向服务端要一次报价，不沿用旧订单的金额')
  assert.equal(calls.create.length, 1, '解锁本身不下单')

  page.submitOrder(); await flush()
  assert.equal(calls.create.length, 2, '用户自己按下去才补这一个 POST')
  const fresh = calls.create[1].opts.idempotencyKey
  assert.notEqual(fresh, key, '必须是新键 —— 复用旧键只会让服务端再回放那张作废的订单')
  assert.match(fresh, idem.KEY_RE)
  assert.equal(idem.findRecord('u:A', fp).key, fresh, '新键在 POST 发出之前就已经落住')

  calls.create[1].resolve({ orderId: 'ord-new', ...LIVE_ORDER })
  await flush()
  assert.deepEqual(wx.calls.redirectTo, ['/pages/package-code/package-code?orderId=ord-new'])
})

test('页面：回放到终态、而 orderId 又没能落进本机 —— 走更保守的那一支，不点亮「重新下单」', async () => {
  const { wx, calls, page, fp, key } = await openSubmittedPage()
  // 存储这一刻写不进去（存满 / 被系统回收 / 被隐私策略拦截）：setStorageSync 不抛异常、
  // 也没写进去，只有 rememberOrderId 的读回核对发现得了。
  wx.control.writeSilentlyDrops = true
  calls.create[0].resolve({ orderId: 'ord-replayed', pickupStatus: 'expired', taskStatus: 'expired', payStatus: 'closed' })
  await flush()
  wx.control.writeSilentlyDrops = false

  // 这一支的前提是"本机连 orderId 都没存住"，而终态那一支要交付的恰恰是"草稿与记录都
  // 留着、由用户自己按重新下单"。前提对不上时只能走更保守的那一个：行为逐字保持原样。
  assert.equal(wx.calls.redirectTo.length, 0, '没落住就不跳转（跳转成功的回调会把仅剩的那个键也清掉）')
  assert.match(page.data.quoteErrorText, /没能把它记下来/, '说的是真正发生的那件事，不是「只是没能自动跳转」')
  assert.equal(page.data.canStartNewOrder, false, '存储正在失败的时候，不许点亮一个会铸新键的按钮')
  assert.equal(idem.findRecord('u:A', fp).key, key,
    '那个键必须原样留着：它是唯一还能让服务端回放同一张订单的东西')
  assert.equal(idem.findRecord('u:A', fp).orderId, '', '这一次确实一个字节都没写进去')
  page.submitOrder(); await flush()
  assert.equal(calls.create.length, 1, '已经建成的订单不许再 POST 一次')
})

// ══════════════════════════════════════════════════════════════════════
// E. 这条链上仍然没有任何在线支付
// ══════════════════════════════════════════════════════════════════════

test('材料包四页与两个 utils 都不调 wx.requestPayment（钱在一体机上现场付）', async () => {
  const wx = createWx(); seedDraft(wx)
  const { api, calls } = createApi(wx)
  const page = await openReadyPage(wx, api, createAuth('A'))
  page.submitOrder(); await flush()
  calls.create[0].resolve({ orderId: 'ord-1' })
  await flush()
  assert.equal(wx.calls.requestPayment, 0, '整条建单链真跑一遍，一次支付都没有发起')
  // 剥注释后再判「不得出现 X」：抓的是代码，不是解释为什么不许有它的那句话
  //（本页头部就写着「全链禁止 wx.requestPayment」）。
  const code = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n')
  for (const rel of [
    'pages/package-create/package-create.js', 'pages/store-select/store-select.js',
    'pages/package-confirm/package-confirm.js', 'pages/package-code/package-code.js',
    'utils/package-order.js', 'utils/package-order-idempotency.js',
  ]) {
    assert.ok(!code(rel).includes('wx.requestPayment'), `${rel} 不得出现 wx.requestPayment`)
  }
  // 键只能来自 wx.getRandomValues：Math.random 的碰撞面意味着两个人共用一个幂等键。
  assert.ok(!code('utils/package-order-idempotency.js').includes('Math.random'))
  assert.ok(!code('pages/package-confirm/package-confirm.js').includes('Math.random'))
})

// ══════════════════════════════════════════════════════════════════════
// F. 小写契约（2026-09-17 daa1f5484）
//
// 服务端去掉了 IDEMPOTENCY_KEY_RE 的 `/i`，因为**大小写不在唯一键里**：
// `Order @@unique(endUserId, idempotencyKey)` 是区分大小写的 TEXT，同一个 UUID 的
// 大写写法在服务端是**另一个键** —— 它不会回放原单，会再建一张、再收一次钱。
// 服务端选择 400 IDEMPOTENCY_KEY_INVALID 而不是 toLowerCase()，所以本地必须同样收紧：
// 大写键一旦走到 wx.request，用户看到的只是一句被翻译过的「请稍后重试」。
//
// 这一组同时覆盖单件链（print-order-idempotency + createCloudPrintOrder）——
// 两条链共用同一条服务端判据，只在一侧收紧等于留着另一半的洞。
// ══════════════════════════════════════════════════════════════════════

const printIdem = requireMiniapp('../utils/print-order-idempotency.js')
const UPPER_KEY = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'
const LOWER_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

test('两份 KEY_RE 都只认小写；宽判据（KEY_SHAPE_RE）仍认得出大写，两者不是同一把尺子', () => {
  for (const [name, mod] of [['package', idem], ['print', printIdem]]) {
    assert.ok(mod.KEY_RE.test(LOWER_KEY), `${name}: 小写 UUID 必须通过`)
    assert.ok(!mod.KEY_RE.test(UPPER_KEY), `${name}: 大写 UUID 必须被拒（服务端把它当另一个键）`)
    assert.ok(!mod.KEY_RE.test(LOWER_KEY.toUpperCase()), `${name}: 全大写同样被拒`)
    assert.ok(!mod.KEY_RE.test('aaaaaaaa-bbbb-4Ccc-8ddd-eeeeeeeeeeee'), `${name}: 混大小写同样被拒`)
    // 宽判据只决定"要不要留在盘上"，必须仍然认得出大写那一种，否则一条带 orderId 的
    // 旧记录会在下一次写回全量时被整条抹掉 —— 那是唯一还指得回那张真实订单的线索。
    assert.ok(mod.KEY_SHAPE_RE.test(UPPER_KEY), `${name}: 宽判据仍认得出大写`)
    assert.equal(mod.isReusableKey(UPPER_KEY), false)
    assert.equal(mod.isReusableKey(LOWER_KEY), true)
    // 正则不带 /g，不会有 lastIndex 粘连；连测两次必须同一个答案。
    assert.equal(mod.KEY_RE.test(LOWER_KEY), mod.KEY_RE.test(LOWER_KEY))
  }
})

test('两条链铸出来的键都是小写（toString(16) 的产物），且逐字通过各自的 KEY_RE', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const pkgKey = (await idem.ensureKey('u:A', 'fp-case')).key
  assert.equal(pkgKey, pkgKey.toLowerCase())
  assert.match(pkgKey, idem.KEY_RE)
  const printKey = (await printIdem.ensureKey('u:A', 'fp-case')).key
  assert.equal(printKey, printKey.toLowerCase())
  assert.match(printKey, printIdem.KEY_RE)
  // 两条链在本机各自一张表，互不相认。**服务端那一侧的键空间是共用的** —— 两条链都写
  // `Order.idempotencyKey`，共用同一个 `@@unique([endUserId, idempotencyKey])`；分表
  // 是本地的需要（指纹字段集不同，且未落定名额/恢复记录按表计，共用会互相挤掉）。
  assert.notEqual(idem.STORE_KEY, printIdem.STORE_KEY)
  assert.notEqual(pkgKey, printKey)
})

test('大写键到不了请求层：两个建单入口都在本地 reject，wx.request 一次都不发', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const requests = []
  wx.request = (opts) => { requests.push(opts); opts.success({ statusCode: 200, data: { data: { orderId: 'x' } } }) }
  const api = requireMiniapp('../utils/api.js')
  const bad = [UPPER_KEY, LOWER_KEY.toUpperCase(), 'aaaaaaaa-bbbb-4Ccc-8ddd-eeeeeeeeeeee']
  for (const key of bad) {
    await assert.rejects(api.createPackageOrder(PAYLOAD, { idempotencyKey: key }), /必须携带幂等键/)
    await assert.rejects(
      api.createCloudPrintOrder({ fileId: 'f1', terminalId: 't-1' }, { idempotencyKey: key }),
      /必须携带幂等键/)
  }
  assert.equal(requests.length, 0, '一个必然 400 的请求都不许发出去')
  // 对照：小写键必须照常发得出去 —— 收紧不能把活人一起挡掉。
  await api.createPackageOrder(PAYLOAD, { idempotencyKey: LOWER_KEY })
  await api.createCloudPrintOrder({ fileId: 'f1', terminalId: 't-1' }, { idempotencyKey: LOWER_KEY })
  assert.equal(requests.length, 2)
  assert.equal(requests[0].header['idempotency-key'], LOWER_KEY)
  assert.equal(requests[1].header['idempotency-key'], LOWER_KEY)
})

test('盘上留着的大写键：未落定的一条不被复用（就地铸一个新的小写键），别人的记录一条不动', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const fp = idem.fingerprintOf(PAYLOAD)
  // 别人的（另一个槽位、另一位账号）好记录：全程必须原封不动。
  const otherA = await idem.ensureKey('u:A', 'fp-other')
  const otherB = await idem.ensureKey('u:B', fp)
  // 手工摆一条旧版留下的大写未落定记录（本模块自己铸不出大写，只可能来自数据损坏
  // 或旧构建）。它既复用不了（服务端 400），也没有 orderId 可指。
  const rows = wx.storage.get(STORE_KEY)
  rows.push({ account: 'u:A', fingerprint: fp, key: UPPER_KEY, orderId: '', createdAt: Date.now() })
  wx.storage.set(STORE_KEY, rows)

  assert.equal(idem.findRecord('u:A', fp), null, '不可用又没落定的记录不许被当成"可复用的记录"交出去')
  const minted = await idem.ensureKey('u:A', fp)
  assert.notEqual(minted.key, UPPER_KEY)
  assert.match(minted.key, idem.KEY_RE)
  assert.equal(minted.key, minted.key.toLowerCase())

  const after = wx.storage.get(STORE_KEY)
  assert.equal(after.filter((r) => r.account === 'u:A' && r.fingerprint === fp).length, 1,
    '同一格只留一条：大写那条被换掉，不是再加一条（两条就是两个键、两张订单）')
  assert.equal(after.find((r) => r.key === UPPER_KEY), undefined)
  // 不相干的记录一条都不许动。
  assert.equal(after.find((r) => r.account === 'u:A' && r.fingerprint === 'fp-other').key, otherA.key)
  assert.equal(after.find((r) => r.account === 'u:B' && r.fingerprint === fp).key, otherB.key)
})

test('盘上留着的大写键：**已落定**的一条 fail-closed —— 不复用、不铸新键、也不抹掉它', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const fp = idem.fingerprintOf(PAYLOAD)
  const other = await idem.ensureKey('u:A', 'fp-other')
  const rows = wx.storage.get(STORE_KEY)
  rows.push({ account: 'u:A', fingerprint: fp, key: UPPER_KEY, orderId: 'ord-old', createdAt: Date.now() })
  wx.storage.set(STORE_KEY, rows)

  // 这一条还指得回一张真实存在的订单：recovery 必须还看得见它。
  const found = idem.findRecord('u:A', fp)
  assert.equal(found.orderId, 'ord-old')
  // 但那个键换不回原单（400），而铸一个新键就是第二张订单 —— 只能拒绝。
  await assert.rejects(idem.ensureKey('u:A', fp), /订单可能已经建好了/)
  assert.equal(wx.calls.random, 1, '拒绝的那一次不许去取随机数（取了就意味着准备铸新键）')

  const after = wx.storage.get(STORE_KEY)
  assert.ok(after.find((r) => r.key === UPPER_KEY), '带 orderId 的那条不许被抹掉（它是唯一还指得回那张订单的线索）')
  assert.equal(after.find((r) => r.fingerprint === 'fp-other').key, other.key)
  // 用户的显式出口仍然有效：清掉之后才可以铸新键。
  assert.equal(idem.clearRecord('u:A', fp), true)
  const fresh = await idem.ensureKey('u:A', fp)
  assert.match(fresh.key, idem.KEY_RE)
  assert.equal(wx.storage.get(STORE_KEY).find((r) => r.fingerprint === 'fp-other').key, other.key)
})

test('单件链同一套：大写未落定不复用、大写已落定 fail-closed，rememberOrderId 也不收大写键', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const KEY = printIdem.STORE_KEY
  const good = await printIdem.ensureKey('u:A', 'fp-keep')
  const rows = wx.storage.get(KEY)
  rows.push({ account: 'u:A', fingerprint: 'fp-upper', key: UPPER_KEY, orderId: '', createdAt: Date.now() })
  rows.push({ account: 'u:A', fingerprint: 'fp-upper-settled', key: UPPER_KEY, orderId: 'ord-old', createdAt: Date.now() })
  wx.storage.set(KEY, rows)

  const minted = await printIdem.ensureKey('u:A', 'fp-upper')
  assert.notEqual(minted.key, UPPER_KEY)
  assert.match(minted.key, printIdem.KEY_RE)
  await assert.rejects(printIdem.ensureKey('u:A', 'fp-upper-settled'), /订单可能已经建好了/)
  // 大写键永远不该被记成"我们发出去的那个键"。
  assert.equal(printIdem.rememberOrderId('u:A', 'fp-keep', UPPER_KEY, 'ord-1'), null)
  assert.ok(printIdem.rememberOrderId('u:A', 'fp-keep', good.key, 'ord-1'))
  const after = wx.storage.get(KEY)
  assert.equal(after.find((r) => r.fingerprint === 'fp-keep').orderId, 'ord-1')
  assert.ok(after.find((r) => r.fingerprint === 'fp-upper-settled'), '已落定的那条仍然留着')
})

// ══════════════════════════════════════════════════════════════════════
// G. 键的寿命：本机的 TTL 不得比服务端的键先失忆
//
// 服务端那一侧的 `(endUserId, idempotencyKey)` 是**永久**挂在 Order 行上的
// （`@@unique`，没有任何过期清理）。本机记录此前一律活 7 天，于是有一整档记录会在
// 服务端仍然认得那个键的时候被本机忘掉：`orderId` 还空着、而 POST 可能已经到过服务端
// 的那一格（响应丢在路上、进程被杀在 POST 与响应之间）。忘掉它之后，用户带同一份
// 材料包再提交铸的是**新键**，服务端按新键正常建**第二张**订单、再收一次钱。
// 而且不必真等满 7 天：设备时钟往前跳一下、或恰好卡在边界那一毫秒就到了。
//
// 现在的判据是 `wasSubmitted`（只看落盘字段，进程重启后照样成立）：
//   - 已落定 / 已被 markSubmitted 标过 / 旧版本没有这个标记的 → **永不因本机时间淘汰**；
//   - 只有"本版写下、且 markSubmitted 还没成功过"的那一格才按 TTL 过期 ——
//     它证明得了自己一个 POST 都没发过，留着只会白占未落定名额。
// ══════════════════════════════════════════════════════════════════════

const DAY = 24 * 60 * 60 * 1000
const KEY_A = '11111111-1111-4111-8111-111111111111'

/** 直接往盘上写一条记录（含做旧的时间戳）。默认是"已标记提交、尚未落定"那一格。 */
function seedRow(wx, patch) {
  const at = Date.now() - 30 * DAY
  const row = Object.assign(
    { account: 'u:A', fingerprint: 'fp-1', key: KEY_A, orderId: '', createdAt: at, submittedAt: at },
    patch || {},
  )
  wx.storage.set(STORE_KEY, [row])
  return row
}

test('寿命：本机时钟走过 7 天，已提交而未落定的那条记录必须还在，且复用的还是同一个键', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  seedRow(wx)
  assert.equal(idem.findRecord('u:A', 'fp-1').key, KEY_A, '30 天前那次"响应丢在路上"的提交不许被忘掉')
  const again = await idem.ensureKey('u:A', 'fp-1')
  assert.equal(again.key, KEY_A, '同参数再提交必须复用旧键（换新键 = 服务端再建一张订单）')
  assert.equal(wx.calls.random, 0, '一个新键都不许铸')
})

test('寿命：已落定的、以及旧版本没有 submittedAt 标记的，同样不因本机时间被淘汰', async () => {
  const settledWx = createWx(); ACTIVE_WX = settledWx
  seedRow(settledWx, { orderId: 'ord-9' })
  assert.equal(idem.findRecord('u:A', 'fp-1').orderId, 'ord-9',
    '服务端那张单还在（键永久），本机不许先忘掉指回它的唯一线索')

  // 旧版本写下的记录没有 submittedAt 这个字段。旧代码是"铸完立刻 POST"——
  // 证明不了它没发过，只能按发过处理（fail-closed）。
  const legacyWx = createWx(); ACTIVE_WX = legacyWx
  const at = Date.now() - 30 * DAY
  legacyWx.storage.set(STORE_KEY, [{ account: 'u:A', fingerprint: 'fp-1', key: KEY_A, orderId: '', createdAt: at }])
  assert.equal(idem.findRecord('u:A', 'fp-1').key, KEY_A, '没有标记 ≠ 证明了没发过')
  const again = await idem.ensureKey('u:A', 'fp-1')
  assert.equal(again.key, KEY_A)
  assert.equal(legacyWx.calls.random, 0)

  // 形状被改坏的标记（字符串 / NaN）同样落在"当作发过"这一档。
  const oddWx = createWx(); ACTIVE_WX = oddWx
  oddWx.storage.set(STORE_KEY, [{ account: 'u:A', fingerprint: 'fp-1', key: KEY_A, orderId: '', createdAt: at, submittedAt: 'x' }])
  assert.ok(idem.findRecord('u:A', 'fp-1'), '读不懂的标记不得被解释成"这个键没出过门"')
})

test('寿命：铸出来却一个 POST 都没发过的键，过了 TTL 才作废（否则名额被永久占住）', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  // 未到期：一样不许丢（它可能正要被这一次提交用上）。
  seedRow(wx, { createdAt: Date.now() - (idem.TTL_MS - 60 * 1000), submittedAt: 0 })
  assert.equal(idem.findRecord('u:A', 'fp-1').key, KEY_A, 'TTL 之内的未提交键仍然复用')

  // 到期：这一档**证明得了**自己没出过门（本版写下、markSubmitted 从没成功过），可以作废。
  seedRow(wx, { createdAt: Date.now() - (idem.TTL_MS + 60 * 1000), submittedAt: 0 })
  assert.equal(idem.findRecord('u:A', 'fp-1'), null)
  const fresh = await idem.ensureKey('u:A', 'fp-1')
  assert.notEqual(fresh.key, KEY_A, '从没发出去过的键过期之后铸新的（服务端那边根本没有这个键）')
  assert.match(fresh.key, idem.KEY_RE)
  assert.equal(fresh.submittedAt, 0, '新铸的键同样先标成"还没发过"')
})

test('markSubmitted：标住之后退出 TTL 淘汰；键对不上 / 这一格不在盘上 / 身份不可用一律 false', async () => {
  const wx = createWx(); ACTIVE_WX = wx
  const record = await idem.ensureKey('u:A', 'fp-1')
  assert.equal(wx.storage.get(STORE_KEY)[0].submittedAt, 0)

  assert.equal(idem.markSubmitted('u:A', 'fp-none', record.key), false, '这一格根本不在盘上：那个键没落住，不许出门')
  assert.equal(idem.markSubmitted('u:A', 'fp-1', KEY_A), false, '盘上是另一个键：要发出去的这个并没有落住')
  assert.equal(idem.markSubmitted('', 'fp-1', record.key), false)
  assert.equal(idem.markSubmitted('u:A', 'fp-1', 'not-a-uuid'), false)
  assert.equal(wx.storage.get(STORE_KEY)[0].submittedAt, 0, '以上每一条都不许顺手改盘上的东西')

  assert.equal(idem.markSubmitted('u:A', 'fp-1', record.key), true)
  assert.ok(wx.storage.get(STORE_KEY)[0].submittedAt > 0)

  // 已经标过的再标一次：直接 true，不写盘（所以存储此刻坏着也不影响）。
  wx.control.writeSilentlyDrops = true
  assert.equal(idem.markSubmitted('u:A', 'fp-1', record.key), true)
  wx.control.writeSilentlyDrops = false

  // 做旧 30 天：标住的那条不再因本机时间被淘汰。
  const rows = wx.storage.get(STORE_KEY)
  rows[0].createdAt = Date.now() - 30 * DAY
  wx.storage.set(STORE_KEY, rows)
  assert.equal(idem.findRecord('u:A', 'fp-1').key, record.key)
})

test('页面：标记落不住就一个 POST 都不发（订单没建成，键原样留着，也不显示成标住了）', async () => {
  const wx = createWx(); seedDraft(wx)
  const { api, calls } = createApi(wx)
  const page = await openReadyPage(wx, api, createAuth('A'))
  // 上一次在 markSubmitted 之前就失败了：盘上留着一条已落住、但还没标过的键。
  const record = await idem.ensureKey('u:A', idem.fingerprintOf(PAYLOAD))
  assert.equal(wx.storage.get(STORE_KEY)[0].submittedAt, 0)

  wx.control.writeSilentlyDrops = true   // 不抛异常、也没写进去（存储被系统回收 / 隐私策略）
  page.submitOrder(); await flush()
  assert.equal(calls.create.length, 0, '标不住 = 这个键出门之后本机会忘掉它 = 下一次是第二张订单')
  assert.equal(page.data.submitting, false, '停下来之后按钮必须放开，让用户能重试')
  assert.match(page.data.submitErrorText, /没能记下这次提交/)
  wx.control.writeSilentlyDrops = false
  const after = wx.storage.get(STORE_KEY)
  assert.equal(after.length, 1)
  assert.equal(after[0].key, record.key, '键原样留着：不清、不换')
  assert.equal(after[0].submittedAt, 0, '没标住就不许在盘上显示成标住了')

  // 存储恢复之后再点一次：这一回标得住，发的是**同一个键**。
  page.submitOrder(); await flush()
  assert.equal(calls.create.length, 1)
  assert.equal(calls.create[0].opts.idempotencyKey, record.key)
  assert.ok(wx.storage.get(STORE_KEY)[0].submittedAt > 0)
})

test('页面：响应丢在路上 + 进程被杀 + 过了 30 天再回来 —— 仍然是同一个键，服务端回放原单', async () => {
  const wx = createWx(); seedDraft(wx)
  const first = createApi(wx)
  const page = await openReadyPage(wx, first.api, createAuth('A'))
  page.submitOrder(); await flush()
  assert.equal(first.calls.create.length, 1)
  const sentKey = first.calls.create[0].opts.idempotencyKey
  assert.ok(first.calls.create[0].storageAtCall[0].submittedAt > 0,
    'POST 发出的那一刻，盘上这一格已经标成"这个键出门了"')
  // 这一发永远不回来（响应丢在路上），小程序随后被杀掉。

  // 30 天后重进（或设备时钟往前跳了 30 天）。本机记录里 orderId 还空着。
  const rows = wx.storage.get(STORE_KEY)
  rows[0].createdAt = Date.now() - 30 * DAY
  rows[0].submittedAt = Date.now() - 30 * DAY
  wx.storage.set(STORE_KEY, rows)

  const second = createApi(wx)
  const page2 = await openReadyPage(wx, second.api, createAuth('A'))
  assert.equal(second.calls.get.length, 0, 'orderId 还空着，没有订单可核对')
  page2.submitOrder(); await flush()
  assert.equal(second.calls.create.length, 1)
  assert.equal(second.calls.create[0].opts.idempotencyKey, sentKey,
    '带的必须还是那个键——换新键就是服务端第二张订单、第二笔钱')
  // 服务端按同键回放原单。
  second.calls.create[0].resolve({ orderId: 'ord-replay' })
  await flush()
  assert.deepEqual(wx.calls.redirectTo, ['/pages/package-code/package-code?orderId=ord-replay'])
})

test('页面：跳转失败先锁住、服务端 404 再解锁之后，那一次点击必须真的发出去（不被"上一发没落定"吞掉）', async () => {
  const wx = createWx(); seedDraft(wx); wx.control.navFail = true
  const { api, calls } = createApi(wx)
  const page = await openReadyPage(wx, api, createAuth('A'))
  page.submitOrder(); await flush()
  const key = calls.create[0].opts.idempotencyKey
  calls.create[0].resolve({ orderId: 'ord-1' }); await flush()
  assert.equal(wx.calls.redirectTo.length, 1)
  assert.equal(page.data.submitting, false, '跳转失败不许把"提交中…"永远留在屏幕上')

  // 用户回到第一步、重新选了**同一份**材料包再进来（草稿在上一次成功建单时已被消费掉，
  // 所以这一步必须真的重新有一份草稿）。指纹相同 → 本机那条记着 ord-1 的记录命中，
  // 页面先锁再核。服务端 requireOwned 明确说本人没有这张订单。
  seedDraft(wx)
  const page2 = await openReadyPage(wx, api, createAuth('A'))
  await flush()
  assert.equal(calls.get.length, 1)
  calls.get[0].reject(httpError(404, 'PACKAGE_ORDER_NOT_FOUND'))
  await flush(); await flush()
  assert.equal(page2.data.quoteState, 'ready', '404 之后重新核价，按钮回到可按')
  page2.submitOrder(); await flush()
  assert.equal(calls.create.length, 2, '解锁之后这一次点击必须真的发出去')
  assert.equal(calls.create[1].opts.idempotencyKey, key, '仍然是同一个键（404 不清键）')
})
