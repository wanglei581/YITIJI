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

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

console.log('\n=== Admin Inkpaper dashboard UI verification ===')

check(
  packageJson.scripts?.['verify:service-desk-dashboard-ui'] ===
    'node scripts/verify-service-desk-dashboard-ui.mjs',
  'package script keeps the established dashboard visual verifier entry point',
)

check(
  /visualTheme=['"]legacy['"]/.test(layout) &&
    /density=['"]compact['"]/.test(layout) &&
    count(layout, 'visualTheme=') === 1 &&
    count(layout, 'density=') === 1 &&
    !layout.includes('service-desk'),
  'AdminLayout keeps the warm legacy theme at compact density on every route',
)

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
const loadersBlock = dashboard.includes('const LOADERS:')
  ? dashboard.slice(dashboard.indexOf('const LOADERS:'), dashboard.indexOf('export default function DashboardPage'))
  : ''

check(
  dashboard.includes('Promise.allSettled') &&
    !dashboard.includes('Promise.all([') &&
    loadersBlock.length > 0 &&
    realCalls.every((call) => count(loadersBlock, call) === 1) &&
    dashboard.includes("alertCount = alerts?.firingCount") &&
    dashboard.includes('BlockError') &&
    dashboard.includes('数据源加载失败'),
  'OPS-05: nine independent loaders, allSettled per-block degrade, firingCount for 处理告警(N)',
)

check(
  dashboard.includes('<LoadingState text="正在加载工作台数据…"') &&
    dashboard.includes('title="工作台数据加载失败"') &&
    dashboard.includes('onRetry={loadAll}') &&
    dashboard.includes('打印任务加载失败') &&
    dashboard.includes('实时告警加载失败'),
  'full-page error only when every block failed; each block has its own error + retry',
)

check(
  /void loadBlocks\(ALL_BLOCKS\)\.finally\(\(\) => setInitialLoading\(false\)\)/.test(dashboard) &&
    /<button\s+type="button"\s+onClick=\{loadAll\}[\s\S]*?<RefreshCwIcon[\s\S]*?刷新\s*<\/button>/.test(
      dashboard,
    ) &&
    count(dashboard, 'onClick={loadAll}') >= 1 &&
    /<ErrorState[\s\S]*?title="工作台数据加载失败"[\s\S]*?onRetry=\{loadAll\}[\s\S]*?\/>/.test(dashboard),
  'initial load, refresh, and all-failed retry retain the loadAll / loadBlocks chain',
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
  'inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-primary-600 px-4 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(16,48,43,0.18)] transition-transform hover:-translate-y-px hover:bg-primary-700 active:scale-[0.97]'
const alertCta = dashboard.match(
  /<a\s+href="\/alerts"\s+className="([^"]+)"[\s\S]*?<AlertTriangleIcon[\s\S]*?处理告警 \(\{alertCount\}\)[\s\S]*?<\/a>/,
)
check(
  alertCta?.[1] === expectedAlertCtaClass &&
    !dashboard.includes('bg-neutral-900 px-4') &&
    !dashboard.includes('rgba(23,105,232,0.18)'),
  'alert primary CTA keeps its semantics and uses the Inkpaper ink-green shadow',
)

const screensaver = readFileSync(new URL('../src/routes/screensaver/index.tsx', import.meta.url), 'utf8')
const saveStart = screensaver.indexOf('const save = useCallback')
const saveBlock = saveStart >= 0 ? screensaver.slice(saveStart, saveStart + 1800) : ''
check(
  saveBlock.includes('const input: SaveAdPlaylistInput') &&
    saveBlock.includes('if (!editor.id) input.status = \'active\'') &&
    !/status:\s*'active'\s*as const/.test(saveBlock) &&
    !saveBlock.includes('enabled: true'),
  'ADM-A18: playlist update does not hardcode status:active / enabled:true',
)
check(
  screensaver.includes('状态获取失败') &&
    screensaver.includes("aiStatusState === 'error'") &&
    !/aiPosterStatus\(\)\.then\(setAiStatus\)\.catch\(\(\) => setAiStatus\(null\)\)/.test(screensaver),
  'ADM-A20: AI poster status request failure is not labelled 暂未启用',
)

const printers = readFileSync(new URL('../src/routes/printers/index.tsx', import.meta.url), 'utf8')
check(
  printers.includes('formatPaperTrayLevel') &&
    !printers.includes('张)') &&
    printers.includes('({Math.round(level)}%)'),
  'OPS-07: paperTrayLevel uses percent like the dashboard, never 张',
)

const loginLegal = readFileSync(new URL('../src/routes/login/LegalDocsModal.tsx', import.meta.url), 'utf8')
check(
  loginLegal.includes("legalDocsService") &&
    loginLegal.includes('.getActive(') &&
    loginLegal.includes('法务文档加载失败') &&
    !loginLegal.includes('v1 草拟版') &&
    !loginLegal.includes('TERMS_SECTIONS'),
  'ADM-A26: login legal modal loads /kiosk/legal, no hardcoded v1 draft',
)

const legalDocs = readFileSync(new URL('../src/routes/legal-docs/index.tsx', import.meta.url), 'utf8')
check(
  legalDocs.includes('已归档 / 已被') &&
    legalDocs.includes('legalDocBadge') &&
    !/isActive \?[\s\S]{0,80}当前有效[\s\S]{0,80}草稿/.test(legalDocs.replace(/\n/g, '')),
  'ADM-M9: superseded published legal docs are archived, not draft',
)

// 派生告警类型以后端 ALERT_TYPES 为准：告警中心的类型元数据、类型筛选和工作台行图标
// 必须逐一覆盖，任何一处漏掉都会让该类告警在前端「无标签 / 筛不出 / 被当成打印机故障」。
const alertIdentity = readFileSync(
  new URL('../../../services/api/src/admin-ops/derived-alert-identity.ts', import.meta.url),
  'utf8',
)
const adminOps = readFileSync(new URL('../src/services/api/adminOps.ts', import.meta.url), 'utf8')
const alertsPage = readFileSync(new URL('../src/routes/alerts/index.tsx', import.meta.url), 'utf8')

function block(source, start, end) {
  const from = source.indexOf(start)
  if (from < 0) return ''
  const to = source.indexOf(end, from + start.length)
  return to < 0 ? '' : source.slice(from, to + end.length)
}
function keysOf(objectBlock) {
  return [...objectBlock.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1])
}

