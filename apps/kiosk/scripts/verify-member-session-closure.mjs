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

const loginPage = read('src/pages/auth/LoginPage.tsx')
const authContext = read('src/auth/AuthContext.tsx')
const memberAuthDevice = read('src/services/auth/memberAuthDevice.ts')
const memberSessionEvents = read('src/services/auth/memberSessionEvents.ts')

assert(
  loginPage.includes('getMemberAuthDeviceId') &&
    /const\s+deviceId\s*=\s*getMemberAuthDeviceId\(\)/.test(loginPage) &&
    loginPage.includes('sendSmsCode(phone, deviceId)') &&
    loginPage.includes('memberLogin(phone, code, deviceId)'),
  '手机号验证码发送与登录都传入会员登录 deviceId',
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
    !authContext.includes('resetMemberAuthDevice') &&
    authContext.includes('userRef.current?.token !== failedToken'),
  'AuthProvider 订阅会员 API 失效事件，只清空仍匹配失败 token 的内存会话，不重置风控 deviceId',
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
