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
  // 错、过期、锁定三种下一步不同（W4 L1，2026-09-28）：锁定单列 phone-code-locked，不再并进过期。
  assert.equal(m.derivePhoneGateState({ sendingCode: false, submitting: false, countdown: 0, notice: null, error: '验证码尝试次数过多,请重新获取' }), 'phone-code-locked')
  assert.equal(m.derivePhoneGateState({ sendingCode: false, submitting: false, countdown: 0, notice: null, error: '验证码已过期,请重新获取' }), 'phone-code-expired')
  const allCopy = Object.values(m.LOGIN_GATE_COPY).map((row) => `${row.title}${row.sub}`).join('')
  assert.equal(allCopy.includes('已登录'), false)
})

test('login: this machine cannot send SMS today → its own state that leads to QR login', async () => {
  const m = await loadModule('src/pages/auth/loginGateModel.ts')
  const base = { sendingCode: false, submitting: false, countdown: 0, notice: null, error: '请明天再试' }
  for (const errorCode of ['SMS_TERMINAL_DAILY_LIMIT', 'SMS_DAILY_TOTAL_LIMIT', 'SMS_BUDGET_UNAVAILABLE', 'TERMINAL_SESSION_INVALID']) {
    assert.equal(m.derivePhoneGateState({ ...base, errorCode }), 'phone-sms-unavailable', errorCode)
  }
  // 限的是这个号码：换号 / 等冷却能过，仍是 send-limited（主按钮「再试一次发码」）。
  assert.equal(m.derivePhoneGateState({ ...base, errorCode: 'SMS_DAILY_LIMIT' }), 'phone-send-limited')
  assert.ok(m.LOGIN_PHONE_STATES.includes('phone-sms-unavailable'))
  assert.match(m.LOGIN_GATE_COPY['phone-sms-unavailable'].sub, /扫码登录/)
})

