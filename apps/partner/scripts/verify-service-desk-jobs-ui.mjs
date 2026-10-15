import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import vm from 'node:vm'

const packageRoot = new URL('../', import.meta.url)
const failures = []

function normalizeNewlines(source) {
  return source.replace(/\r\n?/g, '\n')
}

async function read(relativePath) {
  try {
    return normalizeNewlines(await readFile(new URL(relativePath, packageRoot), 'utf8'))
  } catch (error) {
    throw new Error(`Required Partner UI file is missing or unreadable: ${relativePath}`, {
      cause: error,
    })
  }
}

function check(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`)
    return
  }
  failures.push(message)
  console.error(`FAIL ${message}`)
}

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `${label} is missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `${label} is missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

function matches(source, pattern) {
  return pattern.test(source)
}

function compact(source) {
  return source.replace(/\s+/g, ' ').trim()
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function count(source, token) {
  return source.split(token).length - 1
}

function countObjectKey(source, key) {
  return [...source.matchAll(new RegExp(`(?:^|\\n)\\s*${key}\\s*:`, 'g'))].length
}

console.log('\n=== Partner Inkpaper 岗位管理 UI 门禁 ===')

const packageJsonPath = fileURLToPath(new URL('package.json', packageRoot))
const packageJson = JSON.parse(await read('package.json'))
check(
  packageJson.scripts?.['verify:service-desk-jobs-ui'] ===
    'node scripts/verify-service-desk-jobs-ui.mjs',
  `${packageJsonPath} registers verify:service-desk-jobs-ui`,
)

const wrapper = await read('src/layouts/PartnerLayoutWrapper.tsx')
const partnerLayoutProps = extractBetween(
  wrapper,
  '<PartnerLayout',
  'headerActions=',
  'PartnerLayout route props',
)
check(
  partnerLayoutProps.includes('visualTheme="legacy"') &&
    !partnerLayoutProps.includes('service-desk') &&
    !wrapper.includes('normalizedPathname') &&
    // 菜单高亮仍按原路径查表、查不到回落工作台；数据大屏的 /screen/:tab 子路径高亮「数据大屏」。
    // 这里守的是「不按路由切服务台主题」，不是这一行的字面写法。
    /const activeKey = PATH_TO_KEY\[location\.pathname\] \?\? (?:'dashboard'|\(location\.pathname\.startsWith\('\/screen\/'\) \? 'screen' : 'dashboard'\))\n/.test(wrapper),
  'PartnerLayout keeps the warm legacy theme without route-level service-desk selection',
)
check(
  matches(partnerLayoutProps, /density=['"]comfortable['"]/),
  'PartnerLayout keeps comfortable density for operational pages',
)

const jobsPage = await read('src/routes/jobs/index.tsx')
const jobsTable = await read('src/routes/jobs/JobsTable.tsx')
check(jobsPage.includes('<JobsTable') && jobsTable.includes('<ConsoleTable') && jobsTable.includes("header: '岗位标题'"), '岗位表由现有路由挂载，公共表格保留可见岗位标题列')
const categoryMap = extractBetween(
  jobsTable,
  'const CATEGORY_MAP:',
  'const REVIEW_MAP:',
  'CATEGORY_MAP',
)
const expectedCategories = [
  ['fulltime', '全职', 'bg-blue-50 text-blue-700'],
  ['intern', '实习', 'bg-violet-50 text-violet-700'],
  ['campus', '校招', 'bg-emerald-50 text-emerald-700'],
  ['parttime', '兼职', 'bg-orange-50 text-orange-700'],
]
for (const [key, label, style] of expectedCategories) {
  check(
    matches(
      categoryMap,
      new RegExp(
        `${key}\\s*:\\s*\\{\\s*label:\\s*['"]${label}['"]\\s*,\\s*style:\\s*['"]${style}['"]\\s*\\}`,
      ),
    ),
    `CATEGORY_MAP maps ${key} to the exact low-saturation ${style} category palette`,
  )
}
check(
  !categoryMap.includes('--sd-category-') &&
    !/(?:info|success|warning|error|review|publish|status)/i.test(categoryMap),
  'CATEGORY_MAP is independent from service-desk variables and status semantics',
)

