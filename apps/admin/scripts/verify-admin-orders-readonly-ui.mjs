import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pagePath = join(root, 'src/routes/orders/index.tsx')
const servicePath = join(root, 'src/services/api/adminOrdersReadonly.ts')

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

console.log('\n=== Admin orders read-only UI verification ===')

if (!existsSync(servicePath)) fail('adminOrdersReadonly service is missing')
const page = readFileSync(pagePath, 'utf8')
const service = readFileSync(servicePath, 'utf8')

if (page.includes('adminOrdersReadonlyService') && !page.includes('listPrintTasks')) {
  pass('orders page uses the read-only order service, not print task fallback')
} else {
  fail('orders page should use adminOrdersReadonlyService and avoid listPrintTasks')
}

// G5 已新增管理员退款入口（refundOrder），允许 POST /admin/orders/:id/refund。
// 其余写操作（标记支付/强制改状态/updateOrderStatus）仍禁止。
if (
  service.includes("'/admin/orders'") &&
  service.includes("`/admin/orders/${encodeURIComponent(id)}`")
) {
  pass('service exposes GET list/detail + G5 refundOrder endpoint')
} else {
  fail('service must expose GET /admin/orders list/detail')
}

// refundOrder 已由 G5 合法新增，不再列为禁止操作；
// 标记支付/强制改状态仍禁止。
for (const forbidden of ['标记已支付', '标记支付失败', 'updateOrderStatus']) {
  if (page.includes(forbidden)) fail(`orders page contains forbidden write operation: ${forbidden}`)
}
pass('orders page has no unauthorized payment/status mutation actions')

if (
  page.includes('orderNo') &&
  page.includes('payStatus') &&
  page.includes('taskStatus')
) {
  pass('page fields include order/payment/task metadata')
} else {
  fail('page must include orderNo, payStatus, taskStatus fields')
}

if (
  service.includes('aftercareStatus: AdminOrderAftercareStatus') &&
  service.includes('refundEligible: boolean') &&
  service.includes('retryForbidden: boolean') &&
  page.includes('已支付失败待核查') &&
  page.includes("setStatusFilter('failed')") &&
  page.includes("setPayStatus('paid')") &&
  page.includes("detail.aftercareStatus === 'manual_check_required'") &&
  page.includes('系统已禁止重新排队，避免重复出纸') &&
  page.includes('detail.refundEligible') &&
  page.includes('adminOrdersReadonlyService.refundOrder')
) {
  pass('paid+failed unconfirmed orders expose server-derived aftercare, quick filter, risk warning and canonical refund entry')
} else {
  fail('Gate 0.3B orders aftercare UI/service contract is incomplete')
}

const jobsClient = readFileSync(join(root, 'src/services/api/adminPrintJobs.ts'), 'utf8')
if (
  page.includes('已核查·已出纸') &&
  page.includes('已核查·未出纸') &&
  page.includes('VERIFY_PRINTED') &&
  page.includes('VERIFY_NOT_PRINTED') &&
  page.includes('adminPrintJobsService.verifyOutcome') &&
  jobsClient.includes('/admin/print-jobs/${encodeURIComponent(printTaskId)}/verify-outcome') &&
  service.includes("printOutcome: 'printed' | 'not_printed' | null")
) {
  pass('orders aftercare can persist printed/not_printed via confirm phrases, without adding print-scan write actions')
} else {
  fail('UNCONFIRMED verification buttons, confirm phrases and print-jobs client must stay aligned')
}

console.log('\nALL PASS')
