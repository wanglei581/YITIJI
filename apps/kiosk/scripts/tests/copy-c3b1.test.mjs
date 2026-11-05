import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const base = new URL('../../src/pages/copy/', import.meta.url)
const source = (file) => readFileSync(new URL(file, base), 'utf8')
const compile = (text) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`
const previewURL = compile(source('copyPreview.ts'))
const modelURL = compile(source('copyCheckModel.ts'))
const printURL = compile(source('copyPrintModel.ts'))
const model = await import(modelURL)
const { CopyPreview } = await import(previewURL)

test('paper is rounded per copy: odd originals never share the last sheet with another copy', () => {
  for (const [pages, copies, single, double] of [[1, 2, 2, 2], [3, 2, 6, 4], [5, 3, 15, 9], [4, 2, 8, 4]]) {
    assert.equal(model.copySheetCount(pages, copies, 'simplex'), single)
    for (const duplex of ['duplex_long_edge', 'duplex_short_edge']) assert.equal(model.copySheetCount(pages, copies, duplex), double)
  }
})
test('only a real zero quote says free; no quote and nonzero quote cannot confirm', () => {
  assert.equal(model.copyPriceLabel(0), '本机构免费')
  assert.equal(model.copyPriceLabel(123), '¥1.23')
  for (const amount of [null, undefined, -1, NaN, Infinity]) assert.equal(model.copyPriceLabel(amount), '报价暂时无法确认')
  const job = makeJob()
  assert.equal(model.canConfirmCopy(job), true)
  for (const patch of [{ state: 'confirmed' }, { quote: null }, { quoteVersion: null }, { quoteError: 'COPY_PRICE_INVALID' },
    { quote: { ...job.quote, amountCents: 1 } }, { quote: { ...job.quote, billableSides: 9 } }]) {
    assert.equal(model.canConfirmCopy({ ...job, ...patch }), false)
  }
})
test('local states distinguish a complete glass page, feeder auto-finish, composing and uncertainty', () => {
  for (const [state, source, phase] of [['starting', 'flatbed', 'starting'], ['scanning', 'flatbed', 'scan'],
    ['page_ready', 'flatbed', 'more'], ['page_ready', 'feeder', 'finishing'], ['composing', 'feeder', 'finishing'],
    ['scanned', 'flatbed', 'finishing'], ['failed', 'flatbed', 'unknown'], ['unexpected', 'feeder', 'unknown']]) {
    assert.equal(model.copyPhaseFromLocal(state, source), phase)
  }
})
test('preview uses real blob URLs and revokes on replacement, departure and a late page response', async () => {
  const pool = new CopyPreview()
  const [url] = await pool.load([1], async () => new Blob(['first'], { type: 'image/jpeg' }))
  assert.match(url, /^blob:/)
  assert.equal(await (await fetch(url)).text(), 'first')
  const [next] = await pool.load([2], async () => new Blob(['second']))
  await assert.rejects(fetch(url))
  pool.clear()
  await assert.rejects(fetch(next))
  let finish
  let signal
  const delayed = pool.load([1], (_, s) => { signal = s; return new Promise((resolve) => { finish = resolve }) })
  pool.clear()
  assert.equal(signal.aborted, true)
  finish(new Blob(['old']))
  await assert.rejects(delayed, /COPY_PREVIEW_ABORTED/)
})
test('a partial preview failure revokes earlier pages too', async () => {
  const real = URL.createObjectURL
  const created = []
  URL.createObjectURL = (blob) => { const url = real(blob); created.push(url); return url }
  try {
    await assert.rejects(new CopyPreview().load([1, 2], async (page) => {
      if (page === 2) throw new Error('offline')
      return new Blob(['private'])
    }))
    assert.equal(created.length, 1)
    await assert.rejects(fetch(created[0]))
  } finally { URL.createObjectURL = real }
})

function makeJob(patch = {}) {
  return { copyId: 'test-copy', terminalId: 'KSK-001', generation: 1, authorizationVersion: 1, state: 'scanned',
    pageCount: 3, copies: 2, source: 'flatbed', colorMode: 'black_white', duplex: 'duplex_long_edge',
    expiresAt: '2099-01-01', orderId: null, quoteVersion: 'a'.repeat(64), quoteError: null,
    quote: { pageCount: 3, copies: 2, colorMode: 'black_white', duplex: 'duplex_long_edge', billableSides: 6,
      unitCents: 0, amountCents: 0, serviceKey: 'copy_bw_page' }, ...patch }
}
class ApiHttpError extends Error { constructor(code) { super(code); this.code = code } }
let cleanup
let calls = []
let view
let job
let failure
let quoteChanged
let statusWait = null
let confirmed = false
const timers = new Map()
globalThis.window = {
  setTimeout: (fn, delay) => { const key = Symbol(); timers.set(key, { fn, delay }); return key },
  clearTimeout: (key) => timers.delete(key),
  setInterval: (fn, delay) => { const key = Symbol(); timers.set(key, { fn, delay }); return key },
  clearInterval: (key) => timers.delete(key),
}
globalThis.__copyTestDeps = {
  ApiHttpError, LocalCopyError: class extends Error {}, clearCopySession: () => cleanup(),
  onCopySessionClear: (fn) => { cleanup = fn }, markCopyConfirmed: () => { confirmed = true },
  postLocalCopy: async (action, identity, extra, signal) => {
    calls.push({ action, identity, extra, signal })
    if (action === 'status' && statusWait) return statusWait
    if (failure === action) throw new Error('offline')
    if (action === 'abort' || action === 'clear') return { ...view, state: action === 'abort' ? 'cancelled' : 'cleared', purged: true }
    return { ...view, ...(action === 'print' ? { state: 'printing' } : {}) }
  },
  fetchCopyPreview: async () => new Blob(['private']),
  getCopyJob: async () => { calls.push({ action: 'quote' }); return job },
  confirmCopyJob: async (_id, _token, version) => {
    calls.push({ action: 'confirm', version })
    if (quoteChanged) { quoteChanged = false; job = { ...job, quoteVersion: 'b'.repeat(64) }; throw new ApiHttpError('COPY_QUOTE_CHANGED') }
    return { ...job, state: 'confirmed', orderId: 'order-1' }
  },
  cancelCopyJob: async () => {
    calls.push({ action: 'cancel' })
    if (failure === 'cancel') throw new Error('offline')
    return { ...job, state: 'cancelled' }
  },
}
const injected = source('copyDeviceFlow.ts').replace(/^import .* from '([^']+)'$/gm, (line, path) => {
  if (path === './copyPrintModel') return `import { copyFault, copyPrintPhase } from '${printURL}'`
  if (path === './copyPreview') return `import { CopyPreview } from '${previewURL}'`
  if (path === './copyCheckModel') return `import { canConfirmCopy, copyPhaseFromLocal, validCopyJob } from '${modelURL}'`
  // 类型由转译器去掉；运行依赖用受控的真实状态与失败回包代替。
  return line.replace(/import \{(.*?)\} from .*/, (_, names) =>
    `const { ${names.replace(/type \w+,?\s*/g, '')} } = globalThis.__copyTestDeps`)
})
const runtime = await import(compile(injected))
const flush = async () => { for (let n = 0; n < 15; n++) await Promise.resolve() }
async function start(patch = {}) {
  cleanup?.()
  timers.clear()
  calls = []; failure = null; quoteChanged = false; confirmed = false
  job = makeJob(patch)
  view = { state: 'scanning', generation: 1, pageCount: null, errorCode: null }
  const session = { ...job, input: { ...job, requestKey: 'synthetic-request-key' }, controlToken: 'synthetic-secret' }
  const device = runtime.ensureCopyDevice(session)
  await flush()
  return { device, session }
}
async function tick() {
  const timer = [...timers.entries()].find(([, t]) => t.delay === 3000)
  assert.ok(timer, 'poll must be scheduled')
  timers.delete(timer[0]); timer[1].fn()
  await flush()
}
async function check() {
  const result = await start()
  view = { ...view, state: 'scanned', pageCount: 3 }
  await tick()
  assert.equal(runtime.readCopyDevice().phase, 'check')
  return result
}
test('one local start per session; full-page progress, glass continuation and cloud quote drive check', async () => {
  const { device, session } = await start()
  runtime.ensureCopyDevice(session)
  assert.equal(calls.filter((c) => c.action === 'start').length, 1)
  assert.equal(runtime.readCopyDevice().pages, null)
  view = { ...view, state: 'page_ready', pageCount: 1 }
  await tick()
  assert.equal(runtime.readCopyDevice().phase, 'more')
  assert.equal(runtime.readCopyDevice().pages, 1)
  view = { ...view, state: 'starting' }
  await device.command('next-page')
  assert.equal(runtime.readCopyDevice().phase, 'starting')
  view = { ...view, state: 'page_ready', pageCount: 3 }
  await tick()
  view = { ...view, state: 'composing' }
  await device.command('finish')
  assert.equal(runtime.readCopyDevice().phase, 'finishing')
  view = { ...view, state: 'scanned' }
  await tick()
  assert.equal(runtime.readCopyDevice().phase, 'check')
})
test('feeder follows Agent automatic finish without a second conflicting finish request', async () => {
  await start({ source: 'feeder' })
  for (const state of ['page_ready', 'composing', 'scanned']) { view = { ...view, state, pageCount: 3 }; await tick() }
  assert.equal(runtime.readCopyDevice().phase, 'check')
  assert.equal(calls.some((c) => ['next-page', 'finish'].includes(c.action)), false)
})
for (const failed of [null, 'abort', 'cancel']) test(`stop requires both definitive results: ${failed}`, async () => {
  const { device } = await start()
  failure = failed
  await device.stop()
  assert.ok(calls.some((c) => c.action === 'abort'))
  assert.ok(calls.some((c) => c.action === 'cancel'))
  assert.equal(runtime.readCopyDevice().phase, failed ? 'unknown' : 'stopped')
})
test('quote changes reload and require a second explicit confirmation; one local print', async () => {
  const { device } = await check()
  quoteChanged = true
  await device.confirm()
  assert.equal(runtime.readCopyDevice().phase, 'check')
  assert.match(runtime.readCopyDevice().notice, /报价已更新/)
  assert.equal(confirmed, false)
  await device.confirm()
  assert.equal(runtime.readCopyDevice().phase, 'printing')
  assert.equal(confirmed, true)
  assert.deepEqual(calls.filter((c) => c.action === 'confirm').map((c) => c.version), ['a'.repeat(64), 'b'.repeat(64)])
  assert.equal(calls.filter((c) => c.action === 'print').length, 1)
})
test('a delayed pre-confirm status cannot roll confirmed back to scanned', async () => {
  const { device } = await check()
  let release
  statusWait = new Promise((resolve) => { release = resolve })
  try {
    await tick()
    await device.confirm()
    assert.equal(runtime.readCopyDevice().phase, 'printing')
    release({ ...view, state: 'scanned', pageCount: 3 })
    await flush()
    assert.equal(runtime.readCopyDevice().phase, 'printing')
  } finally { statusWait = null }
})
test('clear aborts requests, destroys previews and schedules local deletion without waiting', async () => {
  const { device } = await check()
  const [url] = await device.loadPreview([1])
  const signal = calls.find((c) => c.action === 'start').signal
  cleanup()
  assert.equal(signal.aborted, true)
  assert.equal(runtime.readCopyDeviceFlow(), null)
  assert.ok(calls.some((c) => c.action === 'clear'))
  await assert.rejects(fetch(url))
})
test('expiry immediately invalidates the preview and stops outstanding requests', async () => {
  const { device } = await check()
  const [url] = await device.loadPreview([1])
  const expiry = [...timers.values()].find((t) => t.delay > 3000)
  assert.ok(expiry.delay <= 2_147_483_647, 'browser timeout must not overflow into immediate expiry')
  expiry.fn()
  assert.equal(runtime.readCopyDeviceFlow(), null)
  assert.equal(runtime.readCopyDevice().job, null)
  assert.ok(calls.find((c) => c.action === 'start').signal.aborted)
  assert.ok(calls.some((c) => c.action === 'clear'))
  await assert.rejects(fetch(url))
})
test('rescan cannot proceed on an uncertain purge; no invented generation increment', async () => {
  const { device } = await check()
  failure = 'clear'
  assert.equal(await device.clearForRescan(), false)
  assert.equal(runtime.readCopyDevice().phase, 'unknown')
  assert.ok(calls.filter((c) => c.identity).every((c) => c.identity.generation === 1))
})
test('wrong generation cloud receipt and watchdog stay unknown instead of inventing check', async () => {
  await start()
  job = { ...job, generation: 2 }
  view = { ...view, state: 'scanned', pageCount: 3 }
  await tick()
  assert.equal(runtime.readCopyDevice().phase, 'unknown')
  await start()
  const now = Date.now
  try {
    Date.now = () => now() + 61_000
    for (const timer of timers.values()) if (timer.delay === 1000) timer.fn()
    assert.equal(runtime.readCopyDevice().phase, 'unknown')
  } finally { Date.now = now }
  cleanup()
})
test('local API uses POST bridge headers, JPEG bytes and safe complete-page counts', async () => {
  const localSource = readFileSync(new URL('../../src/services/copy/localCopyApi.ts', import.meta.url), 'utf8')
    .replaceAll('import.meta.env', JSON.stringify({ VITE_TERMINAL_AGENT_BRIDGE_TOKEN: 'synthetic-bridge' }))
  const local = await import(compile(localSource))
  const realFetch = globalThis.fetch
  const requests = []
  const signal = new AbortController()
  let payload = { success: true, data: { state: 'scanning', generation: 1, pageCount: 0, errorCode: null } }
  let mime = 'image/jpeg'
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) })
    return url.endsWith('/preview') ? new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'Content-Type': mime } })
      : new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const identity = { copyId: 'test-copy', generation: 1 }
    assert.equal((await local.postLocalCopy('start', identity, { source: 'flatbed', scanColor: 'color' }, signal.signal)).pageCount, null)
    assert.deepEqual(requests[0].body, { ...identity, source: 'flatbed', scanColor: 'color', operationId: requests[0].body.operationId })
    assert.match(requests[0].body.operationId, /^[\w-]+$/)
    assert.equal(requests[0].init.headers['X-Local-Bridge-Token'], 'synthetic-bridge')
    assert.equal(requests[0].init.headers['X-Copy-Control'], undefined)
    assert.equal(requests[0].init.method, 'POST')
    assert.equal(requests[0].init.cache, 'no-store')
    const blob = await local.fetchCopyPreview(identity, 2, signal.signal)
    assert.equal(blob.type, 'image/jpeg')
    assert.equal(requests.at(-1).body.page, 2)
    assert.equal(requests.at(-1).url, 'http://127.0.0.1:9527/local/copy/preview')
    payload.data.pageCount = 1
    assert.equal((await local.postLocalCopy('status', identity)).pageCount, 1)
    payload.data.generation = 2
    await assert.rejects(local.postLocalCopy('status', identity), /COPY_LOCAL_UNKNOWN/)
    mime = 'text/html'
    await assert.rejects(local.fetchCopyPreview(identity, 1, signal.signal), /COPY_PREVIEW_UNKNOWN/)
    signal.abort()
    await local.fetchCopyPreview(identity, 1, signal.signal).catch(() => {})
    assert.equal(requests.at(-1).init.signal.aborted, true)
  } finally { globalThis.fetch = realFetch }
})