const reviewMap = extractBetween(
  jobsTable,
  'const REVIEW_MAP:',
  'const PUBLISH_MAP:',
  'REVIEW_MAP',
)
const expectedReviewStatuses = [
  ['pending', 'warning', '待审核'],
  ['reviewing', 'info', '审核中'],
  ['approved', 'success', '已通过'],
  ['rejected', 'error', '已拒绝'],
]
for (const [key, badge, label] of expectedReviewStatuses) {
  check(
    matches(
      reviewMap,
      new RegExp(
        `${key}\\s*:\\s*\\{\\s*badge:\\s*['"]${badge}['"]\\s*,\\s*label:\\s*['"]${label}['"]\\s*\\}`,
      ),
    ),
    `REVIEW_MAP keeps ${key} as ${badge}/${label}`,
  )
}
check(
  expectedReviewStatuses.every(([key]) => countObjectKey(reviewMap, key) === 1),
  'REVIEW_MAP contains each required review status exactly once',
)

const publishMap = extractBetween(
  jobsTable,
  'const PUBLISH_MAP:',
  'interface Props',
  'PUBLISH_MAP',
)
const expectedPublishStatuses = [
  ['draft', 'bg-warning', '待发布'],
  ['published', 'bg-success', '已发布'],
  ['unpublished', 'bg-neutral-300', '已下架'],
  ['expired', 'bg-neutral-300', '已过期'],
]
for (const [key, dot, label] of expectedPublishStatuses) {
  check(
    matches(
      publishMap,
      new RegExp(
        `${key}\\s*:\\s*\\{\\s*dot:\\s*['"]${dot}['"]\\s*,\\s*label:\\s*['"]${label}['"]\\s*\\}`,
      ),
    ),
    `PUBLISH_MAP keeps ${key} as ${dot}/${label}`,
  )
}
check(
  expectedPublishStatuses.every(([key]) => countObjectKey(publishMap, key) === 1),
  'PUBLISH_MAP contains each required publish status exactly once',
)

const selectedClass =
  "const FILTER_SELECTED_CLASS = 'border-primary-600 bg-primary-600 text-white'"
const idleClass =
  "const FILTER_IDLE_CLASS = 'border-neutral-200 bg-surface text-neutral-700 hover:border-primary-600/40'"
check(jobsPage.includes(selectedClass), 'filter selected state uses the Inkpaper primary contract')
check(jobsPage.includes(idleClass), 'filter idle state uses the exact neutral-surface contract')

