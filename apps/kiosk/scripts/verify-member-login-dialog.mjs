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

function extractConstDeclaration(source, name) {
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

function extractBalancedBlock(source, openIndex) {
  if (openIndex < 0 || source[openIndex] !== '{') return ''
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, index + 1)
    }
  }
  return ''
}

function extractConstFunction(source, name) {
  const declaration = new RegExp(`const\\s+${name}\\s*=`).exec(source)
  if (!declaration) return ''
  const arrow = source.indexOf('=>', declaration.index + declaration[0].length)
  const header = source.slice(declaration.index + declaration[0].length, arrow)
  if (arrow < 0 || header.length > 220 || /\n\s*const\s/.test(header)) return ''
  const expressionStart = arrow + 2 + (source.slice(arrow + 2).match(/^\s*/)?.[0].length ?? 0)
  if (source[expressionStart] !== '{') {
    const tail = source.slice(expressionStart)
    const boundary = tail.search(/\n\s*(?=const\s|function\s|use(?:Effect|Memo|Callback)\s*\(|return\b|\})/)
    const end = boundary < 0 ? source.length : expressionStart + boundary
    return source.slice(declaration.index, end)
  }
  const open = expressionStart
  const body = extractBalancedBlock(source, open)
  return body ? source.slice(declaration.index, open + body.length) : ''
}

function extractFunctionDeclaration(source, name) {
  const declaration = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)`).exec(source)
  if (!declaration) return ''
  const open = source.indexOf('{', declaration.index + declaration[0].length)
  const body = extractBalancedBlock(source, open)
  return body ? source.slice(declaration.index, open + body.length) : ''
}

function collectFunctions(source) {
  const functions = []
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    const block = extractConstFunction(source, match[1])
    if (block && !functions.some((item) => item.name === match[1])) functions.push({ name: match[1], block })
  }
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const block = extractFunctionDeclaration(source, match[1])
    if (block && !functions.some((item) => item.name === match[1])) functions.push({ name: match[1], block })
  }
  return functions
}

function callsTarget(name, target, functions, seen = new Set()) {
  if (!name || !target || seen.has(name)) return false
  if (name === target) return true
  const entry = functions.find((item) => item.name === name)
  if (!entry) return false
  const nextSeen = new Set(seen).add(name)
  return [...entry.block.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
    .some((match) => callsTarget(match[1], target, functions, nextSeen))
}

function targetCallIndex(source, target, functions) {
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (callsTarget(match[1], target, functions)) return match.index
  }
  return -1
}

function expandedFunctionSource(name, functions, seen = new Set()) {
  if (!name || seen.has(name)) return ''
  const entry = functions.find((item) => item.name === name)
  if (!entry) return ''
  const nextSeen = new Set(seen).add(name)
  const children = [...entry.block.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
    .map((match) => expandedFunctionSource(match[1], functions, nextSeen))
  return [entry.block, ...children].join('\n')
}

function propSnippet(source, propName) {
  const start = source.indexOf(`${propName}={`)
  return start >= 0 ? source.slice(start, start + 420) : ''
}

function extractKeywordBlock(source, keyword) {
  const match = new RegExp(`\\b${keyword}\\b(?:\\s*\\([^)]*\\))?\\s*\\{`).exec(source)
  if (!match) return ''
  const open = source.indexOf('{', match.index)
  return extractBalancedBlock(source, open)
}

function extractArrowCallBlocks(source, callName) {
  const blocks = []
  const pattern = new RegExp(`\\b${callName}\\s*\\(`, 'g')
  for (const match of source.matchAll(pattern)) {
    const arrow = source.indexOf('=>', match.index + match[0].length)
    const open = source.indexOf('{', arrow)
    const block = extractBalancedBlock(source, open)
    if (arrow >= 0 && block) blocks.push(source.slice(match.index, open + block.length))
  }
  return blocks
}

function extractJsxElement(source, tagName, attributePattern = null) {
  const pattern = new RegExp(`<${tagName}\\b`, 'g')
  for (const match of source.matchAll(pattern)) {
    const close = source.indexOf(`</${tagName}>`, match.index + match[0].length)
    if (close < 0) continue
    const element = source.slice(match.index, close + tagName.length + 3)
    if (!attributePattern || attributePattern.test(element)) return element
  }
  return ''
}

function patternIndex(source, pattern) {
  return pattern.exec(source)?.index ?? -1
}

function generationGuardPattern(generation) {
  if (!generation) return /$a/
  const value = generation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(?:if\\s*\\(\\s*(?:${value}\\s*!==\\s*requestGenerationRef\\.current|requestGenerationRef\\.current\\s*!==\\s*${value}|!\\s*isCurrentRequest\\(\\s*${value}\\s*\\))\\s*\\)\\s*(?:\\{\\s*)?return\\b|if\\s*\\(\\s*(?:${value}\\s*===\\s*requestGenerationRef\\.current|requestGenerationRef\\.current\\s*===\\s*${value}|isCurrentRequest\\(\\s*${value}\\s*\\))\\s*\\)\\s*\\{)`,
  )
}

