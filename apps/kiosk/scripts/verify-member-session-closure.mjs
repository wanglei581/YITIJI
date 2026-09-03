import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
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
  const open = source.indexOf('{', arrow)
  const body = extractBalancedBlock(source, open)
  return arrow >= 0 && body ? source.slice(declaration.index, open + body.length) : ''
}

function extractKeywordBlock(source, keyword) {
  const match = new RegExp(`\\b${keyword}\\b(?:\\s*\\([^)]*\\))?\\s*\\{`).exec(source)
  if (!match) return ''
  return extractBalancedBlock(source, source.indexOf('{', match.index))
}

function hasGuardBefore(block, generation, updatePattern) {
  if (!block || !generation) return false
  const negativeGuardPattern = new RegExp(
    `if\\s*\\(\\s*!\\s*isCurrentRequest\\(\\s*${generation}\\s*\\)\\s*\\)\\s*(?:\\{\\s*)?return\\b`,
  )
  const updateIndex = updatePattern.exec(block)?.index ?? -1
  const negativeGuardIndex = negativeGuardPattern.exec(block)?.index ?? -1
  if (negativeGuardIndex >= 0 && updateIndex > negativeGuardIndex) return true

  const positiveGuardPattern = new RegExp(
    `if\\s*\\(\\s*isCurrentRequest\\(\\s*${generation}\\s*\\)\\s*\\)\\s*\\{`,
  )
  const positiveGuard = positiveGuardPattern.exec(block)
  if (!positiveGuard) return false
  const guardOpenIndex = positiveGuard.index + positiveGuard[0].lastIndexOf('{')
  const guardedBlock = extractBalancedBlock(block, guardOpenIndex)
  return guardedBlock.length > 0 && updatePattern.test(guardedBlock)
}

