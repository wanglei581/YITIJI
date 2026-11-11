import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import assert from 'node:assert/strict'

const routes = [
  {
    name: 'jobs',
    file: '../src/routes/jobs/index.tsx',
    key: "const PARTNER_JOBS_REFRESH_KEY = 'partner:jobs'",
    hint: 'FRONTEND_HINT.jobs',
  },
  {
    name: 'fairs',
    file: '../src/routes/fairs/index.tsx',
    key: "const PARTNER_FAIRS_REFRESH_KEY = 'partner:fairs'",
    hint: 'FRONTEND_HINT.fairs',
  },
  {
    name: 'policy',
    file: '../src/routes/policy/index.tsx',
    key: "const PARTNER_POLICIES_REFRESH_KEY = 'partner:policies'",
    hint: 'FRONTEND_HINT.policy',
  },
]

const requiredTokens = [
  "from '@ai-job-print/refresh'",
  'useRefreshable(',
  'useInteractionLock(',
  'replaceIfChanged',
  'intervalMs: 60_000',
  "failPolicy: 'keep-last'",
  'pageSize: PAGE_SIZE',
  'setPage(1)',
]

const forbiddenTokens = [
  'const load = useCallback',
  'useEffect(() => { load() }',
  'setJobs(',
  'setFairs(',
  'setRows(',
]

const routeFilterRequired = {
  jobs: ['jobType', '...(reviewStatus ? { reviewStatus } : {})'],
  fairs: ['status: fairStatus'],
  policy: ['...(reviewStatus ? { reviewStatus } : {})'],
}

const routeFilterForbidden = {
  jobs: ['jobs.filter((j)'],
  fairs: ['fairs.filter((f)'],
  policy: ['rows.filter((r)'],
}

let failed = false

for (const route of routes) {
  const filePath = fileURLToPath(new URL(route.file, import.meta.url))
  const text = readFileSync(filePath, 'utf8')
  const tableName = { jobs: 'JobsTable', fairs: 'FairsTable', policy: 'PolicyTable' }[route.name]
  const tableText = readFileSync(fileURLToPath(new URL(`../src/routes/${route.name}/${tableName}.tsx`, import.meta.url)), 'utf8')
  for (const token of [`<${tableName}`, 'page={page}', 'total={total}', 'onPageChange={setPage}']) {
    if (!text.includes(token)) { console.error(`${route.name} 缺少服务端分页传入 ${token}`); failed = true }
  }
  for (const token of ['<ConsoleTable', 'page={page}', 'pageSize={20}', 'total={total}', 'onPageChange={onPageChange}', '当前筛选条件下无']) {
    if (!tableText.includes(token)) { console.error(`${route.name} 公共表格缺少 ${token}`); failed = true }
  }
  const missing = [route.key, route.hint, ...requiredTokens].filter((token) => !text.includes(token))
  for (const token of missing) {
    console.error(`${route.name} refresh integration missing token: ${token}`)
    failed = true
  }
  for (const token of forbiddenTokens) {
    if (text.includes(token)) {
      console.error(`${route.name} refresh integration must not use legacy state token: ${token}`)
      failed = true
    }
  }
  for (const token of routeFilterRequired[route.name]) {
    if (!text.includes(token)) {
      console.error(`${route.name} list filter push-down missing token: ${token}`)
      failed = true
    }
  }
  for (const token of routeFilterForbidden[route.name]) {
    if (text.includes(token)) {
      console.error(`${route.name} still locally filters the current page: ${token}`)
      failed = true
    }
  }
}

const pageFile = fileURLToPath(new URL('../src/routes/Page.tsx', import.meta.url))
const pageText = readFileSync(pageFile, 'utf8')
for (const token of [
  "jobs: '对应一体机「岗位信息」/ 小程序「求职」'",
  "fairs: '对应一体机「招聘会信息」'",
  "policy: '对应一体机首页「查政策」'",
  "smartCampus: '一体机端 2026-11-04 起暂停显示，开关先保存'",
  "profile: '对应一体机首页磁贴「机构官方渠道」，打开后页标题是「本机构官方渠道」'",
  "profileHosted: '对应一体机首页磁贴「机构官方渠道」，打开后页标题是「本机构官方渠道」；以及一体机「找企业」与岗位、政策的来源机构'",
  "companies: '对应一体机「找企业」与岗位详情来源机构'",
  "terminals: '对应本机构一体机的打印扫描服务与设备运行'",
  "none: ''",
  'export function withFrontendHint',
  'export function ListPagination',
]) {
  if (!pageText.includes(token)) {
    console.error(`Page subtitle map missing token: ${token}`)
    failed = true
  }
}

