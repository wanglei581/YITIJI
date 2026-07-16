// Admin 从 Partner 安全转移手机号 UI 防回退验证（隔离 VM，不连服务）。
// Task 4 锁定严格 adapter；Task 5 再补齐独立组件与既有账号设置入口。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const authPath = join(root, 'src/services/auth/index.ts')
const componentPath = join(root, 'src/routes/account-settings/AdminPhoneTransferCard.tsx')
const API_ORIGIN = 'https://adapter-test.invalid'
const AUTH_STORAGE_KEY = 'admin_auth_v1'
const START_PATH = '/auth/admin/phone/transfer/start'
const VERIFY_PATH = '/auth/admin/phone/transfer/verify'
const CANCEL_PATH = '/auth/admin/phone/transfer/cancel'

console.log('\n=== Admin 手机号安全转移 UI verification ===')

if (!existsSync(authPath)) {
  console.error('  FAIL Missing required file: src/services/auth/index.ts')
  process.exit(1)
}

const authSource = readFileSync(authPath, 'utf8')
const PASSWORD_SENTINEL = '__ADMIN_TRANSFER_PASSWORD_SENTINEL__'
// 合法中国大陆手机号，仅用于隔离 VM 哨兵；任何测试输出和持久化都必须拒绝它。
const PHONE_SENTINEL = '13812341234'
const OTP_SENTINEL = '__ADMIN_TRANSFER_OTP_SENTINEL__'
const TICKET_SENTINEL = '11111111-1111-4111-8111-111111111111'
const SENSITIVE_SENTINELS = [PASSWORD_SENTINEL, PHONE_SENTINEL, OTP_SENTINEL, TICKET_SENTINEL]
const VALID_PHONE_VERIFIED_AT = '2026-07-16T00:00:00.000Z'
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

function createTrackedStorage(entries = []) {
  const values = new Map(entries)
  let writes = 0
  const api = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      writes += 1
      values.set(key, String(value))
    },
    removeItem(key) {
      writes += 1
      values.delete(key)
    },
    clear() {
      writes += 1
      values.clear()
    },
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
  return {
    api,
    writes: () => writes,
    snapshot: () => JSON.stringify([...values.entries()].sort(([a], [b]) => a.localeCompare(b))),
  }
}

function createUrlTracker() {
  const state = {
    href: `${API_ORIGIN}/account-settings`,
    pathname: '/account-settings',
    search: '',
    hash: '',
  }
  let writes = 0
  const set = (key, value) => {
    writes += 1
    state[key] = String(value)
  }
  const location = {
    assign: (value) => set('href', value),
    replace: (value) => set('href', value),
    reload: () => { writes += 1 },
  }
  for (const key of ['href', 'pathname', 'search', 'hash']) {
    Object.defineProperty(location, key, {
      enumerable: true,
      get: () => state[key],
      set: (value) => set(key, value),
    })
  }
  const history = {
    pushState(_state, _unused, url) {
      writes += 1
      if (url !== undefined) state.href = String(url)
    },
    replaceState(_state, _unused, url) {
      writes += 1
      if (url !== undefined) state.href = String(url)
    },
  }
  return { location, history, writes: () => writes, snapshot: () => JSON.stringify(state) }
}

function renderConsoleValue(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function createConsoleSpy() {
  const calls = []
  const methods = new Map()
  const api = new Proxy(console, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      if (!methods.has(property)) {
        methods.set(property, (...args) => {
          calls.push({ method: String(property), text: args.map(renderConsoleValue).join(' ') })
        })
      }
      return methods.get(property)
    },
  })
  return { api, calls }
}

