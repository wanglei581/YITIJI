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

function extractConstBlock(source, name) {
  const marker = `const ${name} =`
  const start = source.indexOf(marker)
  if (start < 0) return ''

  const tail = source.slice(start + marker.length)
  const nextHookScopeDeclaration = tail.search(
    /\n  (?=const\s+[A-Za-z_$][\w$]*\s*=|use(?:Effect|Memo|Callback)\s*\(|return\s+\{)/,
  )
  const end = nextHookScopeDeclaration < 0 ? source.length : start + marker.length + nextHookScopeDeclaration
  return source.slice(start, end)
}

function sliceBetweenPatterns(source, startPattern, endPattern) {
  const startMatch = startPattern.exec(source)
  if (!startMatch) return ''

  const contentStart = startMatch.index + startMatch[0].length
  const tail = source.slice(contentStart)
  const endMatch = endPattern.exec(tail)
  if (!endMatch) return ''
  return source.slice(contentStart, contentStart + endMatch.index)
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
const handleSendCode = extractConstBlock(memberHook, 'handleSendCode')
const handleLogin = extractConstBlock(memberHook, 'handleLogin')
const cancelPending = extractConstBlock(memberHook, 'cancelPending')
const closeDialog = extractConstBlock(loginDialog, 'closeDialog')
const handleAuthenticated = extractConstBlock(loginDialog, 'handleAuthenticated')
const handleContinueAsGuest = extractConstBlock(loginDialog, 'handleContinueAsGuest')
const sendCodeBeforeGenerationGuard = sliceBetweenPatterns(
  handleSendCode,
  /await\s+sendSmsCode\(phone,\s*deviceId\)/,
  /if\s*\(\s*(?:\w*[Gg]eneration\w*|requestId)\s*!==\s*requestGenerationRef\.current\s*\)\s*return/,
)
const loginBeforeGenerationGuard = sliceBetweenPatterns(
  handleLogin,
  /await\s+memberLogin\(phone,\s*code,\s*deviceId\)/,
  /if\s*\(\s*(?:\w*[Gg]eneration\w*|requestId)\s*!==\s*requestGenerationRef\.current\s*\)\s*return/,
)

expectMatches(memberHook, /export\s+function\s+useMemberPhoneLogin\s*\(/, '共享 hook 导出 useMemberPhoneLogin')
expectMatches(
  memberHook,
  /import\s*\{(?=[^}]*sendSmsCode)(?=[^}]*memberLogin)[^}]*\}\s*from\s*['"][^'"]*services\/auth\/memberAuthApi['"]/,
  '共享 hook 从真实 memberAuthApi 导入 sendSmsCode/memberLogin',
)
expectMatches(
  memberHook,
  /import\s*\{(?=[^}]*getMemberAuthDeviceId)[^}]*\}\s*from\s*['"][^'"]*services\/auth\/memberAuthDevice['"]/,
  '共享 hook 从真实 memberAuthDevice 导入 getMemberAuthDeviceId',
)
expect(handleSendCode.length > 0, '已提取 handleSendCode 函数块')
expect(handleLogin.length > 0, '已提取 handleLogin 函数块')
expect(cancelPending.length > 0, '已提取 cancelPending 函数块')

