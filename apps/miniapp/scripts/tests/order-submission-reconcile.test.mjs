/**
 * 「本机留下的下单标识，服务端那边落成了什么」——核对链的**真执行**测试（node:test）。
 *
 * 为什么必须真跑：这条链上每一个判断的反面都对应一次真实损失，而且方向相反 ——
 * 该清的不清，这台设备永久下不了单；不该清的清了，用户被收两次钱。正则能证明某段
 * 守卫写在那里，证明不了**一次核对到底清了哪几格、留了哪几格**。所以这里把
 * order-submission-reconcile 与两条链的真实 `submissionPort` 都真的执行一遍，
 * 存储用一个可以被单独打坏的 wx 替身（读抛 / 写抛 / 写了没写进去是三种不同故障）。
 *
 * 全文围绕同一条硬规则展开：
 *   **只有服务端的墓碑（resolve 的 `not_created`）才准清一条「已提交、未落定」的记录。**
 *   processing / 网络失败 / 401 / 形状不对 / 换人 —— 一条都不许清。
 *
 * 放在 scripts/tests/ 是刻意的（gates.mjs 把它排除在门禁脚本之外）。由
 * `verify:order-submission-reconcile` 拉起，串在 verify:static 里进 CI。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

// utils/storage.js 读的是**全局** wx。整份测试共用这一个出入口，每条用例换一个新的替身。
let ACTIVE_WX = null
Object.defineProperty(globalThis, 'wx', { get: () => ACTIVE_WX, configurable: true })

const engine = requireMiniapp('../utils/order-submission-reconcile.js')
const pkgIdem = requireMiniapp('../utils/package-order-idempotency.js')
const printIdem = requireMiniapp('../utils/print-order-idempotency.js')

const A = 'u:aaa'
const B = 'u:bbb'
/** 合法的小写 UUID v4（两条链的 KEY_RE 都只认这个形态）。 */
const key = (n) => `0000000${n}-1111-4222-8333-444444444444`

function createWx() {
  const storage = new Map()
  const control = { readThrows: false, writeThrows: false, writeSilentlyDrops: false }
  let seed = 0
  return {
    storage,
    control,
    // 铸键要真随机。给一个确定性的实现，免得测试依赖机器熵；形状仍按 16 字节走，
    // 版本位 / 变体位照旧由被测的 formatUuidV4 自己打。
    getRandomValues({ length, success }) {
      seed += 1
      const bytes = new Uint8Array(length || 16)
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (seed * 31 + i * 7) & 0xff
      success({ randomValues: bytes.buffer })
    },
    getStorageSync(k) {
      if (control.readThrows) throw new Error('getStorageSync failed')
      return storage.has(k) ? storage.get(k) : ''
    },
    setStorageSync(k, v) {
      if (control.writeThrows) throw new Error('setStorageSync failed')
      if (control.writeSilentlyDrops) return
      storage.set(k, JSON.parse(JSON.stringify(v)))
    },
    removeStorageSync(k) { storage.delete(k) },
  }
}

/**
 * 铺一张本机表。`submittedAt` 非 0 = 「已提交、未落定」，正是这条链要处理的那一档。
 * `createdAt` 取足够早，确保它早已越过任何在途保护期。
 */
function seed(storeKey, rows) {
  const wx = createWx()
  ACTIVE_WX = wx
  wx.storage.set(storeKey, rows.map((row) => ({
    account: row.account,
    fingerprint: row.fingerprint,
    key: row.key,
    orderId: row.orderId || '',
    createdAt: row.createdAt === undefined ? Date.now() - 60 * 60 * 1000 : row.createdAt,
    submittedAt: row.submittedAt === undefined ? Date.now() - 60 * 60 * 1000 : row.submittedAt,
  })))
  return wx
}

const read = (wx, storeKey) => wx.storage.get(storeKey) || []
const slot = (wx, storeKey, account, fingerprint) =>
  read(wx, storeKey).find((r) => r.account === account && r.fingerprint === fingerprint) || null

