import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const root = new URL('../../src/', import.meta.url)
const source = (path) => readFileSync(new URL(path, root), 'utf8')
const compile = (text) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`
const modules = Object.fromEntries(['copyCheckModel', 'copyPrintModel', 'copyPreview', 'copySession'].map((name) =>
  [name, compile(source(`pages/copy/${name}.ts`))]))
const model = await import(modules.copyPrintModel)
const sessionStore = await import(modules.copySession)
class LocalCopyError extends Error { constructor(code) { super(code); this.code = code } }
const timers = new Map()
globalThis.window = {
  setTimeout: (fn, delay) => { const key = Symbol(); timers.set(key, { fn, delay }); return key },
  clearTimeout: (key) => timers.delete(key),
  setInterval: (fn, delay) => { const key = Symbol(); timers.set(key, { fn, delay }); return key },
  clearInterval: (key) => timers.delete(key),
}
let local, cloud, calls, fail, pendingPrint
const makeJob = (patch = {}) => ({ copyId: 'copy-test', terminalId: 'KSK-001', generation: 1, authorizationVersion: 1,
  state: 'scanned', source: 'flatbed', copies: 1, colorMode: 'black_white', duplex: 'simplex', pageCount: 2,
  expiresAt: '2099-01-01', orderId: null, quoteVersion: 'a'.repeat(64), quoteError: null,
  quote: { serviceKey: 'print_bw_page', pageCount: 2, copies: 1, colorMode: 'black_white', duplex: 'simplex',
    unitCents: 0, amountCents: 0, billableSides: 2 }, ...patch })
globalThis.__copyPrintTest = {
  LocalCopyError, ApiHttpError: class extends Error {},
  ...sessionStore,
  fetchCopyPreview: async () => new Blob(['private']),
  postLocalCopy: async (action, identity, extra, signal) => {
    calls.push({ action, identity, extra, signal })
    if (fail === action || (['local', 'all'].includes(fail) && ['status', 'print'].includes(action))) throw new Error('offline')
    if (fail === 'device-http' && action === 'status') throw new LocalCopyError('COPY_CAPABILITY_REVOKED')
    if (action === 'print') return pendingPrint ?? { ...local, state: 'printing' }
    if (action === 'clear') return { ...local, state: 'cleared', purged: true }
    return { ...local }
  },
  getCopyJob: async () => { calls.push({ action: 'get' }); if (['cloud', 'all'].includes(fail)) throw new Error('offline'); return cloud },
  confirmCopyJob: async () => {
    calls.push({ action: 'confirm' }); cloud = { ...cloud, state: 'confirmed', orderId: 'order-1' }; return cloud
  },
  cancelCopyJob: async () => { calls.push({ action: 'cancel' }); return { ...cloud, state: 'cancelled' } },
}
const injected = source('pages/copy/copyDeviceFlow.ts').replace(/^import .* from '([^']+)'$/gm, (line, path) => {
  const name = path.split('/').at(-1)
  if (modules[name]) return line.replace(path, modules[name])
  return line.replace(/import \{(.*?)\} from .*/, (_, names) =>
    `const { ${names.replace(/type \w+,?\s*/g, '')} } = globalThis.__copyPrintTest`)
})
const flow = await import(compile(injected))
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
async function tick() {
  const timer = [...timers.entries()].find(([, t]) => t.delay === 3000)
  assert.ok(timer, 'status poll scheduled')
  timers.delete(timer[0]); timer[1].fn(); await flush()
}
async function start() {
  sessionStore.clearCopySession(); timers.clear()
  calls = []; fail = null; pendingPrint = null
  cloud = makeJob(); local = { state: 'scanning', generation: 1, pageCount: 2, errorCode: null }
  const attempt = sessionStore.beginCopyAttempt('KSK-001')
  sessionStore.acceptCopyReceipt(attempt.epoch, { ...cloud, controlToken: 'memory-only-secret' })
  const session = sessionStore.readCopySession()
  const device = flow.ensureCopyDevice(session)
  await flush()
  local.state = 'scanned'; await tick()
  assert.equal(flow.readCopyDevice().phase, 'check')
  return { device, session }
}
async function printing() {
  const result = await start()
  await result.device.confirm()
  assert.equal(flow.readCopyDevice().phase, 'printing')
  return result
}

test('Agent print mapping never infers paper count or actual paper movement', () => {
  for (const state of ['printing', 'dispatching', 'spooled']) assert.equal(model.copyPrintPhase(state), 'printing')
  assert.equal(model.copyPrintPhase('handed'), 'done')
  assert.equal(model.copyPrintPhase('failed'), 'error')
  for (const state of ['unconfirmed', 'scanned', 'unexpected']) assert.equal(model.copyPrintPhase(state), 'unconfirmed')
  assert.equal(model.COPY_PRINT_LABELS.handing, '正在交给打印机')
  for (const file of ['pages/copy/CopyPrintView.tsx', 'pages/copy/copyPrintModel.ts', 'pages/copy/copy-print.css']) {
    assert.doesNotMatch(source(file), /正在出纸|已出\s*\d+\s*张|animation(?:-name)?\s*:/)
  }
})
test('known scanner faults are evidence based; unknown never becomes a paper jam', () => {
  for (const [code, fault] of [['feeder_empty', 'nopaper'], ['paper_jam', 'jam'], ['cover_open', 'jam'],
    ['COPY_DEVICE_BUSY', 'busy'], ['timeout', 'timeout'], ['too_large', 'limit'], ['COPY_CAPABILITY_REVOKED', 'off'],
    ['COPY_UNAUTHORIZED', 'off'], ['not_ready', 'noresp'], ['unknown', 'noresp']]) assert.equal(model.copyFault(code), fault)
})
test('confirm dispatches once; repeated same-operation requests only query status, never send print again', async () => {
  const { device, session } = await printing()
  flow.ensureCopyDevice(session)
  local.state = 'spooled'
  await Promise.all([device.print(), device.print(), device.confirm()])
  assert.equal(calls.filter((c) => c.action === 'print').length, 1)
  assert.equal(calls.filter((c) => c.action === 'confirm').length, 1)
  assert.ok(calls.filter((c) => c.action === 'status').length >= 2)
  const print = calls.find((c) => c.action === 'print')
  assert.match(print.extra.operationId, /^[\w-]+$/)
  assert.equal(print.identity.copyId, session.copyId)
  assert.equal(flow.readCopyDevice().printStage, 'handing')
})
for (const [state, phase] of [['handed', 'done'], ['unconfirmed', 'unconfirmed'], ['failed', 'error']]) {
  test(`${state} is terminal, revokes preview and cannot dispatch or cancel again`, async () => {
    const { device } = await start()
    const [url] = await device.loadPreview([1])
    await device.confirm()
    await assert.rejects(fetch(url))
    local.state = state; cloud = { ...cloud, state }; await tick()
    assert.equal(flow.readCopyDevice().phase, phase)
    assert.equal(flow.readCopyDevice().job.state, state)
    await device.print(); await device.stop(); await device.confirm()
    assert.equal(await device.clearForRescan(), false)
    assert.equal(calls.filter((c) => c.action === 'print').length, 1)
    assert.equal(calls.filter((c) => c.action === 'cancel').length, 0)
    sessionStore.clearCopySession()
    assert.equal(sessionStore.readCopySession(), null)
    assert.ok(calls.some((c) => c.action === 'clear'))
  })
}
test('ambiguous print request queries the same cloud order, then unconfirmed without a second print', async () => {
  const { device } = await start()
  fail = 'print'; await device.confirm()
  assert.equal(flow.readCopyDevice().phase, 'unconfirmed')
  await device.print(); await device.confirm()
  assert.equal(calls.filter((c) => c.action === 'print').length, 1)
  assert.equal(calls.filter((c) => c.action === 'get').length, 2)
})
for (const result of ['handed', 'failed', 'confirmed', 'wrong-generation', 'offline']) test(`local disconnect recovers from GET only: ${result}`, async () => {
  const { device } = await printing()
  fail = 'local'
  cloud = { ...cloud, state: result === 'wrong-generation' ? 'handed' : result, generation: result === 'wrong-generation' ? 2 : 1 }
  if (result === 'offline') fail = 'all'
  await tick(); await tick()
  assert.equal(flow.readCopyDevice().phase, result === 'handed' ? 'done' : result === 'failed' ? 'error' : 'unconfirmed')
  await device.print()
  assert.equal(calls.filter((c) => c.action === 'print').length, 1)
})
test('printing without progress times out to unconfirmed; late in-flight result cannot replace it', async () => {
  const { device } = await printing()
  const now = Date.now
  try {
    Date.now = () => now() + 61_000
    for (const timer of timers.values()) if (timer.delay === 1000) timer.fn()
    await flush()
    assert.equal(flow.readCopyDevice().phase, 'unconfirmed')
    local.state = 'handed'; await device.print()
    assert.equal(flow.readCopyDevice().phase, 'unconfirmed')
    assert.equal(calls.filter((c) => c.action === 'print').length, 1)
  } finally { Date.now = now }
})
test('departure drops credentials immediately even with print and clear pending; late reply never reopens result', async () => {
  const { device } = await start()
  let release
  pendingPrint = new Promise((resolve) => { release = resolve })
  const confirming = device.confirm()
  await flush()
  assert.equal(flow.readCopyDevice().phase, 'printing')
  fail = 'clear'; sessionStore.clearCopySession()
  assert.equal(flow.readCopyDeviceFlow(), null)
  assert.equal(sessionStore.readCopySession(), null)
  assert.equal(calls.filter((c) => c.action === 'cancel').length, 0)
  release({ ...local, state: 'handed' }); await confirming
  assert.equal(flow.readCopyDevice().phase, 'starting')
  assert.ok(calls.some((c) => c.action === 'clear'))
})
test('scanner errors and capability revocation go to error/off, never confirm or print', async () => {
  for (const code of ['feeder_empty', 'paper_jam', 'busy', 'timeout', 'too_large', 'unknown', 'COPY_CAPABILITY_REVOKED']) {
    await start()
    // 核对中的异常同样必须退出可确认状态。
    local = { ...local, state: 'failed', errorCode: code }
    await tick()
    assert.equal(flow.readCopyDevice().phase, code === 'COPY_CAPABILITY_REVOKED' ? 'off' : 'error')
    assert.equal(calls.some((c) => c.action === 'print'), false)
  }
})
test('explicit HTTP device denial uses off instead of a retryable transport failure', async () => {
  await start(); fail = 'device-http'; await tick()
  assert.equal(flow.readCopyDevice().phase, 'off')
  assert.equal(calls.some((c) => c.action === 'print'), false)
})
test('local print wire body excludes all session tokens and print settings; preserves operationId', async () => {
  const localApi = await import(compile(source('services/copy/localCopyApi.ts').replaceAll('import.meta.env',
    JSON.stringify({ VITE_TERMINAL_AGENT_BRIDGE_TOKEN: 'synthetic-bridge' }))))
  const original = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ success: true, data: { state: 'spooled', generation: 1, pageCount: 2, errorCode: null } }))
  }
  try {
    const identity = { copyId: 'copy-test', generation: 1, controlToken: 'must-not-leak', copies: 99 }
    await localApi.postLocalCopy('print', identity, { operationId: 'same-op' })
    await localApi.postLocalCopy('print', identity, { operationId: 'same-op' })
    assert.deepEqual(bodies, [{ copyId: 'copy-test', generation: 1, operationId: 'same-op' }, { copyId: 'copy-test', generation: 1, operationId: 'same-op' }])
  } finally { globalThis.fetch = original }
})
