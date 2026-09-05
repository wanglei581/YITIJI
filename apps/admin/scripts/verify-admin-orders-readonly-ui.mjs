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

// refundOrder 已由 G5 合法新增；线下收款入账（mark-paid）于 2026-09-03 合法新增。
//
// 为什么 `标记已支付` 从禁止清单里移除：
//   这条禁令写于本页还是纯只读的年代（8a83555b7），当时后端 mark-paid 端点没有前端。
//   但 docs/operations/print-rollout-deployment-matrix.md:27 把「有人值守线下收款」
//   列为正式运营模式（「代码写死（Admin mark-paid 后才可领）」），同文件 :40 更写明
//   「正价 + 无 live 支付 + 无线下 mark-paid SOP → cashier stuck → 禁止用于首台终端试运营」。
//   current-progress.md 的 2026-07-04 条目把上线路径定为三选一，其中第 ② 条就是
//   「走 Admin 线下 mark-paid」。即：没有这个入口，三条上线路径只剩两条。
//   所以这是补齐既定规划，不是放宽收款边界。
//
// 仍然禁止的两件事，以及新增的正向钉死：
//   `标记支付失败` —— 后端无此转换，前端不得自造。
//   `updateOrderStatus` —— 任意改状态仍禁止。
//   入口必须只在服务端返回 payStatus === 'unpaid' 时渲染（后端只允许 unpaid → paid）。
//   加这条正向断言是为了防止后来者把入口放宽到别的状态而门禁察觉不到 ——
//   只删禁止项不加约束，等于把这块地方变成无人看守。
for (const forbidden of ['标记支付失败', 'updateOrderStatus']) {
  if (page.includes(forbidden)) fail(`orders page contains forbidden write operation: ${forbidden}`)
}
pass('orders page has no unauthorized payment/status mutation actions')

// 整行匹配，不是子串匹配。
//
// 第一版写的是 /detail\.payStatus\s*===\s*'unpaid'\s*&&/，独立审查指出它挡不住
// 把条件拓宽成 `(detail.payStatus === 'unpaid' || detail.payStatus === 'paying') &&` ——
// 子串仍在，正则照绿，而入口会渲染在后端必拒的订单上。后果被 markPaid 的
// unpaid→paid 单向转换兜住（不会重复收款），但界面会摆一个点了必失败的按钮。
//
// 改为锚定整行：该守卫必须独占一行，且行内除这一个比较外不得有 || 或其它 payStatus 比较。
const guardLine = page
  .split('\n')
  .find((line) => line.includes('detail.payStatus') && line.includes('setMarkPaidOpen') === false && /&&\s*\($/.test(line.trim()))
if (!guardLine) {
  fail('offline mark-paid entry must render only when server-returned payStatus is unpaid (guard line not found)')
} else if (!/^\{detail\.payStatus === 'unpaid' && \($/.test(guardLine.trim())) {
  fail(`offline mark-paid entry guard must be exactly \`detail.payStatus === 'unpaid'\`, found: ${guardLine.trim()}`)
} else {
  pass('offline mark-paid entry is pinned to server-returned payStatus === unpaid (whole-line match)')
}

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

if (
  service.includes('refundRequired: boolean') &&
  service.includes("refundRequired: params.refundRequired ? 'true' : undefined") &&
  page.includes('待退款（已付款未出纸）') &&
  page.includes('setRefundRequiredFilter(true)') &&
  page.includes('不会自动出款') &&
  page.includes("value: 'abandoned'") &&
  jobsClient.includes('refundRequired: boolean')
) {
  pass('paid-unfulfilled refundRequired signal is listed, filterable, and does not claim auto-refund')
} else {
  fail('API-20 admin visibility for paid-not-printed pending refund is incomplete')
}

console.log('\nALL PASS')