assert(
  !hasGuardBefore(
    '{ if (isCurrentRequest(generation)) {} setLoading(false) }',
    'generation',
    /setLoading\s*\(/,
  ),
  'generation 门禁解析器拒绝空正向 guard 后的无条件更新',
)

const loginPage = read('src/pages/auth/LoginPage.tsx')
const memberPhoneLoginHook = read('src/pages/auth/hooks/useMemberPhoneLogin.ts')
const authContext = read('src/auth/AuthContext.tsx')
const returnPath = read('src/auth/returnPath.ts')
const memberAuthDevice = read('src/services/auth/memberAuthDevice.ts')
const memberSessionEvents = read('src/services/auth/memberSessionEvents.ts')
const sessionResumePage = read('src/pages/session-resume/SessionResumePage.tsx')
const pendingTasksApi = read('src/services/api/pendingTasks.ts')
const kioskSessionControl = read('src/auth/KioskSessionControlContext.tsx')
const kioskPrivacyGuard = read('src/auth/KioskPrivacyGuard.tsx')
const profilePage = read('src/pages/profile/ProfilePage.tsx')
const mySettingsPage = read('src/pages/profile/me/MySettingsPage.tsx')

const handleSendCode = extractConstFunction(memberPhoneLoginHook, 'handleSendCode')
const handleLogin = extractConstFunction(memberPhoneLoginHook, 'handleLogin')
const cancelPending = extractConstFunction(memberPhoneLoginHook, 'cancelPending')
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

assert(
  /const\s+deviceId\s*=\s*getMemberAuthDeviceId\(\)/.test(handleSendCode) &&
    /await\s+sendSmsCode\(phone,\s*deviceId\)/.test(sendTry) &&
    /const\s+deviceId\s*=\s*getMemberAuthDeviceId\(\)/.test(handleLogin) &&
    /await\s+memberLogin\(phone,\s*code,\s*consent,\s*deviceId\)/.test(loginTry) &&
    !/\b(?:sendSmsCode|memberLogin)\s*\(/.test(loginPage),
  '共享手机号验证码发送与登录都传入会员登录 deviceId，LoginPage 不复制认证调用',
)

assert(
  /requestGenerationRef\.current\s*===\s*generation|generation\s*===\s*requestGenerationRef\.current/.test(
    memberPhoneLoginHook,
  ) &&
    hasGuardBefore(sendTry, sendGeneration, /(?:countdown\.start|setNotice|setActiveInput)\s*\(/) &&
    hasGuardBefore(sendCatch, sendGeneration, /(?:raiseError|setError)\s*\(/) &&
    hasGuardBefore(sendFinally, sendGeneration, /setLoading\s*\(/) &&
    hasGuardBefore(loginTry, loginGeneration, /options\.onAuthenticated\s*\(/) &&
    hasGuardBefore(loginCatch, loginGeneration, /(?:raiseError|setError)\s*\(/) &&
    hasGuardBefore(loginFinally, loginGeneration, /setLoading\s*\(/) &&
    /\+\+\s*requestGenerationRef\.current/.test(cancelPending) &&
    /setLoading\(false\)/.test(cancelPending) &&
    /setNotice\(null\)/.test(cancelPending) &&
    /setError\(null\)/.test(cancelPending),
  '共享手机号登录以 request generation 保护 success/catch/finally，cancelPending 会失效迟到响应并清理可见状态',
)

assert(
  memberAuthDevice.includes('getTerminalId') &&
    memberAuthDevice.includes('BROWSER_DEVICE_ID_STORAGE_KEY') &&
    memberAuthDevice.includes('window.localStorage') &&
    !memberAuthDevice.includes(':session:') &&
    !memberAuthDevice.includes('resetMemberAuthDevice') &&
    !/return\s+getTerminalId\(\)/.test(memberAuthDevice),
  'memberAuthDevice 使用稳定终端/浏览器设备标识，不直接返回裸 terminalId，也不随会员登出重置',
)

assert(
  memberSessionEvents.includes('notifyMemberSessionExpired') &&
    memberSessionEvents.includes('isMemberSessionInvalidError') &&
    memberSessionEvents.includes('usedMemberToken') &&
    memberSessionEvents.includes('failedToken'),
  '会员会话失效事件 helper 已定义，并要求会员 token 前提与失败 token 透传',
)

assert(
  authContext.includes('onMemberSessionExpired') &&
    authContext.includes('logout()') &&
    authContext.includes('sessionExpiredRedirectingRef') &&
    authContext.includes('!isLoginPath(window.location.pathname)') &&
    authContext.includes('window.location.assign(loginPathForCurrentLocation())') &&
    !authContext.includes('resetMemberAuthDevice') &&
    authContext.includes('userRef.current?.token !== failedToken'),
  'AuthProvider 订阅会员 API 失效事件，只清空仍匹配失败 token 的内存会话，不重置风控 deviceId，并安全回到登录页',
)

assert(
  returnPath.includes('isSafeInternalPath') &&
    returnPath.includes('loginPathForCurrentLocation') &&
    returnPath.includes("path.startsWith('/')") &&
    returnPath.includes("!path.startsWith('//')") &&
    returnPath.includes("!path.includes('\\\\')") &&
    returnPath.includes('isLoginPath') &&
    returnPath.includes("path.startsWith('/login?')") &&
    returnPath.includes("path.startsWith('/login#')"),
  '会员会话失效登录回跳只允许站内安全路径，并拒绝登录页自循环',
)

assert(
  loginPage.includes('new URLSearchParams(location.search)') &&
    loginPage.includes('isSafeInternalPath(queryFrom)') &&
    loginPage.includes('isSafeInternalPath(fromState)'),
  'LoginPage 对 state.from 与 query.from 使用同一站内安全回跳校验',
)

const memberServiceFiles = [
  'src/services/auth/memberAuthApi.ts',
  'src/services/api/memberAssets.ts',
  'src/services/api/memberFavorites.ts',
  'src/services/api/activity.ts',
  'src/services/api/memberPrintOrders.ts',
  'src/services/api/memberNotifications.ts',
  'src/services/api/memberFeedback.ts',
  'src/services/api/benefitActivities.ts',
  'src/services/api/aiHttpAdapter.ts',
  'src/services/api/filesHttpAdapter.ts',
  'src/services/api/jobFit.ts',
  'src/services/api/careerPlan.ts',
  'src/services/api/interview.ts',
  'src/services/api/materials.ts',
  'src/services/api/pendingTasks.ts',
]

for (const file of memberServiceFiles) {
  const source = read(file)
  assert(
    source.includes('notifyMemberSessionExpired') &&
      source.includes('isMemberSessionInvalidError') &&
      !source.includes('isMemberSessionInvalidError(res.status, code))'),
    `${file} 对带会员 token 的会话失效错误触发统一通知`,
  )
}

assert(
  pendingTasksApi.includes('/me/pending-tasks') &&
    /Authorization:\s*`Bearer \$\{token\}`/.test(pendingTasksApi) &&
    pendingTasksApi.includes("credentials: 'include'") &&
    pendingTasksApi.includes('notifyMemberSessionExpired') &&
    pendingTasksApi.includes('isMemberSessionInvalidError'),
  'pending-tasks 客户端调用真实 /me 端点并显式携带 AuthContext Bearer，统一处理会员会话失效',
)

assert(
  sessionResumePage.includes('useAuth') &&
    /const\s*\{[^}]*ready[^}]*isLoggedIn[^}]*getToken[^}]*\}\s*=\s*useAuth\(\)/s.test(sessionResumePage) &&
    /const\s+token\s*=\s*getToken\(\)/.test(sessionResumePage) &&
    /getPendingTasks\(token\)/.test(sessionResumePage) &&
    sessionResumePage.includes("navigate('/login'") &&
    !sessionResumePage.includes("`${API_BASE_URL}/me/pending-tasks`") &&
    !/fetch\s*\(/.test(sessionResumePage),
  'SessionResumePage 复用 useAuth 内存 token；未登录走统一登录页，不再发 credentials-only 的恒 401 请求',
)

assert(
  sessionResumePage.includes("task.resume.kind === 'payment'") &&
    sessionResumePage.includes("navigate('/print/cashier'") &&
    sessionResumePage.includes("navigate('/print/progress'") &&
    !sessionResumePage.includes('navigate(task.route)') &&
    sessionResumePage.includes("case 'pending'") &&
    sessionResumePage.includes("case 'claimed'") &&
    sessionResumePage.includes("case 'printing'"),
  'SessionResumePage 只把后端恢复动作映射到支付/打印两个固定站内路由，并诚实区分 pending/claimed/printing',
)

assert(
  kioskSessionControl.includes('clearSessionTo') &&
    kioskSessionControl.includes("path: '/' | '/profile'") &&
    kioskSessionControl.includes("path: '/login'") &&
    kioskPrivacyGuard.includes('pushSanitizedDestination') &&
    kioskPrivacyGuard.includes('establishPrivacyBoundary()') &&
    /clearSessionTo\(\{\s*path:\s*'\/profile'\s*\}\)/s.test(profilePage),
  'Profile 手动退出统一建立隐私 history boundary，不再直接清会话后留下 token-bearing 历史',
)

const settingsLogout = extractConstFunction(mySettingsPage, 'handleLogout')
const settingsSwitch = extractConstFunction(mySettingsPage, 'handleSwitch')
const settingsRebindDone = extractConstFunction(mySettingsPage, 'handleRebindDone')
assert(
  /clearSessionTo\(\{\s*path:\s*'\/profile'\s*\}\)/s.test(settingsLogout) &&
    /clearSessionTo\(\{\s*path:\s*'\/login',\s*state:\s*\{\s*from:\s*'\/profile'\s*\}\s*\}\)/s.test(settingsSwitch) &&
    /clearSessionTo\(\{[\s\S]*path:\s*'\/login',[\s\S]*from:\s*'\/profile'[\s\S]*hint:\s*'换绑成功，请用新手机号登录'/s.test(settingsRebindDone) &&
    !/\blogout\s*\(/.test(settingsLogout + settingsSwitch + settingsRebindDone),
  'MySettings 退出、切换账号、换绑完成均走同一隐私边界，并保留 /profile 与 /login 目的地语义',
)

assert(
  /value=\{oldOtp\}/.test(mySettingsPage) &&
    /value=\{newOtp\}/.test(mySettingsPage) &&
    /type="password"/.test(mySettingsPage) &&
    /me-otp-mask/.test(mySettingsPage) &&
    /aria-label="当前手机号验证码，已隐藏显示"/.test(mySettingsPage) &&
    /aria-label="新手机号验证码，已隐藏显示"/.test(mySettingsPage),
  '换绑验证码在公共屏隐藏显示，不把 6 位码打在大厅屏幕上',
)
assert(
  !/<input[^>]*type="tel"[^>]*value=\{oldOtp\}/.test(mySettingsPage) &&
    !/<input[^>]*type="tel"[^>]*value=\{newOtp\}/.test(mySettingsPage) &&
    !/<input[^>]*value=\{oldOtp\}[^>]*type="tel"/.test(mySettingsPage),
  '换绑验证码输入不再用可见 tel 明文',
)
assert(
  /timeoutMs:\s*45_000/.test(mySettingsPage) &&
    /enabled:\s*step !== 'done'/.test(mySettingsPage) &&
    /onIdle:\s*onCancel/.test(mySettingsPage),
  '换绑弹层 45 秒无操作自动关闭并清内存',
)
{
  const fixturePlainOtp = '<input type="tel" inputMode="numeric" maxLength={6} value={oldOtp} />'
  assert(
    /<input[^>]*type="tel"[^>]*value=\{oldOtp\}/.test(fixturePlainOtp),
    '换绑验证码明文夹具确实会被「禁止 tel 明文」断言抓住',
  )
}

console.log('\nALL PASS')
