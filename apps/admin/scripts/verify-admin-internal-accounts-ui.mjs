// Admin 内部账号名册（权限管理页）UI 门禁：真跑适配器 + 页面接线静态检查。
//
//   [A] VM 沙箱转译真跑 src/services/api/internalAccounts.ts（stub fetch / localStorage /
//       sessionStorage / redirectToLogin）：GET 路径与查询参数（pageSize 只发 10/20/50/100）、
//       PATCH 与两个 POST 的请求体键恰好是约定字段、不写任何浏览器存储、错误码与中文
//       message 原样带回、401 统一 redirectToLogin、响应形状不对按 INVALID_RESPONSE 拒绝、
//       { success: true, data } 包装也能解、mock 模式不发请求也不造假数据。
//   [B] VM 沙箱真跑 routes/permissions/presentation.ts：自己那行与最后一个启用管理员的
//       停用按钮必须禁用并给原因、partner 行是机构页链接、kiosk 只读、备用管理员存在判定。
//   [C] 静态接线：名册页、启停弹窗、备用管理员抽屉都用真实适配器；敏感值不进存储/URL/DOM。
//
// Run: pnpm --filter @ai-job-print/admin verify:admin-internal-accounts-ui

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

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

console.log('\n=== Admin 内部账号名册 UI verification ===')

const files = {
  adapter: 'src/services/api/internalAccounts.ts',
  presentation: 'src/routes/permissions/presentation.ts',
  page: 'src/routes/permissions/index.tsx',
  table: 'src/routes/permissions/AccountsTable.tsx',
  statusDialog: 'src/routes/permissions/AccountStatusDialog.tsx',
  backupDrawer: 'src/routes/permissions/BackupAdminDrawer.tsx',
}
const loaded = {}
for (const rel of Object.values(files)) {
  const abs = join(root, rel)
  if (!existsSync(abs)) fail(`Missing required file: ${rel}`)
  loaded[rel] = readFileSync(abs, 'utf8')
}

// ─── [A] 适配器 VM 沙箱真跑 ──────────────────────────────────────────────────

function createAdapterHarness(responses, { apiMode = 'http' } = {}) {
  const calls = []
  const storageWrites = { local: 0, session: 0 }
  const redirectCount = { value: 0 }
  const makeStorage = (bucket) => ({
    getItem: () => null,
    setItem: () => { storageWrites[bucket] += 1 },
    removeItem: () => { storageWrites[bucket] += 1 },
    clear: () => { storageWrites[bucket] += 1 },
  })
  class ApiHttpError extends Error {
    constructor(code, message, status) {
      super(message)
      this.code = code
      this.status = status
      this.name = 'ApiHttpError'
    }
  }
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, headers: init?.headers ?? {}, body: init?.body })
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
      if (specifier === '../auth') {
        return {
          authHeader: () => ({ Authorization: 'Bearer adapter-test-token' }),
          redirectToLogin: () => { redirectCount.value += 1 },
        }
      }
      if (specifier === './client') {
        return { API_BASE_URL: 'https://adapter-test.invalid/api/v1', API_MODE: apiMode, ApiHttpError }
      }
      throw new Error(`Unexpected module: ${specifier}`)
    },
    fetch,
    localStorage: makeStorage('local'),
    sessionStorage: makeStorage('session'),
    URL,
    URLSearchParams,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    window: { location: { pathname: '/permissions', href: '' } },
  })
  const transpiled = ts.transpileModule(loaded[files.adapter], {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'internalAccounts.ts',
  })
  new Script(transpiled.outputText, { filename: 'internalAccounts.js' }).runInContext(context)
  return { api: module.exports, calls, storageWrites, redirectCount, ApiHttpError }
}

const ITEM = {
  id: 'a1', username: 'admin-a', name: '管理员甲', role: 'admin', orgId: null, orgName: null,
  enabled: true, phoneBound: true, phoneVerified: true, phoneMasked: '138****1234', emailBound: false,
  passwordState: 'owner_managed', lastLoginAt: '2026-09-29T01:02:03.000Z', createdAt: '2026-01-01T00:00:00.000Z',
  isBackupAdmin: false,
}

function callOf(harness, index = 0) {
  return harness.calls[index] ?? fail(`expected fetch call #${index}, got ${harness.calls.length}`)
}