/** 每条用例一个独立命名空间，免得模块级的 running / lastRun 表互相干扰冷却与在途。 */
let ns = 0
function portFor(idem) {
  ns += 1
  const base = idem.submissionPort
  return Object.assign(Object.create(null), base, { namespace: `${base.namespace}#${ns}` })
}

const ok = (items) => () => Promise.resolve({ items })

// ══════════════════════════════════════════════════════════════════════
// A. 唯一允许清除的那一档
// ══════════════════════════════════════════════════════════════════════

test('not_created（服务端已立墓碑）是唯一会清掉记录的一档，而且只清那一格', async () => {
  const K = pkgIdem.STORE_KEY
  const wx = seed(K, [
    { account: A, fingerprint: 'f1', key: key(1) },
    { account: A, fingerprint: 'f2', key: key(2) },
  ])
  const res = await engine.reconcile(portFor(pkgIdem), A, ok([
    { key: key(1), outcome: 'not_created' },
  ]), { force: true })

  assert.equal(res.status, 'done')
  assert.equal(res.freed, 1, '墓碑那一格被清掉')
  assert.equal(slot(wx, K, A, 'f1'), null, 'f1 不在了')
  assert.ok(slot(wx, K, A, 'f2'), 'f2 原样留着（服务端根本没提它）')
  assert.equal(res.unknown, 1, '服务端没回的那个键算 unknown，不是"可以清"')
})

test('processing / 网络失败 / 401 / 形状不对：一条都不清', async () => {
  const K = pkgIdem.STORE_KEY
  const cases = [
    ['processing', ok([{ key: key(1), outcome: 'processing' }]), 'done'],
    ['网络失败', () => Promise.reject(Object.assign(new Error('net'), { statusCode: -1 })), 'failed'],
    ['401', () => Promise.reject(Object.assign(new Error('401'), { statusCode: 401 })), 'failed'],
    ['整体形状不对', () => Promise.resolve({ nope: true }), 'malformed'],
    ['items 不是数组', () => Promise.resolve({ items: 'x' }), 'malformed'],
    ['outcome 不在三档内', ok([{ key: key(1), outcome: 'deleted' }]), 'done'],
    ['created 却没有 orderId', ok([{ key: key(1), outcome: 'created' }]), 'done'],
    ['同一个键回了两条', ok([
      { key: key(1), outcome: 'not_created' },
      { key: key(1), outcome: 'created', orderId: 'o1' },
    ]), 'done'],
  ]
  for (const [label, resolver, status] of cases) {
    const wx = seed(K, [{ account: A, fingerprint: 'f1', key: key(1) }])
    const res = await engine.reconcile(portFor(pkgIdem), A, resolver, { force: true })
    assert.equal(res.status, status, label)
    assert.equal(res.freed, 0, `${label}：freed 必须为 0`)
    assert.ok(slot(wx, K, A, 'f1'), `${label}：这一格必须原样还在`)
    assert.equal(slot(wx, K, A, 'f1').key, key(1), `${label}：键逐字未变`)
  }
})

test('读不出本机这张表：一个键都不问，一条都不动', async () => {
  const K = pkgIdem.STORE_KEY
  const wx = seed(K, [{ account: A, fingerprint: 'f1', key: key(1) }])
  wx.control.readThrows = true
  let asked = 0
  const res = await engine.reconcile(portFor(pkgIdem), A, () => { asked += 1; return Promise.resolve({ items: [] }) }, { force: true })
  assert.equal(res.status, 'store_unreadable')
  assert.equal(asked, 0, '读不动就不该发出任何请求')
  wx.control.readThrows = false
  assert.ok(slot(wx, K, A, 'f1'), '记录原样还在')
})

test('身份不可用（未登录 / 拿不到 id）：一个键都不碰', async () => {
  const K = pkgIdem.STORE_KEY
  seed(K, [{ account: A, fingerprint: 'f1', key: key(1) }])
  for (const bad of ['', '!', 'u:', null, undefined]) {
    let asked = 0
    const res = await engine.reconcile(portFor(pkgIdem), bad, () => { asked += 1; return Promise.resolve({ items: [] }) }, { force: true })
    assert.equal(res.status, 'identity', `身份 ${JSON.stringify(bad)} 必须整批停手`)
    assert.equal(asked, 0)
  }
})

