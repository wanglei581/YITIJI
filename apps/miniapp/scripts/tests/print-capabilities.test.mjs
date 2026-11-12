// Execute the real pages with controlled network timing; no device or production acceptance implied.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'
const require = createRequire(import.meta.url)
const params = require('../../utils/print-params.js')
const idem = require('../../utils/print-order-idempotency.js')
const advanced = { copies: 2, colorMode: 'color', duplex: 'duplex_long_edge' }
const caps = (enabled = true) => ({ capabilities: ['color_print', 'duplex_print'].map(capabilityKey => ({ capabilityKey, status: 'available', configured: enabled })) })
const quote = amountCents => ({ amountCents, billablePages: 2 })
const event = (key, mode) => ({ currentTarget: { dataset: { key, mode } } })
const select = (page, id) => page.pick({ currentTarget: { dataset: { id } } })
const serial = value => JSON.parse(JSON.stringify(value))
function ui() {
  const calls = { nav: [], redirect: [], toast: [] }
  return { calls, wx: { navigateTo: x => calls.nav.push(x.url), redirectTo: x => { calls.redirect.push(x.url); x.success?.() }, showToast: x => calls.toast.push(x), showModal() {}, showLoading() {}, hideLoading() {}, navigateBack() {}, switchTab() {} } }
}
function store(api, opts = {}) {
  const u = ui()
  const page = instantiate(loadPageDefinition('pages/print-store/print-store.js', { wx: u.wx, modules: { api } }))
  page.onLoad({ fileId: 'owned-file', copies: '2', ...opts }); page.onShow()
  return { page, ...u }
}
function storeApi(overrides = {}) {
  return { getPublicTerminals: () => Promise.resolve([{ id: 'A', displayName: 'A', isOnline: true }, { id: 'B', displayName: 'B', isOnline: true }]), getTerminalCapabilities: () => Promise.resolve(caps()), quoteMyPrintOrder: () => Promise.resolve(quote(120)), ...overrides }
}
function pay(api, opts) {
  const u = ui()
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'A' }), canSilentResignin: () => false, sessionGeneration: () => 0, isSameSession: value => value === 0 }
  const idemPort = { ...idem, findRecord: () => null, ensureKey: () => Promise.resolve({ key: 'one-stable-key' }), markSubmitted: () => true, rememberOrderId: () => ({ orderId: 'new-order' }), clearRecord: () => true }
  const page = instantiate(loadPageDefinition('pages/print-pay/print-pay.js', { wx: u.wx, modules: { api: { getMyDocuments: () => Promise.resolve({ items: [] }), ...api }, auth, 'print-order-idempotency': idemPort } }))
  page.onLoad(opts)
  return { page, ...u }
}

test('capability flags require boolean true, unique rows and available status', () => {
  for (const configured of [undefined, null, false, 'false', 'true', 1]) {
    const raw = caps(); raw.capabilities.forEach(row => { row.configured = configured })
    assert.deepEqual(params.allowedCapabilities(raw), { color: false, duplex: false })
    assert.ok(params.capabilityError(raw, advanced))
  }
  assert.deepEqual(params.allowedCapabilities(caps()), { color: true, duplex: true })
  const duplicate = caps(); duplicate.capabilities.push({ ...duplicate.capabilities[0] })
  assert.equal(params.allowedCapabilities(duplicate).color, false)
  for (const status of ['not_verified', 'disabled', undefined]) {
    const raw = caps(); raw.capabilities.forEach(row => { row.status = status })
    assert.ok(params.capabilityError(raw, advanced))
  }
  assert.ok(params.capabilityError(null, advanced))
  assert.equal(params.capabilityError(null, {}), '')
})

test('parameter canonicalization rejects unknown values and unopened short edge', () => {
  assert.deepEqual(params.normalize({ ...advanced, copies: '2' }), advanced)
  for (const copies of ['', '02', 0, 1.5, 100, 'garbage']) assert.throws(() => params.normalize({ copies }))
  for (const invalid of [{ colorMode: 'rgb' }, { duplex: 'duplex' }, { duplex: 'duplex_short_edge' }]) assert.throws(() => params.normalize(invalid))
  assert.equal(params.quoteParams(advanced).scale, 'fit')
  assert.equal(params.quoteParams(advanced).duplex, 'duplex_long_edge')
  assert.notEqual(idem.fingerprintOf({ fileId: 'f', terminalId: 't', ...advanced }), idem.fingerprintOf({ fileId: 'f', terminalId: 't', ...advanced, duplex: 'simplex' }))
})

