// Admin 账号设置与修改密码 UI 防回退验证（静态门禁，不连服务）。
// 锁定：唯一顶栏入口、受保护路由、三字段、商用强密码提示、错误恢复和成功强制退出。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

const required = [
  'src/layouts/AdminLayoutWrapper.tsx',
  'src/routes/login/index.tsx',
  'src/routes/index.tsx',
  'src/routes/account-settings/index.tsx',
  'src/routes/account-settings/PhoneBindingCard.tsx',
  'src/services/auth/index.ts',
  '../partner/src/routes/login/index.tsx',
  '../partner/src/services/auth/index.ts',
]

console.log('\n=== Admin 账号设置 UI verification ===')
const loaded = {}
for (const rel of required) {
  const abs = join(root, rel)
  if (!existsSync(abs)) fail(`Missing required file: ${rel}`)
  loaded[rel] = readFileSync(abs, 'utf8')
}

const layout = loaded['src/layouts/AdminLayoutWrapper.tsx']
const routes = loaded['src/routes/index.tsx']
const page = loaded['src/routes/account-settings/index.tsx']
const phoneBindingCard = loaded['src/routes/account-settings/PhoneBindingCard.tsx']
const auth = loaded['src/services/auth/index.ts']
const resetPages = [
  loaded['src/routes/login/index.tsx'],
  loaded['../partner/src/routes/login/index.tsx'],
]
const partnerAuth = loaded['../partner/src/services/auth/index.ts']

const entryCount = (layout.match(/href="\/account-settings"/g) ?? []).length
if (entryCount === 1 && layout.includes('aria-label="账号设置"')) {
  pass('顶栏只有一个账号设置入口')
} else {
  fail(`账号设置入口必须唯一且可访问,当前命中 ${entryCount} 个`)
}

