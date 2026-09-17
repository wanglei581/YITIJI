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