function paramsOf(call) {
  return new URL(call.url).searchParams
}

async function verifyAdapter() {
  // GET：路径、查询参数、pageSize 收敛、keyword trim、无请求体
  const listHarness = createAdapterHarness([{ status: 200, body: { items: [ITEM], total: 1, page: 2, pageSize: 20 } }])
  const list = await listHarness.api.listInternalAccounts({ role: 'admin', enabled: false, keyword: '  张三  ', page: 2, pageSize: 7 })
  const call = callOf(listHarness)
  expect(call.method === 'GET', 'list must use GET')
  expect(new URL(call.url).pathname === '/api/v1/admin/internal-accounts', `list path wrong: ${call.url}`)
  expect(paramsOf(call).get('page') === '2' && paramsOf(call).get('pageSize') === '20', 'pageSize=7 must collapse to 20 and never be sent')
  expect(paramsOf(call).get('role') === 'admin' && paramsOf(call).get('enabled') === 'false', 'role/enabled params')
  expect(paramsOf(call).get('keyword') === '张三', 'keyword must be trimmed')
  expect(call.body === undefined, 'GET must not send a body')
  expect(call.headers.Authorization === 'Bearer adapter-test-token', 'auth header must be attached')
  expect(list.items[0].id === 'a1' && list.total === 1, 'list result parsed from bare object')
  expect(listHarness.storageWrites.local === 0 && listHarness.storageWrites.session === 0, 'list must not write browser storage')

  // pageSize 白名单
  const sizes = listHarness.api.INTERNAL_ACCOUNT_PAGE_SIZES
  expect(JSON.stringify([...sizes]) === '[10,20,50,100]', 'page size whitelist is 10/20/50/100')
  expect(listHarness.api.toAllowedPageSize(50) === 50 && listHarness.api.toAllowedPageSize(30) === 20
    && listHarness.api.toAllowedPageSize(1000) === 20 && listHarness.api.toAllowedPageSize(10) === 10, 'toAllowedPageSize')

  // PATCH：路径 + 请求体键恰好 action/reason/adminCurrentPassword
  const patchHarness = createAdapterHarness([{ status: 200, body: { ...ITEM, enabled: false, sessionInvalidation: 'ok' } }])
  const patched = await patchHarness.api.setInternalAccountStatus('a 1', { action: 'disable', reason: '  人员离岗  ', adminCurrentPassword: 'pw' })
  const patchCall = callOf(patchHarness)
  expect(patchCall.method === 'PATCH', 'status must use PATCH')
  expect(new URL(patchCall.url).pathname === '/api/v1/admin/internal-accounts/a%201/status', 'status path with encoded id')
  const patchBody = JSON.parse(patchCall.body)
  expect(JSON.stringify(Object.keys(patchBody).sort()) === '["action","adminCurrentPassword","reason"]', 'PATCH body keys must be exactly the contract')
  expect(patchBody.reason === '人员离岗' && patchBody.action === 'disable', 'reason trimmed, action echoed')
  expect(patched.sessionInvalidation === 'ok' && patched.enabled === false, 'PATCH result carries sessionInvalidation')

  // POST start：请求体键恰好 phone/adminCurrentPassword（不带 deviceId）
  const startHarness = createAdapterHarness([{ status: 200, body: { ticket: 't'.repeat(43), phoneMasked: '138****1234', expiresInSeconds: 300, cooldownSeconds: 60 } }])
  const start = await startHarness.api.startBackupAdmin({ phone: ' 13800138123 ', adminCurrentPassword: 'pw' })
  const startCall = callOf(startHarness)
  expect(startCall.method === 'POST' && new URL(startCall.url).pathname === '/api/v1/admin/internal-accounts/backup-admin/start', 'start path')
  const startBody = JSON.parse(startCall.body)
  expect(JSON.stringify(Object.keys(startBody).sort()) === '["adminCurrentPassword","phone"]', 'start body keys must be exactly phone + adminCurrentPassword')
  expect(startBody.phone === '13800138123', 'start phone trimmed')
  expect(start.expiresInSeconds === 300 && start.cooldownSeconds === 60, 'start result parsed')

  // POST verify：请求体键恰好 ticket/code
  const verifyHarness = createAdapterHarness([{ status: 200, body: ITEM }])
  const verified = await verifyHarness.api.verifyBackupAdmin({ ticket: 't'.repeat(43), code: '123456' })
  const verifyCall = callOf(verifyHarness)
  expect(verifyCall.method === 'POST' && new URL(verifyCall.url).pathname === '/api/v1/admin/internal-accounts/backup-admin/verify', 'verify path')
  const verifyBody = JSON.parse(verifyCall.body)
  expect(JSON.stringify(Object.keys(verifyBody).sort()) === '["code","ticket"]', 'verify body keys must be exactly ticket + code')
  expect(verified.username === 'admin-a', 'verify returns roster item')

  // 错误码与中文 message 原样带回；密码/验证码/ticket 不进 URL
  for (const [status, code, message] of [
    [409, 'INTERNAL_ACCOUNT_LAST_ADMIN', '这是最后一个可用的管理员账号，停用后将没有人能登录管理后台'],
    [422, 'ADMIN_CREDENTIAL_INVALID', '管理员本人密码不正确'],
    [429, 'SMS_TOO_FREQUENT', '发送太频繁，请稍后再试'],
  ]) {
    const errorHarness = createAdapterHarness([{ status, body: { error: { code, message } } }])
    let caught = null
    await errorHarness.api.startBackupAdmin({ phone: '13800138123', adminCurrentPassword: 'pw' }).catch((e) => { caught = e })
    expect(caught instanceof errorHarness.ApiHttpError, `error ${code} must surface as ApiHttpError`)
    expect(caught.code === code && caught.message === message && caught.status === status, `error ${code} code/message/status must round-trip`)
    expect(!errorHarness.calls[0].url.includes('pw') && !errorHarness.calls[0].url.includes('13800138123'), 'credentials must not leak into URL')
  }

  // 401 → redirectToLogin
  const unauthorizedHarness = createAdapterHarness([{ status: 401, body: { error: { code: 'AUTH_TOKEN_INVALID', message: '登录已过期' } } }])
  await unauthorizedHarness.api.listInternalAccounts({ page: 1, pageSize: 20 }).catch(() => undefined)
  expect(unauthorizedHarness.redirectCount.value === 1, '401 must redirect to login exactly once')

  // 响应形状不对不当成功（裸通道与包装通道都要守）
  const malformed = [
    ['items not array', { items: {}, total: 0, page: 1, pageSize: 20 }],
    ['missing total', { items: [], page: 1, pageSize: 20 }],
    ['item missing isBackupAdmin', { items: [{ ...ITEM, isBackupAdmin: undefined }], total: 1, page: 1, pageSize: 20 }],
    ['start missing expiry', { ticket: 't'.repeat(43), phoneMasked: '138****1234', cooldownSeconds: 60 }],
    ['status missing sessionInvalidation', { ...ITEM }],
    ['success wrapper without data', { success: true }],
    ['success false wrapper', { success: false, data: { items: [], total: 0, page: 1, pageSize: 20 } }],
  ]
  for (const [label, body] of malformed) {
    const kind = 'ticket' in body || ('cooldownSeconds' in body) ? 'start'
      : 'sessionInvalidation' in body || 'username' in body ? 'status' : 'list'
    const harness = createAdapterHarness([{ status: 200, body }])
    const promise = kind === 'start'
      ? harness.api.startBackupAdmin({ phone: '13800138123', adminCurrentPassword: 'pw' })
      : kind === 'status'
        ? harness.api.setInternalAccountStatus('a1', { action: 'disable', reason: '事由', adminCurrentPassword: 'pw' })
        : harness.api.listInternalAccounts({ page: 1, pageSize: 20 })
    let caught = null
    await promise.catch((e) => { caught = e })
    expect(caught instanceof harness.ApiHttpError && caught.code === 'INVALID_RESPONSE', `malformed 2xx (${label}) must be rejected as INVALID_RESPONSE`)
    expect(harness.storageWrites.local === 0 && harness.storageWrites.session === 0, `malformed 2xx (${label}) must not persist anything`)
  }

  // { success: true, data } 包装也能正确解析
  const wrappedHarness = createAdapterHarness([{ status: 200, body: { success: true, data: { items: [ITEM], total: 1, page: 1, pageSize: 20 } } }])
  const wrapped = await wrappedHarness.api.listInternalAccounts({ page: 1, pageSize: 20 })
  expect(wrapped.items.length === 1 && wrapped.total === 1, 'enveloped {success,data} response must be unwrapped')

  // mock 模式：不发请求、不造假名册、写操作明确拒绝
  const mockHarness = createAdapterHarness([], { apiMode: 'mock' })
  const mockList = await mockHarness.api.listInternalAccounts({ page: 1, pageSize: 20 })
  expect(mockList.items.length === 0 && mockList.total === 0, 'mock list must stay honestly empty')
  expect(mockHarness.calls.length === 0, 'mock mode must not hit fetch')
  let mockRejected = null
  await mockHarness.api.setInternalAccountStatus('a1', { action: 'disable', reason: '事由', adminCurrentPassword: 'pw' }).catch((e) => { mockRejected = e })
  expect(mockRejected?.code === 'DEMO_MODE_READONLY', 'mock mutations must be rejected as DEMO_MODE_READONLY')

  // 全程不写浏览器存储、不打日志
  for (const harness of [listHarness, patchHarness, startHarness, verifyHarness]) {
    expect(harness.storageWrites.local === 0 && harness.storageWrites.session === 0, 'adapter must never write browser storage')
  }
}

