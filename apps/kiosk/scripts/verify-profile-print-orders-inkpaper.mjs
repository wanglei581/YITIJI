import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:profile-print-orders-inkpaper
//
// 目标：/me/print-orders 只做墨青纸感视觉收口，
// 保留本人打印订单真实 API、支付字段、取件码、分页筛选、自动刷新和反馈跳转。
// 支付诚实性细节继续由 verify:member-print-orders-ui 覆盖。
// ============================================================

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

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
function listChangedFiles() {
  const committed = git(['diff', '--name-only', 'origin/main...HEAD'])
    .split('\n')
    .filter(Boolean)
  const unstaged = git(['diff', '--name-only'])
    .split('\n')
    .filter(Boolean)
  const staged = git(['diff', '--cached', '--name-only'])
    .split('\n')
    .filter(Boolean)
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.startsWith('.ccg/tasks/') && !file.startsWith('docs/superpowers/'))

  return [...new Set([...committed, ...unstaged, ...staged, ...untracked])]
}

console.log('\n=== /me/print-orders 墨青纸感换装守卫 ===')

const page = read('src/pages/profile/me/MyPrintOrdersPage.tsx')
const css = read('src/pages/profile/me/me-detail-inkpaper.css')
const summary = read('src/pages/profile/me/printOrders/OrderPaymentSummary.tsx')
const pickup = read('src/pages/profile/me/printOrders/PickupCodePanel.tsx')
const copy = read('src/pages/profile/me/printOrders/paymentCopy.ts')
const refresh = read('src/pages/profile/me/printOrders/statusRefresh.ts')
const routes = read('src/routes/index.tsx')
const packageJson = read('package.json')
const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
const homeVerify = read('scripts/verify-profile-inkpaper-home.mjs')
const feedbackVerify = read('scripts/verify-profile-feedback-inkpaper.mjs')
const resumesVerify = read('scripts/verify-profile-resumes-notifications-inkpaper.mjs')

expectMatches(routes, /path:\s*'me\/print-orders'[\s\S]{0,80}?element:\s*<MyPrintOrdersPage\s*\/>/, '/me/print-orders 路由仍指向 MyPrintOrdersPage')
expectIncludes(page, "import './me-detail-inkpaper.css'", 'MyPrintOrdersPage 引入明细页局部 CSS')
expectIncludes(page, "useInkRipple('.me-inkdetail .me-ripple')", 'MyPrintOrdersPage 只在 .me-inkdetail 作用域启用涟漪')
expectMatches(page, /className="me-inkdetail me-inkdetail-print-orders h-full"/, 'MyPrintOrdersPage 使用独立 me-inkdetail-print-orders 根作用域')
expectIncludes(page, 'KIcon', 'MyPrintOrdersPage 复用 KIcon 图标系统')
expectIncludes(page, 'className="me-tabbar"', '状态筛选复用 me-tabbar')
expectIncludes(page, "'me-ripple me-tab'", '状态筛选按钮复用 me-tab + 涟漪')
expectIncludes(page, 'className="me-detail-summary"', '打印订单页提供墨青纸感概览卡')
expectIncludes(page, 'className="me-print-order-card"', '订单卡片使用 print-orders 独立卡片类')

expectIncludes(css, '.me-inkdetail-print-orders .me-print-order-card', '明细页 CSS 提供打印订单卡片独立作用域样式')
expectIncludes(css, '.me-inkdetail-print-orders .me-print-order-actions', '明细页 CSS 提供打印订单操作区样式')
expectIncludes(css, '.me-inkdetail-print-orders .me-pickup-panel', '明细页 CSS 提供取件码面板样式')
expectAbsent(css, /\.kprofile|\.khome|\.kassistant|\.kcampus/, '打印订单页样式不污染其他墨青页面作用域')

