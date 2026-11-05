import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

const root = new URL('../../', import.meta.url)
const base = new URL('src/pages/copy/', root)
const source = readFileSync(new URL('copySession.ts', base), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const state = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const receipt = (patch = {}) => ({ copyId: 'copy-1', terminalId: 'KSK-001', state: 'ready', generation: 1,
  authorizationVersion: 1, expiresAt: '2099-01-01T00:00:00Z', controlToken: 'secret-copy-control', ...patch })

test('copies clamp 1–99 for each step, including overshoot near either boundary', () => {
  assert.equal(state.COPY_MAX_COPIES, 99)
  for (let n = 1; n <= 99; n++) for (const delta of [-10, -1, 1, 10]) {
    assert.equal(state.stepCopyCount(n, delta), Math.min(99, Math.max(1, n + delta)))
  }
  assert.equal(state.stepCopyCount(100, 0), 99)
  assert.equal(state.stepCopyCount(0, 0), 1)
})
test('all 16 capability combinations require both screen switches, color and duplex separately', () => {
  const keys = ['copy', 'scan_device', 'color_print', 'duplex_print']
  for (let mask = 0; mask < 16; mask++) {
    const rows = Object.fromEntries(keys.filter((_, i) => mask & (1 << i)).map((k) => [k, { status: 'available' }]))
    const options = state.copyOptions(rows)
    assert.deepEqual(options, { screen: (mask & 3) === 3, color: Boolean(mask & 4), duplex: Boolean(mask & 8) })
    const settings = state.allowedCopySettings({ source: 'feeder', copies: 2, colorMode: 'color', duplex: 'duplex_long_edge' }, options)
    assert.equal(settings.colorMode, options.color ? 'color' : 'black_white')
    assert.equal(settings.duplex, options.duplex ? 'duplex_long_edge' : 'simplex')
  }
  for (const status of ['testing', 'maintenance', 'unsupported', 'not_verified', 'other']) {
    assert.equal(state.copyOptions({ copy: { status }, scan_device: { status: 'available' } }).screen, false)
    assert.equal(state.copyOptions({ copy: { status: 'available' }, scan_device: { status } }).screen, false)
  }
})
test('double start has one requestKey; uncertain retries freeze the exact input; success locks creation', () => {
  state.clearCopySession()
  state.pickCopySettings({ source: 'feeder', copies: 4, colorMode: 'color', duplex: 'duplex_long_edge' })
  const first = state.beginCopyAttempt('KSK-001')
  assert.match(first.input.requestKey, /^[\w-]{16,128}$/)
  assert.equal(state.beginCopyAttempt('KSK-001'), null)
  state.rejectCopyAttempt(first.epoch, 'unknown')
  state.pickCopySettings({ ...first.input, copies: 99 })
  const retry = state.beginCopyAttempt('KSK-001')
  assert.deepEqual(retry.input, first.input)
  assert.equal(state.acceptCopyReceipt(retry.epoch, receipt({ fileUrl: '/must-not-keep', localPath: 'must-not-keep' })), true)
  assert.equal(state.readCopySession().controlToken, 'secret-copy-control')
  assert.equal(JSON.stringify(state.readCopySession()).includes('must-not-keep'), false)
  assert.equal(state.beginCopyAttempt('KSK-001'), null)
})
test('missing one-time token never fabricates recovery or makes another job', () => {
  state.clearCopySession()
  const attempt = state.beginCopyAttempt('KSK-001')
  assert.equal(state.acceptCopyReceipt(attempt.epoch, receipt({ controlToken: undefined })), false)
  assert.equal(state.readCopySnapshot().phase, 'unknown')
  assert.equal(state.readCopySession().controlToken, null)
  assert.equal(state.beginCopyAttempt('KSK-001'), null)
})
test('clear drops credentials, aborts requests and rejects delayed success and delayed errors', () => {
  state.clearCopySession()
  const attempt = state.beginCopyAttempt('KSK-001')
  assert.equal(state.hasCopySession(), true)
  state.clearCopySession()
  assert.equal(attempt.signal.aborted, true)
  assert.equal(state.acceptCopyReceipt(attempt.epoch, receipt()), false)
  state.rejectCopyAttempt(attempt.epoch, 'denied')
  assert.equal(state.readCopySession(), null)
  assert.equal(state.readCopySnapshot().phase, 'idle')
  assert.equal(state.hasCopySession(), false)
  assert.equal(JSON.stringify(state.readCopySnapshot()).includes('secret-copy-control'), false)
})
test('limits are definitive rejection; wrong terminal / expired receipts stay uncertain', () => {
  state.clearCopySession()
  const first = state.beginCopyAttempt('KSK-001')
  state.rejectCopyAttempt(first.epoch, 'limit')
  assert.equal(state.readCopySnapshot().attempt, null)
  const second = state.beginCopyAttempt('KSK-001')
  assert.notEqual(first.input.requestKey, second.input.requestKey)
  assert.equal(state.acceptCopyReceipt(second.epoch, receipt({ terminalId: 'other' })), false)
  assert.equal(state.readCopySession(), null)
  assert.equal(state.acceptCopyReceipt(second.epoch, receipt({ expiresAt: '2000-01-01' })), false)
  state.clearCopySession()
})
test('all copy modules prohibit persistent browser storage, logs and direct hardware endpoints', () => {
  const files = readdirSync(base).filter((name) => /\.(tsx?|css)$/.test(name)).map((name) => new URL(name, base))
  files.push(new URL('src/services/api/copyJobs.ts', root))
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /\b(?:sessionStorage|localStorage|indexedDB)\b/, `${file.pathname}: control/session must remain in memory`)
    assert.doesNotMatch(text, /console\.(?:log|info|debug)|\/local\/copy\/|postLocalScanCommand/, file.pathname)
  }
  const cleanup = readFileSync(new URL('src/auth/kioskSensitiveSession.ts', root), 'utf8')
  assert.match(cleanup, /function clearKioskSensitiveSession[^]*?clearCopySession\(\)/)
  assert.match(cleanup, /function hasKioskSensitiveSession[^]*?hasCopySession\(\)/)
  const lifecycle = readFileSync(new URL('useCopyFlow.ts', base), 'utf8')
  assert.match(lifecycle, /180_000/)
  assert.match(lifecycle, /return \(\) => \{[^]*?clearCopySession\(\)/)
})
