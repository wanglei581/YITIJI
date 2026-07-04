import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => {
  failures += 1
  console.error(`  FAIL ${message}`)
}
const expectIncludes = (source, snippet, message) => (source.includes(snippet) ? pass(message) : fail(`${message} — missing ${snippet}`))
const expectMatches = (source, pattern, message) => (pattern.test(source) ? pass(message) : fail(`${message} — pattern ${pattern} not found`))
const expectAbsent = (source, pattern, message) => (!pattern.test(source) ? pass(message) : fail(`${message} — forbidden pattern ${pattern} matched`))
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function changedFiles() {
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main'
  try {
    git(['rev-parse', '--verify', `${baseRef}^{commit}`])
  } catch {
    git(['fetch', '--no-tags', '--depth=1', 'origin', `${process.env.GITHUB_BASE_REF ?? 'main'}:refs/remotes/${baseRef}`])
  }
  try {
    git(['merge-base', baseRef, 'HEAD'])
  } catch {
    git(['fetch', '--no-tags', '--deepen=50', 'origin'])
  }
  return [
    ...git(['diff', '--name-only', `${baseRef}...HEAD`]).split('\n'),
    ...git(['diff', '--name-only']).split('\n'),
    ...git(['diff', '--cached', '--name-only']).split('\n'),
    ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
  ].filter(Boolean)
}

console.log('\n=== Profile 商用闭环第一批守卫 ===')

const routes = read('src/routes/index.tsx')
const packageJson = read('package.json')
const ci = read('../../.github/workflows/ci.yml')
const printOrders = read('src/pages/profile/me/MyPrintOrdersPage.tsx')
const paymentSummary = read('src/pages/profile/me/printOrders/OrderPaymentSummary.tsx')
const pickupPanel = read('src/pages/profile/me/printOrders/PickupCodePanel.tsx')
const statusRefresh = read('src/pages/profile/me/printOrders/statusRefresh.ts')
const paymentApi = read('src/services/print/paymentApi.ts')
const cashier = read('src/pages/print/PrintCashierPage.tsx')
const done = read('src/pages/print/PrintDonePage.tsx')
const firstBatchPages = [
  ['MyAiRecordsPage', 'me/ai-records', 'src/pages/profile/me/MyAiRecordsPage.tsx'],
  ['MyBenefitsPage', 'me/benefits', 'src/pages/profile/me/MyBenefitsPage.tsx'],
  ['MyDocumentsPage', 'me/documents', 'src/pages/profile/me/MyDocumentsPage.tsx'],
  ['MyFeedbackPage', 'me/feedback', 'src/pages/profile/me/MyFeedbackPage.tsx'],
  ['MyNotificationsPage', 'me/notifications', 'src/pages/profile/me/MyNotificationsPage.tsx'],
  ['MySettingsPage', 'me/settings', 'src/pages/profile/me/MySettingsPage.tsx'],
  ['MyPrintOrdersPage', 'me/print-orders', 'src/pages/profile/me/MyPrintOrdersPage.tsx'],
]

for (const [component, routePath, filePath] of firstBatchPages) {
  const source = read(filePath)
  expectIncludes(source, `export function ${component}`, `${component} 文件存在并导出页面组件`)
  expectMatches(routes, new RegExp(`path:\\s*'${escapeRe(routePath)}'[\\s\\S]{0,90}?element:\\s*<${component}\\s*/>`), `路由保留 /${routePath} -> ${component}`)
  expectAbsent(source, /一键投递|立即投递|平台投递|投递简历/, `${component} 不出现招聘闭环禁用文案`)
  expectAbsent(source, /微信支付|支付宝|到账|确认核销|办理成功/, `${component} 不新增支付/核销/办理结果口径`)
}

