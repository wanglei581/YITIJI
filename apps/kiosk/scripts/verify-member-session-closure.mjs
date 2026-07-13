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
  const positiveGuardIndex = positiveGuardPattern.exec(block)?.index ?? -1
  return positiveGuardIndex >= 0 && updateIndex > positiveGuardIndex
}

const loginPage = read('src/pages/auth/LoginPage.tsx')
const memberPhoneLoginHook = read('src/pages/auth/hooks/useMemberPhoneLogin.ts')
const authContext = read('src/auth/AuthContext.tsx')
const returnPath = read('src/auth/returnPath.ts')
const memberAuthDevice = read('src/services/auth/memberAuthDevice.ts')
const memberSessionEvents = read('src/services/auth/memberSessionEvents.ts')

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
    /await\s+memberLogin\(phone,\s*code,\s*deviceId\)/.test(loginTry) &&
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

console.log('\nALL PASS')