function createAdminAuthAdapterHarness(responses, options = {}) {
  const source = options.source ?? authSource
  const apiBaseUrl = options.apiBaseUrl ?? API_ORIGIN
  const local = createTrackedStorage([[AUTH_STORAGE_KEY, JSON.stringify(INITIAL_AUTH_STATE)]])
  const session = createTrackedStorage()
  const url = createUrlTracker()
  const consoleSpy = createConsoleSpy()
  const requests = []
  const fetch = async (requestUrl, init = {}) => {
    requests.push({
      url: String(requestUrl),
      method: init.method,
      headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key, String(value)])),
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
      if (specifier === '../api/client') return { API_BASE_URL: apiBaseUrl }
      throw new Error(`Unexpected module: ${specifier}`)
    },
    fetch,
    localStorage: local.api,
    sessionStorage: session.api,
    console: consoleSpy.api,
    window: {
      localStorage: local.api,
      sessionStorage: session.api,
      location: url.location,
      history: url.history,
    },
  })
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'auth/index.ts',
  })
  new Script(transpiled.outputText, { filename: 'auth/index.js' }).runInContext(context)
  return {
    auth: module.exports,
    requests,
    local,
    session,
    url,
    console: consoleSpy,
    baseline: {
      local: local.snapshot(),
      session: session.snapshot(),
      url: url.snapshot(),
    },
  }
}

function okResponse(data) {
  return { status: 200, body: { data } }
}

function validStartData(overrides = {}) {
  return {
    bindTicket: TICKET_SENTINEL,
    cooldownSeconds: 60,
    expiresInSeconds: 300,
    sourceAccount: { ...VALID_SOURCE_ACCOUNT },
    ...overrides,
  }
}

function hasExactKeys(value, expectedKeys) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
}

function assertNoSensitiveConsole(harness, label) {
  for (const call of harness.console.calls) {
    for (const sentinel of SENSITIVE_SENTINELS) {
      expect(!call.text.includes(sentinel), `${label} leaked a sensitive sentinel through console.${call.method}`)
    }
  }
}

function assertNoSensitivePersistence(harness, label) {
  const persisted = [harness.local.snapshot(), harness.session.snapshot(), harness.url.snapshot()].join('\n')
  for (const sentinel of SENSITIVE_SENTINELS) {
    expect(!persisted.includes(sentinel), `${label} persisted a sensitive sentinel`)
  }
}

function assertEffects(harness, label, expectedLocalWrites = 0) {
  assertNoSensitiveConsole(harness, label)
  assertNoSensitivePersistence(harness, label)
  expect(harness.local.writes() === expectedLocalWrites, `${label} localStorage write count must be ${expectedLocalWrites}`)
  expect(harness.session.writes() === 0, `${label} must not write sessionStorage`)
  expect(harness.url.writes() === 0, `${label} must not write URL or history state`)
  expect(harness.session.snapshot() === harness.baseline.session, `${label} must keep sessionStorage unchanged`)
  expect(harness.url.snapshot() === harness.baseline.url, `${label} must keep URL state unchanged`)
  if (expectedLocalWrites === 0) {
    expect(harness.local.snapshot() === harness.baseline.local, `${label} must keep localStorage unchanged`)
  }
}

function assertPostRequest(harness, path, body, label) {
  expect(harness.requests.length === 1, `${label} must issue exactly one request`)
  const request = harness.requests[0]
  expect(request.url === `${API_ORIGIN}${path}`, `${label} must use the exact API URL`)
  expect(request.method === 'POST', `${label} must use POST`)
  expect(
    hasExactKeys(request.headers, ['Content-Type', 'Accept', 'Authorization']) &&
      request.headers['Content-Type'] === 'application/json' &&
      request.headers.Accept === 'application/json' &&
      request.headers.Authorization === `Bearer ${INITIAL_AUTH_STATE.token}`,
    `${label} must preserve the authenticated JSON request headers`,
  )
  expect(JSON.stringify(request.body) === JSON.stringify(body), `${label} must send the exact request body`)
}