expectIncludes(page, 'getMyPrintOrders(getToken(), { pageSize: PAGE_SIZE })', '打印订单保留本人订单真实 API 首屏拉取')
expectIncludes(page, "loginFrom=\"/me/print-orders\"", '打印订单保留登录回跳来源')
expectIncludes(page, 'setState(\'ready\')', '打印订单保留游客态 ready 空态/登录引导')
expectIncludes(page, 'STATUS_FILTERS', '打印订单保留任务状态筛选')
expectIncludes(page, 'aria-pressed={filterKey === f.key}', '任务状态筛选 chips 带 aria-pressed')
expectIncludes(page, '{nextCursor &&', '打印订单保留游标加载更多入口')
expectIncludes(page, 'loadMore', '打印订单保留加载更多处理')
expectIncludes(page, 'mergePrintOrderRefresh(prev, r.items)', '打印订单保留自动刷新按 id 合并')
expectIncludes(page, 'hasActivePrintOrders(items)', '打印订单只在有进行中任务时显示自动刷新提示')
expectIncludes(page, "navigate(`/me/feedback?${params.toString()}`)", '打印订单保留反馈跳转')
expectIncludes(page, "new URLSearchParams({ category: 'print', relatedPrintTaskId: printTaskId })", '反馈跳转保留 relatedPrintTaskId 关联')
expectIncludes(page, 'OrderPaymentSummary', '打印订单保留支付详单组件')
expectIncludes(page, 'paymentLine(item)', '打印订单保留支付概要行')
expectIncludes(page, '{item.pickupCode &&', '打印订单列表取件码提示仍由后端 pickupCode 门控')
expectIncludes(summary, '{item.pickupCode && <PickupCodePanel code={item.pickupCode} />}', '支付详单取件码面板仍由后端 pickupCode 门控')
expectIncludes(summary, "navigate('/me/documents')", '再打印仍跳转 /me/documents')
expectIncludes(summary, '去我的文档再打印', '再打印保留诚实路径文案')
expectIncludes(pickup, 'export function PickupCodePanel({ code }: { code: string })', 'PickupCodePanel 取件码仍只来自 code prop')
expectIncludes(copy, 'paymentSourceLabel', '支付来源文案仍由 paymentCopy helper 提供')
expectIncludes(refresh, 'mergePrintOrderRefresh', '自动刷新 helper 保留')

for (const [label, source] of [
  ['MyPrintOrdersPage', page],
  ['OrderPaymentSummary', summary],
  ['PickupCodePanel', pickup],
  ['paymentCopy', copy],
  ['statusRefresh', refresh],
]) {
  expectAbsent(source, /\/print\/confirm/, `${label} 不从订单侧直连打印确认页`)
  expectAbsent(source, /一键投递|立即投递|平台投递|投递简历/, `${label} 不出现招聘闭环禁用文案`)
  expectAbsent(source, /立即支付|去支付|确认核销|核销成功|办理成功/, `${label} 不新增支付/核销/办理结果口径`)
}

expectIncludes(packageJson, '"verify:profile-print-orders-inkpaper"', 'package.json 注册本守卫')
expectIncludes(ci, 'verify:profile-print-orders-inkpaper', 'CI Verify suites 接入本守卫')
expectIncludes(ci, 'verify:member-print-orders-ui', 'CI 仍保留 member-print-orders 支付诚实性守卫')
expectIncludes(homeVerify, '/me/print-orders 已由专属守卫覆盖', 'profile-inkpaper-home 承认打印订单页由专属守卫覆盖')
expectAbsent(feedbackVerify, /'apps\/kiosk\/src\/pages\/profile\/me\/MyPrintOrdersPage\.tsx'/, 'feedback 守卫不再拦截打印订单页专属批次')
expectAbsent(feedbackVerify, /\^apps\\\/kiosk\\\/src\\\/pages\\\/profile\\\/me\\\/printOrders\\\//, 'feedback 守卫不再拦截 printOrders 子组件')
expectAbsent(resumesVerify, /'apps\/kiosk\/src\/pages\/profile\/me\/MyPrintOrdersPage\.tsx'/, 'resumes/notifications 守卫不再拦截打印订单页专属批次')
expectAbsent(resumesVerify, /\^apps\\\/kiosk\\\/src\\\/pages\\\/profile\\\/me\\\/printOrders\\\//, 'resumes/notifications 守卫不再拦截 printOrders 子组件')

let changedFiles = []
try {
  changedFiles = listChangedFiles()
} catch (error) {
  if (error instanceof Error) console.error(`  ${error.message}`)
  fail('范围守卫无法读取 git diff')
}

const allowedChanged = new Set([
  '.github/workflows/ci.yml',
  'apps/kiosk/package.json',
  'apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs',
  'apps/kiosk/scripts/verify-profile-print-orders-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-inkpaper-home.mjs',
  'apps/kiosk/scripts/verify-profile-resumes-notifications-inkpaper.mjs',
  'apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx',
  'apps/kiosk/src/pages/profile/me/printOrders/OrderPaymentSummary.tsx',
  'apps/kiosk/src/pages/profile/me/printOrders/PickupCodePanel.tsx',
  'apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css',
  'docs/acceptance/profile-commercial-preprod-redeploy-and-acceptance.md',
  'docs/progress/current-progress.md',
  'docs/progress/next-tasks.md',
  'services/api/package.json',
  'services/api/scripts/verify-benefit-redemption.ts',
  'services/api/scripts/verify-profile-commercial-first-batch-acceptance.ts',
])

const unexpectedChanged = changedFiles.filter((file) => !allowedChanged.has(file))
if (unexpectedChanged.length === 0) {
  pass('diff 仅触碰打印订单页视觉收口、局部 CSS、必要守卫、package 和 CI')
} else {
  fail(`diff 出现禁止范围变更：${unexpectedChanged.join(', ')}`)
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — /me/print-orders 墨青纸感守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — /me/print-orders 墨青纸感换装守卫通过\n')
