import { readFileSync } from 'node:fs'

const layout = readFileSync(new URL('../src/layouts/AdminLayoutWrapper.tsx', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('../src/routes/dashboard/index.tsx', import.meta.url), 'utf8')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const failures = []

function check(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`)
  } else {
    failures.push(message)
    console.error(`FAIL ${message}`)
  }
}

function count(source, token) {
  return source.split(token).length - 1
}

function compact(source) {
  return source.replace(/\s+/g, ' ').trim()
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

console.log('\n=== Admin service-desk dashboard UI verification ===')

check(
  packageJson.scripts?.['verify:service-desk-dashboard-ui'] ===
    'node scripts/verify-service-desk-dashboard-ui.mjs',
  'package script points to the service-desk dashboard verifier',
)

check(
  /visualTheme=\{activeKey === ['"]dashboard['"] \? ['"]service-desk['"] : ['"]legacy['"]\}/.test(layout) &&
    /density=['"]compact['"]/.test(layout) &&
    count(layout, 'visualTheme=') === 1 &&
    count(layout, 'density=') === 1,
  'AdminLayout opts only the dashboard route into service-desk with compact density',
)

const loadStart = dashboard.indexOf('const load = useCallback(() => {')
const loadEnd = dashboard.indexOf('\n  }, [])', loadStart)
const loadBlock = loadStart >= 0 && loadEnd > loadStart ? dashboard.slice(loadStart, loadEnd) : ''
const realCalls = [
  'getTerminals()',
  'getPrinters()',
  'getJobSources()',
  'getFairSources()',
  'listFiles({ limit: 100 })',
  'getAiUsage()',
  'getAuditLogs({ limit: 6, offset: 0 })',
  'adminOpsService.listPrintTasks({ page: 1, pageSize: 5 })',
  'adminOpsService.listAlerts()',
]
const promiseStart = loadBlock.indexOf('Promise.all([')
const promiseEnd = loadBlock.indexOf('\n    ])', promiseStart)
const promiseBlock =
  promiseStart >= 0 && promiseEnd > promiseStart
    ? loadBlock.slice(promiseStart, promiseEnd + '\n    ])'.length)
    : ''
const expectedPromiseBlock = `Promise.all([
  ${realCalls.join(',\n  ')},
])`
const mappingStart = loadBlock.indexOf('setData({')
const mappingEnd = loadBlock.indexOf('\n        })', mappingStart)
const mappingBlock =
  mappingStart >= 0 && mappingEnd > mappingStart
    ? loadBlock.slice(mappingStart, mappingEnd + '\n        }'.length)
    : ''
const expectedMappingBlock = `setData({
  terminals: terminalRes.terminals,
  printers: printerRes.printers,
  jobSources,
  fairSources,
  files,
  aiUsage,
  auditLogs: auditRes.items,
  printTasks: printTaskPage.data,
  printTaskTotal: printTaskPage.pagination.total,
  alerts: alertsRes.data,
}`

check(
  compact(promiseBlock) === compact(expectedPromiseBlock) &&
    realCalls.every((call) => count(loadBlock, call) === 1) &&
    /\.then\(\(\[terminalRes, printerRes, jobSources, fairSources, files, aiUsage, auditRes, printTaskPage, alertsRes\]\) => \{/.test(
      loadBlock,
    ) &&
    compact(mappingBlock) === compact(expectedMappingBlock),
  'dashboard preserves the nine real service calls and their response mapping',
)

check(
  loadBlock.includes('.catch(() => setError(true))') &&
    loadBlock.includes('.finally(() => setLoading(false))') &&
    dashboard.includes('<LoadingState text="正在加载工作台数据…"') &&
    dashboard.includes('title="工作台数据加载失败"') &&
    dashboard.includes('onRetry={load}'),
  'dashboard preserves loading, failure, and retry recovery semantics',
)

check(
  /useEffect\(\(\) => \{\s*load\(\)\s*\}, \[load\]\)/.test(dashboard) &&
    count(dashboard, 'load()') === 1 &&
    /<button\s+type="button"\s+onClick=\{load\}\s+disabled=\{loading\}[\s\S]*?<RefreshCwIcon[\s\S]*?刷新\s*<\/button>/.test(
      dashboard,
    ) &&
    count(dashboard, 'onClick={load}') === 1 &&
    /<ErrorState[\s\S]*?title="工作台数据加载失败"[\s\S]*?onRetry=\{load\}[\s\S]*?\/>/.test(dashboard) &&
    count(dashboard, 'onRetry={load}') === 1,
  'initial load, refresh action, and error retry all retain the load callback chain',
)

const requiredPrintStatuses = [
  "pending: { label: '排队中', status: 'info' }",
  "claimed: { label: '已领取', status: 'info' }",
  "printing: { label: '打印中', status: 'info' }",
  "completed: { label: '已完成', status: 'success' }",
  "failed: { label: '失败', status: 'error' }",
]
check(
  requiredPrintStatuses.every((status) => dashboard.includes(status)) &&
    dashboard.includes("PRINT_STATUS_LABELS[task.status] ?? { label: task.status"),
  'print tasks retain distinct queued, claimed, printing, completed, and failed states',
)

check(
  dashboard.includes('if (nums.length === 0) return null') &&
    dashboard.includes('{toner !== null && (') &&
    dashboard.includes('{paper !== null && (') &&
    !/\u6536入|营收|金额|GMV|[¥￥]|人民币/i.test(stripComments(dashboard)),
  'unknown metrics stay unknown and the dashboard adds no amount or revenue KPI',
)

const expectedAlertCtaClass =
  'inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-primary-600 px-4 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(23,105,232,0.18)] transition-transform hover:-translate-y-px hover:bg-primary-700 active:scale-[0.97]'
const alertCta = dashboard.match(
  /<a\s+href="\/alerts"\s+className="([^"]+)"[\s\S]*?<AlertTriangleIcon[\s\S]*?处理告警 \(\{alertCount\}\)[\s\S]*?<\/a>/,
)
check(
  alertCta?.[1] === expectedAlertCtaClass &&
    !dashboard.includes('bg-neutral-900 px-4') &&
    !dashboard.includes('rgba(16,48,43,0.18)'),
  'alert primary CTA keeps its semantics and uses the exact LightFlow primary class',
)

if (failures.length > 0) {
  console.error(`\n${failures.length} verification check(s) failed.`)
  process.exit(1)
}

console.log('\nALL PASS')
