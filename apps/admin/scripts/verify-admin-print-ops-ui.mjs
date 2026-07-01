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

console.log('\n=== Admin print operations UI verification ===')

if (!existsSync(pagePath)) fail('orders page is missing')
if (!existsSync(servicePath)) fail('adminOrdersReadonly service is missing')

const page = readFileSync(pagePath, 'utf8')
const service = readFileSync(servicePath, 'utf8')

if (
  service.includes('cancelPrintTask') &&
  service.includes('reassignPrintTask') &&
  service.includes("`/admin/orders/${encodeURIComponent(id)}/cancel`") &&
  service.includes("`/admin/orders/${encodeURIComponent(id)}/reassign`")
) {
  pass('admin order service exposes scoped print cancel/reassign endpoints')
} else {
  fail('admin order service must expose print cancel/reassign endpoints under /admin/orders/:id')
}

if (
  page.includes('取消打印任务') &&
  page.includes('重分配终端') &&
  page.includes('getTerminals') &&
  page.includes('canCancel') &&
  page.includes('canReassign')
) {
  pass('orders detail renders gated print operations and terminal selector')
} else {
  fail('orders detail must render cancel/reassign controls gated by backend operation flags')
}

for (const forbidden of ['标记已支付', '标记支付失败', '标记退款', '确认退款', 'refundOrder', 'updateOrderStatus']) {
  if (page.includes(forbidden) || service.includes(forbidden)) {
    fail(`orders page/service contains forbidden payment or generic status operation: ${forbidden}`)
  }
}
pass('admin print operations do not introduce payment/refund/status mutation actions')

for (const forbidden of ['fileUrl', 'fileMd5', 'paramsJson', 'endUserId']) {
  if (page.includes(forbidden)) fail(`orders page should not reference sensitive field: ${forbidden}`)
}
pass('orders UI does not render sensitive print/user internals')

console.log('\nALL PASS')