if (/path:\s*['"]account-settings['"]\s*,\s*element:\s*<AccountSettingsPage\s*\/>/.test(routes)) {
  pass('账号设置路由挂在受保护的 AdminLayoutWrapper 子路由')
} else {
  fail('缺少受保护的 account-settings 子路由')
}

for (const token of [
  'account-current-password',
  'account-new-password',
  'account-confirm-password',
  'autoComplete="current-password"',
  'autoComplete="new-password"',
]) {
  if (!page.includes(token)) fail(`账号设置页缺少 ${token}`)
}
pass('修改密码表单包含当前密码、新密码和确认密码字段')

if (
  page.includes('const [user, setUser] = useState<AuthedUser | null>') &&
  page.includes('!user?.phoneMasked') &&
  page.includes('<PhoneBindingCard') &&
  page.includes("{ ...current, ...phone }")
) {
  pass('首次绑定卡只对未绑定账号展示，并以不可变方式更新当前用户')
} else {
  fail('首次绑定卡必须只对未绑定账号展示，且不能把 setUser 直接暴露给子组件')
}

for (const text of [
  '绑定手机号后，可用于短信登录和忘记密码。',
  '验证码、密码和绑定凭据不会保存到本机。',
  'initial-phone-current-password',
  'initial-phone-number',
  'initial-phone-code',
  'autoComplete="current-password"',
  'autoComplete="one-time-code"',
]) {
  if (!phoneBindingCard.includes(text)) fail(`首次绑定卡缺少 ${text}`)
}

if (
  phoneBindingCard.includes('startInitialPhoneBind(currentPassword, phone)') &&
  phoneBindingCard.includes('completeInitialPhoneBind(bindTicket, code)') &&
  phoneBindingCard.includes('mergeStoredUser(bound)') &&
  phoneBindingCard.includes('requiresSessionRenewal(result.code)') &&
  phoneBindingCard.includes('redirectToLogin()') &&
  phoneBindingCard.includes('requiresRestartAfterVerificationFailure(result.code)') &&
  phoneBindingCard.includes("'SMS_CODE_INVALID'") &&
  phoneBindingCard.includes("'PHONE_BIND_TICKET_INVALID'") &&
  phoneBindingCard.includes("'PHONE_SELF_ALREADY_BOUND'") &&
  phoneBindingCard.includes("'AUTH_SESSION_INVALID'") &&
  !phoneBindingCard.includes('localStorage') &&
  !phoneBindingCard.includes('sessionStorage') &&
  !phoneBindingCard.includes('console.log')
) {
  pass('首次绑定仅发送必要字段，且密码、验证码、ticket 不写浏览器持久化或日志')
} else {
  fail('首次绑定卡的请求契约或敏感数据内存边界不符合要求')
}

if (
  auth.includes("'/auth/phone/initial-bind/start'") &&
  auth.includes("'/auth/phone/initial-bind/verify'") &&
  auth.includes('{ currentPassword, phone }') &&
  auth.includes('{ bindTicket, code }') &&
  !auth.includes('console.log(bindTicket)') &&
  !auth.includes('console.log(code)')
) {
  pass('认证 adapter 使用首次绑定专用端点，且不记录绑定凭据或验证码')
} else {
  fail('首次绑定 adapter 的端点、请求体或无日志边界不符合要求')
}

if (
  page.includes('unicodeCharacterLength(newPassword) < 12') &&
  page.includes('Array.from(value).length') &&
  page.includes('new TextEncoder().encode(value).length') &&
  page.includes('新密码按 UTF-8 计算不能超过 72 字节') &&
  page.includes('至少包含大写字母、小写字母、数字、特殊字符中的 3 类') &&
  page.includes('minLength={12}')
) {
  pass('页面展示并执行与后端一致的 12 位、字符分类和 UTF-8 字节规则')
} else {
  fail('页面必须执行并展示 12 位 + 4 类取 3 类 + UTF-8 72 字节的强密码规则')
}

for (const [portal, service] of [['Admin', auth], ['Partner', partnerAuth]]) {
  if (!service.includes("code: 'NETWORK_ERROR'") || !service.includes("code: 'INVALID_RESPONSE'")) {
    fail(`${portal} 认证服务必须统一处理网络失败与 2xx 非法 JSON`)
  }
}
pass('Admin 与 Partner 认证服务统一处理网络失败和非法成功响应')

if (page.includes('role="alert"') && page.includes('role="status"') && page.includes('aria-live="polite"')) {
  pass('错误与成功状态可被辅助技术及时感知')
} else {
  fail('错误提示必须使用 alert,成功提示必须使用 status + polite live region')
}

for (const resetPage of resetPages) {
  if (
    !resetPage.includes('unicodeCharacterLength(newPassword) < 12') ||
    !resetPage.includes('Array.from(value).length') ||
    !resetPage.includes('passwordCategoryCount(newPassword) < 3') ||
    !resetPage.includes('utf8ByteLength(newPassword) > 72') ||
    !resetPage.includes('minLength={12}') ||
    !resetPage.includes('maxLength={72}')
  ) {
    fail('Admin 与 Partner 找回密码页面必须执行同一商用强密码规则')
  }
}
pass('Admin 与 Partner 找回密码页面已统一商用强密码规则')

if (
  page.includes('finally {') &&
  page.includes('setSubmitting(false)') &&
  page.includes('setError(r.message') &&
  page.includes('window.setTimeout(() => logout(), 1200)')
) {
  pass('所有异常路径都会恢复提交状态,成功后强制退出重新登录')
} else {
  fail('页面必须用 finally 恢复提交状态并覆盖成功退出')
}

if (
  auth.includes("'/auth/password/change'") &&
  auth.includes('{ currentPassword, newPassword }') &&
  auth.includes("code: 'INVALID_RESPONSE'") &&
  !auth.includes('console.log(currentPassword)') &&
  !auth.includes('console.log(newPassword)')
) {
  pass('认证服务仅发送必要字段、无密码日志且能处理 2xx 非法 JSON')
} else {
  fail('认证服务改密契约、非法响应处理缺失或存在密码日志风险')
}

console.log('\nALL PASS')
