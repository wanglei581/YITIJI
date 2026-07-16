// Admin 从 Partner 安全转移手机号 UI 防回退验证（静态门禁，不连服务）。
// Task 4 先锁定严格 adapter；Task 5 再补齐独立组件与既有账号设置入口。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const authPath = join(root, 'src/services/auth/index.ts')
const componentPath = join(root, 'src/routes/account-settings/AdminPhoneTransferCard.tsx')

console.log('\n=== Admin 手机号安全转移 UI verification ===')

if (!existsSync(authPath)) {
  console.error('  FAIL Missing required file: src/services/auth/index.ts')
  process.exit(1)
}

const authSource = readFileSync(authPath, 'utf8')
const AUTH_STORAGE_KEY = 'admin_auth_v1'
const VALID_BIND_TICKET = '2db6a54a-c472-4477-a8fe-2dcdde4eceb5'
const VALID_PHONE_VERIFIED_AT = '2026-07-16T00:00:00.000Z'
const CURRENT_PASSWORD = 'CurrentPassword!'
const PLAIN_PHONE = '13812341234'
const OTP_CODE = '654321'
const INITIAL_AUTH_STATE = {
  token: 'adapter-test-token',
  user: { id: 'admin-1', name: 'Admin', role: 'admin', orgId: null },
}
const VALID_SOURCE_ACCOUNT = {
  username: 'partner-user',
  organizationName: '协作机构',
  phoneMasked: '138****1234',
}

const failures = []

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  failures.push(message)
  console.error(`  FAIL ${message}`)
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function createAdminAuthAdapterHarness(responses) {
  const storage = new Map([[AUTH_STORAGE_KEY, JSON.stringify(INITIAL_AUTH_STATE)]])
  const initialStoredState = storage.get(AUTH_STORAGE_KEY)
  const requests = []
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
  const fetch = async (url, init = {}) => {
    requests.push({
      url: String(url),
      method: init.method,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    })
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
  const transpiled = ts.transpileModule(authSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'auth/index.ts',
  })
  new Script(transpiled.outputText, { filename: 'auth/index.js' }).runInContext(context)
  return {
    auth: module.exports,
    initialStoredState,
    requests,
    storedState: () => storage.get(AUTH_STORAGE_KEY),
    writes: () => writes,
  }
}

function okResponse(data) {
  return { status: 200, body: { data } }
}

function validStartData(overrides = {}) {
  return {
    bindTicket: VALID_BIND_TICKET,
    cooldownSeconds: 60,
    expiresInSeconds: 300,
    sourceAccount: { ...VALID_SOURCE_ACCOUNT },
    ...overrides,
  }
}

function assertNoSensitivePersistence(harness, label) {
  const stored = harness.storedState() ?? ''
  for (const sensitive of [CURRENT_PASSWORD, PLAIN_PHONE, OTP_CODE, VALID_BIND_TICKET]) {
    expect(!stored.includes(sensitive), `${label} must not persist sensitive request data`)
  }
}

