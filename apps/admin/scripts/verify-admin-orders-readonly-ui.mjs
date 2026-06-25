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

if (
  service.includes("'/admin/orders'") &&
  service.includes("`/admin/orders/${encodeURIComponent(id)}`") &&
  !/PATCH|POST|DELETE|updateOrderStatus|refundOrder/.test(service)
) {
  pass('service exposes GET list/detail only')
} else {
  fail('service must expose only GET /admin/orders list/detail')
}

for (const forbidden of ['标记已支付', '标记支付失败', '标记退款', '确认退款', 'updateOrderStatus', 'refundOrder']) {
  if (page.includes(forbidden)) fail(`orders page contains forbidden write operation: ${forbidden}`)
}
pass('orders page has no payment/refund/status mutation actions')

if (
  page.includes('订单只读视图') &&
  page.includes('支付 / 退款 / 对账域尚未上线') &&
  page.includes('orderNo') &&
  page.includes('payStatus') &&
  page.includes('taskStatus')
) {
  pass('page copy and fields clearly communicate read-only order scope')
} else {
  fail('page must show read-only scope and order/payment/task fields')
}

console.log('\nALL PASS')
