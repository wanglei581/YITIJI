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