test('W-15 canceling a QR fetch releases the lock so the next attempt can start', async () => {
  const m = await loadModule('src/pages/auth/loginGateModel.ts')
  const started = m.beginQrFetch({ refreshing: false, generation: 0 }, true)
  assert.ok(started)
  assert.equal(started.guard.refreshing, true)
  // 只加代数、不放开锁：下一次取码直接放弃，页面停在「正在获取二维码」。
  assert.equal(m.beginQrFetch({ refreshing: true, generation: started.guard.generation + 1 }, true), null)
  const cancelled = m.cancelQrFetch(started.guard)
  assert.equal(cancelled.refreshing, false)
  assert.equal(cancelled.generation, started.guard.generation + 1)
  const again = m.beginQrFetch(cancelled, true)
  assert.ok(again)
  assert.equal(again.guard.refreshing, true)
  // 被取消的那次结束时，不能清掉后一次的锁。
  assert.equal(m.finishQrFetch(again.guard, started.generation).refreshing, true)
  assert.equal(m.finishQrFetch(again.guard, again.generation).refreshing, false)
  assert.equal(m.beginQrFetch({ refreshing: false, generation: 0 }, false), null)

  const panel = readFileSync(join(kioskRoot, 'src/pages/auth/ScanQrLoginPanel.tsx'), 'utf8')
  const cleanupAt = panel.indexOf('useEffect(() => () => {')
  const refreshAt = panel.indexOf('const refresh = useCallback')
  const cleanup = panel.slice(cleanupAt, refreshAt)
  assert.match(cleanup, /cancelQrFetch\(/)
  assert.match(cleanup, /refreshingRef\.current = cancelled\.refreshing/)
  assert.doesNotMatch(cleanup, /requestGeneration\.current \+= 1/)
})

test('W-19 machine quota, site quota, and this number do not share one sentence', async () => {
  const m = await loadModule('src/pages/auth/loginGateModel.ts')
  const terminal = m.smsUnavailableCopy('SMS_TERMINAL_DAILY_LIMIT')
  const total = m.smsUnavailableCopy('SMS_DAILY_TOTAL_LIMIT')
  const budget = m.smsUnavailableCopy('SMS_BUDGET_UNAVAILABLE')
  const session = m.smsUnavailableCopy('TERMINAL_SESSION_INVALID')
  assert.match(terminal.title, /这台机器今天的短信已经发完/)
  assert.match(terminal.sub, /扫码登录/)
  assert.match(total.title, /今天的短信验证码已经发完/)
  assert.doesNotMatch(`${total.title}${total.sub}`, /这台机器/)
  assert.match(total.sub, /不登录/)
  assert.match(`${budget.title}${budget.sub}`, /扫码登录/)
  assert.match(`${session.title}${session.sub}`, /扫码登录/)
  assert.equal(m.phoneSendSideLabel({ state: 'phone-sms-unavailable', errorCode: 'SMS_TERMINAL_DAILY_LIMIT', countdown: 42, loading: false }), '暂时不能发')
  assert.equal(m.phoneSendSideLabel({ state: 'phone-sms-unavailable', errorCode: 'SMS_DAILY_TOTAL_LIMIT', countdown: 0, loading: false }), '暂时不能发')
  assert.equal(m.phoneSendSideLabel({ state: 'phone-send-limited', errorCode: 'SMS_DAILY_LIMIT', countdown: 30, loading: false }), '今天不能再发')
  assert.equal(m.phoneSendSideLabel({ state: 'phone-idle', errorCode: null, countdown: 0, loading: false }), '获取验证码')
  assert.equal(m.sendLimitedPrimaryLabel(15), '15 秒后再获取')
  assert.equal(m.sendLimitedPrimaryLabel(0), '重新获取验证码')
  assert.equal(m.isPhoneDailySmsCode('SMS_PROVIDER_PHONE_DAILY_LIMIT'), true)
  assert.equal(m.isPhoneDailySmsCode('SMS_TERMINAL_DAILY_LIMIT'), false)
  assert.equal(m.derivePhoneGateState({ sendingCode: false, submitting: false, countdown: 0, notice: null, error: '请明天再试', errorCode: 'SMS_DAILY_LIMIT' }), 'phone-send-limited')
})

test('W-54 full number stays on the phone keypad until a code exists', async () => {
  const m = await loadModule('src/pages/auth/loginGateModel.ts')
  assert.equal(m.shouldKeepPhoneKeypadOnNumber({ codeOpen: false, phoneComplete: true, activeInput: 'code' }), true)
  assert.equal(m.shouldKeepPhoneKeypadOnNumber({ codeOpen: true, phoneComplete: true, activeInput: 'code' }), false)
  assert.equal(m.shouldKeepPhoneKeypadOnNumber({ codeOpen: false, phoneComplete: false, activeInput: 'code' }), false)

  const login = readFileSync(join(kioskRoot, 'src/pages/auth/LoginPage.tsx'), 'utf8')
  const fields = readFileSync(join(kioskRoot, 'src/pages/auth/components/LoginGatePhoneFields.tsx'), 'utf8')
  const agreement = readFileSync(join(kioskRoot, 'src/pages/auth/components/MemberAgreement.tsx'), 'utf8')
  const css = readFileSync(join(kioskRoot, 'src/pages/auth/styles/login-gate-qx.css'), 'utf8')
  const profile = readFileSync(join(kioskRoot, 'src/pages/profile/ProfilePage.tsx'), 'utf8')
  const settings = readFileSync(join(kioskRoot, 'src/pages/profile/me/MySettingsPage.tsx'), 'utf8')
  const hookAt = login.indexOf('const phoneLogin = useMemberPhoneLogin(')
  const keepAt = login.indexOf('shouldKeepPhoneKeypadOnNumber({')
  assert.ok(hookAt >= 0 && keepAt > hookAt)
  assert.match(fields, /codeFieldRef\.current\?\.focus\(\)/)
  assert.match(fields, /className="lg-field lg-field-phone"/)
  assert.match(agreement, /agreed \? <CheckIcon/)
  assert.match(css, /\.lg-fields\s*\{[^}]*z-index:\s*50/)
  assert.match(css, /\.k-agree:not\(\.checked\) \.box svg\s*\{[^}]*opacity:\s*0/)
  assert.match(profile, /clearSessionTo\(\{ path: '\/' \}\)/)
  assert.doesNotMatch(profile, /clearSessionTo\(\{ path: '\/profile' \}\)/)
  assert.match(settings, /clearSessionTo\(\{ path: '\/' \}\)/)
  assert.match(settings, /clearSessionTo\(\{ path: '\/login', state: \{ from: '\/profile' \} \}\)/)
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
