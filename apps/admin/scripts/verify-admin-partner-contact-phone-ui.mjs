// 管理员登记机构联系人手机：隔离 VM 跑适配器与资格判断，并静态核对按钮与弹层文案。
// 不连服务，不写浏览器存储。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const API_ORIGIN = 'https://adapter-test.invalid/api/v1'
const PHONE = '13812345678'
const LETTER = 'QD-2026/09'
const PASSWORD = '__ADMIN_CONTACT_PHONE_PASSWORD_SENTINEL__'
const NOTICE = '管理员不能代收验证码'
const failures = []

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  failures.push(message)
  console.error(`  FAIL ${message}`)
}

function expect(condition, message) {
  if (condition) pass(message)
  else fail(message)
}

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

function storageSpy() {
  let writes = 0
  const data = new Map()
  return {
    writes: () => writes,
    snapshot: () => JSON.stringify([...data.entries()]),
    api: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        writes += 1
        data.set(String(key), String(value))
      },
      removeItem: (key) => {
        writes += 1
        data.delete(String(key))
      },
      clear: () => {
        writes += 1
        data.clear()
      },
      key: () => null,
      get length() {
        return data.size
      },
    },
  }
}

function loadTs(relativePath, stubs, globals) {
  const source = read(relativePath)
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
    fileName: relativePath,
  })
  const module = { exports: {} }
  const context = createContext({
    module,
    exports: module.exports,
    require: (specifier) => {
      if (Object.prototype.hasOwnProperty.call(stubs, specifier)) return stubs[specifier]
      throw new Error(`Unexpected module: ${specifier}`)
    },
    ...globals,
  })
  new Script(transpiled.outputText, { filename: relativePath }).runInContext(context)
  return module.exports
}

function jsonResponse(status, body, statusText = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() {
      if (body === undefined) throw new Error('invalid json')
      return body
    },
  }
}

function createAdapter(mode, responses) {
  const requests = []
  const local = storageSpy()
  const session = storageSpy()
  const consoleCalls = []
  let redirects = 0
  const fetch = async (requestUrl, init = {}) => {
    requests.push({
      url: String(requestUrl),
      method: init.method,
      credentials: init.credentials,
      headers: init.headers,
      rawBody: typeof init.body === 'string' ? init.body : '',
    })
    const next = responses.shift()
    if (next instanceof Error) throw next
    if (!next) throw new Error('Missing stubbed fetch response')
    return next
  }
  const adapter = loadTs('src/services/api/registerPartnerContactPhone.ts', {
    './client': { API_BASE_URL: API_ORIGIN, API_MODE: mode },
    '../auth': {
      authHeader: () => ({ Authorization: 'Bearer adapter-test' }),
      redirectToLogin: () => {
        redirects += 1
      },
    },
  }, {
    fetch,
    localStorage: local.api,
    sessionStorage: session.api,
    console: new Proxy(console, {
      get(target, property, receiver) {
        if (property === 'log' || property === 'error' || property === 'info' || property === 'debug' || property === 'warn') {
          return (...args) => {
            consoleCalls.push(args.map((item) => String(item)).join(' '))
          }
        }
        return Reflect.get(target, property, receiver)
      },
    }),
    window: { localStorage: local.api, sessionStorage: session.api },
  })
  return { adapter, requests, local, session, consoleCalls, redirects: () => redirects }
}

function validBody(overrides = {}) {
  return { phone: PHONE, confirmationLetterNo: LETTER, currentPassword: PASSWORD, ...overrides }
}

const successBody = {
  accountId: 'acc-1',
  phoneMasked: '138****5678',
  registeredAt: '2026-09-29T01:02:03.000Z',
}

