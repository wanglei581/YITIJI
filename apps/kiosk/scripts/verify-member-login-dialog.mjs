import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const resolve = (relativePath) => join(appRoot, relativePath)

let failures = 0

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}

function expect(condition, message) {
  if (condition) pass(message)
  else fail(message)
}

function expectMatches(source, pattern, message) {
  const matched = pattern.test(source)
  expect(matched, `${message}${matched ? '' : ` — pattern ${pattern} not found`}`)
}

function expectNoMatches(source, pattern, message) {
  const matched = pattern.test(source)
  expect(!matched, `${message}${matched ? ` — forbidden pattern ${pattern} found` : ''}`)
}

function readRequired(relativePath) {
  const absolutePath = resolve(relativePath)
  if (!existsSync(absolutePath)) {
    fail(`${relativePath} 尚未实现`)
    return ''
  }

  pass(`${relativePath} 存在`)
  return readFileSync(absolutePath, 'utf8')
}

function cssRules(source) {
  const rules = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  for (const match of source.matchAll(pattern)) {
    rules.push({ selector: match[1].trim(), body: match[2] })
  }
  return rules
}

function pixelMinHeight(ruleBody) {
  const match = ruleBody.match(/min-height:\s*(?:var\([^,]+,\s*)?(\d+)px/)
  return match ? Number(match[1]) : null
}

function expectSemanticMinHeight(source, selectorPattern, minimum, label) {
  const matches = cssRules(source).filter(({ selector }) => selectorPattern.test(selector))
  const values = matches.map(({ body }) => pixelMinHeight(body)).filter((value) => value !== null)
  const maximum = values.length > 0 ? Math.max(...values) : null
  expect(maximum !== null && maximum >= minimum, `${label} min-height >= ${minimum}px（当前 ${maximum ?? '缺失'}）`)
}

console.log('\n=== Kiosk 真实会员登录弹窗静态合同 ===')

const memberHook = readRequired('src/pages/auth/hooks/useMemberPhoneLogin.ts')
const phonePane = readRequired('src/pages/auth/components/MemberPhoneLoginPane.tsx')
const agreement = readRequired('src/pages/auth/components/MemberAgreement.tsx')
const loginDialog = readRequired('src/pages/auth/components/MemberLoginDialog.tsx')
const loginPage = readRequired('src/pages/auth/LoginPage.tsx')
const home = readRequired('src/pages/home/HomePage.tsx')
const loginDialogCss = readRequired('src/pages/auth/styles/login-dialog.css')
const kioskRoot = readRequired('src/layouts/KioskRoot.tsx')
const packageJson = readRequired('package.json')
const workflow = readRequired('../../.github/workflows/ci.yml')

expectMatches(memberHook, /export\s+function\s+useMemberPhoneLogin\s*\(/, '共享 hook 导出 useMemberPhoneLogin')
expectMatches(memberHook, /const\s+deviceId\s*=\s*getMemberAuthDeviceId\(\)/, '共享 hook 使用稳定会员登录 deviceId')
expectMatches(memberHook, /sendSmsCode\(phone,\s*deviceId\)/, '共享 hook 发送验证码时携带 deviceId')
expectMatches(memberHook, /memberLogin\(phone,\s*code,\s*deviceId\)/, '共享 hook 登录时携带 deviceId')
expectMatches(memberHook, /requestGenerationRef/, '共享 hook 使用 request generation 隔离迟到响应')
expectMatches(
  memberHook,
  /\+\+\s*requestGenerationRef\.current|requestGenerationRef\.current\s*(?:\+=\s*1|\+\+|=\s*requestGenerationRef\.current\s*\+\s*1)/,
  'request generation 可递增失效当前请求',
)
expectMatches(
  memberHook,
  /(?:\w*generation\w*|requestId)\s*!==\s*requestGenerationRef\.current|requestGenerationRef\.current\s*!==\s*(?:\w*generation\w*|requestId)/i,
  '异步结果更新前校验 request generation',
)
expectMatches(memberHook, /const\s+cancelPending\s*=\s*useCallback\s*\(/, '共享 hook 提供 cancelPending')
expectMatches(memberHook, /cancelPending[\s\S]*?setLoading\(false\)/, 'cancelPending 清理可见 loading 状态')
expectMatches(memberHook, /return\s*\{[\s\S]*?cancelPending/, '共享控制器向消费者暴露 cancelPending')
expectNoMatches(
  memberHook,
  /(?:localStorage|sessionStorage)\.setItem\s*\(|document\.cookie\s*=|window\.location\.(?:hash|search)\s*=/,
  '共享手机号登录逻辑不把 token 或认证结果写入持久化浏览器表面',
)

for (const [source, label] of [
  [loginPage, '独立 LoginPage'],
  [loginDialog, 'MemberLoginDialog'],
  [phonePane, 'MemberPhoneLoginPane'],
  [agreement, 'MemberAgreement'],
]) {
  expectNoMatches(source, /\b(?:sendSmsCode|memberLogin)\s*\(/, `${label} 不直接调用认证 API`)
}

expectMatches(loginPage, /useMemberPhoneLogin\s*\(/, 'LoginPage 使用共享手机号登录 hook')
expectMatches(loginPage, /<MemberPhoneLoginPane\s+\{\.\.\.phoneLogin\.paneProps\}/, 'LoginPage 使用共享手机号登录面板')
expectMatches(loginPage, /<MemberAgreement/, 'LoginPage 使用共享协议组件')
expectMatches(loginDialog, /useMemberPhoneLogin\s*\(/, 'MemberLoginDialog 使用共享手机号登录 hook')
expectMatches(loginDialog, /<MemberPhoneLoginPane\s+\{\.\.\.phoneLogin\.paneProps\}/, 'MemberLoginDialog 使用共享手机号登录面板')
expectMatches(loginDialog, /<MemberAgreement/, 'MemberLoginDialog 使用共享协议组件')

expectMatches(loginDialog, /<dialog[\s\S]*?className="member-login-dialog"/, '登录弹窗使用原生 dialog 元素')
expectMatches(loginDialog, /showModal\(\)/, 'open 时调用原生 dialog.showModal')
expectMatches(loginDialog, /\.close\(\)/, '关闭流程调用原生 dialog.close')
expectMatches(loginDialog, /onCancel=\{/, '登录弹窗处理原生 cancel / Escape')
expectMatches(loginDialog, /aria-labelledby="member-login-dialog-title"/, '登录弹窗关联可访问标题')
expectMatches(loginDialog, /id="member-login-dialog-title"[^>]*>手机号登录/, '登录弹窗提供冻结标题')
expectMatches(loginDialog, /cancelPending\(\)/, '关闭弹窗会取消当前手机号登录请求')
expectMatches(loginDialog, /aria-label="关闭登录窗口"/, '登录弹窗保留显式关闭按钮')
expectMatches(loginDialog, />\s*关闭\s*<\/button>/, '显式关闭按钮提供可见关闭文案')
expectMatches(loginDialog, /继续游客体验/, '登录弹窗保留继续游客体验操作')
expectMatches(loginDialog, /onContinueAsGuest/, '游客体验操作调用外部真实游客态 handler')
expectMatches(loginDialog, /公共设备长时间无操作将自动退出并清理本次会话/, '登录弹窗提示公共终端空闲清场')

expectMatches(agreement, /<Link\s+[^>]*to="\/legal\/terms"/, '共享协议组件链接真实用户服务协议')
expectMatches(agreement, /<Link\s+[^>]*to="\/legal\/privacy"/, '共享协议组件链接真实隐私政策')
expectNoMatches(agreement, /href="#"|to="#"/, '共享协议组件不使用占位协议链接')

expectMatches(home, /<MemberLoginDialog/, '首页挂载 MemberLoginDialog')
expectNoMatches(home, /\b(?:sendSmsCode|memberLogin)\s*\(/, '首页不复制认证 API')
expectMatches(kioskRoot, /useIdleLogout\(/, 'KioskRoot 保持全局 useIdleLogout 空闲清场')

expect(loginDialogCss.includes('.member-login-dialog::backdrop'), '弹窗样式定义原生 ::backdrop')
expectMatches(loginDialogCss, /\.member-login-dialog\s*\{/, '弹窗样式定义 1080 居中容器基础规则')
expectMatches(loginDialogCss, /\.member-login-dialog \.member-dialog-surface\s*\{/, '弹窗表面解除页面版全屏约束')
expectMatches(
  loginDialogCss,
  /body:has\(\.member-login-dialog\[open\]\)\s*\{[^}]*overflow:\s*hidden/,
  '弹窗打开时锁定背景滚动',
)
expectMatches(loginDialogCss, /@media[^{}]*390px[^{}]*844px/, '弹窗样式显式覆盖 390x844')
expectMatches(loginDialogCss, /@media[^{}]*390px[^{}]*700px/, '弹窗样式显式覆盖 390x700')
expectMatches(loginDialogCss, /@media[^{}]*1080px[^{}]*1920px/, '弹窗样式显式覆盖 1080x1920')
expectMatches(loginDialogCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, '弹窗样式支持 reduced motion')
expectMatches(loginDialogCss, /var\(--sd-/, '弹窗样式复用 LightFlow 语义 token')
expectSemanticMinHeight(loginDialogCss, /close/i, 48, '显式关闭按钮')
expectSemanticMinHeight(loginDialogCss, /guest/i, 48, '继续游客体验按钮')
expectSemanticMinHeight(loginDialogCss, /\.k-cta|primary|submit|login-action/i, 56, '登录主操作')

expect(
  packageJson.includes('"verify:member-login-dialog": "node scripts/verify-member-login-dialog.mjs"'),
  'package.json 注册 verify:member-login-dialog',
)
expectMatches(
  workflow,
  /pnpm --filter @ai-job-print\/kiosk verify:home-service-desk\s*\n\s*pnpm --filter @ai-job-print\/kiosk verify:member-login-dialog/,
  'CI 在 verify:home-service-desk 后紧跟登录弹窗合同',
)

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项失败 — Kiosk 真实会员登录弹窗尚未满足冻结合同\n`)
  process.exit(1)
}

console.log('\nALL PASS — Kiosk 真实会员登录弹窗符合冻结合同\n')