function validatesCurrentRequest(helper) {
  const parameter = helper.match(
    /(?:isCurrentRequest\s*=\s*\(?\s*|function\s+isCurrentRequest\s*\(\s*)([A-Za-z_$][\w$]*)/,
  )?.[1]
  if (!parameter) return false
  const value = parameter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(?:${value}\\s*===\\s*requestGenerationRef\\.current|requestGenerationRef\\.current\\s*===\\s*${value})`,
  ).test(helper)
}

function expectGuardBeforeUpdate(block, guardPattern, updatePattern, label) {
  const guard = guardPattern.exec(block)
  const guardIndex = guard?.index ?? -1
  const updateIndex = patternIndex(block, updatePattern)
  const positiveGuardBody = guard && !/\breturn\b/.test(guard[0])
    ? extractBalancedBlock(block, block.indexOf('{', guard.index))
    : ''
  const updateIsGuarded = guard && /\breturn\b/.test(guard[0])
    ? updateIndex > guardIndex
    : updateIndex >= guardIndex && positiveGuardBody.length > 0 && updatePattern.test(positiveGuardBody)
  expect(block.length > 0 && updateIsGuarded, label)
}

function phoneFocusableTags(source) {
  return [...source.matchAll(/<(?:input|button)\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /(?:手机|phone|tel|k-input-target)/i.test(tag) && !/\bdisabled\b/.test(tag))
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
const handleSendCode = extractConstFunction(memberHook, 'handleSendCode')
const handleLogin = extractConstFunction(memberHook, 'handleLogin')
const cancelPending = extractConstFunction(memberHook, 'cancelPending')
const resetSensitiveInput = extractConstFunction(memberHook, 'resetSensitiveInput')
const handleAuthenticated = extractConstFunction(loginDialog, 'handleAuthenticated')
const handleContinueAsGuest = extractConstFunction(loginDialog, 'handleContinueAsGuest')
const sendGeneration = handleSendCode.match(
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*\+\+\s*requestGenerationRef\.current/,
)?.[1]
const loginGeneration = handleLogin.match(
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*\+\+\s*requestGenerationRef\.current/,
)?.[1]
const sendTry = extractKeywordBlock(handleSendCode, 'try')
const sendCatch = extractKeywordBlock(handleSendCode, 'catch')
const sendFinally = extractKeywordBlock(handleSendCode, 'finally')
const loginTry = extractKeywordBlock(handleLogin, 'try')
const loginCatch = extractKeywordBlock(handleLogin, 'catch')
const loginFinally = extractKeywordBlock(handleLogin, 'finally')
const currentRequestHelper = extractConstDeclaration(memberHook, 'isCurrentRequest')
  || extractFunctionDeclaration(memberHook, 'isCurrentRequest')
const raiseErrorHelper = extractConstDeclaration(memberHook, 'raiseError')
  || extractFunctionDeclaration(memberHook, 'raiseError')
const dialogFunctions = collectFunctions(loginDialog)
const finalCloseFunction = dialogFunctions.find(({ block }) => (
  /cancelPending\s*\(\s*\)/.test(block)
    && /\.close\s*\(\s*\)/.test(block)
    && /\bonClose\s*(?:\?\.)?\s*\(\s*\)/.test(block)
))
const finalCloseName = finalCloseFunction?.name ?? ''
const finalCloseBlock = finalCloseFunction?.block ?? ''
const dialogJsx = extractJsxElement(loginDialog, 'dialog')
const closeButton = extractJsxElement(dialogJsx, 'button', /aria-label="关闭登录窗口"/)
const openEffect = extractArrowCallBlocks(loginDialog, 'useEffect').find((block) => /showModal\(\)/.test(block)) ?? ''
const savedTriggerMatch = openEffect.match(
  /([A-Za-z_$][\w$]*)\.current\s*=\s*document\.activeElement(?:\s+as\s+[^\n;]+)?/,
)
const savedTriggerRef = savedTriggerMatch?.[1] ?? ''
const cancelHandlerName = dialogJsx.match(/onCancel=\{([A-Za-z_$][\w$]*)\}/)?.[1] ?? ''
const cancelInlineSnippet = cancelHandlerName ? '' : propSnippet(dialogJsx, 'onCancel')
const cancelInlineDelegate = [...cancelInlineSnippet.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
  .map((match) => match[1])
  .find((name) => dialogFunctions.some((item) => item.name === name) && callsTarget(name, finalCloseName, dialogFunctions)) ?? ''
const cancelInlineExpanded = cancelInlineDelegate ? expandedFunctionSource(cancelInlineDelegate, dialogFunctions) : ''
const cancelHandler = cancelHandlerName
  ? expandedFunctionSource(cancelHandlerName, dialogFunctions)
  : (/preventDefault\s*\(/.test(cancelInlineSnippet)
      ? `${cancelInlineSnippet}\n${cancelInlineExpanded}`
      : (cancelInlineExpanded || cancelInlineSnippet))
const closeButtonHandlerName = closeButton.match(/onClick=\{([A-Za-z_$][\w$]*)\}/)?.[1] ?? ''
const closeButtonHandler = closeButtonHandlerName
  ? expandedFunctionSource(closeButtonHandlerName, dialogFunctions)
  : propSnippet(closeButton, 'onClick')
const showModalIndex = patternIndex(openEffect, /\.showModal\(\)/)
const focusMatch = /([A-Za-z_$][\w$]*)\.current\s*(?:\?\.)?focus\s*\(/.exec(openEffect)
const focusRef = focusMatch?.[1] ?? ''
const queryFocusIndex = patternIndex(
  openEffect,
  /querySelector(?:<[^>]+>)?\s*\([^)]*(?:input|button|tel|手机|phone|k-input-target)[^)]*\)[\s\S]{0,160}?focus\s*\(/i,
)
const explicitFocusIndex = focusMatch?.index ?? queryFocusIndex
const dialogPhoneTags = phoneFocusableTags(dialogJsx)
const panePhoneTags = /<MemberPhoneLoginPane\b/.test(dialogJsx) ? phoneFocusableTags(phonePane) : []
const directFocusTarget = Boolean(focusRef) && dialogPhoneTags.some((tag) => (
  new RegExp(`ref=\\{${focusRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`).test(tag)
))
const paneFocusProp = focusRef
  ? dialogJsx.match(new RegExp(`<MemberPhoneLoginPane\\b[\\s\\S]*?\\b([A-Za-z_$][\\w$]*)=\\{${focusRef}\\}`))?.[1]
  : ''
const paneFocusTarget = Boolean(paneFocusProp) && panePhoneTags.some((tag) => (
  new RegExp(`ref=\\{${paneFocusProp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`).test(tag)
))
const queryFocusTarget = queryFocusIndex >= 0 && (dialogPhoneTags.length > 0 || panePhoneTags.length > 0)
const autoFocusTarget = [...dialogPhoneTags, ...panePhoneTags].some((tag) => /\bautoFocus\b/.test(tag))

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
expect(resetSensitiveInput.length > 0, '已提取 resetSensitiveInput 函数块')

expectMatches(handleSendCode, /const\s+deviceId\s*=\s*getMemberAuthDeviceId\(\)/, 'handleSendCode 使用稳定会员登录 deviceId')
expect(Boolean(sendGeneration), 'handleSendCode 生成并捕获 request generation')
expect(sendTry.length > 0 && sendCatch.length > 0 && sendFinally.length > 0, 'handleSendCode 分别包含 try/catch/finally')
expectMatches(sendTry, /const\s+(?:result|res)\s*=\s*await\s+sendSmsCode\(phone,\s*deviceId\)/, 'handleSendCode try 调用真实验证码 API')
expectGuardBeforeUpdate(
  sendTry,
  generationGuardPattern(sendGeneration),
  /(?:countdown\.start|setNotice|setActiveInput)\s*\(/,
  'handleSendCode try 在成功状态更新前拒绝迟到 generation',
)
expectGuardBeforeUpdate(
  sendCatch,
  generationGuardPattern(sendGeneration),
  /(?:set(?:Error|Notice|Loading)|raiseError)\s*\(/,
  'handleSendCode catch 在任何错误/loading 副作用前拒绝迟到 generation',
)
expectGuardBeforeUpdate(
  sendCatch,
  generationGuardPattern(sendGeneration),
  /(?:set(?:Error|Notice)|raiseError)\s*\(/,
  'handleSendCode catch guard 后执行真实错误更新',
)
expectGuardBeforeUpdate(
  sendFinally,
  generationGuardPattern(sendGeneration),
  /setLoading\s*\(/,
  'handleSendCode finally 在清理 loading 前拒绝迟到 generation',
)

expectMatches(handleLogin, /const\s+deviceId\s*=\s*getMemberAuthDeviceId\(\)/, 'handleLogin 使用稳定会员登录 deviceId')
expect(Boolean(loginGeneration), 'handleLogin 生成并捕获 request generation')
expect(loginTry.length > 0 && loginCatch.length > 0 && loginFinally.length > 0, 'handleLogin 分别包含 try/catch/finally')
expectMatches(loginTry, /const\s+(?:result|res)\s*=\s*await\s+memberLogin\(phone,\s*code,\s*deviceId\)/, 'handleLogin try 调用真实登录 API')
expectGuardBeforeUpdate(
  loginTry,
  generationGuardPattern(loginGeneration),
  /options\.onAuthenticated\s*\(/,
  'handleLogin try 在认证成功回调前拒绝迟到 generation',
)
expectGuardBeforeUpdate(
  loginCatch,
  generationGuardPattern(loginGeneration),
  /(?:set(?:Error|Notice|Loading)|raiseError)\s*\(/,
  'handleLogin catch 在任何错误/loading 副作用前拒绝迟到 generation',
)
expectGuardBeforeUpdate(
  loginCatch,
  generationGuardPattern(loginGeneration),
  /(?:set(?:Error|Notice)|raiseError)\s*\(/,
  'handleLogin catch guard 后执行真实错误更新',
)
expectGuardBeforeUpdate(
  loginFinally,
  generationGuardPattern(loginGeneration),
  /setLoading\s*\(/,
  'handleLogin finally 在清理 loading 前拒绝迟到 generation',
)
const usesCurrentRequestHelper = [sendTry, sendCatch, sendFinally, loginTry, loginCatch, loginFinally]
  .some((block) => /isCurrentRequest\s*\(/.test(block))
expect(!usesCurrentRequestHelper || validatesCurrentRequest(currentRequestHelper), 'isCurrentRequest helper 真实比较 generation 与当前 ref')
const raiseErrorDefined = /\b(?:const\s+raiseError\s*=|function\s+raiseError\s*\()/.test(memberHook)
const raiseErrorUsed = [sendCatch, loginCatch].some((block) => /\braiseError\s*\(/.test(block))
expect(
  (!raiseErrorDefined && !raiseErrorUsed)
    || (raiseErrorHelper.length > 0 && /set(?:Error|Notice)\s*\(/.test(raiseErrorHelper)),
  '若定义或调用 raiseError helper，其函数体真实更新 error/notice 状态',
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
expectMatches(resetSensitiveInput, /setPhone\(''\)/, 'resetSensitiveInput 清空手机号')
expectMatches(resetSensitiveInput, /setCode\(''\)/, 'resetSensitiveInput 清空验证码')
expectMatches(resetSensitiveInput, /setActiveInput\('phone'\)/, 'resetSensitiveInput 恢复手机号输入态')
expectMatches(resetSensitiveInput, /resetCountdown\(\)/, 'resetSensitiveInput 清空短信倒计时')
expectMatches(memberHook, /return\s*\{[\s\S]*?resetSensitiveInput/, '共享控制器向消费者暴露敏感输入重置能力')
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
  /import\s*\{(?=[^}]*\buseAuth\b)[^}]*\}\s*from\s*['"][^'"]*auth\/useAuth['"]/,
  'MemberLoginDialog 从真实 auth/useAuth 模块导入 useAuth',
)
expectMatches(loginDialog, /const\s*\{(?=[^}]*\blogin\b)[^}]*\}\s*=\s*useAuth\(\)/, 'MemberLoginDialog 获取真实 login handler')
expect(handleAuthenticated.length > 0, '已提取 handleAuthenticated 函数块')
expectMatches(
  handleAuthenticated,
  /login\(\{\s*id:\s*(?:result|res)\.user\.id,\s*phoneMasked:\s*(?:result|res)\.user\.phoneMasked,\s*nickname:\s*(?:result|res)\.user\.nickname,\s*token:\s*(?:result|res)\.token,\s*method:\s*'phone',?\s*\}\)/,
  'handleAuthenticated 把 LoginResult 完整映射到 AuthContext',
)
const authenticatedLoginIndex = patternIndex(handleAuthenticated, /\blogin\s*\(/)
const authenticatedNoticeIndex = patternIndex(handleAuthenticated, /\bonAuthenticated\s*\?\.\s*\(\s*\)/)
const authenticatedCloseIndex = targetCallIndex(handleAuthenticated, finalCloseName, dialogFunctions)
expect(
  authenticatedLoginIndex >= 0
    && authenticatedNoticeIndex > authenticatedLoginIndex
    && authenticatedCloseIndex > authenticatedNoticeIndex,
  'handleAuthenticated 先落真实会话、通知调用方，再进入共享关闭调用链',
)
expectMatches(
  loginDialog,
  /useMemberPhoneLogin\(\{[\s\S]*?onAuthenticated:\s*handleAuthenticated[\s\S]*?\}\)/,
  '共享手机号 hook 的认证成功回调接入真实会话 handler',
)

expectMatches(dialogJsx, /^<dialog\b[\s\S]*?className="member-login-dialog"/, '登录弹窗使用可达的原生 dialog 元素')
expect(openEffect.length > 0 && /\bopen\b/.test(openEffect), '已提取由 open 驱动的 dialog 打开 effect')
expect(
  Boolean(savedTriggerMatch) && savedTriggerMatch.index < showModalIndex,
  '打开 effect 在 showModal 前保存 document.activeElement（不锁定 ref 名）',
)
expect(
  showModalIndex >= 0
    && ((explicitFocusIndex > showModalIndex && (directFocusTarget || paneFocusTarget || queryFocusTarget)) || autoFocusTarget),
  'showModal 后聚焦弹窗内可交互的手机号 input/button（允许 ref/querySelector/autoFocus）',
)
expect(finalCloseBlock.length > 0, '已捕获包含 cancelPending/dialog.close/onClose 的共享最终关闭函数')
const cancelPendingIndex = patternIndex(finalCloseBlock, /cancelPending\s*\(\s*\)/)
const resetSensitiveInputIndex = patternIndex(finalCloseBlock, /resetSensitiveInput\s*\(\s*\)/)
const resetAgreementIndex = patternIndex(finalCloseBlock, /setAgreed\(false\)/)
const nativeCloseIndex = patternIndex(finalCloseBlock, /\.close\s*\(\s*\)/)
const onCloseIndex = patternIndex(finalCloseBlock, /\bonClose\s*(?:\?\.)?\s*\(\s*\)/)
const restoreFocusIndex = patternIndex(finalCloseBlock, /(?:\?\.)?focus\s*\(\s*\)/)
expect(
  cancelPendingIndex >= 0 && resetSensitiveInputIndex > cancelPendingIndex
    && resetAgreementIndex > resetSensitiveInputIndex
    && nativeCloseIndex > resetAgreementIndex && onCloseIndex >= 0
    && restoreFocusIndex > nativeCloseIndex && restoreFocusIndex > onCloseIndex,
  '共享最终关闭函数先失效请求并清空手机号/验证码/协议勾选，再关闭 dialog 且恢复焦点',
)
const focusPrefix = restoreFocusIndex >= 0 ? finalCloseBlock.slice(Math.min(nativeCloseIndex, onCloseIndex), restoreFocusIndex + 16) : ''
expect(
  /\.isConnected\b/.test(focusPrefix)
    || /document(?:\.[A-Za-z_$][\w$]*)?\.contains\s*\(/.test(focusPrefix)
    || /\?\.focus\s*\(/.test(focusPrefix)
    || /try\s*\{[\s\S]*?(?:\?\.)?focus\s*\(/.test(focusPrefix),
  '焦点恢复使用 isConnected/document.contains/可选链/try 等存在性保护',
)
expect(Boolean(savedTriggerRef) && finalCloseBlock.includes(savedTriggerRef), '共享最终关闭函数恢复打开 effect 保存的同一触发元素')
const cancelPreventIndex = patternIndex(cancelHandler, /\.preventDefault\s*\(\s*\)/)
const cancelCloseIndex = cancelHandlerName === finalCloseName || cancelInlineDelegate === finalCloseName
  ? patternIndex(cancelHandler, /\.close\s*\(\s*\)/)
  : targetCallIndex(cancelHandler, finalCloseName, dialogFunctions)
expect(cancelPreventIndex >= 0 && cancelCloseIndex > cancelPreventIndex, 'onCancel / Escape 先 preventDefault 再进入共享关闭调用链')
expectMatches(dialogJsx, /aria-labelledby="member-login-dialog-title"/, '登录弹窗关联可访问标题')
expectMatches(dialogJsx, /id="member-login-dialog-title"[^>]*>手机号登录/, '登录弹窗提供冻结标题')
expect(closeButton.length > 0, '登录弹窗保留显式关闭按钮')
const closeButtonCallIndex = closeButtonHandlerName === finalCloseName
  ? 0
  : targetCallIndex(closeButtonHandler, finalCloseName, dialogFunctions)
expect(closeButtonCallIndex >= 0 && Boolean(finalCloseName), '显式关闭按钮 handler 最终进入共享关闭调用链')
expectMatches(
  closeButton,
  /(?:^|>)[^<{]*关闭[^<{]*(?:<|$)/,
  '显式关闭按钮提供可见关闭文案',
)
expectMatches(loginDialog, /继续游客体验/, '登录弹窗保留继续游客体验操作')
expect(handleContinueAsGuest.length > 0, '已提取 handleContinueAsGuest 函数块')
expect(
  patternIndex(handleContinueAsGuest, /onContinueAsGuest\s*\(\s*\)/) >= 0
    && targetCallIndex(handleContinueAsGuest, finalCloseName, dialogFunctions)
      > patternIndex(handleContinueAsGuest, /onContinueAsGuest\s*\(\s*\)/),
  '游客 handler 先进入真实游客态，再进入共享关闭调用链',
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
  /pnpm --filter @ai-job-print\/kiosk verify:home-prototype-v1\s*\n\s*pnpm --filter @ai-job-print\/kiosk verify:member-login-dialog/,
  'CI 在 verify:home-prototype-v1 后紧跟登录弹窗合同（首页重建为 prototype-v1，守卫更名）',
)

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项失败 — Kiosk 真实会员登录弹窗尚未满足冻结合同\n`)
  process.exit(1)
}

console.log('\nALL PASS — Kiosk 真实会员登录弹窗符合冻结合同\n')
