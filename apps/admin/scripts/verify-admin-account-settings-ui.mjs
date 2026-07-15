// Admin 账号设置与修改密码 UI 防回退验证（静态门禁，不连服务）。
// 锁定：唯一顶栏入口、强密码保护，以及 Admin 严格首次手机号绑定的本地恢复语义。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = process.cwd()

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function sourceForFunction(source, name) {
  const start = source.indexOf(`export async function ${name}`)
  if (start === -1) return ''
  const next = source.indexOf('\nexport ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

const required = [
  'src/layouts/AdminLayoutWrapper.tsx',
  'src/routes/login/index.tsx',
  'src/routes/index.tsx',
  'src/routes/account-settings/index.tsx',
  'src/routes/account-settings/AdminInitialPhoneBindingCard.tsx',
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
const adminPhoneBindingCard = loaded['src/routes/account-settings/AdminInitialPhoneBindingCard.tsx']
const genericPhoneBindingCard = loaded['src/routes/account-settings/PhoneBindingCard.tsx']
const auth = loaded['src/services/auth/index.ts']
const resetPages = [
  loaded['src/routes/login/index.tsx'],
  loaded['../partner/src/routes/login/index.tsx'],
]
const partnerAuth = loaded['../partner/src/services/auth/index.ts']

const AUTH_STORAGE_KEY = 'admin_auth_v1'
const VALID_BIND_TICKET = '2db6a54a-c472-4477-a8fe-2dcdde4eceb5'
const VALID_PHONE_VERIFIED_AT = '2026-07-15T00:00:00.000Z'
const INITIAL_AUTH_STATE = {
  token: 'adapter-test-token',
  user: { id: 'admin-1', name: 'Admin', role: 'admin', orgId: null },
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function createAdminAuthAdapterHarness(responses) {
  const storage = new Map([[AUTH_STORAGE_KEY, JSON.stringify(INITIAL_AUTH_STATE)]])
  const initialStoredState = storage.get(AUTH_STORAGE_KEY)
  let writes = 0
  const localStorage = {
    getItem(key) {
      return storage.get(key) ?? null
    },
    setItem(key, value) {
      writes += 1
      storage.set(key, String(value))
    },
    removeItem(key) {
      storage.delete(key)
    },
  }
  const fetch = async () => {
    const next = responses.shift()
    if (next instanceof Error) throw next
    if (!next) throw new Error('Missing stubbed fetch response')
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      statusText: next.statusText ?? '',
      json: async () => next.body,
    }
  }
  const module = { exports: {} }
  const context = createContext({
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === '../api/client') return { API_BASE_URL: 'https://adapter-test.invalid' }
      throw new Error(`Unexpected module: ${specifier}`)
    },
    fetch,
    localStorage,
    window: { location: { pathname: '/account-settings', href: '' } },
  })
  const transpiled = ts.transpileModule(auth, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'auth/index.ts',
  })
  new Script(transpiled.outputText, { filename: 'auth/index.js' }).runInContext(context)
  return {
    auth: module.exports,
    storedState: () => storage.get(AUTH_STORAGE_KEY),
    initialStoredState,
    writes: () => writes,
  }
}

function okResponse(data) {
  return { status: 200, body: { data } }
}