async function verifyAdminPhoneTransferAdapterBehavior() {
  const nativeNonFunctionProperty = Reflect.ownKeys(console)
    .find((property) => typeof Reflect.get(console, property, console) !== 'function')
  expect(nativeNonFunctionProperty !== undefined, 'console spy contract needs a native non-function property')
  const consoleContract = createConsoleSpy()
  expect(
    Reflect.get(consoleContract.api, nativeNonFunctionProperty) === Reflect.get(console, nativeNonFunctionProperty, console),
    'console Proxy must preserve native non-function properties',
  )

  for (const name of ['startAdminPhoneTransfer', 'verifyAdminPhoneTransfer', 'cancelAdminPhoneTransfer']) {
    expect(typeof createAdminAuthAdapterHarness([]).auth[name] === 'function', `missing ${name} adapter`)
  }

  const invalidStartResponses = [
    ['non-UUID ticket', validStartData({ bindTicket: 'not-a-uuid' })],
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
    ['plaintext phone', validStartData({ sourceAccount: { ...VALID_SOURCE_ACCOUNT, phoneMasked: PHONE_SENTINEL } })],
    ['malformed mask', validStartData({ sourceAccount: { ...VALID_SOURCE_ACCOUNT, phoneMasked: '138***1234' } })],
    ['extra source field', validStartData({ sourceAccount: { ...VALID_SOURCE_ACCOUNT, phone: PHONE_SENTINEL } })],
    ['extra top-level field', { ...validStartData(), phone: PHONE_SENTINEL }],
  ]
  for (const [label, data] of invalidStartResponses) {
    const harness = createAdminAuthAdapterHarness([okResponse(data)])
    const result = await harness.auth.startAdminPhoneTransfer(PASSWORD_SENTINEL, PHONE_SENTINEL)
    expect(!result.ok && result.code === 'INVALID_RESPONSE', `start must reject ${label}`)
    assertEffects(harness, `invalid start (${label})`)
  }

  const validStartHarness = createAdminAuthAdapterHarness([okResponse(validStartData())])
  const validStart = await validStartHarness.auth.startAdminPhoneTransfer(PASSWORD_SENTINEL, PHONE_SENTINEL)
  expect(validStart.ok && validStart.bindTicket === TICKET_SENTINEL, 'start must accept an exact bounded UUID response')
  expect(validStart.sourceAccount.username === VALID_SOURCE_ACCOUNT.username, 'start must expose the validated source username')
  expect(validStart.sourceAccount.organizationName === VALID_SOURCE_ACCOUNT.organizationName, 'start must expose the validated organization name')
  expect(validStart.sourceAccount.phoneMasked === VALID_SOURCE_ACCOUNT.phoneMasked, 'start must expose only the validated masked phone')
  assertPostRequest(validStartHarness, START_PATH, { currentPassword: PASSWORD_SENTINEL, phone: PHONE_SENTINEL }, 'valid start')
  assertEffects(validStartHarness, 'valid start')

  const startFailureHarness = createAdminAuthAdapterHarness([
    { status: 503, body: { error: { code: 'SMS_PROVIDER_UNAVAILABLE', message: 'provider unavailable' } } },
  ])
  const startFailure = await startFailureHarness.auth.startAdminPhoneTransfer(PASSWORD_SENTINEL, PHONE_SENTINEL)
  expect(!startFailure.ok && startFailure.status === 503, 'start must retain the HTTP failure status')
  assertPostRequest(startFailureHarness, START_PATH, { currentPassword: PASSWORD_SENTINEL, phone: PHONE_SENTINEL }, 'failed start')
  assertEffects(startFailureHarness, 'failed start')

  const invalidVerifyResponses = [
    ['plaintext phone', { phoneMasked: PHONE_SENTINEL, phoneVerifiedAt: VALID_PHONE_VERIFIED_AT }],
    ['malformed mask', { phoneMasked: '138***1234', phoneVerifiedAt: VALID_PHONE_VERIFIED_AT }],
    ['missing timestamp', { phoneMasked: VALID_SOURCE_ACCOUNT.phoneMasked }],
    ['non-canonical ISO', { phoneMasked: VALID_SOURCE_ACCOUNT.phoneMasked, phoneVerifiedAt: '2026-07-16T00:00:00Z' }],
    ['extra field', { phoneMasked: VALID_SOURCE_ACCOUNT.phoneMasked, phoneVerifiedAt: VALID_PHONE_VERIFIED_AT, phone: PHONE_SENTINEL }],
  ]
  for (const [label, data] of invalidVerifyResponses) {
    const harness = createAdminAuthAdapterHarness([okResponse(data)])
    const result = await harness.auth.verifyAdminPhoneTransfer(TICKET_SENTINEL, OTP_SENTINEL)
    expect(!result.ok && result.code === 'INVALID_RESPONSE', `verify must reject ${label}`)
    assertEffects(harness, `invalid verify (${label})`)
  }

  for (const phoneMasked of [VALID_SOURCE_ACCOUNT.phoneMasked, '***']) {
    const harness = createAdminAuthAdapterHarness([okResponse({ phoneMasked, phoneVerifiedAt: VALID_PHONE_VERIFIED_AT })])
    const result = await harness.auth.verifyAdminPhoneTransfer(TICKET_SENTINEL, OTP_SENTINEL)
    expect(result.ok && result.phoneMasked === phoneMasked, `verify must accept backend mask ${phoneMasked}`)
    const stored = JSON.parse(harness.local.api.getItem(AUTH_STORAGE_KEY))
    expect(stored.user.phoneMasked === phoneMasked, 'verify may persist only the validated masked phone')
    expect(stored.user.phoneVerifiedAt === VALID_PHONE_VERIFIED_AT, 'verify must persist the validated canonical timestamp')
    assertPostRequest(harness, VERIFY_PATH, { bindTicket: TICKET_SENTINEL, code: OTP_SENTINEL }, 'valid verify')
    assertEffects(harness, 'valid verify', 1)
  }

  const verifyFailureHarness = createAdminAuthAdapterHarness([
    { status: 409, body: { error: { code: 'AUTH_PHONE_TRANSFER_UNAVAILABLE', message: 'unavailable' } } },
  ])
  const verifyFailure = await verifyFailureHarness.auth.verifyAdminPhoneTransfer(TICKET_SENTINEL, OTP_SENTINEL)
  expect(!verifyFailure.ok && verifyFailure.status === 409, 'verify must retain the HTTP failure status')
  assertPostRequest(verifyFailureHarness, VERIFY_PATH, { bindTicket: TICKET_SENTINEL, code: OTP_SENTINEL }, 'failed verify')
  assertEffects(verifyFailureHarness, 'failed verify')

  for (const [label, data] of [
    ['cancelled:false', { cancelled: false }],
    ['missing cancelled', {}],
    ['extra field', { cancelled: true, bindTicket: TICKET_SENTINEL }],
  ]) {
    const harness = createAdminAuthAdapterHarness([okResponse(data)])
    const result = await harness.auth.cancelAdminPhoneTransfer(TICKET_SENTINEL)
    expect(!result.ok && result.code === 'INVALID_RESPONSE', `cancel must reject ${label}`)
    assertEffects(harness, `invalid cancel (${label})`)
  }

  const validCancelHarness = createAdminAuthAdapterHarness([okResponse({ cancelled: true })])
  const validCancel = await validCancelHarness.auth.cancelAdminPhoneTransfer(TICKET_SENTINEL)
  expect(validCancel.ok, 'cancel must accept the exact strict success response')
  assertPostRequest(validCancelHarness, CANCEL_PATH, { bindTicket: TICKET_SENTINEL }, 'valid cancel')
  assertEffects(validCancelHarness, 'valid cancel')

  const cancelFailureHarness = createAdminAuthAdapterHarness([
    { status: 500, body: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'server error' } } },
  ])
  const cancelFailure = await cancelFailureHarness.auth.cancelAdminPhoneTransfer(TICKET_SENTINEL)
  expect(!cancelFailure.ok && cancelFailure.status === 500, 'cancel must retain the HTTP failure status')
  assertPostRequest(cancelFailureHarness, CANCEL_PATH, { bindTicket: TICKET_SENTINEL }, 'failed cancel')
  assertEffects(cancelFailureHarness, 'failed cancel')
}

