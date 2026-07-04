import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:profile-print-orders-login-smoke
//
// 目标：为 /me/print-orders 登录态订单验收补静态 fixture 与人工 smoke
// runbook 守卫，不向 AuthProvider / 登录页 / 后端 / 支付状态机加入任何测试后门。
// ============================================================

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')
const readRepo = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8')

let failures = 0
function pass(message) {
  console.log(`  PASS ${message}`)
}
function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}
function expectIncludes(source, snippet, message) {
  if (source.includes(snippet)) pass(message)
  else fail(`${message} — missing ${snippet}`)
}
function expectMatches(source, pattern, message) {
  if (pattern.test(source)) pass(message)
  else fail(`${message} — pattern ${pattern} not found`)
}
function expectAbsent(source, pattern, message) {
  if (!pattern.test(source)) pass(message)
  else fail(`${message} — forbidden pattern ${pattern} matched`)
}
function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
function trackedRuntimeReferences(pattern) {
  return git(['grep', '-n', pattern, '--', 'apps/kiosk/src', ':(exclude)apps/kiosk/src/pages/profile/me/printOrders/__fixtures__'])
    .split('\n')
    .filter(Boolean)
}

console.log('\n=== /me/print-orders 登录态 smoke fixture 守卫 ===')

const fixturePath = 'src/pages/profile/me/printOrders/__fixtures__/member-print-orders-login-smoke.json'
const fixture = JSON.parse(read(fixturePath))
const page = read('src/pages/profile/me/MyPrintOrdersPage.tsx')
const api = read('src/services/api/memberPrintOrders.ts')
const authContext = read('src/auth/AuthContext.tsx')
const login = read('src/pages/auth/LoginPage.tsx')
const packageJson = read('package.json')
const ci = readRepo('.github/workflows/ci.yml')
const runbook = readRepo('docs/acceptance/member-print-orders-login-smoke.md')

expectIncludes(fixture.purpose, 'not imported by runtime code', 'fixture 明确标注不进入运行时代码')
expectMatches(JSON.stringify(fixture), /"nextCursor":"cursor-after-smoke-page"/, 'fixture 覆盖游标加载更多形态')

const items = fixture.response?.items
if (Array.isArray(items) && items.length >= 4) pass('fixture 提供至少四类订单样例')
else fail('fixture.response.items 至少应包含 paid / unpaid / refunded / no-order 四类样例')

const allowedKeys = new Set([
  'id',
  'status',
  'fileName',
  'createdAt',
  'completedAt',
  'copies',
  'colorMode',
  'paperSize',
  'amountCents',
  'payStatus',
  'paymentSource',
  'billablePages',
  'billingPageSource',
  'pickupCode',
])
const allowedStatuses = new Set(['pending', 'claimed', 'printing', 'completed', 'failed', 'cancelled'])
const allowedPayStatuses = new Set(['unpaid', 'paid', 'refunded', 'failed', 'paying', 'closed', null])
const visiblePaymentSources = new Set(['offline', 'free', 'manual_confirmed', null])
const allowedBillingSources = new Set(['pdf_lightweight_scan', 'image_single_page', null])

let hasPaidPickup = false
let hasUnpaidHiddenPickup = false
let hasRefundedHiddenPickup = false
let hasNoOrder = false

for (const item of Array.isArray(items) ? items : []) {
  const keys = Object.keys(item)
  const unknownKeys = keys.filter((key) => !allowedKeys.has(key))
  if (unknownKeys.length === 0) pass(`${item.id} 只含会员打印订单安全字段`)
  else fail(`${item.id} 出现未允许字段：${unknownKeys.join(', ')}`)

  if (allowedStatuses.has(item.status)) pass(`${item.id} 任务状态来自 PrintTaskStatus 白名单`)
  else fail(`${item.id} 任务状态非法：${item.status}`)

  if (allowedPayStatuses.has(item.payStatus)) pass(`${item.id} payStatus 来自已知状态或 null`)
  else fail(`${item.id} payStatus 非法：${item.payStatus}`)

  if (visiblePaymentSources.has(item.paymentSource)) pass(`${item.id} paymentSource 只使用当前可展示白名单或 null`)
  else fail(`${item.id} paymentSource 非当前展示白名单：${item.paymentSource}`)

  if (allowedBillingSources.has(item.billingPageSource)) pass(`${item.id} billingPageSource 来自后端识别来源或 null`)
  else fail(`${item.id} billingPageSource 非法：${item.billingPageSource}`)

  const amountOk = item.amountCents === null || (Number.isInteger(item.amountCents) && item.amountCents >= 0)
  if (amountOk) pass(`${item.id} amountCents 为整数分或 null`)
  else fail(`${item.id} amountCents 必须是非负整数分或 null`)

  const hasPickup = typeof item.pickupCode === 'string' && item.pickupCode.length > 0
  if (hasPickup && item.payStatus === 'paid' && item.paymentSource) pass(`${item.id} 取件码只出现在已支付且有来源样例`)
  else if (!hasPickup) pass(`${item.id} 未展示取件码时使用 null`)
  else fail(`${item.id} 取件码不能脱离 paid + paymentSource 出现`)

  if (item.payStatus !== 'paid' && item.pickupCode !== null) {
    fail(`${item.id} 非 paid 样例不得携带 pickupCode`)
  }

  if (item.payStatus === 'paid' && hasPickup) hasPaidPickup = true
  if (item.payStatus === 'unpaid' && item.pickupCode === null) hasUnpaidHiddenPickup = true
  if (item.payStatus === 'refunded' && item.pickupCode === null) hasRefundedHiddenPickup = true
  if (
    item.payStatus === null &&
    item.amountCents === null &&
    item.paymentSource === null &&
    item.billablePages === null &&
    item.billingPageSource === null &&
    item.pickupCode === null
  ) {
    hasNoOrder = true
  }
}

