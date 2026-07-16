// Admin 从 Partner 安全转移手机号 UI 防回退验证（隔离 VM，不连服务）。
// Task 4 锁定严格 adapter；Task 5 再补齐独立组件与既有账号设置入口。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const authPath = join(root, 'src/services/auth/index.ts')
const componentPath = join(root, 'src/routes/account-settings/AdminPhoneTransferCard.tsx')
const accountSettingsPath = join(root, 'src/routes/account-settings/index.tsx')
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

function parseTsx(source, fileName) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function visit(node, callback) {
  callback(node)
  node.forEachChild((child) => visit(child, callback))
}

function findNamedFunction(sourceFile, name) {
  let match
  visit(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) match = node
  })
  return match
}

function identifiersIn(node) {
  const names = new Set()
  visit(node, (child) => {
    if (ts.isIdentifier(child)) names.add(child.text)
  })
  return names
}

function callsNamed(node, name) {
  const calls = []
  visit(node, (child) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === name) calls.push(child)
  })
  return calls
}

function hasPropertyCall(node, owner, name) {
  let found = false
  visit(node, (child) => {
    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
      const target = child.expression
      if (ts.isIdentifier(target.expression) && target.expression.text === owner && target.name.text === name) found = true
    }
  })
  return found
}

function stringLiteralsIn(node) {
  const values = new Set()
  visit(node, (child) => {
    if (ts.isStringLiteral(child)) values.add(child.text)
  })
  return values
}

function hasNumericCall(node, name, value) {
  return callsNamed(node, name).some((call) => {
    const argument = call.arguments[0]
    return argument && ts.isNumericLiteral(argument) && Number(argument.text) === value
  })
}

function useStateBindings(sourceFile) {
  const bindings = new Set()
  visit(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'useState'
    ) {
      const stateName = node.name.elements[0]?.name
      if (stateName && ts.isIdentifier(stateName)) bindings.add(stateName.text)
    }
  })
  return bindings
}

function jsxTagName(node) {
  return node.tagName.getText()
}

function jsxAttribute(opening, name) {
  return opening.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === name,
  )
}

function jsxAttributeText(attribute) {
  if (!attribute?.initializer) return undefined
  return ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : undefined
}

function renderedText(node) {
  const parts = []
  visit(node, (child) => {
    if (ts.isJsxText(child)) {
      const text = child.text.replace(/\s+/g, ' ').trim()
      if (text) parts.push(text)
    }
    if (ts.isStringLiteral(child)) parts.push(child.text)
  })
  return parts
}

function hasNegatedIdentifier(node, name) {
  let found = false
  visit(node, (child) => {
    if (
      ts.isPrefixUnaryExpression(child) &&
      child.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isIdentifier(child.operand) &&
      child.operand.text === name
    ) found = true
  })
  return found
}

function expectRejected(label, assertion) {
  let rejected = false
  try {
    assertion()
  } catch {
    rejected = true
  }
  expect(rejected, `${label} mutation escaped the UI verifier`)
}