async function verifyAdminPhoneTransferAdapterBehavior() {
  for (const name of ['startAdminPhoneTransfer', 'verifyAdminPhoneTransfer', 'cancelAdminPhoneTransfer']) {
    expect(typeof createAdminAuthAdapterHarness([]).auth[name] === 'function', `missing ${name} adapter`)
  }

  const invalidStartResponses = [
    ['non-UUID ticket', validStartData({ bindTicket: 'ticket' })],
    ['negative cooldown', validStartData({ cooldownSeconds: -1 })],
    ['out-of-range cooldown', validStartData({ cooldownSeconds: 301 })],
    ['non-integer expiry', validStartData({ expiresInSeconds: 299.5 })],
    ['zero expiry', validStartData({ expiresInSeconds: 0 })],
    ['out-of-range expiry', validStartData({ expiresInSeconds: 301 })],
    ['missing source account', (() => {
      const { sourceAccount: _sourceAccount, ...data } = validStartData()
      return data
    })()],
    ['empty username', validStartData({ sourceAccount: { ...VALID_SOURCE_ACCOUNT, username: ' ' } })],
    ['empty organization name', validStartData({ sourceAccount: { ...VALID_SOURCE_ACCOUNT, organizationName: '' } })],
    ['plaintext phone', validStartData({ sourceAccount: { ...VALID_SOURCE_ACCOUNT, phoneMasked: PLAIN_PHONE } })],
    ['malformed mask', validStartData({ sourceAccount: { ...VALID_SOURCE_ACCOUNT, phoneMasked: '138***1234' } })],
    ['extra source field', validStartData({ sourceAccount: { ...VALID_SOURCE_ACCOUNT, phone: PLAIN_PHONE } })],
    ['extra top-level field', { ...validStartData(), phone: PLAIN_PHONE }],
  ]
  for (const [label, data] of invalidStartResponses) {
    const harness = createAdminAuthAdapterHarness([okResponse(data)])
    const result = await harness.auth.startAdminPhoneTransfer(CURRENT_PASSWORD, PLAIN_PHONE)
    expect(!result.ok && result.code === 'INVALID_RESPONSE', `start must reject ${label}`)
    expect(harness.storedState() === harness.initialStoredState && harness.writes() === 0, `start must not persist ${label}`)
    assertNoSensitivePersistence(harness, `invalid start (${label})`)
  }

  const validStartHarness = createAdminAuthAdapterHarness([okResponse(validStartData())])
  const validStart = await validStartHarness.auth.startAdminPhoneTransfer(CURRENT_PASSWORD, PLAIN_PHONE)
  expect(validStart.ok && validStart.bindTicket === VALID_BIND_TICKET, 'start must accept an exact bounded UUID response')
  expect(validStart.sourceAccount.username === VALID_SOURCE_ACCOUNT.username, 'start must expose the validated source username')
  expect(validStart.sourceAccount.organizationName === VALID_SOURCE_ACCOUNT.organizationName, 'start must expose the validated organization name')
  expect(validStart.sourceAccount.phoneMasked === VALID_SOURCE_ACCOUNT.phoneMasked, 'start must expose only the validated masked phone')
  expect(validStartHarness.writes() === 0, 'start must never persist credentials, phone, OTP, or ticket')
  assertNoSensitivePersistence(validStartHarness, 'valid start')
  expect(validStartHarness.requests[0].url.endsWith('/auth/admin/phone/transfer/start'), 'start must call the dedicated Admin transfer endpoint')
  expect(validStartHarness.requests[0].method === 'POST', 'start must use POST')
  expect(
    JSON.stringify(validStartHarness.requests[0].body) === JSON.stringify({ currentPassword: CURRENT_PASSWORD, phone: PLAIN_PHONE }),
    'start must send only currentPassword and phone',
  )

  const startServerErrorHarness = createAdminAuthAdapterHarness([
    { status: 503, body: { error: { code: 'SMS_PROVIDER_UNAVAILABLE', message: 'provider unavailable' } } },
  ])
  const startServerError = await startServerErrorHarness.auth.startAdminPhoneTransfer(CURRENT_PASSWORD, PLAIN_PHONE)
  expect(!startServerError.ok && startServerError.status === 503, 'start must retain the HTTP failure status')

  const invalidVerifyResponses = [
    ['plaintext phone', { phoneMasked: PLAIN_PHONE, phoneVerifiedAt: VALID_PHONE_VERIFIED_AT }],
    ['malformed mask', { phoneMasked: '138***1234', phoneVerifiedAt: VALID_PHONE_VERIFIED_AT }],
    ['missing timestamp', { phoneMasked: VALID_SOURCE_ACCOUNT.phoneMasked }],
    ['non-canonical ISO', { phoneMasked: VALID_SOURCE_ACCOUNT.phoneMasked, phoneVerifiedAt: '2026-07-16T00:00:00Z' }],
    ['extra field', { phoneMasked: VALID_SOURCE_ACCOUNT.phoneMasked, phoneVerifiedAt: VALID_PHONE_VERIFIED_AT, phone: PLAIN_PHONE }],
  ]
  for (const [label, data] of invalidVerifyResponses) {
    const harness = createAdminAuthAdapterHarness([okResponse(data)])
    const result = await harness.auth.verifyAdminPhoneTransfer(VALID_BIND_TICKET, OTP_CODE)
    expect(!result.ok && result.code === 'INVALID_RESPONSE', `verify must reject ${label}`)
    expect(harness.storedState() === harness.initialStoredState && harness.writes() === 0, `verify must not persist ${label}`)
    assertNoSensitivePersistence(harness, `invalid verify (${label})`)
  }

  for (const phoneMasked of [VALID_SOURCE_ACCOUNT.phoneMasked, '***']) {
    const harness = createAdminAuthAdapterHarness([okResponse({ phoneMasked, phoneVerifiedAt: VALID_PHONE_VERIFIED_AT })])
    const result = await harness.auth.verifyAdminPhoneTransfer(VALID_BIND_TICKET, OTP_CODE)
    expect(result.ok && result.phoneMasked === phoneMasked, `verify must accept backend mask ${phoneMasked}`)
    const stored = JSON.parse(harness.storedState())
    expect(stored.user.phoneMasked === phoneMasked, 'verify may persist only the validated masked phone')
    expect(stored.user.phoneVerifiedAt === VALID_PHONE_VERIFIED_AT, 'verify must persist the validated canonical timestamp')
    expect(harness.writes() === 1, 'only a valid verify response may update the stored user')
    assertNoSensitivePersistence(harness, 'valid verify')
    expect(harness.requests[0].url.endsWith('/auth/admin/phone/transfer/verify'), 'verify must call the dedicated Admin transfer endpoint')
    expect(
      JSON.stringify(harness.requests[0].body) === JSON.stringify({ bindTicket: VALID_BIND_TICKET, code: OTP_CODE }),
      'verify must send only bindTicket and code',
    )
  }

  const verifyServerErrorHarness = createAdminAuthAdapterHarness([
    { status: 409, body: { error: { code: 'AUTH_PHONE_TRANSFER_UNAVAILABLE', message: 'unavailable' } } },
  ])
  const verifyServerError = await verifyServerErrorHarness.auth.verifyAdminPhoneTransfer(VALID_BIND_TICKET, OTP_CODE)
  expect(!verifyServerError.ok && verifyServerError.status === 409, 'verify must retain the HTTP failure status')

  for (const [label, data] of [
    ['cancelled:false', { cancelled: false }],
    ['missing cancelled', {}],
    ['extra field', { cancelled: true, bindTicket: VALID_BIND_TICKET }],
  ]) {
    const harness = createAdminAuthAdapterHarness([okResponse(data)])
    const result = await harness.auth.cancelAdminPhoneTransfer(VALID_BIND_TICKET)
    expect(!result.ok && result.code === 'INVALID_RESPONSE', `cancel must reject ${label}`)
    expect(harness.storedState() === harness.initialStoredState && harness.writes() === 0, `cancel must not persist ${label}`)
    assertNoSensitivePersistence(harness, `invalid cancel (${label})`)
  }

  const validCancelHarness = createAdminAuthAdapterHarness([okResponse({ cancelled: true })])
  const validCancel = await validCancelHarness.auth.cancelAdminPhoneTransfer(VALID_BIND_TICKET)
  expect(validCancel.ok, 'cancel must accept the exact strict success response')
  expect(validCancelHarness.writes() === 0, 'cancel must never persist the ticket')
  assertNoSensitivePersistence(validCancelHarness, 'valid cancel')
  expect(validCancelHarness.requests[0].url.endsWith('/auth/admin/phone/transfer/cancel'), 'cancel must call the dedicated Admin transfer endpoint')
  expect(
    JSON.stringify(validCancelHarness.requests[0].body) === JSON.stringify({ bindTicket: VALID_BIND_TICKET }),
    'cancel must send only bindTicket',
  )

  const cancelServerErrorHarness = createAdminAuthAdapterHarness([
    { status: 500, body: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'server error' } } },
  ])
  const cancelServerError = await cancelServerErrorHarness.auth.cancelAdminPhoneTransfer(VALID_BIND_TICKET)
  expect(!cancelServerError.ok && cancelServerError.status === 500, 'cancel must retain the HTTP failure status')
}