async function verifyAdminInitialPhoneBindAdapterBehavior() {
  const invalidStartResponses = [
    ['non-UUID ticket', { bindTicket: 'ticket', cooldownSeconds: 60, expiresInSeconds: 300 }],
    ['out-of-range cooldown', { bindTicket: VALID_BIND_TICKET, cooldownSeconds: 301, expiresInSeconds: 300 }],
    ['non-integer expiry', { bindTicket: VALID_BIND_TICKET, cooldownSeconds: 60, expiresInSeconds: 299.5 }],
    ['zero expiry', { bindTicket: VALID_BIND_TICKET, cooldownSeconds: 60, expiresInSeconds: 0 }],
  ]
  for (const [label, data] of invalidStartResponses) {
    const harness = createAdminAuthAdapterHarness([okResponse(data)])
    const result = await harness.auth.startAdminInitialPhoneBind('CurrentPassword!', '13812341234')
    expect(!result.ok && result.code === 'INVALID_RESPONSE', `start must reject ${label}`)
    expect(harness.storedState() === harness.initialStoredState && harness.writes() === 0, `start must not persist ${label}`)
  }

  const validStartHarness = createAdminAuthAdapterHarness([
    okResponse({ bindTicket: VALID_BIND_TICKET, cooldownSeconds: 60, expiresInSeconds: 300 }),
  ])
  const validStart = await validStartHarness.auth.startAdminInitialPhoneBind('CurrentPassword!', '13812341234')
  expect(validStart.ok && validStart.bindTicket === VALID_BIND_TICKET, 'start must accept a bounded UUID response')
  expect(validStartHarness.writes() === 0, 'start must never persist a ticket')

  const invalidVerifyResponses = [
    ['plaintext phone', { phoneMasked: '13812341234', phoneVerifiedAt: VALID_PHONE_VERIFIED_AT }],
    ['malformed mask', { phoneMasked: '138***1234', phoneVerifiedAt: VALID_PHONE_VERIFIED_AT }],
    ['non-canonical ISO', { phoneMasked: '138****1234', phoneVerifiedAt: '2026-07-15T00:00:00Z' }],
  ]
  for (const [label, data] of invalidVerifyResponses) {
    const harness = createAdminAuthAdapterHarness([okResponse(data)])
    const result = await harness.auth.verifyAdminInitialPhoneBind(VALID_BIND_TICKET, '123456')
    expect(!result.ok && result.code === 'INVALID_RESPONSE', `verify must reject ${label}`)
    expect(harness.storedState() === harness.initialStoredState && harness.writes() === 0, `verify must not persist ${label}`)
  }

  for (const phoneMasked of ['138****1234', '***']) {
    const harness = createAdminAuthAdapterHarness([okResponse({ phoneMasked, phoneVerifiedAt: VALID_PHONE_VERIFIED_AT })])
    const result = await harness.auth.verifyAdminInitialPhoneBind(VALID_BIND_TICKET, '123456')
    expect(result.ok && result.phoneMasked === phoneMasked, `verify must accept backend mask ${phoneMasked}`)
    const stored = JSON.parse(harness.storedState())
    expect(stored.user.phoneMasked === phoneMasked, 'verify may persist only the validated masked phone')
    expect(stored.user.phoneVerifiedAt === VALID_PHONE_VERIFIED_AT, 'verify must persist the validated canonical timestamp')
    expect(harness.writes() === 1, 'only a valid verify response may update the stored user')
  }
}

try {
  await verifyAdminInitialPhoneBindAdapterBehavior()
  pass('Admin 严格绑定 adapter 已在隔离 VM 中拒绝异常或明文 2xx，且只持久化有效脱敏响应')
} catch (error) {
  fail(`Admin 严格绑定 adapter 运行时行为验证失败: ${error instanceof Error ? error.message : String(error)}`)
}

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
  page.includes("user?.role === 'admin' && !user.phoneMasked") &&
  page.includes('<AdminInitialPhoneBindingCard') &&
  page.includes('{ ...current, ...phone }') &&
  !page.includes("from './PhoneBindingCard'") &&
  !page.includes('<PhoneBindingCard')
) {
  pass('仅未绑定的已登录 Admin 显示专用首次绑定卡，且不可变更新当前用户')
} else {
  fail('Admin 首次绑定必须只使用专用卡片；user=null、非 Admin 或已绑定账号均不能显示')
}

if (
  page.includes('phoneBindingSuccess') &&
  page.includes('phoneBindingSuccess.phoneMasked') &&
  page.includes('role="status"') &&
  page.includes('aria-live="polite"')
) {
  pass('绑定成功后页面立即显示仅含脱敏手机号的可访问反馈')
} else {
  fail('绑定成功反馈必须仅展示脱敏手机号，并使用 status + polite live region')
}