function verifyComponentContract(componentSource, pageSource) {
  const componentFile = parseTsx(componentSource, 'AdminPhoneTransferCard.tsx')
  const pageFile = parseTsx(pageSource, 'account-settings/index.tsx')
  const component = findNamedFunction(componentFile, 'AdminPhoneTransferCard')
  expect(component?.body, 'missing AdminPhoneTransferCard function component')

  const componentIdentifiers = identifiersIn(component)
  for (const required of [
    'onBound', 'onBack', 'startAdminPhoneTransfer', 'verifyAdminPhoneTransfer',
    'cancelAdminPhoneTransfer', 'redirectToLogin',
  ]) expect(componentIdentifiers.has(required), `component missing ${required}`)

  const states = useStateBindings(component)
  for (const state of [
    'phase', 'currentPassword', 'phone', 'code', 'bindTicket', 'sourceAccount',
    'acknowledged', 'cooldownSeconds', 'ticketExpiresAt', 'now', 'submitting', 'message',
  ]) expect(states.has(state), `component state ${state} must use useState`)

  for (const forbidden of ['localStorage', 'sessionStorage', 'console', 'history']) {
    expect(!componentIdentifiers.has(forbidden), `component must not reference ${forbidden}`)
  }
  let hasHiddenInput = false
  visit(component, (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && jsxTagName(node) === 'input') {
      if (jsxAttributeText(jsxAttribute(node, 'type')) === 'hidden') hasHiddenInput = true
    }
  })
  expect(!hasHiddenInput, 'component must not render hidden inputs')

  const facts = [
    '该手机号将从上述机构账号转移到当前管理员账号。',
    '机构账号仍可使用用户名和密码登录。',
    '机构账号将无法再使用该手机号短信登录或找回密码。',
    '机构账号当前登录会话将失效；忘记密码时需由管理员重置。',
  ]
  const texts = renderedText(component)
  for (const fact of facts) expect(texts.includes(fact), `missing exact impact statement: ${fact}`)

  for (const field of ['username', 'organizationName', 'phoneMasked']) {
    let rendered = false
    visit(component, (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'sourceAccount' &&
        node.name.text === field
      ) rendered = true
    })
    expect(rendered, `sourceAccount.${field} must be rendered through JSX escaping`)
  }

  let checkbox
  let checkboxLabel = false
  let confirmButton
  visit(component, (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && jsxTagName(node) === 'input') {
      if (jsxAttributeText(jsxAttribute(node, 'type')) === 'checkbox') checkbox = node
    }
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement) === 'label') {
      if (jsxAttributeText(jsxAttribute(node.openingElement, 'htmlFor')) === 'admin-phone-transfer-acknowledged') checkboxLabel = true
    }
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement) === 'Button') {
      if (renderedText(node).includes('确认转移')) confirmButton = node.openingElement
    }
  })
  expect(checkbox, 'missing accessible acknowledgement checkbox')
  expect(jsxAttributeText(jsxAttribute(checkbox, 'id')) === 'admin-phone-transfer-acknowledged', 'checkbox needs a stable id')
  expect(jsxAttribute(checkbox, 'checked')?.initializer?.expression?.getText() === 'acknowledged', 'checkbox must be controlled by acknowledged')
  expect(Boolean(jsxAttribute(checkbox, 'onChange')), 'checkbox needs onChange')
  expect(checkboxLabel, 'checkbox needs a matching label')
  expect(confirmButton, 'missing confirm transfer button')
  const disabled = jsxAttribute(confirmButton, 'disabled')?.initializer?.expression
  expect(disabled && identifiersIn(disabled).has('submitting'), 'confirm button must disable while submitting')
  expect(disabled && hasNegatedIdentifier(disabled, 'acknowledged'), 'confirm button must disable before acknowledgement')

  const requestCode = findNamedFunction(componentFile, 'requestCode')
  const verifyCode = findNamedFunction(componentFile, 'verifyCode')
  const returnToInitialBind = findNamedFunction(componentFile, 'returnToInitialBind')
  expect(requestCode && verifyCode && returnToInitialBind, 'component is missing request/verify/cancel handlers')
  expect(callsNamed(requestCode, 'startAdminPhoneTransfer').length === 1, 'requestCode must start transfer exactly once')
  expect(callsNamed(requestCode, 'onBound').length === 0, 'sending a code must not complete the transfer')
  expect(callsNamed(requestCode, 'requiresConservativeStartCooldown').length === 1, 'requestCode must classify unknown send results')
  expect(callsNamed(verifyCode, 'verifyAdminPhoneTransfer').length === 1, 'verifyCode must verify exactly once')
  expect(callsNamed(verifyCode, 'onBound').length === 1, 'successful verify must refresh the parent user')
  expect(callsNamed(verifyCode, 'requiresLoginAfterUncertainVerification').length === 1, 'verifyCode must classify unknown results')
  expect(callsNamed(verifyCode, 'requiresRestartAfterVerificationFailure').length === 1, 'verifyCode must restart expired tickets')
  expect(callsNamed(returnToInitialBind, 'cancelAdminPhoneTransfer').length === 1, 'return must cancel the remote ticket')
  expect(callsNamed(returnToInitialBind, 'onBack').length >= 1, 'return must switch back only after cancellation')
  expect(callsNamed(returnToInitialBind, 'requiresLoginAfterUncertainCancellation').length === 1, 'cancel must classify unknown results')
  expect(callsNamed(returnToInitialBind, 'redirectToLogin').length === 1, 'unknown cancel must force login recovery')
  const cancelCall = callsNamed(returnToInitialBind, 'cancelAdminPhoneTransfer')[0]
  const lastBackCall = callsNamed(returnToInitialBind, 'onBack').at(-1)
  expect(cancelCall.getStart() < lastBackCall.getStart(), 'remote cancel must precede switching back')

  const requestIdentifiers = identifiersIn(requestCode)
  for (const name of ['bindTicket', 'submitting', 'cooldownSeconds']) {
    expect(requestIdentifiers.has(name), `request duplicate guard must include ${name}`)
  }
  const verifyIdentifiers = identifiersIn(verifyCode)
  for (const name of ['bindTicket', 'submitting', 'acknowledged', 'ticketExpiresAt']) {
    expect(verifyIdentifiers.has(name), `verify guard must include ${name}`)
  }

  for (const helperName of [
    'requiresConservativeStartCooldown', 'requiresKnownSmsCooldown',
    'requiresRestartAfterVerificationFailure', 'requiresLoginAfterUncertainVerification',
    'requiresLoginAfterUncertainCancellation',
  ]) expect(findNamedFunction(componentFile, helperName), `missing conservative helper ${helperName}`)
  expect(hasNumericCall(requestCode, 'setCooldownSeconds', 300), 'unknown start must apply a 300-second cooldown')
  expect(hasNumericCall(requestCode, 'setCooldownSeconds', 60), 'known SMS throttling must apply a 60-second cooldown')
  expect(stringLiteralsIn(verifyCode).has('SMS_CODE_INVALID'), 'invalid OTP must remain retryable')
  expect(callsNamed(verifyCode, 'redirectToLogin').length === 1, 'uncertain verify must force login recovery')
  expect(callsNamed(verifyCode, 'clearTransferState').length >= 2, 'expiry and uncertain verify must clear memory state')
  let hasExpiryGuard = false
  visit(verifyCode, (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken &&
      identifiersIn(node).has('ticketExpiresAt') &&
      hasPropertyCall(node, 'Date', 'now')
    ) hasExpiryGuard = true
  })
  expect(hasExpiryGuard, 'verify must reject an expired ticket before submitting')

  let initialCardCount = 0
  let transferCardCount = 0
  visit(pageFile, (node) => {
    if (ts.isJsxSelfClosingElement(node)) {
      if (jsxTagName(node) === 'AdminInitialPhoneBindingCard') initialCardCount += 1
      if (jsxTagName(node) === 'AdminPhoneTransferCard') transferCardCount += 1
    }
  })
  expect(initialCardCount === 1 && transferCardCount === 1, 'account settings must compose exactly one card for each mode')
  expect(useStateBindings(pageFile).has('phoneBindingMode'), 'account settings needs in-memory binding mode')
  const handlePhoneBound = findNamedFunction(pageFile, 'handlePhoneBound')
  expect(handlePhoneBound, 'account settings needs shared handlePhoneBound')
  let immutableUserUpdate = false
  visit(handlePhoneBound, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return
    const spreads = node.properties.filter(ts.isSpreadAssignment).map((property) => property.expression.getText())
    if (spreads.includes('current') && spreads.includes('phone')) immutableUserUpdate = true
  })
  expect(immutableUserUpdate, 'handlePhoneBound must update the user immutably')
  expect(callsNamed(handlePhoneBound, 'setPhoneBindingSuccess').length === 1, 'handlePhoneBound must publish one success state')
  expect(renderedText(pageFile).includes('该号码已用于机构账号？安全转移'), 'missing the single secondary transfer action')
}