try {
  await verifyAdminPhoneTransferAdapterBehavior()
  pass('Admin 手机号转移 adapter 严格拒绝异常/额外/明文 2xx，只持久化验证后的脱敏用户字段')
} catch (error) {
  fail(`Admin 手机号转移 adapter 运行时行为验证失败: ${error instanceof Error ? error.message : String(error)}`)
}

for (const token of ['console.log', 'console.error', 'localStorage', 'sessionStorage']) {
  const transferFunctionSources = ['startAdminPhoneTransfer', 'verifyAdminPhoneTransfer', 'cancelAdminPhoneTransfer']
    .map((name) => {
      const start = authSource.indexOf(`export async function ${name}`)
      if (start === -1) return ''
      const next = authSource.indexOf('\nexport ', start + 1)
      return authSource.slice(start, next === -1 ? authSource.length : next)
    })
    .join('\n')
  if (transferFunctionSources.includes(token)) fail(`Admin 手机号转移 adapter 不得使用 ${token} 处理敏感流程状态`)
}

if (existsSync(componentPath)) {
  pass('AdminPhoneTransferCard 已存在，Task 5 可继续验证独立内存状态机')
} else {
  fail('Missing required file: src/routes/account-settings/AdminPhoneTransferCard.tsx')
}

if (failures.length > 0) {
  console.error(`\n${failures.length} verification failure(s)`)
  process.exit(1)
}

console.log('\nALL PASS')
