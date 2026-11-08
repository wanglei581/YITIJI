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
const store = await import(modules.copySession)
const timers = new Map()
globalThis.window = {
  setTimeout: (fn, delay) => { const key = Symbol(); timers.set(key, { fn, delay }); return key },
  clearTimeout: (key) => timers.delete(key),
  setInterval: (fn, delay) => { const key = Symbol(); timers.set(key, { fn, delay }); return key },
  clearInterval: (key) => timers.delete(key),
  location: { origin: 'https://kiosk.invalid' },
}
// 在真实状态机与重试路径中禁止任何持久化访问。
for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(globalThis, name, {
  configurable: true, get: () => assert.fail(`${name} must not be accessed`),
})
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
const TOKEN = 'c3c-memory-only-control'
let calls = [], local, cloud, startWait, cancelWait, confirmWait, printWait, cancelFailures, clearFails, badReceipt
const job = () => ({ copyId: 'copy-c3c', terminalId: 'KSK-001', generation: 7, authorizationVersion: 3,
  state: 'scanned', source: 'flatbed', copies: 1, colorMode: 'black_white', duplex: 'simplex', pageCount: 2,
  expiresAt: '2099-01-01', orderId: null, quoteVersion: 'a'.repeat(64), quoteError: null,
  quote: { serviceKey: 'print_bw_page', pageCount: 2, copies: 1, colorMode: 'black_white', duplex: 'simplex',
    unitCents: 0, amountCents: 0, billableSides: 2 } })