// ══════════════════════════════════════════════════════════════════════
// B. created：记回 orderId，绝不清
// ══════════════════════════════════════════════════════════════════════

test('created：把 orderId 记回那一格，记录**不清**，并把状态带给调用方', async () => {
  const K = pkgIdem.STORE_KEY
  const wx = seed(K, [{ account: A, fingerprint: 'f1', key: key(1) }])
  const res = await engine.reconcile(portFor(pkgIdem), A, ok([
    { key: key(1), outcome: 'created', orderId: 'ord-1', orderKind: 'package', taskStatus: 'completed' },
  ]), { force: true })

  assert.equal(res.created, 1)
  assert.equal(res.freed, 0, 'created 那一档一条都不许清')
  assert.equal(slot(wx, K, A, 'f1').orderId, 'ord-1', 'orderId 落进了本机')
  assert.deepEqual(
    res.orders.map((o) => [o.fingerprint, o.orderId, o.taskStatus, o.adopted]),
    [['f1', 'ord-1', 'completed', true]],
    '明细带着指纹，调用方才分得清这张订单属不属于它当前那一份',
  )
})

test('created 但本机写不进去：算 unsaved 而不是 created，且不谎称已落盘', async () => {
  const K = pkgIdem.STORE_KEY
  const wx = seed(K, [{ account: A, fingerprint: 'f1', key: key(1) }])
  wx.control.writeSilentlyDrops = true
  const res = await engine.reconcile(portFor(pkgIdem), A, ok([
    { key: key(1), outcome: 'created', orderId: 'ord-1' },
  ]), { force: true })
  assert.equal(res.created, 0)
  assert.equal(res.unsaved, 1, '写不进去就必须如实算成 unsaved')
  assert.equal(res.orders[0].adopted, false)
})

// ══════════════════════════════════════════════════════════════════════
// C. 账号、键、落定状态三道闸（每一道守的都是"别写到别人那一格上"）
// ══════════════════════════════════════════════════════════════════════

test('跨账号：只选本人的记录，B 的那几格一个字节都不动', async () => {
  const K = pkgIdem.STORE_KEY
  const wx = seed(K, [
    { account: A, fingerprint: 'f1', key: key(1) },
    { account: B, fingerprint: 'f1', key: key(2) },
  ])
  let sent = null
  const res = await engine.reconcile(portFor(pkgIdem), A, (keys) => {
    sent = keys
    return Promise.resolve({ items: keys.map((k) => ({ key: k, outcome: 'not_created' })) })
  }, { force: true })

  assert.deepEqual(sent, [key(1)], '只问本人那一个键')
  assert.equal(res.freed, 1)
  assert.equal(slot(wx, K, A, 'f1'), null)
  assert.ok(slot(wx, K, B, 'f1'), 'B 的那一格必须完好')
  assert.equal(slot(wx, K, B, 'f1').key, key(2))
})

test('核对期间这一格被换了键：墓碑说的不是它，不清', () => {
  const K = pkgIdem.STORE_KEY
  const wx = seed(K, [{ account: A, fingerprint: 'f1', key: key(9) }])
  const port = portFor(pkgIdem)
  assert.equal(port.clearSubmittedKey(A, 'f1', key(1)), false, '键对不上必须拒绝')
  assert.ok(slot(wx, K, A, 'f1'), '记录原样还在')
  assert.equal(port.adoptResolvedOrder(A, 'f1', key(1), 'ord-1'), false, 'adopt 同样要逐字核键')
  assert.equal(slot(wx, K, A, 'f1').orderId, '', 'orderId 没被写进一个不属于它的格子')
})