const subtitlePages = [
  { name: 'smart-campus', file: '../src/routes/smart-campus/index.tsx', hint: 'FRONTEND_HINT.smartCampus' },
  { name: 'profile', file: '../src/routes/profile/index.tsx', hint: 'FRONTEND_HINT.profile' },
  { name: 'companies', file: '../src/routes/companies/index.tsx', hint: 'FRONTEND_HINT.companies' },
  { name: 'dashboard', file: '../src/routes/dashboard/index.tsx', hint: 'FRONTEND_HINT.none' },
  { name: 'sources', file: '../src/routes/sources/index.tsx', hint: 'FRONTEND_HINT.none', extra: ['不要把凭证放进地址', "'API 直连'"] },
  { name: 'sync-logs', file: '../src/routes/sync-logs/index.tsx', hint: 'FRONTEND_HINT.none' },
  { name: 'stats', file: '../src/routes/stats/index.tsx', hint: 'FRONTEND_HINT.none' },
  { name: 'account', file: '../src/routes/account/index.tsx', hint: 'FRONTEND_HINT.none' },
  // 2026-09-29 终端数据页接真：统计的是本机构一体机的打印扫描与设备运行，副标题改指一体机
  { name: 'terminals', file: '../src/routes/terminals/index.tsx', hint: 'FRONTEND_HINT.terminals' },
]
for (const route of subtitlePages) {
  const text = readFileSync(fileURLToPath(new URL(route.file, import.meta.url)), 'utf8')
  if (!text.includes(route.hint) || !text.includes('withFrontendHint(')) {
    console.error(`${route.name} missing frontend destination subtitle`)
    failed = true
  }
  for (const token of route.extra ?? []) {
    if (!text.includes(token)) {
      console.error(`${route.name} missing token: ${token}`)
      failed = true
    }
  }
}

// 企业页本地筛选：子表须接收全量是否存在，不能用筛选后 rows.length 区分空态。
const companies = readFileSync(fileURLToPath(new URL('../src/routes/companies/index.tsx', import.meta.url)), 'utf8')
assert.ok(companies.includes('hasAny={companies.length > 0}'), '企业表必须从全量 rows 接收 hasAny')
const companyTable = readFileSync(fileURLToPath(new URL('../src/routes/companies/CompaniesTable.tsx', import.meta.url)), 'utf8')
const ast = ts.createSourceFile('CompaniesTable.tsx', companyTable, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let emptyTitle
function visitEmpty(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'empty') {
    emptyTitle = node.initializer.expression.properties.find((p) => p.name?.getText(ast) === 'title').initializer.getText(ast)
  }
  ts.forEachChild(node, visitEmpty)
}
visitEmpty(ast)
assert.ok(emptyTitle, '企业表必须提供空态标题')
const titleOf = new Function('hasAny', 'rows', `return (${emptyTitle})`)
assert.equal(titleOf(false, []), '暂无匹配的企业资料')
assert.equal(titleOf(true, []), '当前筛选条件下无企业', '全量有企业但筛选为零时必须说明筛选无结果')
console.log('PASS 企业表两种空态：全量无数据 / 全量有数据但筛选为零')

if (failed) process.exit(1)