const startAdminInitialPhoneBind = sourceForFunction(auth, 'startAdminInitialPhoneBind')
const verifyAdminInitialPhoneBind = sourceForFunction(auth, 'verifyAdminInitialPhoneBind')
if (
  startAdminInitialPhoneBind.includes("'/auth/admin/phone/initial-bind/start'") &&
  startAdminInitialPhoneBind.includes('{ currentPassword, phone }') &&
  startAdminInitialPhoneBind.includes('postJson<unknown>') &&
  startAdminInitialPhoneBind.includes('isValidAdminInitialPhoneBindStartResponse(r.data)') &&
  !startAdminInitialPhoneBind.includes("'/auth/phone/initial-bind/start'") &&
  verifyAdminInitialPhoneBind.includes("'/auth/admin/phone/initial-bind/verify'") &&
  verifyAdminInitialPhoneBind.includes('{ bindTicket, code }') &&
  verifyAdminInitialPhoneBind.includes('postJson<unknown>') &&
  verifyAdminInitialPhoneBind.includes('isValidAdminInitialPhoneBindVerifyResponse(r.data)') &&
  !verifyAdminInitialPhoneBind.includes("'/auth/phone/initial-bind/verify'")
) {
  pass('Admin adapter 仅调用严格首次绑定端点，且不回退到通用路径')
} else {
  fail('Admin adapter 必须使用严格端点、运行时验证 2xx 数据，且不能走通用路径')
}

if (
  auth.includes('Number.isSafeInteger(value) && value >= 0 && value <= 300') &&
  auth.includes('UUID') &&
  auth.includes("/^1[3-9]\\d\\*{4}\\d{4}$/") &&
  auth.includes("value === '***'") &&
  auth.includes('new Date(value).toISOString() === value') &&
  auth.includes("code: 'INVALID_RESPONSE'") &&
  auth.includes("message: '服务响应异常，请稍后再试'")
) {
  pass('Admin adapter 对 ticket、秒数、脱敏手机号和时间戳执行严格运行时 guard')
} else {
  fail('Admin adapter 缺少 UUID、0..300 安全整数、脱敏手机号或 canonical ISO 的严格 guard')
}

const verifyGuardIndex = verifyAdminInitialPhoneBind.indexOf('isValidAdminInitialPhoneBindVerifyResponse(r.data)')
const verifyMergeIndex = verifyAdminInitialPhoneBind.indexOf('mergeStoredUser(bound)')
if (
  verifyGuardIndex !== -1 &&
  verifyMergeIndex > verifyGuardIndex &&
  verifyAdminInitialPhoneBind.includes("const bound = { phoneMasked: r.data.phoneMasked, phoneVerifiedAt: r.data.phoneVerifiedAt }") &&
  !auth.includes('console.log(bindTicket)') &&
  !auth.includes('console.log(code)')
) {
  pass('仅验证成功且 shape 合法后才合并脱敏用户字段，且不记录绑定凭据或验证码')
} else {
  fail('verify 只能在 shape guard 成功后合并脱敏字段，且不得记录敏感绑定数据')
}

for (const token of [
  'const [currentPassword, setCurrentPassword] = useState',
  'const [phone, setPhone] = useState',
  'const [code, setCode] = useState',
  'const [bindTicket, setBindTicket] = useState',
  'const [cooldownSeconds, setCooldownSeconds] = useState',
  'const [ticketExpiresAt, setTicketExpiresAt] = useState',
  'const [submitting, setSubmitting] = useState',
  'const [message, setMessage] = useState',
  'startAdminInitialPhoneBind(currentPassword, phone)',
  'verifyAdminInitialPhoneBind(bindTicket, code)',
  'autoComplete="current-password"',
  'autoComplete="one-time-code"',
  '请输入有效的中国大陆手机号',
  '请输入 6 位数字验证码',
]) {
  if (!adminPhoneBindingCard.includes(token)) fail(`Admin 专用首次绑定卡缺少 ${token}`)
}