try {
  await verifyAdapter()
  pass('适配器已在隔离 VM 中真跑：路径/参数/请求体键精确、错误原样带回、坏响应拒绝、mock 不造假')
} catch (error) {
  fail(`适配器运行时行为验证失败: ${error instanceof Error ? error.message : String(error)}`)
}

// ─── [B] presentation.ts VM 沙箱真跑（行级按钮判定）─────────────────────────

function createPresentationHarness() {
  const module = { exports: {} }
  const context = createContext({
    module,
    exports: module.exports,
    Intl,
    Date,
    require: () => { throw new Error('presentation.ts must not require runtime modules') },
  })
  const transpiled = ts.transpileModule(loaded[files.presentation], {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'presentation.ts',
  })
  new Script(transpiled.outputText, { filename: 'presentation.js' }).runInContext(context)
  return module.exports
}

try {
  const p = createPresentationHarness()
  const adminRow = { ...ITEM }
  const other = { ...ITEM, id: 'a2', username: 'admin-b', enabled: true }
  const self = p.rowActionFor(adminRow, 'a1', 2)
  expect(self.kind === 'status' && self.disabled === true && self.reason.length > 0, 'own row disable must be disabled with a reason')
  const lastAdmin = p.rowActionFor(other, 'a1', 1)
  expect(lastAdmin.kind === 'status' && lastAdmin.disabled === true && lastAdmin.reason.length > 0, 'last enabled admin disable must be disabled with a reason')
  const normal = p.rowActionFor(other, 'a1', 2)
  expect(normal.kind === 'status' && normal.disabled === false, 'other enabled admin with enabledAdminTotal>=2 must be actionable')
  const unknownTotal = p.rowActionFor(other, 'a1', null)
  expect(unknownTotal.kind === 'status' && unknownTotal.disabled === false, 'unknown enabledAdminTotal must not hard-block the row (server 409 is the backstop)')
  const disabledRow = { ...ITEM, enabled: false }
  const enable = p.rowActionFor(disabledRow, 'a1', 2)
  expect(enable.kind === 'status' && enable.enabled === false && enable.disabled === false, 'disabled admin must be enableable')
  const partner = p.rowActionFor({ ...ITEM, id: 'p1', role: 'partner', orgId: 'org-1', orgName: '演示机构' }, 'a1', 2)
  expect(partner.kind === 'partner-link' && partner.orgId === 'org-1' && partner.orgName === '演示机构', 'partner row must be a link to the org page')
  const kiosk = p.rowActionFor({ ...ITEM, id: 'k1', role: 'kiosk' }, 'a1', 2)
  expect(kiosk.kind === 'readonly', 'kiosk row must be readonly')
  expect(p.backupAdminExistsIn([{ ...ITEM }, { ...ITEM, isBackupAdmin: true }]) === true, 'backup admin existence detection')
  expect(p.backupAdminExistsIn([ITEM]) === false, 'no false positive for backup admin existence')
  expect(p.formatBeijingDateTime(null) === '从未登录', 'empty last login must say 从未登录')
  expect(p.formatBeijingDateTime('2026-09-29T01:02:03.000Z') === '2026-09-29 09:02', `Beijing time must be yyyy-MM-dd HH:mm, got ${p.formatBeijingDateTime('2026-09-29T01:02:03.000Z')}`)
  expect(p.formatBeijingDate('2026-01-01T16:00:00.000Z') === '2026-01-02 00:00', 'created time uses the same Beijing clock')
  pass('presentation 规则已真跑：自己/最后一个启用管理员禁用并说明、partner 链机构页、kiosk 只读、北京时间格式')
} catch (error) {
  fail(`presentation 运行时行为验证失败: ${error instanceof Error ? error.message : String(error)}`)
}

