import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const base = new URL('../../src/pages/scan/', import.meta.url)
async function load(name, dependencies = '') {
  const source = readFileSync(new URL(name, base), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(dependencies + js.replace(/^import .* from .*;\n/gm, '')).toString('base64')}`)
}
const stop = await load('scanDeviceStopState.ts')
const copy = await load('scanDeviceErrorCopy.ts')
const state = await load('scanDeviceState.ts')
const pending = () => ({ scanTaskId: 'same', abort: 'pending', cancel: 'pending', purged: false, countdownEndsAt: null })
const abort = (purged) => ({ ok: true, state: 'aborted', purged, pageCount: 0, errorCode: null })
const cancel = (fields = {}) => ({ scanTaskId: 'same', status: 'cancelled', ...fields })

test('all five mapped faults and unknown codes have separate outcomes', () => {
  const cases = { feeder_empty: 'nopaper', paper_jam: 'jam', cover_open: 'jam', busy: 'busy', not_found: 'noresp', error: 'noresp', not_ready: 'noresp', timeout: 'timeout' }
  for (const [code, expected] of Object.entries(cases)) assert.equal(state.deviceFault(code), expected)
  for (const code of ['LOCAL_SCAN_INTERNAL_ERROR', 'warming_up', 'too_large', 'unknown', 'future']) assert.equal(state.deviceFault(code), null)
})

test('noresp has no unproved alert and device timeout never claims three minutes', () => {
  assert.doesNotMatch(JSON.stringify(copy.DEVICE_ERROR_COPY.noresp), /已经收到提醒|会尽快处理/)
  assert.doesNotMatch(JSON.stringify(copy.DEVICE_ERROR_COPY.timeout), /3 分钟|三分钟/)
  assert.equal(copy.DEVICE_ERROR_COPY.timeout.reason, '这次没有扫出文件。')
  const view = readFileSync(new URL('ScanDeviceErrorPage.tsx', base), 'utf8')
  assert.doesNotMatch(view, /已经收到提醒|会尽快处理|machineCannotPrintLine/)
  for (const code of ['warming_up', 'too_large']) {
    const screen = state.selectDeviceScreen({ status: { status: 'waiting', deviceState: 'error', deviceErrorCode: code }, startConfirmed: true, localUncertain: null })
    assert.equal(screen.kind, 'terminal', 'K1b-2 faults outside the five screens keep their prior outcome')
  }
})

test('purged must be strictly true, including missing, false and truthy impostors', () => {
  assert.equal(stop.abortedReceipt(pending(), abort(true)).purged, true)
  for (const value of [false, null, undefined, 1, 'true']) assert.equal(stop.abortedReceipt(pending(), abort(value)).purged, false)
  assert.equal(stop.abortedReceipt(pending(), { ...abort(true), state: 'delivering' }).purged, false)
  assert.equal(stop.abortedReceipt(pending(), { ok: false, kind: 'not-active' }).abort, 'unknown')
})

test('only both server timestamps allow digits; malformed and old responses have none', () => {
  for (const raw of [null, {}, cancel(), cancel({ serverNow: '2026-11-04T00:00:00Z' }), cancel({ serverNow: 'bad', quietPeriodEndsAt: '2026-11-04T00:01:30Z' })]) {
    const receipt = stop.cancelledReceipt(pending(), raw, 100000)
    assert.equal(receipt.countdownEndsAt, null)
    assert.equal(stop.remainingQuietSeconds(receipt, 110000), null)
  }
  assert.equal(stop.cancelledReceipt(pending(), { status: 'cancelled', scanTaskId: 'other' }, 1).cancel, 'unknown')
})

test('server-relative deadline is saved and reload never restarts its interval', () => {
  const receipt = stop.cancelledReceipt(pending(), cancel({ serverNow: '2026-11-04T00:00:00Z', quietPeriodEndsAt: '2026-11-04T00:01:30Z' }), 100000)
  assert.equal(stop.remainingQuietSeconds(receipt, 100000), 90)
  const memory = new Map()
  globalThis.window = { sessionStorage: { setItem: (k, v) => memory.set(k, v), getItem: (k) => memory.get(k), removeItem: (k) => memory.delete(k) } }
  stop.saveDeviceStopReceipt(receipt)
  assert.equal(stop.remainingQuietSeconds(stop.readDeviceStopReceipt('same'), 125001), 65)
  assert.equal(stop.remainingQuietSeconds(stop.readDeviceStopReceipt('same'), 200000), 0)
  assert.equal(stop.readDeviceStopReceipt('new'), null)
  assert.equal(memory.size, 0)
})

for (const fail of ['abort', 'cancel']) {
  test(`${fail} failure still executes and records the other side and stays unknown`, async () => {
    const calls = [], records = []
    const receipt = await stop.settleDeviceStop({
      scanTaskId: 'same',
      abort: async () => { calls.push('abort'); if (fail === 'abort') throw Error(); return abort(true) },
      cancel: async () => { calls.push('cancel'); if (fail === 'cancel') throw Error(); return cancel() },
      onReceipt: (r) => records.push(r),
    })
    assert.deepEqual(calls.sort(), ['abort', 'cancel'])
    assert.equal(stop.stopConfirmed(receipt), false)
    assert.equal(receipt[fail], 'unknown')
    assert.equal(receipt[fail === 'abort' ? 'cancel' : 'abort'], 'confirmed')
    assert.equal(records.length, 3)
  })
}

test('a hung side times out independently and cannot claim stopped', async () => {
  const result = await stop.settleDeviceStop({ scanTaskId: 'same', abort: () => new Promise(() => {}), cancel: async () => cancel(), onReceipt: () => {}, timeoutMs: 5 })
  assert.equal(result.abort, 'unknown')
  assert.equal(result.cancel, 'confirmed')
  assert.equal(stop.stopConfirmed(result), false)
})

test('uncertain stop wins over cancellation, device error and completed cloud state', () => {
  for (const status of ['waiting', 'cancelled', 'completed']) {
    assert.equal(state.selectDeviceScreen({ status: { status, deviceState: 'error', deviceErrorCode: 'busy' }, startConfirmed: true, localUncertain: 'unknown', uncertainCommand: 'stop' }).kind, 'unknown')
  }
})

function recoveryHarness() {
  const h = { calls: [], generation: 0, session: { deviceAcked: true, deviceFlow: true, stage: 'progress', deviceChoice: { source: 'feeder', colorMode: 'gray' }, live: { scanTaskId: 'same', controlToken: 'control', instructions: ['old'], expiresAt: '2099-01-01' } } }
  h.update = async (...args) => { h.calls.push(['settings', ...args]); return { scanTaskId: 'same', startMode: 'device', deviceState: 'ready', source: 'flatbed', colorMode: 'gray', expiresAt: '2099-01-02' } }
  h.panel = async (...args) => { h.calls.push(['panel', ...args]); return { scanTaskId: 'same', startMode: 'panel', instructions: ['真实面板步骤'], expiresAt: '2099-01-02' } }
  h.status = async () => { h.calls.push(['GET']); return { status: 'waiting', deviceState: 'scanning' } }
  h.local = async (...args) => { h.calls.push(['local', ...args]); return { ok: true, state: 'scanning' } }
  globalThis.__recovery = h
  return h
}
let moduleId = 0
async function recoveryModule() {
  return load('scanDeviceRecovery.ts', `
    const h = globalThis.__recovery; // ${moduleId++}
    class ApiHttpError extends Error { constructor(status) { super(); this.status = status } }
    h.conflict = () => new ApiHttpError(409);
    const getScanSessionStatus = (...a) => h.status(...a), switchScanSessionToPanel = (...a) => h.panel(...a), updateScanDeviceSettings = (...a) => h.update(...a), postLocalScanCommand = (...a) => h.local(...a);
    const bumpScanDeviceEpoch = () => {}, readScanWorkbenchSession = () => h.session, scanLifecycleGeneration = () => h.generation;
    const patchScanWorkbenchSession = (p) => Object.assign(h.session, p);
  `)
}

test('glass and panel reuse live and ACK without creating or cancelling', async () => {
  const h = recoveryHarness(), mod = await recoveryModule()
  await mod.recoverDeviceSession({ action: 'retry', settings: { source: 'flatbed' }, token: null, onGoStage: () => {} })
  assert.deepEqual(h.calls[0], ['settings', 'same', 'control', { source: 'flatbed' }, null])
  assert.deepEqual(h.calls[1], ['local', 'start', 'same'])
  assert.equal(h.session.deviceAcked, true)
  await mod.recoverDeviceSession({ action: 'panel', token: null, onGoStage: () => {} })
  assert.equal(h.session.live.scanTaskId, 'same')
  assert.deepEqual(h.session.live.instructions, ['真实面板步骤'])
  assert.equal(h.session.stage, 'settings')
  assert.equal(h.session.deviceFlow, undefined)
})

test('409 rereads first, leaves device mode intact and never starts', async () => {
  const h = recoveryHarness(), mod = await recoveryModule()
  h.panel = async () => { h.calls.push(['panel']); throw h.conflict() }
  let observed
  await mod.recoverDeviceSession({ action: 'panel', token: null, onGoStage: () => {}, onStatus: (s) => { observed = s } })
  assert.deepEqual(h.calls, [['panel'], ['GET']])
  assert.equal(h.session.deviceFlow, true)
  assert.deepEqual(h.session.live.instructions, ['old'])
  assert.equal(observed.deviceState, 'scanning')
})

test('leaving during a switch cannot write into the next lifecycle', async () => {
  const h = recoveryHarness(), mod = await recoveryModule()
  const normal = h.panel
  h.panel = async (...args) => { h.generation++; return normal(...args) }
  await mod.recoverDeviceSession({ action: 'panel', token: null, onGoStage: () => { assert.fail('stale navigation') } })
  assert.equal(h.session.deviceFlow, true)
  assert.deepEqual(h.session.live.instructions, ['old'])
})