if (
  !adminPhoneBindingCard.includes('localStorage') &&
  !adminPhoneBindingCard.includes('sessionStorage') &&
  !adminPhoneBindingCard.includes('console.') &&
  !adminPhoneBindingCard.includes('mergeStoredUser') &&
  !adminPhoneBindingCard.includes("'/auth/phone/initial-bind") &&
  !adminPhoneBindingCard.includes('startInitialPhoneBind') &&
  !adminPhoneBindingCard.includes('completeInitialPhoneBind') &&
  !/\{bindTicket\}/.test(adminPhoneBindingCard) &&
  !/value=\{bindTicket\}/.test(adminPhoneBindingCard) &&
  !/data-[\w-]*ticket/.test(adminPhoneBindingCard)
) {
  pass('Admin 专用卡片不持久化、记录或渲染密码、验证码或 ticket，也不调用通用 adapter')
} else {
  fail('Admin 专用卡片泄露敏感状态、回退到通用 adapter，或将 ticket 放进 DOM')
}

if (
  adminPhoneBindingCard.includes('if (bindTicket || submitting || cooldownSeconds > 0) return') &&
  adminPhoneBindingCard.includes("result.code === 'NETWORK_ERROR' || result.code === 'INVALID_RESPONSE'") &&
  adminPhoneBindingCard.includes('setCooldownSeconds(300)') &&
  adminPhoneBindingCard.includes('请等待 5 分钟后重试')
) {
  pass('发码期间、活动 ticket 和未知发送结果均不能重复发送；未知结果保守锁定 300 秒')
} else {
  fail('发码必须阻止重复发送，且 NETWORK_ERROR/INVALID_RESPONSE 必须保守锁定 300 秒')
}

const redirectsAfterUncertainVerification = /if \(requiresLoginAfterUncertainVerification\(result\.code\)\) \{\s*clearVerificationState\(\)\s*redirectToLogin\(\)\s*return/.test(adminPhoneBindingCard)

if (
  adminPhoneBindingCard.includes('function clearVerificationState()') &&
  adminPhoneBindingCard.includes('setBindTicket(null)') &&
  adminPhoneBindingCard.includes('setTicketExpiresAt(null)') &&
  adminPhoneBindingCard.includes("setCode('')") &&
  adminPhoneBindingCard.includes('requiresRestartAfterVerificationFailure(result.code)') &&
  adminPhoneBindingCard.includes("'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE'") &&
  redirectsAfterUncertainVerification &&
  adminPhoneBindingCard.includes("code === 'NETWORK_ERROR'") &&
  adminPhoneBindingCard.includes("code === 'INVALID_RESPONSE'") &&
  adminPhoneBindingCard.includes('/^HTTP_5\\d{2}$/') &&
  !adminPhoneBindingCard.includes('请刷新页面后确认绑定状态') &&
  adminPhoneBindingCard.includes('ticketExpiresAt <= Date.now()') &&
  adminPhoneBindingCard.includes('window.setInterval') &&
  adminPhoneBindingCard.includes('return () => window.clearInterval(timer)')
) {
  pass('验证码到期、已知验证失败与不确定的 NETWORK/INVALID/HTTP_5xx 结果都会清理 ticket；后者强制重新登录')
} else {
  fail('Admin 专用卡必须在 ticket 到期、验证失败或不确定结果后安全清理；NETWORK/INVALID/HTTP_5xx 必须重新登录')
}

if (
  adminPhoneBindingCard.includes('<form onSubmit={requestCode}') &&
  adminPhoneBindingCard.includes('<form onSubmit={verifyCode}')
) {
  pass('Enter 会根据是否存在活动 ticket 分流为发码或验证')
} else {
  fail('Admin 专用卡必须支持无 ticket 时 Enter 发码、有 ticket 时 Enter 验证')
}

if (
  genericPhoneBindingCard.includes('export function PhoneBindingCard') &&
  genericPhoneBindingCard.includes('startInitialPhoneBind') &&
  genericPhoneBindingCard.includes('completeInitialPhoneBind')
) {
  pass('通用 PhoneBindingCard 保留为既有通用/Partner 能力，不作为 Admin 入口改写')
} else {
  fail('现有通用 PhoneBindingCard 必须保留，不能被 Admin 专用改造替换')
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