// 2026-11-05 政策最小闭环：执行真实表单转换与发布错误适配，保护清空语义和停放边界。
{
  const vm = await import('node:vm')
  const readPolicy = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const load = (file, dependencies = {}, expose = '') => {
    const module = { exports: {} }
    const output = ts.transpileModule(readPolicy(file), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    vm.runInNewContext(output + expose, {
      module, exports: module.exports, URL,
      require: (name) => {
        assert.ok(name in dependencies, `意外依赖 ${name}`)
        return dependencies[name]
      },
    })
    return module.exports
  }
  const jsx = (type, props) => ({ type, props })
  const react = { useEffect: () => {}, useState: (value) => [value, () => {}] }
  const model = load('routes/policy/policyFormModel.ts', { '../../lib/httpUrl': load('lib/httpUrl.ts') })
  const fields = load('routes/policy/PolicyFormFields.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, react,
    '../../services/api/officialChannels': {},
    '../../services/api/policies': { partnerPoliciesService: { previewDraftCheck: async () => ({ publishWarning: null, checklistReady: true, columns: [] }) } },
    '../../lib/httpUrl': load('lib/httpUrl.ts'),
    './policyLabels': load('routes/policy/policyLabels.ts', { '@ai-job-print/shared': { PARTNER_TYPE_LABELS: {} } }),
    './policyFormModel': model,
  })
  const empty = { ...model.EMPTY_FORM, title: '政策扶持条目' }
  const keys = ['summary', 'content', 'externalUrl', 'externalId', 'publishedDate', 'whoCanApply', 'requiredMaterials', 'whereToApply']
  for (const key of keys) {
    const form = { ...empty, [key]: '  ' }
    assert.ok(!(key in model.policyFormPayload(form, false)), `新建空 ${key} 必须省略`)
    assert.equal(JSON.parse(JSON.stringify(model.policyFormPayload(form, true)))[key], null, `编辑清空 ${key} 必须发送 null`)
    assert.equal(model.policyFormPayload({ ...form, [key]: ' 原文 ' }, true)[key], '原文')
  }
  assert.equal(model.EMPTY_FORM.kind, 'policy_guide', '新增默认是政策扶持条目')
  const notice = { ...model.EMPTY_FORM, kind: 'notice', title: '政策公告' }
  assert.equal(model.policyFormBlockReason(notice), null, '公告允许无链接和三栏')
  const guide = { ...empty, kind: 'policy_guide', externalUrl: 'https://official.example/policy', whoCanApply: '原文条件', requiredMaterials: '原文材料', whereToApply: '原文窗口' }
  assert.equal(model.policyFormBlockReason(guide), null, '前端不按域名名单拒绝，名单判据在服务端')
  for (const key of ['whoCanApply', 'requiredMaterials', 'whereToApply']) {
    assert.match(model.policyFormBlockReason({ ...guide, [key]: ' \n ' }), /请填齐/)
    assert.match(model.policyFormBlockReason({ ...guide, [key]: '字'.repeat(2001) }), /2000/)
  }
  assert.match(model.policyFormBlockReason({ ...guide, externalUrl: '' }), /原文链接/)
  assert.equal(model.policyFormBlockReason({ ...guide, externalUrl: 'http://official.example/p' }), null, 'http 不拦保存草稿')
  for (const externalUrl of ['javascript:alert(1)', '/policy', 'https://']) {
    assert.match(model.policyFormBlockReason({ ...guide, externalUrl }), /https/)
  }
  assert.equal(model.policyFormBlockReason({ ...guide, title: '字'.repeat(200) }), null)
  assert.match(model.policyFormBlockReason({ ...guide, title: '字'.repeat(201) }), /200/)
  const treeNodes = (node) => {
    if (!node || typeof node !== 'object') return []
    if (Array.isArray(node)) return node.flatMap(treeNodes)
    return [node, ...treeNodes(node.props?.children)]
  }
  const render = (form) => treeNodes(fields.PolicyFormFields({ form, setForm: () => {}, recruitmentOpen: false, editingRecruitmentLocked: false }))
  const guideNodes = render(guide)
  assert.equal(guideNodes.filter((node) => node.type === 'textarea' && node.props.maxLength === 2000 && node.props.required).length, 3)
  assert.equal(guideNodes.filter((node) => node.type === 'input' && node.props.maxLength === 200).length, 1)
  assert.equal(render(notice).filter((node) => node.type === 'textarea' && node.props.maxLength === 2000).length, 0)
  const fieldsSource = readPolicy('routes/policy/PolicyFormFields.tsx')
  assert.equal(model.CHECKLIST_OVERFLOW_HINT, '清单上印不下，超出的部分要扫码看原文')
  assert.ok(fieldsSource.includes('CHECKLIST_OVERFLOW_HINT'))
  assert.ok(fieldsSource.includes('previewDraftCheck'))
  const page = readPolicy('routes/policy/index.tsx')
  const table = readPolicy('routes/policy/PolicyTable.tsx')
  assert.doesNotMatch(page, /import\s+EligibilityRulesDrawer|<EligibilityRulesDrawer|setRulesFor/)
  assert.doesNotMatch(table, /setRulesFor|ClipboardListIcon|>\s*申领条件\s*</)
  assert.match(table, /停放（2026-11-05 政策最小闭环）：条件核对整块停放，源码保留/)
  assert.ok(readPolicy('routes/policy/EligibilityRulesDrawer.tsx').includes('EligibilityRulesDrawer'))
  assert.ok(readPolicy('routes/policy/EligibilityRuleEditor.tsx').length > 0)
  assert.match(page, /disabled=\{saving \|\| !canSave\}/)
  assert.match(page, /保存并发布/)
  assert.match(table, />\s*审核通过\s*</)
  assert.match(table, />\s*发布\s*</)
  assert.match(page, /formBlockReason && !editingRecruitmentLocked && <p role="status"/)
  class ApiHttpError extends Error {
    constructor(codeOrMessage, message) { super(message ?? codeOrMessage) }
  }
  const releaseModule = load('routes/policy/PolicyReleaseDialog.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, react, '@ai-job-print/ui': {},
    '../../services/api/client': { ApiHttpError }, '../../services/api/policies': {},
  }, '\nmodule.exports.releaseErrorMessage = errMsg;')
  const { releaseErrorMessage, PolicyReleaseDialog } = releaseModule
  const renderedText = (node) => {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(renderedText).join('')
    if (!node) return ''
    return renderedText(node.props?.children)
  }
  const releaseText = (policy) => renderedText(PolicyReleaseDialog({ policy, onClose: () => {}, onReleased: () => {} }))
  const releasePolicy = { ...guide, id: '1', contentVersion: 1 }
  assert.match(releaseText(releasePolicy), /已填齐/)
  assert.match(releaseText(releasePolicy), /原文链接还没通过官方网站核对，发布时会被拦下/)
  assert.match(releaseText({ ...releasePolicy, externalUrlVerified: true }), /原文链接已通过官方网站核对/)
  assert.match(releaseText({ ...releasePolicy, requiredMaterials: '  ', externalUrl: '' }), /未填齐，发布时会被拦下/)
  assert.match(releaseText({ ...releasePolicy, requiredMaterials: '  ', externalUrl: '' }), /原文链接未填写，发布时会被拦下/)
  const fallback = '这次没发布成功，请稍后再试；多次失败请联系平台管理员'
  assert.equal(releaseErrorMessage(new ApiHttpError('请填齐谁可以申请、要准备的材料、去哪办')), '请填齐谁可以申请、要准备的材料、去哪办')
  assert.equal(releaseErrorMessage(new ApiHttpError('')), fallback)
  assert.equal(releaseErrorMessage(new ApiHttpError('POLICY_NOT_FOUND', 'Policy pp-1 not found')), fallback)
  assert.equal(releaseErrorMessage(new Error('/api/v1/partner/policies/1/release HTTP_400 {"error":{}}')), fallback)

  // 真实 HTTP 适配器：发布失败只从 error.message 取原因，不泄漏顶层 message 数组/状态文本。
  let responseBody
  let sent
  const apiModule = { exports: {} }
  const output = ts.transpileModule(readPolicy('services/api/policies.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(output, {
    module: apiModule, exports: apiModule.exports, URLSearchParams,
    require: (name) => name === './client'
      ? { API_MODE: 'http', API_BASE_URL: '/api/v1', ApiHttpError }
      : { authHeader: () => ({}), redirectToLogin: () => {} },
    fetch: async (_url, init) => {
      sent = JSON.parse(init.body)
      return { ok: false, status: 400, statusText: 'Bad Request /api/v1/internal', json: async () => responseBody }
    },
  })
  const api = apiModule.exports.partnerPoliciesService
  for (const body of [
    { error: { code: 'POLICY_HANDLING_FIELDS_REQUIRED', message: '请填齐三栏' } },
    { message: ['HTTP_400 /api/v1/internal {"error":{}}'] }, {},
  ]) {
    responseBody = body
    await assert.rejects(api.releasePolicy('1', { responsibilityAcknowledged: true }), (error) => {
      assert.equal(releaseErrorMessage(error), body.error?.message ?? fallback)
      return true
    })
  }
  responseBody = {}
  await assert.rejects(api.updatePolicy('1', model.policyFormPayload(empty, true)))
  for (const key of keys) assert.equal(sent[key], null, `PATCH 实际 JSON 中 ${key} 为 null`)
  console.log('PASS 政策三栏/默认扶持条目/http 不拦保存/标题边界、新建省略与编辑清空、条件入口停放、分步按钮仍在、发布人话错误与真实 PATCH JSON')
}

console.log('verify:partner-refresh-safe passed')
