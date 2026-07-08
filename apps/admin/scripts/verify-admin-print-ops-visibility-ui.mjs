import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const ordersPagePath = join(root, 'src/routes/orders/index.tsx')
const terminalsPagePath = join(root, 'src/routes/terminals/index.tsx')
const ordersServicePath = join(root, 'src/services/api/adminOrdersReadonly.ts')
const orderActionsPath = join(root, 'src/services/api/adminOrderActions.ts')

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function mustExist(path, label) {
  if (!existsSync(path)) fail(`${label} is missing`)
}

function includesAll(source, snippets, label) {
  const missing = snippets.filter((snippet) => !source.includes(snippet))
  if (missing.length > 0) fail(`${label} missing: ${missing.join(' | ')}`)
  pass(label)
}

console.log('\n=== Admin print ops visibility UI verification ===')

mustExist(ordersPagePath, 'orders page')
mustExist(terminalsPagePath, 'terminals page')
mustExist(ordersServicePath, 'admin order readonly service')
mustExist(orderActionsPath, 'admin order actions service')

const ordersPage = readFileSync(ordersPagePath, 'utf8')
const terminalsPage = readFileSync(terminalsPagePath, 'utf8')
const ordersService = readFileSync(ordersServicePath, 'utf8')
const orderActions = readFileSync(orderActionsPath, 'utf8')

includesAll(
  terminalsPage,
  [
    "agentStatus === 'agent_degraded'",
    'localTaskDatabaseAvailable === false',
    '本地任务库不可用，已暂停领取打印任务',
    'ONLINE_VIEW',
    'OFFLINE_VIEW',
    'DEGRADED_VIEW',
    '最近心跳',
    '打印机状态',
    'Windows Terminal Agent 的心跳上报',
  ],
  'terminal page exposes online/offline/degraded recovery state from Agent heartbeat',
)

if (
  terminalsPage.includes('runtimeStatusView(t)') &&
  terminalsPage.includes('<StatusBadge dot status={runtimeView.badge} label={runtimeView.label} />') &&
  terminalsPage.includes('runtimeView.detail')
) {
  pass('terminal table renders degraded detail text next to runtime badge')
} else {
  fail('terminal table must render runtime badge and degraded detail text')
}

includesAll(
  ordersPage,
  [
    "failed:    { badge: 'error',   label: '失败' }",
    "'错误码'",
    'order.errorCode',
    'detail.print?.errorCode',
    '状态流转',
    'detail.statusLogs.map',
    'log.errorCode',
    'fmt(log.createdAt)',
  ],
  'orders page exposes failed status, error code, and status transition log',
)

includesAll(
  ordersService,
  [
    'errorCode: string | null',
    'statusLogs',
    'fromStatus',
    'toStatus',
    'createdAt',
    "'/admin/orders'",
    '`/admin/orders/${encodeURIComponent(id)}`',
  ],
  'order readonly service carries failure code and status log contract',
)

if (/fileUrl|fileMd5|signedUrl|fileHash/.test(ordersService)) {
  fail('order readonly service must not expose file URLs, signatures, or file hashes')
}
pass('order readonly service keeps file URL/hash out of Admin ops visibility payload')

includesAll(
  ordersPage,
  [
    "detail.taskStatus === 'pending'",
    'detail.printTaskId',
    '取消任务',
    '重分配终端',
    'adminOrderActionsService.cancelOrder',
    'adminOrderActionsService.reassignOrder',
    'terminalData.terminals.filter((terminal) => terminal.enabled)',
    'actionError',
    'refreshDetail(detail.id)',
    'await refresh()',
  ],
  'orders page exposes only pending manual cancel/reassign handling and refreshes state after action',
)

if (
  /\/admin\/orders\/.*\/cancel/.test(orderActions) &&
  /\/admin\/orders\/.*\/reassign/.test(orderActions) &&
  !/mark-paid|refund|DELETE/.test(orderActions)
) {
  pass('Admin order actions adapter is limited to cancel/reassign endpoints')
} else {
  fail('Admin order actions adapter must be limited to cancel/reassign endpoints')
}

console.log('\nALL PASS')