test('已经落定（有 orderId）的记录：clearSubmittedKey 拒绝清 —— 它是找回那张订单的唯一线索', () => {
  const K = pkgIdem.STORE_KEY
  const wx = seed(K, [{ account: A, fingerprint: 'f1', key: key(1), orderId: 'ord-1' }])
  assert.equal(portFor(pkgIdem).clearSubmittedKey(A, 'f1', key(1)), false)
  assert.equal(slot(wx, K, A, 'f1').orderId, 'ord-1')
})

test('clearSubmittedKey 必须**读回来证明**清掉了：写了没写进去时返回 false', () => {
  const K = pkgIdem.STORE_KEY
  const wx = seed(K, [{ account: A, fingerprint: 'f1', key: key(1) }])
  wx.control.writeSilentlyDrops = true
  assert.equal(portFor(pkgIdem).clearSubmittedKey(A, 'f1', key(1)), false,
    'storage.set 不抛也没写进去时同样返回 true，只看它就会谎称清掉了')
  wx.control.writeSilentlyDrops = false
  assert.ok(slot(wx, K, A, 'f1'), '那一格其实还在')
})

test('这一格本来就不在了：算作已经腾出来（true），不当失败', () => {
  seed(pkgIdem.STORE_KEY, [])
  assert.equal(portFor(pkgIdem).clearSubmittedKey(A, 'f1', key(1)), true)
})

// ══════════════════════════════════════════════════════════════════════
// D. 挑选：哪些记录该被问
// ══════════════════════════════════════════════════════════════════════

test('已落定的、以及"铸了键但一个 POST 都没发过"的，都不进这一批', async () => {
  const K = pkgIdem.STORE_KEY
  seed(K, [
    { account: A, fingerprint: 'settled', key: key(1), orderId: 'ord-1' },
    { account: A, fingerprint: 'never-sent', key: key(2), submittedAt: 0 },
    { account: A, fingerprint: 'sent', key: key(3) },
  ])
  let sent = null
  await engine.reconcile(portFor(pkgIdem), A, (keys) => {
    sent = keys
    return Promise.resolve({ items: [] })
  }, { force: true })
  assert.deepEqual(sent, [key(3)],
    '只问"已提交、未落定"那一档：去核对一个从没发过的键等于白白给它立墓碑')
})

test('同一个键出现在两格：两格都不动（分不清答案该写回哪一格）', () => {
  const rows = [
    { account: A, fingerprint: 'f1', key: key(1), orderId: '' },
    { account: A, fingerprint: 'f2', key: key(1), orderId: '' },
    { account: A, fingerprint: 'f3', key: key(3), orderId: '' },
  ]
  const picked = engine.selectPending(rows, { isInFlight: () => false }, Date.now())
  assert.deepEqual(picked.map((p) => p.fingerprint), ['f3'])
})

test('本进程正带着这个键出门：这一轮先不问（否则墓碑会抢在请求前面落下）', async () => {
  const K = pkgIdem.STORE_KEY
  const wx = seed(K, [{ account: A, fingerprint: 'f1', key: key(1) }])
  const port = portFor(pkgIdem)
  port.noteInFlight(key(1))

  let asked = 0
  const res = await engine.reconcile(port, A, () => { asked += 1; return Promise.resolve({ items: [] }) }, { force: true })
  assert.equal(res.status, 'idle')
  assert.equal(asked, 0, '在飞的键一个都不问')
  assert.ok(slot(wx, K, A, 'f1'))

  // 保护期过了就该恢复正常 —— 它只决定"什么时候去问"，不决定答案。
  assert.equal(port.isInFlight(key(1), Date.now() + engine.INFLIGHT_GUARD_MS + 1), false)
  port.noteInFlight(key(1))
  port.forgetInFlight(key(1))
  assert.equal(port.isInFlight(key(1), Date.now()), false, 'forgetInFlight 之后立刻可问')
})

