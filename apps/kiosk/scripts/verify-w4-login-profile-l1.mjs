import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(resolve(root, name), 'utf8')
function load(name, imports = {}) {
  const exports = {}
  const code = ts.transpileModule(read(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('exports', 'require', 'window', code)(exports, (id) => {
    assert.ok(id in imports, `unmapped dependency ${name}: ${id}`); return imports[id]
  }, { setTimeout: () => 1, clearTimeout() {} })
  return exports
}
// 发码经 terminalAttributedFetch（按台计额度）；本门禁不发真实请求，给个会报错的替身即可。
const api = load('src/services/auth/memberAuthApi.ts', { '../api/client': { API_BASE_URL: '/api/v1' }, './memberSessionEvents': {}, '../terminalAuth': { terminalAttributedFetch: () => { throw new Error('verify-w4: 不应发出真实请求') } } })
const masking = load('src/utils/maskPii.ts')
// 2026-10-06：ACCOUNT_UNAVAILABLE 改走 helpNeededLine / preferUnattended，加载时要映上这份文案模块。
const unattended = load('src/copy/unattendedCopy.ts')
const copy = load('src/pages/auth/accountUserMessage.ts', { '../../services/auth/memberAuthApi': api, '../../utils/maskPii': masking, '../../copy/unattendedCopy': unattended })
const model = load('src/pages/auth/loginGateModel.ts')
const paths = load('src/auth/returnPath.ts')
let passed = 0
function check(name, fn) { fn(); passed++; console.log(`PASS W4 L1 ${name}`) }
check('history from has priority; invalid values fail closed without echo/query fallback', () => {
  for (const from of ['https://evil.invalid', '//evil.invalid', '/login', '/login?from=/profile', '/bad\\path', '', null, 12]) {
    const result = model.resolveLoginReturnTo(from, '/profile', paths.isSafeInternalPath)
    assert.equal(result.returnTo, '/'); assert.equal(result.fromRejected, true)
  }
  assert.equal(model.resolveLoginReturnTo('/me/settings', '/profile', paths.isSafeInternalPath).returnTo, '/me/settings')
  assert.equal(model.resolveLoginReturnTo(undefined, '/me/settings', paths.isSafeInternalPath).returnTo, '/me/settings')
  assert.equal(model.resolveLoginReturnTo(undefined, '//evil.invalid', paths.isSafeInternalPath).returnTo, '/')
  assert.equal(model.loginReturnLabel('/path?private=value'), '刚才的页面')
})
check('business words pass unchanged; engineering strings/codes rejected and PII masked', () => {
  for (const message of ['当前使用的人较多，请稍后再试', '该手机号已绑定其他账号，无法换绑', '短信发送失败，请稍后再试']) {
    assert.equal(copy.accountErrorMessage(new api.MemberApiError('UNKNOWN', message, 429), '本步失败'), message)
  }
  for (const message of ['', 'SMS_SEND_FAILED', '后端会话字段错误', 'HTTP 500', 'pending', '内部文件号 abc', 'Error: failed']) assert.equal(copy.accountDisplayMessage(message, '本步失败'), '本步失败')
  assert.equal(copy.accountPhoneDisplay('138****8000'), '138****8000')
  assert.equal(copy.accountPhoneDisplay('13800138000'), '138****8000')
  const text = copy.accountDisplayMessage('请核对 13800138000 与 alice@example.com', '失败')
  assert.ok(text.includes('138****8000')); assert.ok(text.includes('a***@example.com')); assert.ok(!text.includes('13800138000')); assert.ok(!text.includes('alice@'))
})
check('SMS recovery distinguishes frequency/day/failure and invalid/expired/locked', () => {
  for (const code of ['SMS_TOO_FREQUENT', 'SMS_IP_LIMIT', 'SMS_DEVICE_LIMIT', 'SMS_PROVIDER_RATE_LIMIT', 'PROVIDER_RATE_LIMIT']) assert.match(copy.accountErrorMessage(new api.MemberApiError(code, code, 429), '失败'), /稍后再试/)
  for (const code of ['SMS_DAILY_LIMIT', 'SMS_PROVIDER_PHONE_DAILY_LIMIT', 'PROVIDER_PHONE_DAILY_LIMIT']) assert.match(copy.accountErrorMessage(new api.MemberApiError(code, code, 429), '失败'), /明天再试/)
  assert.match(copy.accountErrorMessage(new api.MemberApiError('SMS_SEND_FAILED', 'SMS_SEND_FAILED', 502), '失败'), /立刻/)
  for (const [code, expected] of [['SMS_CODE_INVALID', 'phone-code-invalid'], ['SMS_CODE_EXPIRED', 'phone-code-expired'], ['SMS_CODE_LOCKED', 'phone-code-locked']]) assert.equal(model.derivePhoneGateState({ errorCode: code, error: '核对失败', countdown: 37, sendingCode: false, submitting: false, notice: null }), expected)
})
check('one-use rebind proof is never replayed; unknown result requires login review', () => {
  for (const code of ['STEP_UP_TOKEN_INVALID', 'REBIND_CODE_INVALID', 'REBIND_CODE_EXPIRED', 'REBIND_CODE_LOCKED', 'PHONE_CONFLICT']) {
    assert.equal(copy.phoneRebindRecovery(new api.MemberApiError(code, code, 409)), 'restart')
  }
  for (const error of [new Error('connection lost'), new api.MemberApiError('NETWORK_ERROR', '网络连接失败', 0), new api.MemberApiError('UNKNOWN_ERROR', '请求失败（500）', 500)]) assert.equal(copy.phoneRebindRecovery(error), 'relogin')
  const rebind = read('src/pages/profile/me/components/PhoneRebindPanel.tsx')
  assert.match(rebind, /setStepUpToken\(''\); setRecovery\(phoneRebindRecovery\(error\)\)/)
  assert.match(rebind, /if \(newOtp.length !== 6 \|\| unusable \|\| recovery\) return/)
  assert.match(rebind, /重新验证旧手机号/); assert.match(rebind, /重新登录核对/)
})
// Real hook state/effects/continuations, with isolated API promises and clock.
function harness() {
  const slots = []; let cursor = 0; let effects = []; let dirty = false
  const changed = (old, next) => !old || !next || old.length !== next.length || next.some((v, i) => v !== old[i])
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) dirty = true; slots[i] = next }] },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value } },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() }) } },
  }
  let send = async () => ({ sent: true, cooldownSeconds: 17, expiresInSeconds: 91 })
  let login = async () => { throw new api.MemberApiError('SMS_CODE_INVALID', '验证码不正确', 400) }
  const calls = []; let authenticated = 0
  const hook = load('src/pages/auth/hooks/useMemberPhoneLogin.ts', {
    react,
    '../../../services/auth/memberAuthApi': { ...api, sendSmsCode: (...args) => { calls.push(args); return send() }, memberLogin: (...args) => { calls.push(args); return login() } },
    '../accountUserMessage': copy, '../../../utils/maskPii': masking,
    '../../../services/auth/memberAuthDevice': { getMemberAuthDeviceId: () => 'device-fixture' },
    '../../../services/auth/legalConsentVersions': { fetchLegalConsentVersions: async () => ({ termsVersion: 't', privacyVersion: 'p' }) },
  })
  let current
  const options = { agreed: true, onAgreementRequired() {}, onAuthenticated() { authenticated++ } }
  const render = () => { do { dirty = false; cursor = 0; current = hook.useMemberPhoneLogin(options); const queued = effects; effects = []; queued.forEach((fn) => fn()) } while (dirty); return current }
  const digits = (value) => { for (const digit of value) { render().onDigit(digit); render() } }
  render()
  return { render, digits, calls, setSend: (fn) => { send = fn }, setLogin: (fn) => { login = fn }, authenticated: () => authenticated, unmount: () => slots.forEach((slot) => slot?.cleanup?.()) }
}
const h = harness(); h.digits('13800138000'); await h.render().onSendCode()
check('response cooldown/expiry used; raw phone sent only to API, notice masked', () => {
  assert.equal(h.render().countdown, 17); assert.equal(h.render().expiresInSeconds, 91); assert.equal(h.calls[0][0], '13800138000'); assert.match(h.render().notice, /138\*\*\*\*8000/); assert.doesNotMatch(h.render().notice, /13800138000/)
})
h.digits('123456'); await h.render().onLogin()
check('invalid code keeps phone/cooldown and clears only code', () => {
  assert.equal(h.render().phone, '13800138000'); assert.equal(h.render().code, ''); assert.equal(h.render().errorCode, 'SMS_CODE_INVALID'); assert.equal(h.render().countdown, 17)
})
const failure = harness(); failure.digits('13800138000'); failure.setSend(async () => { throw new api.MemberApiError('SMS_SEND_FAILED', 'SMS_SEND_FAILED', 502) }); await failure.render().onSendCode()
check('SMS_SEND_FAILED has no synthetic cooldown; immediate retry is possible', () => { assert.equal(failure.render().countdown, 0); assert.equal(failure.render().expiresInSeconds, null); assert.equal(failure.render().errorCode, 'SMS_SEND_FAILED') })
failure.setSend(async () => ({ sent: true, cooldownSeconds: 0, expiresInSeconds: 47 })); await failure.render().onSendCode()
check('zero cooldown stays zero instead of becoming 60 seconds', () => { assert.equal(failure.calls.length, 2); assert.equal(failure.render().countdown, 0); assert.equal(failure.render().expiresInSeconds, 47) })
const late = harness(); late.digits('13800138000'); await late.render().onSendCode(); late.digits('123456')
let resolveLogin
late.setLogin(() => new Promise((resolve) => { resolveLogin = resolve }))
const pending = late.render().onLogin(); await Promise.resolve(); late.unmount(); resolveLogin({ token: 'fixture', user: {} }); await pending
check('unmounted login completion cannot authenticate another person', () => assert.equal(late.authenticated(), 0))
check('profile/rebind retain contracts, masking, and irreversible action guards', () => {
  const profile = read('src/pages/profile/ProfilePage.tsx'); const counts = read('src/pages/profile/assets/useMemberAssetCounts.ts'); const rebind = read('src/pages/profile/me/components/PhoneRebindPanel.tsx')
  assert.match(profile, /key=\{user\?\.id \?\? 'guest'\}/); assert.match(counts, /return result.status === 'fulfilled' \? result.value.total : null/); assert.match(counts, /return \(\) => \{ requestGen.current \+= 1 \}/)
  assert.match(profile, /getPendingTasks\(token\)/); assert.doesNotMatch(profile, /\/me\/summary/)
  for (const name of ['sendPhoneRebindStepUpCode', 'verifyPhoneRebindStepUp', 'sendSmsCode', 'submitPhoneRebind']) assert.match(rebind, new RegExp(`await ${name}\\(`))
  assert.match(rebind, /disabled=\{busy \|\| step === 'done'\}/); assert.match(rebind, /setStep\('done'\)\s+onDone\(\)/); assert.match(rebind, /if \(!current\(\)\) return/g); assert.match(rebind, /maskPhone\(newPhone\)/)
})
console.log(`ALL PASS W4 L1 (${passed} groups)`)