function assertNoLeak(harness, label) {
  const persisted = `${harness.local.snapshot()}\n${harness.session.snapshot()}\n${harness.consoleCalls.join('\n')}`
  const urls = harness.requests.map((request) => request.url).join('\n')
  expect(harness.local.writes() === 0, `${label} 不写 localStorage`)
  expect(harness.session.writes() === 0, `${label} 不写 sessionStorage`)
  expect(!persisted.includes(PHONE) && !persisted.includes(PASSWORD) && !persisted.includes(LETTER), `${label} 不把手机号、确认函编号或密码写入存储或控制台`)
  expect(!urls.includes(PHONE) && !urls.includes(encodeURIComponent(PASSWORD)), `${label} 不把手机号或密码放进 URL`)
}

async function verifyAdapter() {
  const harness = createAdapter('http', [jsonResponse(200, successBody)])
  expect(harness.adapter.registerPartnerContactPhone.length === 3, '适配器参数恰好三个')
  const extra = await harness.adapter.registerPartnerContactPhone('org-1', 'acc-1', {
    ...validBody(),
    note: 'must-not-be-sent',
  })
  expect(extra.ok === true && extra.accountId === 'acc-1' && extra.phoneMasked === '138****5678', '合法响应记为成功')
  expect(harness.requests.length === 1, '成功路径只发一次请求')
  const request = harness.requests[0]
  expect(
    request.url === `${API_ORIGIN}/admin/orgs/org-1/accounts/acc-1/contact-phone` && request.method === 'POST',
    '路径与方法为 POST /admin/orgs/:orgId/accounts/:accountId/contact-phone',
  )
  expect(request.credentials === 'include', '请求携带凭据')
  expect(
    request.headers?.Accept === 'application/json'
      && request.headers?.['Content-Type'] === 'application/json'
      && request.headers?.Authorization === 'Bearer adapter-test',
    '请求带 JSON 与管理员令牌头',
  )
  const parsed = JSON.parse(request.rawBody)
  expect(
    JSON.stringify(Object.keys(parsed)) === JSON.stringify(['phone', 'confirmationLetterNo', 'currentPassword'])
      && request.rawBody === JSON.stringify({ phone: PHONE, confirmationLetterNo: LETTER, currentPassword: PASSWORD }),
    '请求体键恰好三个且丢掉多余字段',
  )
  assertNoLeak(harness, '成功请求')
  expect(harness.redirects() === 0, '成功不跳登录')

  const rejectedLetters = ['ab', 'abc_', '确认函1', 'A'.repeat(65), 'ab c', 'QD\\2026', '']
  for (const confirmationLetterNo of rejectedLetters) {
    const rejected = createAdapter('http', [])
    const result = await rejected.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody({ confirmationLetterNo }))
    expect(result.ok === false && result.code === 'VALIDATION_ERROR' && rejected.requests.length === 0, `确认函编号「${confirmationLetterNo || '空'}」不发请求`)
    expect(result.message === '确认函编号须为 4–64 位字母、数字、横线或斜线', '确认函编号错误提示固定')
  }
  for (const confirmationLetterNo of ['Ab-1', 'A'.repeat(64), 'QD-2026/09']) {
    const accepted = createAdapter('http', [jsonResponse(200, successBody)])
    const result = await accepted.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody({ confirmationLetterNo }))
    const sent = JSON.parse(accepted.requests[0]?.rawBody ?? '{}')
    expect(result.ok === true && sent.confirmationLetterNo === confirmationLetterNo, `确认函编号「${confirmationLetterNo}」通过并原样提交`)
  }

  const shortPhone = createAdapter('http', [])
  const shortPhoneResult = await shortPhone.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody({ phone: '1381234567' }))
  expect(shortPhoneResult.ok === false && shortPhoneResult.code === 'VALIDATION_ERROR' && shortPhone.requests.length === 0, '非 11 位大陆手机号不发请求')

  const shortPassword = createAdapter('http', [jsonResponse(200, successBody)])
  const shortPasswordResult = await shortPassword.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody({ currentPassword: 'x' }))
  expect(shortPasswordResult.ok === true && JSON.parse(shortPassword.requests[0].rawBody).currentPassword === 'x', '本人当前密码不在前端加最短 8 位')

  const unauthorized = createAdapter('http', [jsonResponse(401, {
    error: { code: 'AUTH_REQUIRED', message: '登录已过期' },
  }, 'Unauthorized')])
  const unauthorizedResult = await unauthorized.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody())
  expect(
    unauthorizedResult.ok === false
      && unauthorizedResult.code === 'AUTH_REQUIRED'
      && unauthorizedResult.message === '登录已过期'
      && unauthorizedResult.status === 401
      && unauthorized.redirects() === 1,
    '401 原样带回错误码与 message，并走登录跳转',
  )

  const mismatchMessage = '手机号和机构确认函上登记的联系人手机不一致，请先核对机构资料。'
  const mismatch = createAdapter('http', [jsonResponse(409, {
    error: { code: 'CONTACT_PHONE_MISMATCH', message: mismatchMessage },
  })])
  const mismatchResult = await mismatch.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody())
  expect(
    mismatchResult.ok === false
      && mismatchResult.code === 'CONTACT_PHONE_MISMATCH'
      && mismatchResult.message === mismatchMessage
      && mismatchResult.status === 409
      && mismatch.redirects() === 0,
    'CONTACT_PHONE_MISMATCH 原样带回错误码与 message',
  )

  const joined = createAdapter('http', [jsonResponse(400, { message: ['手机号格式不正确', '确认函编号无效'] })])
  const joinedResult = await joined.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody())
  expect(joinedResult.message === '手机号格式不正确；确认函编号无效', '数组 message 用中文分号拼回')

  const badShapes = [
    ['套 data', { data: successBody }],
    ['明文手机号', { ...successBody, phoneMasked: PHONE }],
    ['多余字段', { ...successBody, code: '123456' }],
    ['非规范时间', { ...successBody, registeredAt: '2026-09-29T01:02:03Z' }],
    ['空账号', { ...successBody, accountId: ' ' }],
  ]
  for (const [label, body] of badShapes) {
    const bad = createAdapter('http', [jsonResponse(200, body)])
    const result = await bad.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody())
    expect(result.ok === false && result.code === 'INVALID_RESPONSE', `响应形状「${label}」不当成功`)
  }

  const masked = createAdapter('http', [jsonResponse(200, { ...successBody, phoneMasked: '***' })])
  const maskedResult = await masked.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody())
  expect(maskedResult.ok === true && maskedResult.phoneMasked === '***', '全星号脱敏手机号可以成功')

  const offline = createAdapter('http', [new Error('offline')])
  const offlineResult = await offline.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody())
  expect(offlineResult.ok === false && offlineResult.code === 'NETWORK_ERROR' && offlineResult.status === 0, '网络异常不当成功')

  const mock = createAdapter('mock', [])
  const mockResult = await mock.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody())
  expect(
    mockResult.ok === false && mockResult.code === 'DEMO_MODE_READONLY' && mockResult.status === 501 && mock.requests.length === 0,
    'mock 模式不假成功也不发请求',
  )
  const mockInvalid = createAdapter('mock', [])
  const mockInvalidResult = await mockInvalid.adapter.registerPartnerContactPhone('org-1', 'acc-1', validBody({ confirmationLetterNo: 'no' }))
  expect(mockInvalidResult.code === 'VALIDATION_ERROR' && mockInvalid.requests.length === 0, 'mock 模式仍先做确认函编号校验')
}