test('markSubmitted 会把键登记成在途；落定 / 清除之后不再在途', () => {
  const K = pkgIdem.STORE_KEY
  seed(K, [])
  const rec = { account: A, fingerprint: 'f1', key: key(1), orderId: '', createdAt: Date.now(), submittedAt: 0 }
  ACTIVE_WX.storage.set(K, [rec])
  assert.equal(pkgIdem.markSubmitted(A, 'f1', key(1)), true)
  assert.equal(pkgIdem.submissionPort.isInFlight(key(1), Date.now()), true,
    'POST 之前标记的那一刻就必须挡住核对')
  assert.ok(pkgIdem.rememberOrderId(A, 'f1', key(1), 'ord-1'))
  assert.equal(pkgIdem.submissionPort.isInFlight(key(1), Date.now()), false, '落定之后不再在途')
})

test('一次最多问 20 个键，与服务端 @ArrayMaxSize(20) 同一个数', async () => {
  const K = pkgIdem.STORE_KEY
  const rows = []
  for (let i = 0; i < 25; i += 1) {
    rows.push({ account: A, fingerprint: `f${i}`, key: `${String(i).padStart(8, '0')}-1111-4222-8333-444444444444` })
  }
  seed(K, rows)
  let sent = null
  await engine.reconcile(portFor(pkgIdem), A, (keys) => { sent = keys; return Promise.resolve({ items: [] }) }, { force: true })
  assert.equal(engine.MAX_RESOLVE_KEYS, 20)
  assert.equal(sent.length, 20, '超过 20 会让服务端整批 400，于是死路一条都没解开')
})

// ══════════════════════════════════════════════════════════════════════
// E. 冷却 / 并发
// ══════════════════════════════════════════════════════════════════════

test('自动触发有 30s 冷却；显式触发（force）一律绕过它', async () => {
  const K = pkgIdem.STORE_KEY
  seed(K, [{ account: A, fingerprint: 'f1', key: key(1) }])
  const port = portFor(pkgIdem)
  let asked = 0
  const resolver = () => { asked += 1; return Promise.resolve({ items: [] }) }

  await engine.reconcile(port, A, resolver, { force: true })
  assert.equal(asked, 1)
  const cooled = await engine.reconcile(port, A, resolver, {})
  assert.equal(cooled.status, 'cooldown')
  assert.equal(asked, 1, '冷却期内不再打请求')
  await engine.reconcile(port, A, resolver, { force: true })
  assert.equal(asked, 2, 'force 必须绕过冷却 —— 用户刚被拦住，要的是当下的真值')
})

test('两个重叠调用共用同一发，不各打一次（各打一次会对同一批键重复判墓碑）', async () => {
  const K = pkgIdem.STORE_KEY
  seed(K, [{ account: A, fingerprint: 'f1', key: key(1) }])
  const port = portFor(pkgIdem)
  let asked = 0
  let release
  const gate = new Promise((r) => { release = r })
  const resolver = () => { asked += 1; return gate.then(() => ({ items: [] })) }
  const a = engine.reconcile(port, A, resolver, { force: true })
  const b = engine.reconcile(port, A, resolver, { force: true })
  assert.equal(a, b, '同一个在途 Promise')
  release()
  await a
  assert.equal(asked, 1)
})

// ══════════════════════════════════════════════════════════════════════
// F. 两条链共用同一份实现
// ══════════════════════════════════════════════════════════════════════

test('单件链走同一套：not_created 清、processing 留，且两条链互不串表', async () => {
  const PK = pkgIdem.STORE_KEY
  const RK = printIdem.STORE_KEY
  const wx = createWx()
  ACTIVE_WX = wx
  const row = (fp, k) => ({
    account: A, fingerprint: fp, key: k, orderId: '',
    createdAt: Date.now() - 3600_000, submittedAt: Date.now() - 3600_000,
  })
  wx.storage.set(PK, [row('pkg', key(1))])
  wx.storage.set(RK, [row('print', key(2))])

  const res = await engine.reconcile(portFor(printIdem), A, ok([
    { key: key(2), outcome: 'not_created' },
  ]), { force: true })
  assert.equal(res.freed, 1)
  assert.equal(slot(wx, RK, A, 'print'), null, '单件那一格被清掉')
  assert.ok(slot(wx, PK, A, 'pkg'), '材料包那张表一个字节都没动')

  const res2 = await engine.reconcile(portFor(printIdem), A, ok([]), { force: true })
  assert.equal(res2.status, 'idle')
})