function mutateOnce(source, needle, replacement, label) {
  expect(source.includes(needle), `${label} mutation setup target is missing`)
  return source.replace(needle, replacement)
}

function expectProbeRejected(label, assertion) {
  let rejected = false
  try {
    assertion()
  } catch {
    rejected = true
  }
  expect(rejected, `${label} mutation escaped the verifier`)
}

async function verifyMutationProbes() {
  const consoleMutation = mutateOnce(
    authSource,
    '  let res: Response\n  try {',
    '  console.warn(body)\n  let res: Response\n  try {',
    'helper console.warn',
  )
  const consoleHarness = createAdminAuthAdapterHarness([okResponse(validStartData())], { source: consoleMutation })
  const consoleResult = await consoleHarness.auth.startAdminPhoneTransfer(PASSWORD_SENTINEL, PHONE_SENTINEL)
  expect(consoleResult.ok, 'helper console.warn mutation must reach the assertion')
  expectProbeRejected('helper console.warn', () => assertNoSensitiveConsole(consoleHarness, 'helper console.warn probe'))

  const consoleTableMutation = mutateOnce(
    authSource,
    '  let res: Response\n  try {',
    '  console.table(body)\n  let res: Response\n  try {',
    'helper console.table',
  )
  const consoleTableHarness = createAdminAuthAdapterHarness([okResponse(validStartData())], { source: consoleTableMutation })
  const consoleTableResult = await consoleTableHarness.auth.startAdminPhoneTransfer(PASSWORD_SENTINEL, PHONE_SENTINEL)
  expect(consoleTableResult.ok, 'helper console.table mutation must reach the assertion')
  expectProbeRejected('helper console.table', () => assertNoSensitiveConsole(consoleTableHarness, 'helper console.table probe'))

  const wrongPrefixHarness = createAdminAuthAdapterHarness([okResponse(validStartData())], {
    apiBaseUrl: 'https://wrong-prefix.invalid',
  })
  const wrongPrefixResult = await wrongPrefixHarness.auth.startAdminPhoneTransfer(PASSWORD_SENTINEL, PHONE_SENTINEL)
  expect(wrongPrefixResult.ok, 'wrong-prefix mutation must reach the assertion')
  expectProbeRejected('wrong URL prefix', () => {
    assertPostRequest(wrongPrefixHarness, START_PATH, { currentPassword: PASSWORD_SENTINEL, phone: PHONE_SENTINEL }, 'wrong-prefix probe')
  })

  const verifyGetMutation = mutateOnce(
    authSource,
    "  const r = await postJson<unknown>('/auth/admin/phone/transfer/verify', { bindTicket, code })",
    "  const r = await getJson<unknown>('/auth/admin/phone/transfer/verify')",
    'verify GET',
  )
  const verifyGetHarness = createAdminAuthAdapterHarness([
    okResponse({ phoneMasked: VALID_SOURCE_ACCOUNT.phoneMasked, phoneVerifiedAt: VALID_PHONE_VERIFIED_AT }),
  ], { source: verifyGetMutation })
  const verifyGetResult = await verifyGetHarness.auth.verifyAdminPhoneTransfer(TICKET_SENTINEL, OTP_SENTINEL)
  expect(verifyGetResult.ok, 'verify GET mutation must reach the assertion')
  expectProbeRejected('verify GET', () => {
    assertPostRequest(verifyGetHarness, VERIFY_PATH, { bindTicket: TICKET_SENTINEL, code: OTP_SENTINEL }, 'verify GET probe')
  })

  const failureWriteMutation = mutateOnce(
    authSource,
    '  return { ok: false, code, message, status: res.status }\n}\n\nasync function getJson',
    "  localStorage.setItem('mutation-failure', JSON.stringify(body))\n  return { ok: false, code, message, status: res.status }\n}\n\nasync function getJson",
    'failure storage write',
  )
  const failureWriteHarness = createAdminAuthAdapterHarness([
    { status: 503, body: { error: { code: 'SMS_PROVIDER_UNAVAILABLE', message: 'provider unavailable' } } },
  ], { source: failureWriteMutation })
  const failureWriteResult = await failureWriteHarness.auth.startAdminPhoneTransfer(PASSWORD_SENTINEL, PHONE_SENTINEL)
  expect(!failureWriteResult.ok && failureWriteResult.status === 503, 'failure storage mutation must reach the assertion')
  expectProbeRejected('failure storage write', () => assertEffects(failureWriteHarness, 'failure storage probe'))
}

try {
  await verifyAdminPhoneTransferAdapterBehavior()
  pass('Admin 手机号转移 adapter 严格校验响应、请求与 Bearer 头，且运行时阻断敏感日志/持久化')
} catch (error) {
  fail(`Admin 手机号转移 adapter 运行时行为验证失败: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  await verifyMutationProbes()
  pass('故障探针拒绝任意 helper console 方法、错误 URL 前缀、verify GET 与失败分支持久化回退')
} catch (error) {
  fail(`Admin 手机号转移 mutation verification 失败: ${error instanceof Error ? error.message : String(error)}`)
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
