import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = new URL('../', import.meta.url)
const failures = []

async function read(relativePath) {
  try {
    return await readFile(new URL(relativePath, packageRoot), 'utf8')
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

console.log('\n=== Partner 青序 LightFlow 岗位管理 UI 门禁 ===')

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
  matches(
    partnerLayoutProps,
    /visualTheme=\{activeKey\s*===\s*['"]jobs['"]\s*\?\s*['"]service-desk['"]\s*:\s*['"]legacy['"]\}/,
  ),
  "PartnerLayout enables service-desk only when activeKey === 'jobs'",
)
check(
  matches(partnerLayoutProps, /density=['"]comfortable['"]/),
  'PartnerLayout keeps comfortable density for the jobs representative route',
)

const jobsPage = await read('src/routes/jobs/index.tsx')
const categoryMap = extractBetween(
  jobsPage,
  'const CATEGORY_MAP:',
  'const REVIEW_MAP:',
  'CATEGORY_MAP',
)
const expectedCategories = [
  ['fulltime', '全职', 'blue'],
  ['intern', '实习', 'lavender'],
  ['campus', '校招', 'mint'],
  ['parttime', '兼职', 'orange'],
]
for (const [key, label, color] of expectedCategories) {
  check(
    matches(
      categoryMap,
      new RegExp(
        `${key}\\s*:\\s*\\{\\s*label:\\s*['"]${label}['"]\\s*,\\s*style:\\s*['"]bg-\\[var\\(--sd-category-${color}-bg\\)\\] text-\\[var\\(--sd-category-${color}-fg\\)\\]['"]\\s*\\}`,
      ),
    ),
    `CATEGORY_MAP maps ${key} to the exact ${color} category tokens`,
  )
}
check(
  !/(?:warning|success|error|review|publish|status)/i.test(categoryMap),
  'CATEGORY_MAP does not reuse review or publish status colors',
)

const selectedClass =
  "const FILTER_SELECTED_CLASS = 'border-primary-600 bg-primary-600 text-white'"
const idleClass =
  "const FILTER_IDLE_CLASS = 'border-neutral-200 bg-surface text-neutral-700 hover:border-primary-600/40'"
check(jobsPage.includes(selectedClass), 'filter selected state uses the exact primary-blue contract')
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

const refreshContract = extractBetween(
  jobsPage,
  'const { data, status, refresh } = useRefreshable(',
  'useEffect(() => {',
  'refresh and interaction-lock contract',
)
for (const required of [
  'PARTNER_JOBS_REFRESH_KEY',
  'getPartnerJobs',
  'mergeById<PartnerJobRecord>',
  "failPolicy: 'keep-last'",
  'PARTNER_JOB_QUALITY_REFRESH_KEY',
  'getPartnerJobQualitySummary',
  'replaceIfChanged',
  'useInteractionLock(',
  "'hard'",
]) {
  check(refreshContract.includes(required), `refresh contract retains ${required}`)
}

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

for (const required of [
  'importPartnerJobs(',
  'updatePartnerJob(',
  'unpublishPartnerJob(',
  "busyId === j.id ? '处理中…' : '下架'",
  "status={review.badge}",
  'publish.dot',
  'href={j.sourceUrl}',
  '当前筛选条件下无岗位',
  '加载失败，请稍后重试',
  '不在本系统内接收求职者简历',
  '保存并重新提审',
  'disabled={saving || !canSave}',
  'onClose={() => setEditing(null)}',
  'value={form.title}',
  'setForm((f) => ({ ...f, title: e.target.value }))',
  'formError &&',
]) {
  check(jobsPage.includes(required), `jobs workflow retains ${required}`)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} Partner service-desk jobs UI contract(s) failed.`)
  process.exit(1)
}

console.log('SERVICE_DESK_JOBS_UI_VERIFY_OK')