// ─── [C] 页面接线静态检查 ────────────────────────────────────────────────────

const page = loaded[files.page]
const table = loaded[files.table]
const statusDialog = loaded[files.statusDialog]
const backupDrawer = loaded[files.backupDrawer]

if (
  page.includes("from '../../services/api/internalAccounts'") &&
  page.includes('listInternalAccounts(') &&
  page.includes("role: 'admin', enabled: true") &&
  page.includes('getUser()') &&
  page.includes('enabledAdminTotal') &&
  page.includes('sessionInvalidation') &&
  page.includes('未能立即让该账号已登录的会话失效')
) {
  pass('名册页用真实适配器拉名册与启用管理员总数，sessionInvalidation 语义如实提示')
} else {
  fail('名册页必须接 internalAccounts 适配器、自己那行与最后一个启用管理员的判定、sessionInvalidation 提示')
}

if (
  table.includes("from './presentation'") &&
  table.includes('rowActionFor') &&
  table.includes('/partners?search=${encodeURIComponent(action.orgName)}') &&
  table.includes('去机构页处理') &&
  table.includes('min-h-12')
) {
  pass('表格行按 presentation 判定渲染；partner 行链到合作机构管理页；可点区域 ≥48px')
} else {
  fail('AccountsTable 必须用 rowActionFor、partner 行链机构页、按钮 min-h-12')
}