function verifyEligibility() {
  const eligibility = loadTs('src/routes/partners/partnerContactPhoneEligibility.ts', {}, { Date, Intl })
  const offer = (account) => eligibility.contactPhoneRegistrationOffer(account)
  const signalsThatUsedToHide = {
    enabled: false,
    phoneVerifiedAt: '2026-09-01T00:00:00.000Z',
    phoneMasked: '138****0000',
    availableActionVerificationMethods: ['password'],
    phoneRegisteredByAdminAt: null,
  }
  const serverSaysYes = offer({ ...signalsThatUsedToHide, canRegisterContactPhone: true })
  expect(
    serverSaysYes.visible === true && serverSaysYes.label === '登记手机号' && serverSaysYes.reason == null && serverSaysYes.pending == null,
    '按钮只由 canRegisterContactPhone 决定，停用、已验证、本人密码方式都不隐藏',
  )
  const serverSaysNo = offer({
    enabled: true,
    phoneVerifiedAt: null,
    phoneMasked: null,
    availableActionVerificationMethods: [],
    canRegisterContactPhone: false,
  })
  expect(
    serverSaysNo.visible === false && serverSaysNo.label == null && serverSaysNo.reason === '当前不符合登记条件',
    'canRegisterContactPhone 为 false 时不显示按钮，其余信号也不能把按钮打开',
  )
  const missingFlag = offer({
    enabled: true,
    phoneVerifiedAt: null,
    phoneMasked: null,
    availableActionVerificationMethods: [],
  })
  expect(missingFlag.visible === false && missingFlag.reason == null && missingFlag.label == null, '字段缺失时不显示按钮，也不写原因')
  const missingAll = offer({ enabled: true, phoneVerifiedAt: null })
  expect(missingAll.visible === false && missingAll.pending == null && missingAll.reason == null, '三个资格字段都缺时不显示按钮')

  const registered = offer({
    enabled: true,
    phoneVerifiedAt: null,
    phoneMasked: '138****5678',
    phoneRegisteredByAdminAt: '2026-09-29T01:02:03.000Z',
    canRegisterContactPhone: true,
  })
  expect(registered.visible === true && registered.label === '重新登记', 'phoneRegisteredByAdminAt 非空时按钮为重新登记')
  expect(registered.pending?.status === '已登记，待机构本人自证', 'phoneRegisteredByAdminAt 非空时显示已登记，待机构本人自证')
  expect(registered.pending?.phoneMasked === '138****5678', '已登记状态附带脱敏手机号')
  expect(registered.pending?.registeredAtLabel === '2026-09-29 09:02:03', '登记时间按北京时间显示')

  const freshAccount = {
    enabled: true,
    phoneVerifiedAt: null,
    phoneMasked: '138****5678',
    phoneRegisteredByAdminAt: null,
    canRegisterContactPhone: true,
  }
  const fresh = offer(freshAccount)
  expect(fresh.visible === true && fresh.label === '登记手机号' && fresh.pending == null, '登记时间为空时按钮为登记手机号')
  const blankRegistered = offer({ ...freshAccount, phoneRegisteredByAdminAt: '  ' })
  expect(blankRegistered.label === '登记手机号' && blankRegistered.pending == null, '空白登记时间不算已登记')
  const oldField = offer({ ...freshAccount, contactPhoneRegisteredAt: '2026-09-29T01:02:03.000Z' })
  expect(oldField.label === '登记手机号' && oldField.pending == null, '自拟字段 contactPhoneRegisteredAt 不再生效')
  const loginPhoneOnly = offer({ ...freshAccount, phoneMasked: '139****0001' })
  expect(loginPhoneOnly.pending == null && loginPhoneOnly.label === '登记手机号', '登录手机脱敏值不算已登记')

  const disabled = offer({ ...signalsThatUsedToHide, canRegisterContactPhone: false, phoneRegisteredByAdminAt: null })
  expect(disabled.visible === false && disabled.reason === '账号已停用', '服务端拒绝且账号停用时说明账号已停用')
  const ownerVerifiedAccount = {
    enabled: true,
    phoneVerifiedAt: '2026-09-01T00:00:00.000Z',
    phoneMasked: '139****0001',
    canRegisterContactPhone: false,
  }
  const ownerVerified = offer(ownerVerifiedAccount)
  expect(ownerVerified.visible === false && ownerVerified.reason === '手机号已由机构本人验证，无需登记', '服务端拒绝且手机已由本人验证时如实说明')
  const ownerOnly = offer({ ...ownerVerifiedAccount, phoneVerifiedAt: null })
  expect(ownerOnly.reason === '当前不符合登记条件', '手机未验证时不声称已验证')
  const legacy = offer({
    enabled: true,
    phoneVerifiedAt: null,
    canRegisterContactPhone: false,
  })
  expect(legacy.visible === false && legacy.reason === '当前不符合登记条件', '其它不符合条件不猜测原因')
  const unparsable = offer({
    enabled: true,
    phoneVerifiedAt: null,
    phoneMasked: '138****5678',
    phoneRegisteredByAdminAt: 'not-a-time',
    canRegisterContactPhone: true,
  })
  expect(
    unparsable.pending?.status === '已登记，待机构本人自证' && unparsable.pending?.registeredAtLabel === 'not-a-time',
    '登记时间解析不了时原样显示，仍视为已登记',
  )
}