test('两条链的 submissionPort 命名空间不同（否则一条链的在途核对会挡住另一条）', () => {
  assert.notEqual(pkgIdem.submissionPort.namespace, printIdem.submissionPort.namespace)
  assert.equal(pkgIdem.submissionPort.namespace, pkgIdem.STORE_KEY)
  assert.equal(printIdem.submissionPort.namespace, printIdem.STORE_KEY)
})

// ══════════════════════════════════════════════════════════════════════
// G. 409 三种成因：处置完全相反
// ══════════════════════════════════════════════════════════════════════

test('classifySubmitConflict：三种 409 各归各位，其余一律空串', () => {
  const at = (statusCode, code) => engine.classifySubmitConflict({ statusCode, code })
  assert.equal(at(409, 'IDEMPOTENCY_KEY_REUSED'), 'reused')
  assert.equal(at(409, 'IDEMPOTENCY_KEY_ABANDONED'), 'abandoned')
  assert.equal(at(409, 'IDEMPOTENCY_IN_PROGRESS'), 'in_progress')
  // 状态码不对就不算 —— 光看 code 会把别处同名的错误也认成冲突。
  assert.equal(at(500, 'IDEMPOTENCY_IN_PROGRESS'), '')
  assert.equal(at(409, 'PRINT_FILE_EXPIRED'), '')
  assert.equal(engine.classifySubmitConflict(null), '')
  assert.equal(engine.classifySubmitConflict(new Error('x')), '')
})

test('abandoned 指向"再提交一次"，in_progress 指向"再核对一次"（两者绝不能互换）', () => {
  const ab = engine.describeSubmitConflict('abandoned', { submitLabel: '确认下单' })
  assert.equal(ab.recover, 'resubmit')
  assert.match(ab.text, /确认下单/)
  const ip = engine.describeSubmitConflict('in_progress', {})
  assert.equal(ip.recover, 'reconcile')
  assert.match(ip.text, /正在服务端处理|稍等/)
  assert.equal(engine.describeSubmitConflict('reused', {}), null, 'reused 各页自有文案')
})

// ══════════════════════════════════════════════════════════════════════
// H. 每一档都给得出一个真的有下一步的动作
// ══════════════════════════════════════════════════════════════════════

test('describeReconcileResult：每一档的 recover 都在页面认得的白名单里，且语义不串档', () => {
  const allowed = ['login', 'orders', 'reconcile', 'resubmit']
  const cases = [
    [{ status: 'identity' }, 'login'],
    [{ status: 'store_unreadable' }, 'orders'],
    [{ status: 'failed', error: { statusCode: 401 } }, 'login'],
    [{ status: 'failed', error: { statusCode: -1 } }, 'reconcile'],
    [{ status: 'malformed' }, 'reconcile'],
    [{ status: 'cooldown' }, 'resubmit'],
    [{ status: 'idle' }, 'resubmit'],
    [{ status: 'done', created: 1, orders: [] }, 'orders'],
    [{ status: 'done', freed: 2 }, 'resubmit'],
    [{ status: 'done', processing: 1 }, 'reconcile'],
    [{ status: 'done', unknown: 1 }, 'reconcile'],
    [{ status: 'done', blocked: 1 }, 'reconcile'],
  ]
  for (const [result, recover] of cases) {
    const shown = engine.describeReconcileResult(
      Object.assign({ created: 0, freed: 0, processing: 0, unsaved: 0, blocked: 0, unknown: 0, orders: [] }, result),
      { submitLabel: '确认下单' },
    )
    assert.ok(allowed.includes(shown.recover), `${result.status}/${shown.recover} 必须是页面认得的动作`)
    assert.equal(shown.recover, recover, `${JSON.stringify(result)} 的下一步`)
    assert.ok(shown.title && shown.text, '标题与正文都不能空')
  }
})