globalThis.__copyCleanupTest = {
  ...store, LocalCopyError: class extends Error {}, ApiHttpError: class extends Error {},
  fetchCopyPreview: async () => new Blob(['private']),
  postLocalCopy: async (action, identity, extra, signal) => {
    calls.push({ action, copyId: identity.copyId, generation: identity.generation, signal, extra })
    if (action === 'start' && startWait) return startWait.promise
    if (action === 'print') return printWait?.promise ?? { ...local, state: 'printing' }
    if (action === 'clear' && clearFails) throw new Error('404 COPY_NOT_FOUND')
    return { ...local, ...(['abort', 'clear'].includes(action) ? { state: action === 'clear' ? 'cleared' : 'cancelled', purged: true } : {}) }
  },
  getCopyJob: async () => cloud,
  confirmCopyJob: async () => confirmWait?.promise ?? { ...cloud, state: 'confirmed', orderId: 'order-c3c' },
  cancelCopyJob: async (copyId, token, generation, signal) => {
    calls.push({ action: 'cancel', copyId, token, generation, signal })
    if (cancelFailures-- > 0) throw new Error('offline')
    return cancelWait?.promise ?? { ...cloud, state: 'cancelled', ...(badReceipt ? { generation: 99 } : {}) }
  },
}
const injected = source('pages/copy/copyDeviceFlow.ts').replace(/^import .* from '([^']+)'$/gm, (line, path) => {
  const name = path.split('/').at(-1)
  if (modules[name]) return line.replace(path, modules[name])
  return line.replace(/import \{(.*?)\} from .*/, (_, names) =>
    `const { ${names.replace(/type \w+,?\s*/g, '')} } = globalThis.__copyCleanupTest`)
})
const flow = await import(compile(injected))
async function start({ delayed = false, failures = 0 } = {}) {
  store.clearCopySession(); await flush(); timers.clear()
  calls = []; local = { state: 'scanning', generation: 7, pageCount: 2, errorCode: null }; cloud = job()
  startWait = delayed ? deferred() : null
  cancelWait = confirmWait = printWait = null
  cancelFailures = failures; clearFails = badReceipt = false
  const attempt = store.beginCopyAttempt('KSK-001')
  store.acceptCopyReceipt(attempt.epoch, { ...cloud, controlToken: TOKEN })
  const session = store.readCopySession()
  const device = flow.ensureCopyDevice(session)
  await flush()
  return { device, session }
}
const cancels = () => calls.filter((call) => call.action === 'cancel')
async function timer(delay) {
  const entry = [...timers.entries()].find(([, value]) => value.delay === delay)
  assert.ok(entry, `timer ${delay} must exist`)
  timers.delete(entry[0]); entry[1].fn(); await flush()
}
async function check() {
  const result = await start()
  local.state = 'scanned'; await timer(3000)
  assert.equal(flow.readCopyDevice().phase, 'check')
  return result
}
test('start in flight → clear 404 still cancels cloud once; departure is synchronous and late start stays dead', async () => {
  const { device, session } = await start({ delayed: true })
  clearFails = true; cancelWait = deferred()
  const signal = calls.find((call) => call.action === 'start').signal
  assert.equal(store.clearCopySession(), undefined)
  assert.equal(flow.readCopyDeviceFlow(), null)
  assert.equal(store.readCopySession(), null)
  assert.equal(session.controlToken, null)
  assert.equal(signal.aborted, true)
  assert.deepEqual(cancels(), [{ action: 'cancel', copyId: 'copy-c3c', generation: 7, token: TOKEN, signal: undefined }])
  assert.equal(calls.filter((call) => call.action === 'clear').length, 1)
  device.dispose(); store.clearCopySession()
  assert.equal(cancels().length, 1)
  startWait.resolve({ ...local, state: 'scanning' })
  cancelWait.resolve({ ...cloud, state: 'cancelled' }); await flush()
  assert.equal(flow.readCopyDeviceFlow(), null)
  assert.equal(flow.readCopyDevice().phase, 'starting')
  assert.equal(timers.size, 0)
})
test('departure while confirmation is pending cancels and never dispatches a late confirmed job', async () => {
  const { device } = await check()
  confirmWait = deferred()
  const confirming = device.confirm()
  store.clearCopySession()
  confirmWait.resolve({ ...cloud, state: 'confirmed', orderId: 'order-c3c' }); await confirming
  assert.equal(cancels().length, 1)
  assert.equal(calls.some((call) => call.action === 'print'), false)
})
test('after print dispatch departure only clears, even while the print response is pending', async () => {
  const { device, session } = await check()
  printWait = deferred()
  const confirming = device.confirm(); await flush()
  assert.equal(calls.filter((call) => call.action === 'print').length, 1)
  store.clearCopySession(); device.dispose()
  assert.equal(cancels().length, 0)
  assert.equal(session.controlToken, null)
  assert.equal(calls.filter((call) => call.action === 'clear').length, 1)
  printWait.resolve({ ...local, state: 'handed' }); await confirming
  assert.equal(flow.readCopyDevice().phase, 'starting')
})
for (const failures of [1, 2, 99]) test(`background cancellation retries are bounded and retain the original memory credential: ${failures}`, async () => {
  const { device, session } = await start({ delayed: true, failures })
  store.clearCopySession(); device.dispose(); await flush()
  assert.equal(session.controlToken, null)
  assert.equal(flow.readCopyDeviceFlow(), null)
  assert.equal(cancels().length, 1)
  await timer(1000)
  if (failures > 1) await timer(2000)
  assert.equal(cancels().length, Math.min(failures + 1, 3))
  assert.ok(cancels().every((call) => call.copyId === 'copy-c3c' && call.generation === 7 && call.token === TOKEN && !call.signal))
  assert.equal(timers.size, 0, 'no retry remains after success or exhaustion')
  startWait.resolve(local); await flush()
})
test('a mismatched cancellation receipt is uncertain and exhausts the same retry bound', async () => {
  await start(); badReceipt = true
  store.clearCopySession(); await flush()
  await timer(1000); await timer(2000)
  assert.equal(cancels().length, 3)
  assert.equal(timers.size, 0)
})
test('departure shares a pending stop cancellation instead of duplicating or aborting it', async () => {
  const { device } = await start()
  cancelWait = deferred()
  const stopping = device.stop(); await flush()
  store.clearCopySession()
  assert.equal(cancels().length, 1)
  cancelWait.resolve({ ...cloud, state: 'cancelled' }); await stopping; await flush()
  assert.equal(cancels().length, 1)
  assert.equal(timers.size, 0)
})
test('successful rescan cancellation is reused by subsequent disposal', async () => {
  const { device } = await check()
  assert.equal(await device.clearForRescan(), true)
  store.clearCopySession(); await flush()
  assert.equal(cancels().length, 1)
  assert.equal(timers.size, 0)
})
test('cloud cancel wire uses POST, generation body, control header, keepalive and an independent 12s timeout', async () => {
  store.clearCopySession(); await flush(); timers.clear()
  const requests = []
  globalThis.__copyWireTest = {
    API_BASE_URL: '/api/v1', getTerminalId: () => 'KSK-001', ApiHttpError: class extends Error {},
    terminalProtectedFetch: async (url, init) => {
      requests.push({ url, init })
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout'))))
    },
  }
  const api = await import(compile(source('services/api/copyJobs.ts').replace(/^import \{(.*?)\} from .*$/gm,
    (_, names) => `const { ${names} } = globalThis.__copyWireTest`)))
  const pending = api.cancelCopyJob('copy/c3c', TOKEN, 7)
  assert.equal(requests.length, 1)
  const { url, init } = requests[0]
  assert.equal(url.pathname, '/api/v1/copy/jobs/copy%2Fc3c/cancel')
  assert.equal(url.href.includes(TOKEN), false)
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.get('X-Copy-Control'), TOKEN)
  assert.equal(init.headers.get('X-Terminal-Id'), 'KSK-001')
  assert.deepEqual(JSON.parse(init.body), { generation: 7 })
  assert.equal(init.keepalive, true)
  assert.equal(init.cache, 'no-store')
  const rejected = assert.rejects(pending, /timeout/)
  await timer(12000); await rejected
  assert.equal(init.signal.aborted, true)
  assert.equal(timers.size, 0)
})