function verifyStatic() {
  const manager = read('src/routes/partners/PartnerAccountManager.tsx')
  const dialog = read('src/routes/partners/PartnerAccountActionDialog.tsx')
  const steps = read('src/routes/partners/partner-account-action-steps/ContactPhoneRegistrationSteps.tsx')
  const hook = read('src/routes/partners/usePartnerAccountAction.ts')
  const eligibilitySource = read('src/routes/partners/partnerContactPhoneEligibility.ts')
  const accountType = read('src/services/api/orgsAdmin.ts')
  const visibleButton = /\{registration\.visible && registration\.label && \([\s\S]{0,700}?actionFlow\.open\('register_contact_phone'/
  const hiddenReason = /\{registration\.reason && \([\s\S]{0,300}?\{registration\.reason\}/
  expect(visibleButton.test(manager), '登记按钮只在 registration.visible 内渲染')
  expect(hiddenReason.test(manager), '不符合资格时展示 registration.reason')
  expect(manager.includes('{registration.pending.status}'), '已登记状态文案来自资格结果，不在列表里另写一套')
  expect(manager.includes('registration.pending.phoneMasked'), '已登记状态展示脱敏手机号')
  expect(manager.includes('registration.pending.registeredAtLabel'), '已登记状态展示登记时间')
  expect(manager.includes('北京时间'), '登记时间标明北京时间')
  expect(manager.includes('{registration.label}'), '按钮文字来自资格结果')
  expect(!manager.includes('canRegisterContactPhone'), '列表组件不自己读取 canRegisterContactPhone')
  expect(!manager.includes('contactPhoneRegisteredAt') && !eligibilitySource.includes('contactPhoneRegisteredAt'), '不再使用自拟字段 contactPhoneRegisteredAt')
  expect(!eligibilitySource.includes('availableActionVerificationMethods'), '资格判断不再读取验证方式')
  expect(eligibilitySource.includes('canRegisterContactPhone === true'), '只有 canRegisterContactPhone 严格为 true 才进入可登记分支')
  expect(eligibilitySource.includes('已登记，待机构本人自证') && eligibilitySource.includes("重新登记"), '资格模块给出待自证状态与重新登记')
  expect(accountType.includes('phoneRegisteredByAdminAt?: string | null'), '账号类型包含 phoneRegisteredByAdminAt')
  expect(accountType.includes('canRegisterContactPhone?: boolean'), '账号类型包含 canRegisterContactPhone')
  // #1139：后台账号响应不暴露原始密码状态，前端类型与资格判断都不许出现它。
  expect(!/passwordProofState/.test(accountType), '账号类型不声明 passwordProofState')
  expect(!/passwordProofState|owner_managed/.test(eligibilitySource), '资格判断不读 passwordProofState')
  expect(!accountType.includes('contactPhoneRegisteredAt'), '账号类型不再保留 contactPhoneRegisteredAt')
  expect(manager.includes('min-h-12') && steps.includes('min-h-12'), '按钮点击区域使用 min-h-12')
  expect(steps.includes(NOTICE), '弹层步骤含「管理员不能代收验证码」')
  expect(dialog.includes('<ContactPhoneRegistrationSteps'), '弹层渲染登记步骤而不是另一套对话框')
  expect(dialog.includes('serverMessage || errorMessages[flow.state.errorCode]'), '服务端 message 优先于兜底文案')
  for (const code of [
    'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE',
    'CONTACT_PHONE_MISMATCH',
    'CONTACT_PHONE_RECENTLY_CHANGED',
    'PHONE_IN_USE',
    'CONTACT_PHONE_NOTICE_UNAVAILABLE',
  ]) {
    expect(dialog.includes(code), `弹层兜底含 ${code}`)
  }
  expect(hook.includes('setErrorMessage(result.message)') && hook.includes('code: result.code'), 'hook 原样带回错误码与 message')
  expect(hook.includes('contactPhoneSubmitRef'), '提交中用同步标记防重复点击')
  for (const [label, source] of [
    ['适配器', read('src/services/api/registerPartnerContactPhone.ts')],
    ['资格判断', read('src/routes/partners/partnerContactPhoneEligibility.ts')],
    ['登记步骤', steps],
  ]) {
    for (const forbidden of ['localStorage', 'sessionStorage', 'console.log', 'console.error']) {
      expect(!source.includes(forbidden), `${label}源码不含 ${forbidden}`)
    }
  }
}

/**
 * 「安全验证未就绪」提示：有了「登记手机号」之后，不能再说「只能走独立线下核验、本系统不提供管理员绕过」
 * （登记正是线下核验之后的那一步）。按账号状态分三种说法，且可登记时写明管理员不能代收验证码。
 */
function verifyUnreadyHint() {
  // 审计页与工作台「最近操作」要把登记动作显示成中文，不露原始动作码（走查 r5 第 7 步）。
  for (const page of ['src/routes/audit/index.tsx', 'src/routes/dashboard/index.tsx']) {
    expect(read(page).includes("'partner_account.contact_phone_registered': '登记机构联系人手机'"), `${page} 有「登记机构联系人手机」中文动作名`)
  }
  const manager = read('src/routes/partners/PartnerAccountManager.tsx')
  expect(!manager.includes('本系统不提供管理员绕过'), '旧提示「本系统不提供管理员绕过」已去掉')
  expect(!manager.includes('否则只能走独立线下核验'), '旧提示「否则只能走独立线下核验」已去掉')
  expect(
    /registration\.pending\s*\?\s*'已登记联系人手机，等机构本人在机构后台登录页点「忘记密码」完成自证。'/.test(manager),
    '已登记待自证：提示等机构本人在登录页忘记密码完成自证',
  )
  expect(
    /registration\.visible\s*\?\s*'该账号还没有可用的验证手机。请先线下核对机构盖章确认函，再用「登记手机号」登记联系人手机；[^']*管理员不能代收验证码。'/.test(manager),
    '可登记：提示先核对确认函再登记，并写明管理员不能代收验证码',
  )
  expect(manager.includes('该账号安全验证未就绪，请由持有人用已验证的手机在机构后台登录页点「忘记密码」找回。'), '其它情况：请持有人用已验证手机找回')
}

console.log('\n=== Admin 登记机构联系人手机 UI verification ===')
await verifyAdapter()
verifyEligibility()
verifyStatic()
verifyUnreadyHint()

if (failures.length > 0) {
  console.error(`\n  ${failures.length} FAIL`)
  process.exit(1)
}
console.log('\n  PASS 适配器、资格判断与弹层文案')