test('slow terminal A capability cannot overwrite selected B', async () => {
  const a = deferred(); const b = deferred(); const seen = []
  const { page } = store(storeApi({ getTerminalCapabilities: id => (id === 'A' ? a : b).promise, quoteMyPrintOrder: (...args) => { seen.push(args); return Promise.resolve(quote(50)) } }))
  await flush(); select(page, 'A'); select(page, 'B'); b.resolve(caps(false)); await flush()
  a.resolve(caps()); await flush()
  assert.equal(page.data.picked, 'B'); assert.equal(page.data.capColor, false)
  assert.equal(seen.length, 1); assert.equal(seen[0][3].terminalId, 'B'); assert.equal(page.data.amountCents, 50)
})

test('slow terminal A quote cannot overwrite B, and parameter changes withdraw amount', async () => {
  const pending = []
  const { page } = store(storeApi({ quoteMyPrintOrder: (...args) => { const d = deferred(); pending.push({ d, args }); return d.promise } }))
  await flush(); select(page, 'A'); await flush(); select(page, 'B'); await flush()
  pending[1].d.resolve(quote(80)); await flush(); pending[0].d.resolve(quote(999)); await flush()
  assert.equal(page.data.amountCents, 80)
  page.setParam(event('colorMode', 'color'))
  assert.equal(page.data.quoteReady, false); assert.equal(page.data.amountCents, null)
  page.setParam(event('duplex', 'duplex_long_edge'))
  pending[2].d.resolve(quote(999)); await flush(); assert.equal(page.data.quoteReady, false)
  pending[3].d.resolve(quote(130)); await flush()
  assert.equal(page.data.amountCents, 130); assert.equal(page.data.duplex, 'duplex_long_edge')
})

test('hide discards outstanding capabilities and quotes; show refetches', async () => {
  const capabilities = []; const prices = []
  const { page } = store(storeApi({ getTerminalCapabilities: () => { const d = deferred(); capabilities.push(d); return d.promise }, quoteMyPrintOrder: () => { const d = deferred(); prices.push(d); return d.promise } }))
  await flush(); select(page, 'A'); page.onHide(); capabilities[0].resolve(caps()); await flush()
  assert.equal(prices.length, 0); assert.equal(page.data.quoteReady, false)
  page.onShow(); await flush(); capabilities[1].resolve(caps()); await flush()
  assert.equal(prices.length, 1); page.onHide(); prices[0].resolve(quote(777)); await flush()
  assert.equal(page.data.amountCents, null); assert.equal(page.data.quoteReady, false)
  page.onShow(); await flush(); capabilities[2].resolve(caps()); await flush(); prices[1].resolve(quote(90)); await flush()
  assert.equal(page.data.amountCents, 90); assert.equal(page.data.canConfirm, true)
})

test('switching to a terminal without capability preserves advanced intent and blocks navigation', async () => {
  const seen = []
  const { page, calls } = store(storeApi({ getTerminalCapabilities: id => Promise.resolve(caps(id === 'A')), quoteMyPrintOrder: (...args) => { seen.push(args); return Promise.resolve(quote(150)) } }))
  await flush(); select(page, 'A'); await flush(); page.setParam(event('colorMode', 'color')); page.setParam(event('duplex', 'duplex_long_edge')); await flush()
  const before = seen.length; select(page, 'B'); await flush(); page.toPay()
  assert.equal(page.data.colorMode, 'color'); assert.equal(page.data.duplex, 'duplex_long_edge')
  assert.equal(page.data.quoteReady, false); assert.equal(seen.length, before); assert.equal(calls.nav.length, 0)
  page.setParam(event('colorMode', 'black_white')); page.setParam(event('duplex', 'simplex')); await flush(); page.toPay()
  assert.equal(calls.nav.length, 1); assert.match(calls.nav[0], /colorMode=black_white&duplex=simplex/)
})

