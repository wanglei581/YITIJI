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
  "policy: '对应一体机「政策服务」'",
  "smartCampus: '对应一体机首页「智慧校园」'",
  "profile: '对应一体机「本机构官方渠道」与政策的来源机构'",
  "profileHosted: '对应一体机「本机构官方渠道」「找企业」与岗位、政策的来源机构'",
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
console.log('verify:partner-refresh-safe passed')