const backendAlertTypes = [
  ...(alertIdentity.match(/export const ALERT_TYPES = \[([^\]]*)\] as const/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g),
].map((match) => match[1])
const frontendAlertTypes = [
  ...(adminOps.match(/export type AdminAlertType =([^\n]+)/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g),
].map((match) => match[1])
const typeMetaKeys = keysOf(block(alertsPage, 'const TYPE_META:', '\n}\n'))
const typeFilterValues = [
  ...block(alertsPage, 'const TYPE_FILTERS = [', '] as const').matchAll(/value: '([a-z_]+)'/g),
].map((match) => match[1])
const rowIconKeys = keysOf(block(dashboard, 'const ALERT_ROW_ICON:', '\n}\n'))
const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item))

check(
  backendAlertTypes.includes('paid_pending_file_unavailable') &&
    sameSet(frontendAlertTypes, backendAlertTypes) &&
    /type: AdminAlertType\b/.test(adminOps),
  `ALERT-TYPES: AdminAlertItem.type mirrors backend ALERT_TYPES (${backendAlertTypes.join(', ')})`,
)
check(
  sameSet(typeMetaKeys, backendAlertTypes) && sameSet(typeFilterValues, backendAlertTypes),
  `ALERT-TYPES: alerts TYPE_META [${typeMetaKeys.join(', ')}] and TYPE_FILTERS [${typeFilterValues.join(', ')}] cover every alert type`,
)
check(
  sameSet(rowIconKeys, backendAlertTypes) &&
    dashboard.includes('icon: ALERT_ROW_ICON[alert.type]') &&
    /const alertRows = alerts \? buildAlertRows\(alerts\.data\) : \[\]/.test(dashboard) &&
    dashboard.includes('{alertCount > alertRows.length && (') &&
    /\[\.\.\.paidPending, \.\.\.others\]\.slice\(0, 3\)/.test(dashboard),
  'ALERT-TYPES: dashboard alert summary keeps paid_pending_file_unavailable (own icon, listed first, footer counts hidden rows)',
)

const paidPendingMeta = block(alertsPage, '  paid_pending_file_unavailable: {', '\n  },')
// 工作台只扫告警相关代码：审计动作标签里合法地出现 file.get_signed_url。
const dashboardAlertCode =
  block(dashboard, 'const ALERT_ROW_ICON:', '// ─── Page') +
  block(dashboard, '<SectionCard title="实时告警"', '</SectionCard>')
const alertSurfaces = stripComments(alertsPage) + stripComments(dashboardAlertCode) + stripComments(adminOps)
check(
  dashboardAlertCode.includes('buildAlertRows') &&
    paidPendingMeta.includes("label: '已支付文件不可用'") &&
    paidPendingMeta.includes('需人工') &&
    paidPendingMeta.includes('不会退款') &&
    paidPendingMeta.includes('不会恢复文件') &&
    alertsPage.includes('{meta.guidance && (') &&
    !/signed_?url|storageKey|sha256|contentHash|rawError/i.test(alertSurfaces) &&
    !/<ActionButton[^>]*>[^<]*退款/.test(alertsPage) &&
    !/label: '已(退款|恢复)/.test(alertsPage) &&
    !/refund/i.test(stripComments(alertsPage) + stripComments(adminOps)),
  'ALERT-TYPES: paid file-unavailable alert says manual handling, no refund action, no signed URL / storageKey / hash',
)

if (failures.length > 0) {
  console.error(`\n${failures.length} verification check(s) failed.`)
  process.exit(1)
}

console.log('\nALL PASS')