test('「已经建成」那一档绝不说成「可以再提交」—— 那正是多一张订单的入口', () => {
  const shown = engine.describeReconcileResult({
    status: 'done', created: 1, freed: 0, processing: 0, unsaved: 0, blocked: 0, unknown: 0, orders: [],
  }, {})
  assert.equal(shown.recover, 'orders')
  assert.doesNotMatch(shown.text, /再点一次|重新提交/)
})

// ══════════════════════════════════════════════════════════════════════
// I. 端到端：名额满的死路真的被这条链解开，而且只被墓碑解开
// ══════════════════════════════════════════════════════════════════════

test('名额满 → 核对 → 只有墓碑那几格被腾出来，随后真的能铸出新键', async () => {
  const K = pkgIdem.STORE_KEY
  const rows = []
  for (let i = 0; i < pkgIdem.MAX_PENDING_RECORDS; i += 1) {
    rows.push({ account: A, fingerprint: `f${i}`, key: `${String(i).padStart(8, '0')}-1111-4222-8333-444444444444` })
  }
  const wx = seed(K, rows)

  // 名额满：ensureKey 必须 fail-closed，一条既有记录都不删。
  await assert.rejects(pkgIdem.ensureKey(A, 'brand-new'), (e) => e.message === pkgIdem.PENDING_FULL_MESSAGE)
  assert.equal(read(wx, K).length, pkgIdem.MAX_PENDING_RECORDS, '被拒绝时一条都没被挤掉')

  // 服务端：一条是墓碑，一条还在处理，一条其实已经建成了。
  const res = await engine.reconcile(portFor(pkgIdem), A, (keys) => Promise.resolve({
    items: keys.map((k, i) => {
      if (i === 0) return { key: k, outcome: 'not_created' }
      if (i === 1) return { key: k, outcome: 'processing' }
      if (i === 2) return { key: k, outcome: 'created', orderId: 'ord-x' }
      return { key: k, outcome: 'processing' }
    }),
  }), { force: true })

  assert.equal(res.freed, 1, '只有墓碑那一条腾出了名额')
  assert.equal(res.created, 1)
  assert.equal(res.processing, pkgIdem.MAX_PENDING_RECORDS - 2)
  assert.equal(slot(wx, K, A, 'f0'), null)
  assert.equal(slot(wx, K, A, 'f1').key, rows[1].key, 'processing 那一格逐字未变')
  assert.equal(slot(wx, K, A, 'f2').orderId, 'ord-x')

  // 名额真的腾出来了：未落定从 20 降到 18（一条清掉、一条落定），可以铸新键。
  ACTIVE_WX = wx
  const minted = await pkgIdem.ensureKey(A, 'brand-new')
  assert.match(minted.key, pkgIdem.KEY_RE, '新铸的键是合法的小写 UUID')
  assert.equal(minted.orderId, '')
})

test('全是 processing 时，名额一格都不腾 —— 宁可让用户再等，不多建一张订单', async () => {
  const K = pkgIdem.STORE_KEY
  const rows = []
  for (let i = 0; i < pkgIdem.MAX_PENDING_RECORDS; i += 1) {
    rows.push({ account: A, fingerprint: `f${i}`, key: `${String(i).padStart(8, '0')}-1111-4222-8333-444444444444` })
  }
  const wx = seed(K, rows)
  const res = await engine.reconcile(portFor(pkgIdem), A, (keys) => Promise.resolve({
    items: keys.map((k) => ({ key: k, outcome: 'processing' })),
  }), { force: true })
  assert.equal(res.freed, 0)
  assert.equal(read(wx, K).length, pkgIdem.MAX_PENDING_RECORDS)
  await assert.rejects(pkgIdem.ensureKey(A, 'brand-new'), (e) => e.message === pkgIdem.PENDING_FULL_MESSAGE)
  const shown = engine.describeReconcileResult(res, { submitLabel: '确认下单' })
  assert.equal(shown.recover, 'reconcile', '下一步是再核对，不是再提交')
})