test('baseline survives capability read failure but still requires valid server quote', async () => {
  for (const response of [quote(0), { amountCents: 0 }, { amountCents: '0', billablePages: 2 }, { amountCents: 0, billablePages: 0 }]) {
    const { page } = store(storeApi({ getTerminalCapabilities: () => Promise.reject(new Error('offline')), quoteMyPrintOrder: () => Promise.resolve(response) }))
    await flush(); select(page, 'A'); await flush()
    assert.equal(page.data.capState, 'fail'); assert.equal(page.data.capColor, false)
    assert.equal(page.data.quoteReady, Number.isSafeInteger(response.amountCents) && response.billablePages > 0)
  }
})

test('offline terminal and invalid URL parameters never quote or navigate', async () => {
  let requests = 0
  const api = storeApi({ getPublicTerminals: () => Promise.resolve([{ id: 'A', isOnline: false }]), quoteMyPrintOrder: () => { requests++; return Promise.resolve(quote(0)) } })
  const offline = store(api); await flush(); offline.page.toPay(); assert.equal(requests, 0); assert.equal(offline.calls.nav.length, 0)
  for (const invalid of [{ copies: '0' }, { colorMode: 'rgb' }, { duplex: 'duplex_short_edge' }]) {
    const s = store(api, invalid); await flush(); s.page.toPay(); s.page.reload(); assert.equal(s.calls.nav.length, 0)
  }
  assert.equal(requests, 0)
})

test('store URL to pay quote to create uses the same canonical intent and double click submits once', async () => {
  const { page, calls } = store(storeApi())
  await flush(); select(page, 'A'); await flush(); page.setParam(event('colorMode', 'color')); page.setParam(event('duplex', 'duplex_long_edge')); await flush(); page.toPay(); page.toPay()
  assert.equal(calls.nav.length, 1)
  const url = new URL(calls.nav[0], 'https://test.invalid'); const opts = Object.fromEntries(url.searchParams)
  const quotes = []; const creates = []; const created = deferred()
  const p = pay({ getTerminalCapabilities: () => Promise.resolve(caps()), quoteMyPrintOrder: (...args) => { quotes.push(args); return Promise.resolve(quote(140)) }, createCloudPrintOrder: (...args) => { creates.push(args); return created.promise } }, opts)
  await flush(); assert.equal(p.page.data.quoteState, 'ready')
  assert.equal(p.page.data.duplexLabel, '双面（长边翻页）'); p.page.continueFlow(); p.page.continueFlow(); await flush()
  assert.equal(creates.length, 1)
  assert.deepEqual(serial(creates[0][0]), { fileId: 'owned-file', terminalId: 'A', ...advanced })
  assert.deepEqual(serial(quotes[0][1]), params.quoteParams(advanced)); assert.equal(quotes[0][3].terminalId, 'A')
  assert.equal(creates[0][1].quotedAmountCents, 140); assert.equal(creates[0][1].idempotencyKey, 'one-stable-key')
  created.resolve({ id: 'new-order', amountCents: 140 }); await flush(); p.page.continueFlow(); await flush(); assert.equal(creates.length, 1)
})

test('pay rechecks revoked capability and invalid deep links cannot submit', async () => {
  let quotes = 0; let creates = 0
  const api = { getTerminalCapabilities: () => Promise.resolve(caps(false)), quoteMyPrintOrder: () => { quotes++; return Promise.resolve(quote(0)) }, createCloudPrintOrder: () => { creates++; return Promise.resolve({ id: 'bad' }) } }
  for (const intent of [advanced, { colorMode: 'rgb' }, { duplex: 'duplex_short_edge' }, { copies: '0' }]) {
    const p = pay(api, { fileId: 'owned-file', storeId: 'A', ...intent }); await flush(); p.page.continueFlow(); await flush()
    assert.equal(p.page.data.quoteState, 'error'); assert.equal(p.calls.redirect.length, 0)
  }
  assert.equal(quotes, 0); assert.equal(creates, 0)
})