expectMatches(handleSendCode, /const\s+deviceId\s*=\s*getMemberAuthDeviceId\(\)/, 'handleSendCode 使用稳定会员登录 deviceId')
expectMatches(
  handleSendCode,
  /const\s+(?:\w*[Gg]eneration\w*|requestId)\s*=\s*\+\+\s*requestGenerationRef\.current/,
  'handleSendCode 生成并捕获 request generation',
)
expectMatches(
  handleSendCode,
  /const\s+(?:result|res)\s*=\s*await\s+sendSmsCode\(phone,\s*deviceId\)[\s\S]*?if\s*\(\s*(?:\w*[Gg]eneration\w*|requestId)\s*!==\s*requestGenerationRef\.current\s*\)\s*return[\s\S]*?(?:countdown\.start|setNotice|setActiveInput)\(/,
  'handleSendCode 在成功状态更新前拒绝迟到 generation',
)
expect(sendCodeBeforeGenerationGuard.length > 0, '已提取 handleSendCode await 后到 generation guard 的区间')
expectNoMatches(
  sendCodeBeforeGenerationGuard,
  /\b(?:set[A-Z]\w*|countdown\.start)\s*\(/,
  'handleSendCode generation guard 前不更新任何成功状态',
)

expectMatches(handleLogin, /const\s+deviceId\s*=\s*getMemberAuthDeviceId\(\)/, 'handleLogin 使用稳定会员登录 deviceId')
expectMatches(
  handleLogin,
  /const\s+(?:\w*[Gg]eneration\w*|requestId)\s*=\s*\+\+\s*requestGenerationRef\.current/,
  'handleLogin 生成并捕获 request generation',
)
expectMatches(
  handleLogin,
  /const\s+(?:result|res)\s*=\s*await\s+memberLogin\(phone,\s*code,\s*deviceId\)[\s\S]*?if\s*\(\s*(?:\w*[Gg]eneration\w*|requestId)\s*!==\s*requestGenerationRef\.current\s*\)\s*return[\s\S]*?options\.onAuthenticated\((?:result|res)\)/,
  'handleLogin 在 onAuthenticated 前拒绝迟到 generation',
)
expect(loginBeforeGenerationGuard.length > 0, '已提取 handleLogin await 后到 generation guard 的区间')
expectNoMatches(
  loginBeforeGenerationGuard,
  /\bset[A-Z]\w*\s*\(|options\.onAuthenticated\s*\(/,
  'handleLogin generation guard 前不更新状态或触发认证成功',
)

expectMatches(
  cancelPending,
  /\+\+\s*requestGenerationRef\.current|requestGenerationRef\.current\s*(?:\+=\s*1|\+\+)/,
  'cancelPending 自身增加 request generation',
)
expectMatches(cancelPending, /setLoading\(false\)/, 'cancelPending 清理 loading')
expectMatches(cancelPending, /setNotice\(null\)/, 'cancelPending 清理 notice')
expectMatches(cancelPending, /setError\(null\)/, 'cancelPending 清理 error')
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

for (const [source, label] of [
  [loginPage, '独立 LoginPage'],
  [loginDialog, 'MemberLoginDialog'],
]) {
  expectNoMatches(
    source,
    /from\s*['"][^'"]*services\/auth\/(?:memberAuthApi|memberAuthDevice)['"]/,
    `${label} 不直接 import 真实认证 API/device 模块`,
  )
}

expectMatches(loginPage, /useMemberPhoneLogin\s*\(/, 'LoginPage 使用共享手机号登录 hook')
expectMatches(loginPage, /<MemberPhoneLoginPane\s+\{\.\.\.phoneLogin\.paneProps\}/, 'LoginPage 使用共享手机号登录面板')
expectMatches(loginPage, /<MemberAgreement/, 'LoginPage 使用共享协议组件')
expectMatches(loginDialog, /useMemberPhoneLogin\s*\(/, 'MemberLoginDialog 使用共享手机号登录 hook')
expectMatches(loginDialog, /<MemberPhoneLoginPane\s+\{\.\.\.phoneLogin\.paneProps\}/, 'MemberLoginDialog 使用共享手机号登录面板')
expectMatches(loginDialog, /<MemberAgreement/, 'MemberLoginDialog 使用共享协议组件')
expectMatches(
  loginDialog,
  /import\s*\{(?=[^}]*\buseAuth\b)[^}]*\}\s*from\s*['"][^'"]*auth\/AuthContext['"]/,
  'MemberLoginDialog 从真实 AuthContext 导入 useAuth',
)
expectMatches(loginDialog, /const\s*\{(?=[^}]*\blogin\b)[^}]*\}\s*=\s*useAuth\(\)/, 'MemberLoginDialog 获取真实 login handler')
expect(handleAuthenticated.length > 0, '已提取 handleAuthenticated 函数块')
expectMatches(
  handleAuthenticated,
  /login\(\{\s*id:\s*(?:result|res)\.user\.id,\s*phoneMasked:\s*(?:result|res)\.user\.phoneMasked,\s*nickname:\s*(?:result|res)\.user\.nickname,\s*token:\s*(?:result|res)\.token,\s*method:\s*'phone',?\s*\}\)/,
  'handleAuthenticated 把 LoginResult 完整映射到 AuthContext',
)
expectMatches(
  handleAuthenticated,
  /login\([\s\S]*?onAuthenticated\?\.\(\)[\s\S]*?closeDialog\(\)/,
  'handleAuthenticated 先落真实会话，再通知调用方并关闭弹窗',
)
expectMatches(
  loginDialog,
  /useMemberPhoneLogin\(\{[\s\S]*?onAuthenticated:\s*handleAuthenticated[\s\S]*?\}\)/,
  '共享手机号 hook 的认证成功回调接入真实会话 handler',
)

expectMatches(loginDialog, /<dialog[\s\S]*?className="member-login-dialog"/, '登录弹窗使用原生 dialog 元素')
expectMatches(loginDialog, /document\.activeElement/, '打开弹窗前读取当前触发元素')
expectMatches(
  loginDialog,
  /(?:trigger|activeElement)\w*Ref\.current\s*=[\s\S]{0,180}?document\.activeElement/i,
  '打开弹窗前把 document.activeElement 保存到触发元素 ref',
)
expectMatches(loginDialog, /const\s+phoneTargetRef\s*=\s*useRef<[^>]+>\(null\)/, '登录弹窗持有真实手机号入口 ref')
expectMatches(loginDialog, /showModal\(\)/, 'open 时调用原生 dialog.showModal')
expectMatches(
  loginDialog,
  /showModal\(\)[\s\S]{0,500}?phoneTargetRef\.current\?\.focus\(\)/,
  'showModal 后把焦点送到手机号入口',
)
expectMatches(loginDialog, /<MemberPhoneLoginPane[\s\S]*?phoneTargetRef=\{phoneTargetRef\}/, '登录面板接收手机号焦点 ref')
expectMatches(loginDialog, /\.close\(\)/, '关闭流程调用原生 dialog.close')
expect(closeDialog.length > 0, '已提取 closeDialog 函数块')
expectMatches(closeDialog, /cancelPending\(\)[\s\S]*?\.close\(\)/, 'closeDialog 先取消请求再关闭原生 dialog')
expectMatches(
  closeDialog,
  /(?:trigger|activeElement)\w*(?:Ref\.current)?[\s\S]*?isConnected[\s\S]*?\.focus\(\)/i,
  'closeDialog 仅对仍在文档中的触发元素恢复焦点',
)
expectMatches(loginDialog, /onCancel=\{/, '登录弹窗处理原生 cancel / Escape')
expectMatches(loginDialog, /aria-labelledby="member-login-dialog-title"/, '登录弹窗关联可访问标题')
expectMatches(loginDialog, /id="member-login-dialog-title"[^>]*>手机号登录/, '登录弹窗提供冻结标题')
expectMatches(loginDialog, /cancelPending\(\)/, '关闭弹窗会取消当前手机号登录请求')
expectMatches(loginDialog, /aria-label="关闭登录窗口"/, '登录弹窗保留显式关闭按钮')
expectMatches(loginDialog, />\s*关闭\s*<\/button>/, '显式关闭按钮提供可见关闭文案')
expectMatches(loginDialog, /继续游客体验/, '登录弹窗保留继续游客体验操作')
expect(handleContinueAsGuest.length > 0, '已提取 handleContinueAsGuest 函数块')
expectMatches(
  handleContinueAsGuest,
  /onContinueAsGuest\(\)[\s\S]*?(?:closeDialog|cancelPending)\(\)/,
  '游客 handler 先进入真实游客态，再关闭弹窗或取消请求',
)
expectMatches(
  loginDialog,
  /<button(?=[^>]*onClick=\{handleContinueAsGuest\})[^>]*>\s*继续游客体验\s*<\/button>/,
  '继续游客体验按钮绑定真实游客 handler',
)
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
