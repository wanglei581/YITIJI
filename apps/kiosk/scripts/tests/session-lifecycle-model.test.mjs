import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

function loadModule(rel) {
  const source = readFileSync(join(kioskRoot, rel), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(js)}`
  return import(dataUrl)
}

function task(overrides = {}) {
  return {
    id: 't1',
    type: 'print',
    status: 'pending',
    payStatus: 'unpaid',
    fileName: '简历.pdf',
    updatedAt: new Date().toISOString(),
    resume: {
      kind: 'payment',
      orderId: 'o1',
      orderNo: 'PT1',
      amountCents: 200,
      priceLines: [],
      paymentSessionToken: 'tok',
    },
    ...overrides,
  }
}

test('standby empty playlist is the only exit-home phase', async () => {
  const m = await loadModule('src/pages/screensaver/standbyModel.ts')
  assert.equal(m.deriveStandbyPhase({ fetchSettled: false, fetchFailed: false, enabled: true, itemCount: 0, mediaReady: false }), 'loading')
  assert.equal(m.deriveStandbyPhase({ fetchSettled: true, fetchFailed: false, enabled: true, itemCount: 2, mediaReady: true }), 'playing')
  assert.equal(m.deriveStandbyPhase({ fetchSettled: true, fetchFailed: false, enabled: false, itemCount: 0, mediaReady: false }), 'empty')
  assert.equal(m.standbyShouldExitHome('empty'), true)
  assert.equal(m.standbyShouldExitHome('loading'), false)
  assert.equal(m.standbyShouldExitHome('playing'), false)
})

test('login phone states do not invent 已登录', async () => {
  const m = await loadModule('src/pages/auth/loginGateModel.ts')
  assert.equal(m.derivePhoneGateState({ sendingCode: true, submitting: false, countdown: 0, notice: null, error: null }), 'phone-sending')
  assert.equal(m.derivePhoneGateState({ sendingCode: false, submitting: true, countdown: 0, notice: null, error: null }), 'phone-verifying')
  assert.equal(m.derivePhoneGateState({ sendingCode: false, submitting: false, countdown: 60, notice: 'ok', error: null }), 'phone-code-sent')
  assert.equal(m.derivePhoneGateState({ sendingCode: false, submitting: false, countdown: 0, notice: null, error: '短信发送失败,请稍后再试' }), 'phone-send-failed')
  assert.equal(m.derivePhoneGateState({ sendingCode: false, submitting: false, countdown: 0, notice: null, error: '验证码发送过于频繁,请 60 秒后再试' }), 'phone-send-limited')
  assert.equal(m.derivePhoneGateState({ sendingCode: false, submitting: false, countdown: 0, notice: null, error: '验证码不正确' }), 'phone-code-invalid')
  assert.equal(m.derivePhoneGateState({ sendingCode: false, submitting: false, countdown: 0, notice: null, error: '验证码尝试次数过多,请重新获取' }), 'phone-code-expired')
  const allCopy = Object.values(m.LOGIN_GATE_COPY).map((row) => `${row.title}${row.sub}`).join('')
  assert.equal(allCopy.includes('已登录'), false)
})

test('login returnTo rejects unsafe query and does not echo it', async () => {
  const m = await loadModule('src/pages/auth/loginGateModel.ts')
  const isSafe = (p) => p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') && p !== '/login'
  assert.deepEqual(m.resolveLoginReturnTo('/print-scan', null, isSafe), { returnTo: '/print-scan', fromRejected: false })
  assert.deepEqual(m.resolveLoginReturnTo(undefined, 'https://evil.example', isSafe), { returnTo: '/', fromRejected: true })
  assert.deepEqual(m.resolveLoginReturnTo(undefined, '//evil', isSafe), { returnTo: '/', fromRejected: true })
})

test('session guard fail-closed has no continue', async () => {
  const m = await loadModule('src/pages/session-guard/sessionGuardModel.ts')
  assert.equal(m.deriveSessionGuardState({ clearing: false, canContinue: true }), 'warning')
  assert.equal(m.deriveSessionGuardState({ clearing: false, canContinue: false }), 'warning-no-continue')
  assert.equal(m.deriveSessionGuardState({ clearing: true, canContinue: true }), 'clearing')
  assert.equal(m.remainingSeconds(Date.now() + 1500, Date.now()), 2)
  assert.equal(m.remainingSeconds(Date.now() - 10, Date.now()), 0)
})

test('resume verdict fail-closes unpaid claimed/printing and never says 已支付 for legacy', async () => {
  const m = await loadModule('src/pages/session-resume/sessionResumeModel.ts')
  const payment = m.resumeVerdict(task())
  assert.equal(payment.ok, true)
  assert.equal(payment.dest, 'payment')

  const missingToken = m.resumeVerdict(task({ resume: { ...task().resume, paymentSessionToken: '' } }))
  assert.equal(missingToken.ok, false)

  const claimedUnpaid = m.resumeVerdict(task({ status: 'claimed', payStatus: 'unpaid', resume: { kind: 'print-progress' } }))
  assert.equal(claimedUnpaid.ok, false)

  const legacy = task({ payStatus: null, resume: { kind: 'print-progress' } })
  const legacyVerdict = m.resumeVerdict(legacy)
  assert.equal(legacyVerdict.ok, true)
  assert.equal(legacyVerdict.dest, 'print-progress')
  assert.equal(legacyVerdict.legacy, true)
  assert.equal(m.resumeRowCopy(legacy).sub.includes('已支付'), false)

  assert.equal(m.deriveResumeScreen({ authReady: true, isLoggedIn: true, loading: false, error: true, taskCount: 0 }), 'unavailable')
  assert.equal(m.deriveResumeScreen({ authReady: true, isLoggedIn: true, loading: false, error: false, taskCount: 0 }), 'empty')
})