const categoryFiltersUi = extractBetween(
  jobsPage,
  '{CATEGORY_FILTERS.map((f) => (',
  '{REVIEW_FILTERS.map((f) => (',
  'category filter UI',
)
const reviewFiltersUi = extractBetween(
  jobsPage,
  '{REVIEW_FILTERS.map((f) => (',
  '<JobsTable',
  'review filter UI',
)
for (const [label, block, stateName] of [
  ['category', categoryFiltersUi, 'categoryFilter'],
  ['review', reviewFiltersUi, 'reviewFilter'],
]) {
  check(
    matches(
      block,
      new RegExp(
        `${stateName}\\s*===\\s*f\\s*\\?\\s*FILTER_SELECTED_CLASS\\s*:\\s*FILTER_IDLE_CLASS`,
      ),
    ),
    `${label} filter uses the shared selected and idle style contracts`,
  )
  check(
    matches(block, /className=\{`[^`]*\bborder\b[^`]*\$\{/),
    `${label} filter renders a real border before applying border colors`,
  )
}

check(
  /import\s*\{\s*getPartnerJobQualitySummary\s*,\s*getPartnerJobs\s*,\s*importPartnerJobs\s*,\s*unpublishPartnerJob\s*,\s*updatePartnerJob\s*\}\s*from\s*['"]\.\.\/\.\.\/services\/api['"]/.test(
    jobsPage,
  ),
  'jobs workflow imports every service from ../../services/api',
)

const refreshContract = extractBetween(
  jobsPage,
  'const { data, status, refresh } = useRefreshable(',
  'useEffect(() => {',
  'refresh and interaction-lock contract',
)
check(
  /getPartnerJobs\(\{\s*page\s*,\s*pageSize:\s*PAGE_SIZE\s*,\s*\.\.\.\(jobType \? \{ jobType \} : \{\}\)\s*,\s*\.\.\.\(reviewStatus \? \{ reviewStatus \} : \{\}\)\s*,?\s*\}\)/.test(
    refreshContract,
  ),
  'jobs useRefreshable pushes jobType/reviewStatus with page/pageSize',
)
check(
  /const\s*\{\s*data\s*,\s*status\s*,\s*refresh\s*\}\s*=\s*useRefreshable\(\s*jobsRefreshKey/.test(
    refreshContract,
  )
    && refreshContract.includes("intervalMs: 60_000")
    && refreshContract.includes('replaceIfChanged')
    && refreshContract.includes("failPolicy: 'keep-last'"),
  'jobs useRefreshable binds the paged jobs key/service, 60s interval, replaceIfChanged, and keep-last',
)
check(
  jobsPage.includes('const jobsRefreshKey = `${PARTNER_JOBS_REFRESH_KEY}:${page}:${jobType ?? \'all\'}:${reviewStatus ?? \'all\'}`')
    && jobsPage.includes('<JobsTable') && jobsTable.includes('<ConsoleTable')
    && jobsPage.includes('pageSize: PAGE_SIZE')
    && jobsPage.includes('setPage(1)'),
  'jobs pagination uses filter-aware refresh key, PAGE_SIZE, ConsoleTable, and filter changes reset to page 1',
)
check(
  /const\s*\{\s*data:\s*qualitySummary\s*=\s*\[\]\s*\}\s*=\s*useRefreshable\(\s*PARTNER_JOB_QUALITY_REFRESH_KEY\s*,\s*getPartnerJobQualitySummary\s*,\s*\{\s*intervalMs:\s*60_000\s*,\s*merge:\s*replaceIfChanged\s*,\s*failPolicy:\s*['"]keep-last['"]\s*,?\s*\}\s*,?\s*\)/.test(
    refreshContract,
  ),
  'quality useRefreshable binds the real quality key/service, 60s interval, replace merge, and keep-last',
)
check(
  /useInteractionLock\(\s*editing\s*!==\s*null\s*\|\|\s*saving\s*\|\|\s*busyId\s*!==\s*null\s*\|\|\s*confirmUnpublish\s*!==\s*null\s*,\s*\[\s*jobsRefreshKey\s*,\s*PARTNER_JOB_QUALITY_REFRESH_KEY\s*\]\s*,\s*['"]hard['"]\s*\)/.test(
    refreshContract,
  ),
  // confirmUnpublish 也要进锁：二次确认弹窗开着的时候后台刷新不能把那一行换掉，
  // 否则用户确认的是 A、下架的是刷新后落在同一位置的 B。
  'interaction lock binds editing/saving/busyId/confirmUnpublish, both refresh keys, and hard mode',
)

const filterDataContract = extractBetween(
  jobsPage,
  'const CATEGORY_FILTERS',
  'const PARTNER_JOBS_REFRESH_KEY',
  'filter data contract',
)
for (const required of [
  "['全部', '全职', '实习', '校招', '兼职'] as const",
  "['全部', '待审核', '审核中', '已通过', '已拒绝'] as const",
  "全职: 'fulltime'",
  "实习: 'intern'",
  "校招: 'campus'",
  "兼职: 'parttime'",
  "待审核: 'pending'",
  "审核中: 'reviewing'",
  "已通过: 'approved'",
  "已拒绝: 'rejected'",
]) {
  check(filterDataContract.includes(required), `filter data contract retains ${required}`)
}

const filteringBlock = extractBetween(
  jobsPage,
  'const jobs = data?.data ?? []',
  'const handleUnpublish',
  'loading, filtering, and review count contract',
)
const expectedFilteringBlock = `const jobs = data?.data ?? []
const total = data?.pagination.total ?? 0
const loading = status === 'idle' || (status === 'loading' && jobs.length === 0)
const error = status === 'error' && jobs.length === 0`
check(
  compact(filteringBlock) === compact(expectedFilteringBlock),
  'loading/error conditions use server page data without local filter or current-page reviewCounts',
)
check(
  !jobsPage.includes('reviewCounts') && !jobsPage.includes('const filtered = jobs.filter'),
  'jobs page no longer locally filters the current page or shows per-status counts from it',
)

const loadingBranch = compact(
  stripComments(extractBetween(jobsPage, 'if (loading) {', 'if (error) {', 'loading branch')),
)
check(
  /^if \(loading\) \{ return \( <Page title="岗位信息管理" subtitle=\{withFrontendHint\('加载中\.\.\.', FRONTEND_HINT\.jobs\)\}> .*(?:<p[^>]*>加载中[.…]{3,}<\/p>|<LoadingState[^/]*\/>).*<\/Page> \) \}$/.test(
    loadingBranch,
  ),
  'loading condition returns the jobs Page with loading subtitle and visible loading copy',
)

const errorBranch = compact(
  stripComments(
    extractBetween(jobsPage, 'if (error) {', '\n\n  return (\n    <Page', 'error branch'),
  ),
)
check(
  /^if \(error\) \{ return \( <Page title="岗位信息管理" subtitle=\{withFrontendHint\('加载失败', FRONTEND_HINT\.jobs\)\}> .*<p[^>]*>加载失败，请稍后重试<\/p>.*<\/Page> \) \}$/.test(
    errorBranch,
  ),
  'error condition returns the jobs Page with failure subtitle and visible failure copy',
)

// 真执行拆出的 JobsTable，检查返回的 ConsoleTable 配置和可见空态文字。
const jsxRuntime = { Fragment: Symbol('Fragment'), jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
const consoleTableType = Symbol('ConsoleTable')
const tableModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(jobsTable, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  module: tableModule, exports: tableModule.exports,
  require(id) {
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === '@ai-job-print/ui') return { Card: Symbol('Card'), ConsoleTable: consoleTableType, StatusBadge: Symbol('StatusBadge') }
    if (id === '@ai-job-print/shared') return { formatDateTime: (value) => value }
    if (id === '../../components/RejectReason') return { RejectReason: Symbol('RejectReason') }
    throw new Error(`JobsTable 的新依赖未在门禁注册 ${id}`)
  },
})
function tableNodes(node) {
  if (node == null || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap(tableNodes)
  if (typeof node !== 'object') return []
  return [node, ...tableNodes(node.props?.children)]
}
const rendered = tableModule.exports.JobsTable({ rows: [], page: 2, total: 41, busyId: null, openEdit() {}, setConfirmUnpublish() {}, onPageChange() {} })
const table = tableNodes(rendered).find((node) => node.type === consoleTableType)
check(Boolean(table), '路由子组件渲染公共 ConsoleTable')
check(table?.props.empty.title === '当前筛选条件下无岗位', '筛选空态显示可见中文「当前筛选条件下无岗位」')
check(table?.props.columns.length === 10 && table.props.columns.some((col) => col.header === '操作'), '十个可见表头和操作列都保留')
check(table?.props.page === 2 && table.props.total === 41 && table.props.pageSize === 20, '分页准确传递后端总数与当前页')

const unpublishBlock = extractBetween(
  jobsPage,
  'const handleUnpublish = async (job: PartnerJobRecord) => {',
  'const openNew',
  'handleUnpublish',
)
// 下架现在只能从二次确认弹窗触发，因此入参从 id 变成整条记录（弹窗要显示岗位标题）。
// 锁的仍是同一套纪律：真调服务、失败报错、成功刷新、无论如何清 busyId。
const expectedUnpublishBlock = `const handleUnpublish = async (job: PartnerJobRecord) => {
  setBusyId(job.id)
  setConfirmUnpublish(null)
  try {
    await unpublishPartnerJob(job.id)
    showNotice('岗位已下架，终端将不再展示。')
    void refresh()
  } catch (e) {
    showNotice(errMsg(e, '岗位下架失败，请稍后重试'), true)
  } finally {
    setBusyId(null)
  }
}`
check(
  compact(unpublishBlock) === compact(expectedUnpublishBlock),
  'handleUnpublish awaits the real service, reports both outcomes, refreshes success, and always clears busyId',
)

// 下架是不可撤销的对外动作（求职者立刻看不到），必须经二次确认。
// 钉死「唯一触发点是弹窗的 onConfirm」：定义写作 `const handleUnpublish = async (job…`，
// 不含 `handleUnpublish(`，所以全页该模式应当恰好出现一次 —— 就是 onConfirm 那处。
// 多出一处就意味着有人绕开了确认框。
check(
  /onConfirm=\{\(\)\s*=>\s*confirmUnpublish\s*&&\s*void\s+handleUnpublish\(confirmUnpublish\)\}/.test(jobsPage),
  'unpublish is triggered only through the confirm dialog onConfirm handler',
)
check(
  (jobsPage.match(/handleUnpublish\(/g) ?? []).length === 1,
  'handleUnpublish has exactly one call site (the confirm dialog), so no path skips confirmation',
)

check(
  /<button\s+disabled=\{busyId\s*===\s*j\.id\}\s+className=['"][^'"]+['"]\s+onClick=\{\(\)\s*=>\s*setConfirmUnpublish\(j\)\}\s*>\s*\{busyId\s*===\s*j\.id\s*\?\s*['"]处理中…['"]\s*:\s*['"]下架['"]\}\s*<\/button>/.test(
    jobsTable,
  ),
  'published-row unpublish button is disabled while busy and calls handleUnpublish for its job',
)

const saveBlock = extractBetween(
  jobsPage,
  'const save = async () => {',
  'if (loading) {',
  'save workflow',
)
check(
  // 3.15：管理员侧审核发布停放，托管打开时文案按真实能力写「审核发布入口尚未开放」（原钉「管理员审核通过并发布后」）
  saveBlock.includes("setNotice('岗位已录入,进入待审核;审核发布入口尚未开放（平台不代审、不代发）,开放并发布前终端不展示。')") &&
    saveBlock.includes("setNotice('修改已保存。该岗位已重新进入待审核,审核通过并重新发布前,终端不展示该条数据。')") &&
    count(saveBlock, 'setEditing(null)') === 1 &&
    /setEditing\(null\)\s*void refresh\(\)\s*\} catch \(e\) \{\s*setFormError\(errMsg\(e, '岗位没有保存，请检查后重试'\)\)\s*\} finally \{\s*setSaving\(false\)\s*\}\s*\}/.test(
      compact(saveBlock),
    ),
  'save closes and notifies only on success; failure only exposes formError and keeps the drawer open',
)

const drawerBlock = extractBetween(jobsPage, '<Drawer', '</Drawer>', 'jobs Drawer')
check(
  /open=\{editing\s*!==\s*null\}\s+onClose=\{\(\)\s*=>\s*setEditing\(null\)\}/.test(drawerBlock) &&
    /<button\s+onClick=\{\(\)\s*=>\s*setEditing\(null\)\}\s+disabled=\{saving\}/.test(drawerBlock) &&
    /<button\s+onClick=\{save\}\s+disabled=\{saving\s*\|\|\s*!canSave\}/.test(drawerBlock) &&
    /\{formError\s*&&\s*<p[^>]*>\{formError\}<\/p>\}/.test(drawerBlock),
  'Drawer close/cancel/save/error contracts preserve saving guards and visible form errors',
)

const controlledFields = [
  ['title', 'setForm((f) => ({ ...f, title: e.target.value }))'],
  ['company', 'setForm((f) => ({ ...f, company: e.target.value }))'],
  ['city', 'setForm((f) => ({ ...f, city: e.target.value }))'],
  ['salary', 'setForm((f) => ({ ...f, salary: e.target.value }))'],
  ['sourceUrl', 'setForm((f) => ({ ...f, sourceUrl: e.target.value }))'],
  ['tags', 'setForm((f) => ({ ...f, tags: e.target.value }))'],
  ['description', 'setForm((f) => ({ ...f, description: e.target.value }))'],
  ['requirements', 'setForm((f) => ({ ...f, requirements: e.target.value }))'],
]
for (const [field, setter] of controlledFields) {
  check(
    count(drawerBlock, `value={form.${field}}`) === 1 && count(drawerBlock, setter) === 1,
    `Drawer keeps ${field} as a controlled immutable input`,
  )
}
check(
  count(drawerBlock, 'value={form.workType}') === 1 &&
    count(
      drawerBlock,
      "setForm((f) => ({ ...f, workType: e.target.value as JobFormState['workType'] }))",
    ) === 1,
  'Drawer keeps workType as a controlled immutable select',
)

const sample = { id: 'job-1', reviewStatus: 'approved', publishStatus: 'published', sourceUrl: 'https://official.invalid/job-1' }
let selectedForUnpublish = null
const rowElement = tableModule.exports.JobsTable({ rows: [sample], page: 1, total: 1, busyId: 'job-1', openEdit() {}, setConfirmUnpublish(row) { selectedForUnpublish = row }, onPageChange() {} })
const rowTable = tableNodes(rowElement).find((node) => node.type === consoleTableType)
const reviewCell = rowTable.props.columns.find((col) => col.header === '审核状态').cell(sample)
check(tableNodes(reviewCell).some((node) => node.props.label === '已通过' && node.props.status === 'success'), '可见审核状态保持已通过与成功色')
const publishCell = rowTable.props.columns.find((col) => col.header === '发布状态').cell(sample)
check(tableNodes(publishCell).some((node) => node.props.className?.includes('bg-success')), '可见发布状态保留成功圆点')
const linkCell = rowTable.props.columns.find((col) => col.header === '来源链接').cell(sample)
check(tableNodes(linkCell).some((node) => node.type === 'a' && node.props.href === sample.sourceUrl), '查看来源仍指向该岗位真实来源链接')
const actionCell = rowTable.props.columns.find((col) => col.header === '操作').cell(sample)
const unpublish = tableNodes(actionCell).find((node) => node.type === 'button' && node.props.disabled === true)
check(Boolean(unpublish), '处理中可见下架按钮禁用')
unpublish?.props.onClick()
check(selectedForUnpublish === sample, '下架按钮只把原岗位交给二次确认，直接执行服务的唯一调用仍在确认弹窗')

for (const required of [
  '不在本系统内接收求职者简历',
  '保存并重新提审',
]) {
  check(jobsPage.includes(required), `jobs workflow retains ${required}`)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} Partner Inkpaper jobs UI contract(s) failed.`)
  process.exit(1)
}

console.log('PARTNER_INKPAPER_JOBS_UI_VERIFY_OK')
