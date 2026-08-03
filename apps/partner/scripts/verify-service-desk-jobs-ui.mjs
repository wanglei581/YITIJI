import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

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
    wrapper.includes("const activeKey = PATH_TO_KEY[location.pathname] ?? 'dashboard'"),
  'PartnerLayout keeps the warm legacy theme without route-level service-desk selection',
)
check(
  matches(partnerLayoutProps, /density=['"]comfortable['"]/),
  'PartnerLayout keeps comfortable density for operational pages',
)

const jobsPage = await read('src/routes/jobs/index.tsx')
const categoryMap = extractBetween(
  jobsPage,
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
  jobsPage,
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
  jobsPage,
  'const PUBLISH_MAP:',
  'const CATEGORY_FILTERS',
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
  '{/* 表格 */}',
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
  /const\s*\{\s*data\s*,\s*status\s*,\s*refresh\s*\}\s*=\s*useRefreshable\(\s*PARTNER_JOBS_REFRESH_KEY\s*,\s*getPartnerJobs\s*,\s*\{\s*intervalMs:\s*60_000\s*,\s*merge:\s*mergeById<PartnerJobRecord>\(\(item\)\s*=>\s*item\.id\)\s*,\s*failPolicy:\s*['"]keep-last['"]\s*,?\s*\}\s*,?\s*\)/.test(
    refreshContract,
  ),
  'jobs useRefreshable binds the real jobs key/service, 60s interval, mergeById, and keep-last',
)
check(
  /const\s*\{\s*data:\s*qualitySummary\s*=\s*\[\]\s*\}\s*=\s*useRefreshable\(\s*PARTNER_JOB_QUALITY_REFRESH_KEY\s*,\s*getPartnerJobQualitySummary\s*,\s*\{\s*intervalMs:\s*60_000\s*,\s*merge:\s*replaceIfChanged\s*,\s*failPolicy:\s*['"]keep-last['"]\s*,?\s*\}\s*,?\s*\)/.test(
    refreshContract,
  ),
  'quality useRefreshable binds the real quality key/service, 60s interval, replace merge, and keep-last',
)
check(
  /useInteractionLock\(\s*editing\s*!==\s*null\s*\|\|\s*saving\s*\|\|\s*busyId\s*!==\s*null\s*,\s*\[\s*PARTNER_JOBS_REFRESH_KEY\s*,\s*PARTNER_JOB_QUALITY_REFRESH_KEY\s*\]\s*,\s*['"]hard['"]\s*\)/.test(
    refreshContract,
  ),
  'interaction lock binds editing/saving/busyId, both refresh keys, and hard mode',
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
  'const jobs = data ?? []',
  'const handleUnpublish',
  'loading, filtering, and review count contract',
)
const expectedFilteringBlock = `const jobs = data ?? []
const loading = status === 'idle' || (status === 'loading' && jobs.length === 0)
const error = status === 'error' && jobs.length === 0

const filtered = jobs.filter((j) => {
  const matchCat = categoryFilter === '全部' || j.category === CATEGORY_FILTER_MAP[categoryFilter]
  const matchReview = reviewFilter === '全部' || j.reviewStatus === REVIEW_FILTER_MAP[reviewFilter]
  return matchCat && matchReview
})

const reviewCounts = {
  全部: jobs.length,
  待审核: jobs.filter((j) => j.reviewStatus === 'pending').length,
  审核中: jobs.filter((j) => j.reviewStatus === 'reviewing').length,
  已通过: jobs.filter((j) => j.reviewStatus === 'approved').length,
  已拒绝: jobs.filter((j) => j.reviewStatus === 'rejected').length,
}`
check(
  compact(filteringBlock) === compact(expectedFilteringBlock),
  'loading/error/filtered conditions and reviewCounts retain their exact real-data computation',
)

const loadingBranch = compact(
  stripComments(extractBetween(jobsPage, 'if (loading) {', 'if (error) {', 'loading branch')),
)
check(
  /^if \(loading\) \{ return \( <Page title="岗位信息管理" subtitle="加载中\.\.\."> .*(?:<p[^>]*>加载中[.…]{3,}<\/p>|<LoadingState[^/]*\/>).*<\/Page> \) \}$/.test(
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
  /^if \(error\) \{ return \( <Page title="岗位信息管理" subtitle="加载失败"> .*<p[^>]*>加载失败，请稍后重试<\/p>.*<\/Page> \) \}$/.test(
    errorBranch,
  ),
  'error condition returns the jobs Page with failure subtitle and visible failure copy',
)

const tableBody = stripComments(
  extractBetween(
    jobsPage,
    '<tbody className="divide-y divide-neutral-900/[0.06]">',
    '</tbody>',
    'jobs table body',
  ),
)
const filteredEmptyBranch = compact(
  extractBetween(
    tableBody,
    '{filtered.length === 0 ? (',
    ') : (',
    'filtered-empty table branch',
  ).replace('{filtered.length === 0 ? (', ''),
)
check(
  /^<tr> <td colSpan=\{10\}[^>]*> .*当前筛选条件下无岗位.*<\/td> <\/tr>$/.test(
    filteredEmptyBranch,
  ),
  'filtered-empty condition renders a table row and colSpan=10 cell with visible empty copy',
)

const unpublishBlock = extractBetween(
  jobsPage,
  'const handleUnpublish = async (id: string) => {',
  'const openNew',
  'handleUnpublish',
)
const expectedUnpublishBlock = `const handleUnpublish = async (id: string) => {
  setBusyId(id)
  try {
    await unpublishPartnerJob(id)
    void refresh()
  } catch (e) {
    setNotice(errMsg(e))
  } finally {
    setBusyId(null)
  }
}`
const expectedUnpublishBlockWithShowNotice = `const handleUnpublish = async (id: string) => {
  setBusyId(id)
  try {
    await unpublishPartnerJob(id)
    void refresh()
  } catch (e) {
    showNotice(errMsg(e), true)
  } finally {
    setBusyId(null)
  }
}`
check(
  compact(unpublishBlock) === compact(expectedUnpublishBlock) ||
    compact(unpublishBlock) === compact(expectedUnpublishBlockWithShowNotice),
  'handleUnpublish awaits the real service, reports failure, refreshes success, and always clears busyId',
)

check(
  /<button\s+disabled=\{busyId\s*===\s*j\.id\}\s+className=['"][^'"]+['"]\s+onClick=\{\(\)\s*=>\s*void\s+handleUnpublish\(j\.id\)\}\s*>\s*\{busyId\s*===\s*j\.id\s*\?\s*['"]处理中…['"]\s*:\s*['"]下架['"]\}\s*<\/button>/.test(
    jobsPage,
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
  saveBlock.includes("setNotice('岗位已录入,进入待审核;管理员审核通过并发布后,终端才会展示。')") &&
    saveBlock.includes("setNotice('修改已保存。该岗位已重新进入待审核,审核通过并重新发布前,终端不展示该条数据。')") &&
    count(saveBlock, 'setEditing(null)') === 1 &&
    /setEditing\(null\)\s*void refresh\(\)\s*\} catch \(e\) \{\s*setFormError\(errMsg\(e\)\)\s*\} finally \{\s*setSaving\(false\)\s*\}\s*\}/.test(
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

for (const required of [
  "status={review.badge}",
  'publish.dot',
  'href={j.sourceUrl}',
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