expectIncludes(printOrders, "from './printOrders/OrderPaymentSummary'", 'MyPrintOrdersPage 仍导入订单详单组件')
expectIncludes(paymentSummary, "from './PickupCodePanel'", '订单详单仍导入 PickupCodePanel')
expectIncludes(printOrders, "from './printOrders/statusRefresh'", 'MyPrintOrdersPage 仍导入状态刷新 helper')
expectIncludes(statusRefresh, 'MEMBER_ORDERS_POLL_MS = 5000', '打印订单活跃状态仍 5 秒刷新')
expectIncludes(statusRefresh, 'MEMBER_ORDERS_POLL_MAX_MS = 60000', '打印订单失败退避仍封顶 60 秒')
expectMatches(statusRefresh, /ACTIVE_PRINT_STATUSES[\s\S]{0,160}'pending'[\s\S]{0,80}'claimed'[\s\S]{0,80}'printing'/, '自动刷新活跃状态仍限 pending / claimed / printing')
expectIncludes(printOrders, 'mergePrintOrderRefresh(prev, r.items)', '自动刷新仍按 id 合并，不覆盖已加载分页')
expectIncludes(printOrders, "document.visibilityState !== 'visible'", '页面不可见时暂停自动刷新')
expectIncludes(printOrders, 'setAutoRefreshFailed(true)', '自动刷新失败仍显示低噪声失败态')
for (const [name, source] of [
  ['MyPrintOrdersPage', printOrders],
  ['OrderPaymentSummary', paymentSummary],
  ['PickupCodePanel', pickupPanel],
]) {
  expectAbsent(source, /errorCode|errorMessage|failureReasonForUser/, `${name} 不回显内部错误或失败原因字段`)
}

expectIncludes(paymentApi, 'paymentSessionToken?: string | null', 'Kiosk payment adapter 保留 paymentSessionToken 输入')
expectIncludes(paymentApi, "'x-payment-session-token': input.paymentSessionToken", 'Kiosk payment adapter 保留 x-payment-session-token header')
expectMatches(paymentApi, /createPayAttempt\(input:\s*PaymentSessionInput\)/, 'createPayAttempt 仍强制使用 PaymentSessionInput')
expectMatches(paymentApi, /getPayStatus\(input:\s*PaymentSessionInput\)/, 'getPayStatus 仍强制使用 PaymentSessionInput')
expectMatches(cashier, /createPayAttempt\(\{\s*orderId,\s*paymentSessionToken\s*\}\)/, 'PrintCashierPage 出码仍带 paymentSessionToken')
expectMatches(cashier, /getPayStatus\(\{\s*orderId,\s*paymentSessionToken\s*\}\)/, 'PrintCashierPage 轮询仍带 paymentSessionToken')
expectMatches(done, /getPayStatus\(\{\s*orderId:\s*state\.orderId as string,\s*paymentSessionToken:\s*state\.paymentSessionToken\s*\}\)/, 'PrintDonePage 取件码查询仍带 paymentSessionToken')

expectIncludes(packageJson, '"verify:profile-commercial-first-batch"', 'package.json 注册 profile-commercial-first-batch 守卫')
expectIncludes(ci, 'verify:profile-commercial-first-batch', 'CI Verify suites 接入 profile-commercial-first-batch 守卫')

const allowedChanged = new Set([
  '.github/workflows/ci.yml',
  'apps/kiosk/package.json',
  'apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs',
  'apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs', 'apps/kiosk/scripts/verify-profile-print-orders-inkpaper.mjs',
  'docs/progress/current-progress.md',
  'docs/progress/next-tasks.md',
])
const files = [...new Set(changedFiles())]
const unexpectedChanged = files.includes('apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs') ? files.filter((file) => !allowedChanged.has(file)) : []
if (unexpectedChanged.length === 0) pass(files.includes('apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs') ? 'diff 仅触碰 P0a 守卫、注册和进度文档' : 'diff 未触碰 P0a 守卫文件，仅执行静态防回退断言')
else fail(`diff 出现 P0a 范围外变更：${unexpectedChanged.join(', ')}`)

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — Profile 商用闭环第一批守卫未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — Profile 商用闭环第一批守卫通过\n')