if (
  statusDialog.includes("from '../../services/api/internalAccounts'") &&
  statusDialog.includes('setInternalAccountStatus(') &&
  statusDialog.includes('2-200 字') &&
  statusDialog.includes('/200') &&
  statusDialog.includes('type="password"')
) {
  pass('启停弹窗走真实适配器，事由 2–200 字带计数，密码用 password 输入')
} else {
  fail('AccountStatusDialog 必须接 setInternalAccountStatus 并显示事由字数')
}

if (
  backupDrawer.includes("from '../../services/api/internalAccounts'") &&
  backupDrawer.includes('startBackupAdmin(') &&
  backupDrawer.includes('verifyBackupAdmin(') &&
  backupDrawer.includes('重新发送验证码') &&
  backupDrawer.includes('随机临时密码') &&
  backupDrawer.includes('找回密码') &&
  backupDrawer.includes('min-h-12')
) {
  pass('备用管理员抽屉两步都走真实适配器，结果说明讲清随机临时密码与找回密码路径')
} else {
  fail('BackupAdminDrawer 必须用 start/verify 真实适配器并讲清建号语义')
}

// 敏感值不进存储 / 不进 URL / 不进 console / 不进 DOM 属性
for (const [name, source] of [['page', page], ['table', table], ['statusDialog', statusDialog], ['backupDrawer', backupDrawer], ['adapter', loaded[files.adapter]]]) {
  if (source.includes('localStorage') || source.includes('sessionStorage')) fail(`${name} 不得读写浏览器存储`)
  if (/console\.(log|info|debug|warn|error)/.test(source)) fail(`${name} 不得打日志（避免泄漏密码/验证码/ticket）`)
}
if (backupDrawer.includes('ticket}') && backupDrawer.includes('to=')) fail('ticket 不得拼进 URL')
if (/data-[\w-]*ticket|value=\{ticket\}/.test(backupDrawer)) fail('ticket 不得进 DOM 属性或受控值')
if (/password\}.*to=|to=.*password\}/.test(statusDialog)) fail('密码不得进 URL')
pass('密码 / 验证码 / ticket 不进存储、URL、console 或 DOM 属性')

console.log('\nALL PASS')