function verifyUiMutationProbes(componentSource, pageSource) {
  const withoutAcknowledgementGate = componentSource.replace(
    'disabled={submitting || !acknowledged}',
    'disabled={submitting}',
  )
  expect(withoutAcknowledgementGate !== componentSource, 'acknowledgement mutation setup target is missing')
  expectRejected('acknowledgement gate', () => verifyComponentContract(withoutAcknowledgementGate, pageSource))

  const missingImpactFact = componentSource.replace(
    '机构账号仍可使用用户名和密码登录。',
    '机构账号仍可登录。',
  )
  expect(missingImpactFact !== componentSource, 'impact statement mutation setup target is missing')
  expectRejected('impact statement', () => verifyComponentContract(missingImpactFact, pageSource))

  const hiddenTicket = componentSource.replace('type="text"', 'type="hidden"')
  expect(hiddenTicket !== componentSource, 'hidden input mutation setup target is missing')
  expectRejected('hidden input', () => verifyComponentContract(hiddenTicket, pageSource))
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

if (!existsSync(componentPath)) {
  fail('Missing required file: src/routes/account-settings/AdminPhoneTransferCard.tsx')
} else if (!existsSync(accountSettingsPath)) {
  fail('Missing required file: src/routes/account-settings/index.tsx')
} else {
  const componentSource = readFileSync(componentPath, 'utf8')
  const pageSource = readFileSync(accountSettingsPath, 'utf8')
  try {
    verifyComponentContract(componentSource, pageSource)
    pass('转移组件使用三态内存状态机，并锁定来源确认、保守失败、远端取消与不可变用户刷新')
  } catch (error) {
    fail(`Admin 手机号转移组件契约失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    verifyUiMutationProbes(componentSource, pageSource)
    pass('组件 mutation probes 拒绝未确认提交、影响文案缺失与隐藏字段回退')
  } catch (error) {
    fail(`Admin 手机号转移组件 mutation verification 失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} verification failure(s)`)
  process.exit(1)
}

console.log('\nALL PASS')