if (hasPaidPickup) pass('fixture 覆盖 paid + 后端返回 pickupCode')
else fail('fixture 缺少 paid + pickupCode 样例')
if (hasUnpaidHiddenPickup) pass('fixture 覆盖 unpaid 隐藏 pickupCode')
else fail('fixture 缺少 unpaid + pickupCode null 样例')
if (hasRefundedHiddenPickup) pass('fixture 覆盖 refunded 隐藏 pickupCode')
else fail('fixture 缺少 refunded + pickupCode null 样例')
if (hasNoOrder) pass('fixture 覆盖历史无 Order 全支付字段 null')
else fail('fixture 缺少历史无 Order 全 null 样例')

expectAbsent(JSON.stringify(fixture), /微信|支付宝|wechat|alipay|\/print\/confirm|立即支付|去支付|确认核销|核销成功|办理成功/i, 'fixture 不含线上支付/核销/订单直连禁用口径')

expectIncludes(page, 'getMyPrintOrders(getToken(), { pageSize: PAGE_SIZE })', '页面仍调用本人订单真实 API')
expectIncludes(page, "loginFrom=\"/me/print-orders\"", '游客态仍走登录回跳来源')
expectIncludes(api, "headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }", '真实 API 仍显式携带会员 Bearer token')
expectIncludes(api, "if (API_MODE !== 'http' || !token) return Promise.resolve({ items: [], nextCursor: null, total: 0 })", 'mock/未登录仍返回空页，不构造假订单')
expectAbsent(authContext + login, /localStorage|sessionStorage|indexedDB|document\.cookie|__PRINT_ORDER|fixture|testToken|debugToken|mockToken/i, '登录与 AuthProvider 未新增持久化 token、fixture 或调试注入后门')

let runtimeReferences = []
try {
  runtimeReferences = trackedRuntimeReferences('member-print-orders-login-smoke')
} catch {
  runtimeReferences = []
}
if (runtimeReferences.length === 0) pass('fixture 未被 apps/kiosk/src 运行时代码引用')
else fail(`fixture 被运行时代码引用：${runtimeReferences.join('; ')}`)

expectIncludes(runbook, '/me/print-orders 登录态真实订单 smoke 验收', 'runbook 记录登录态验收主题')
expectIncludes(runbook, '只走真实登录链路', 'runbook 明确只走真实登录链路')
expectIncludes(runbook, '不得使用 localStorage、sessionStorage、cookie、query token 或 window hook 注入会员态', 'runbook 禁止 token 注入后门')
expectIncludes(runbook, '取件码只按后端返回展示', 'runbook 保留取件码后端门控')
expectIncludes(runbook, '去我的文档再打印', 'runbook 保留诚实再打印路径')
expectIncludes(runbook, '360px 和 390px', 'runbook 覆盖窄屏无横向溢出验收')
expectIncludes(runbook, '加载更多', 'runbook 覆盖游标加载更多验收')
expectIncludes(runbook, '自动刷新', 'runbook 覆盖 pending/printing 自动刷新验收')
expectIncludes(runbook, '反馈跳转', 'runbook 覆盖反馈跳转验收')

expectIncludes(packageJson, '"verify:profile-print-orders-login-smoke"', 'package.json 注册登录态 smoke 守卫')
expectIncludes(ci, 'verify:profile-print-orders-login-smoke', 'CI Verify suites 接入登录态 smoke 守卫')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — /me/print-orders 登录态 smoke fixture 守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — /me/print-orders 登录态 smoke fixture 守卫通过\n')
