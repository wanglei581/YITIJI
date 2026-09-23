import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:profile-print-orders-inkpaper
//
// 目标：/me/print-orders 的页面/行为合同 —— 青序会员壳结构与旧壳排除，
// 本人打印订单真实 API、支付字段、取件码、分页筛选、自动刷新、反馈跳转与招聘合规。
// 支付诚实性细节继续由 verify:member-print-orders-ui 覆盖。
// 集成候选的文件范围不归本守卫：由 verify:profile-commercial-first-batch、
// verify:fusion-w5、project graph 与 CI diff 合同负责（见文件末尾退役说明）。
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
function readImportedCss(entryPath, expectedImports, message) {
  const entry = read(entryPath)
  const imports = [...entry.matchAll(/^@import\s+['"]([^'"]+)['"];\s*$/gm)].map((match) => match[1])
  if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
    fail(`${message} — ${entryPath} 的显式 CSS imports 已变化: ${imports.join(' | ')}`)
    return ''
  }
  pass(`${message} — 仅拼接聚合入口显式导入的 CSS`)
  return imports.map((importPath) => read(join(dirname(entryPath), importPath))).join('\n')
}

console.log('\n=== /me/print-orders 页面/行为合同守卫 ===')

const page = read('src/pages/profile/me/MyPrintOrdersPage.tsx')
const css = readImportedCss(
  'src/pages/profile/me/me-detail-inkpaper.css',
  [
    './styles/me-detail-base.css',
    './styles/me-assets.css',
    './styles/me-orders.css',
    './styles/me-records.css',
    './styles/me-settings-feedback.css',
  ],
  '明细页 CSS 聚合入口保持封闭',
)
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
// 2026-09-23 稿 38-member-assets：本页从墨青纸感（MeListShell + me-detail-inkpaper）迁入青序流光。
// 下面这组原来钉的是墨青纸感的**形状**（局部 CSS 导入、涟漪、根类名、KIcon、me-tab 类名），
// 迁移后逐条换成青序壳的同位断言；API、支付字段、取件码、分页筛选、自动刷新、反馈跳转一条不删。
// me-detail-inkpaper.css 聚合入口：2026-09-23 /me/settings 也迁入青序后已无 src 引用；文件未删，封闭性断言保留。
const qxCss = [
  read('src/pages/profile/me/styles/member-records-qx.css'),
  read('src/pages/profile/me/styles/qx-me-shared.css'),
].join('\n')
expectIncludes(page, "import './styles/member-records-qx.css'", 'MyPrintOrdersPage 引入青序记录页 CSS')
expectMatches(page, /<QxMePage[\s\S]{0,120}?view="orders"/, 'MyPrintOrdersPage 使用青序会员壳的「打印订单」分域视图')
expectAbsent(page, /MeListShell|me-detail-inkpaper|useInkRipple|me-inkdetail|KioskPageFrame/, 'MyPrintOrdersPage 已离开墨青纸感 / V6 旧壳')
expectMatches(page, /live=\{false\}/, '打印订单每 5 秒自动同步，整页不挂 aria-live，避免读屏反复播报')
expectIncludes(page, 'className="qx-me-tabbar"', '状态筛选复用青序 qx-me-tabbar')
expectIncludes(page, 'className="qx-me-tab"', '状态筛选按钮复用青序 qx-me-tab')
expectIncludes(page, '<QxMeSummary', '打印订单页提供青序概览卡')
expectIncludes(page, 'data-server-slot="print-order"', '订单卡片声明为服务端回填的订单位')

expectIncludes(qxCss, '.qx-me-asset-item', '青序 CSS 提供打印订单卡片样式')
expectIncludes(qxCss, '.qx-me-acts', '青序 CSS 提供打印订单操作区样式')
expectIncludes(qxCss, '.qx-me-assets .me-pickup-panel', '青序 CSS 提供取件码面板样式')
expectIncludes(qxCss, '.qx-me-assets .me-payment-summary', '青序 CSS 提供订单详单样式')
expectAbsent(qxCss, /#[0-9a-fA-F]{3,8}\b/, '青序打印订单页样式只用 var(--qx-*) 令牌，无裸 hex')
expectAbsent(css, /\.kprofile|\.khome|\.kassistant|\.kcampus/, '打印订单页样式不污染其他墨青页面作用域')

expectIncludes(page, 'getMyPrintOrders(getToken(), { pageSize: PAGE_SIZE })', '打印订单保留本人订单真实 API 首屏拉取')
// 登录回跳来源：青序壳底栏由 recordsCtabar 统一生成，loginFrom 是它的第 4 个位置参数。
expectMatches(page, /recordsCtabar\(uiState, navigate, \(\) => setReloadKey\(\(k\) => k \+ 1\), '\/me\/print-orders',/, '打印订单保留登录回跳来源')
expectIncludes(read('src/pages/profile/me/qx/QxMeChrome.tsx'), "navigate('/login', { state: { from: loginFrom } })", '青序会员底栏登录键带回跳来源')
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
expectIncludes(summary, 'label="单双面"', '详单展示单双面（非计价项）')
expectIncludes(summary, 'label="页范围"', '详单展示页范围')
expectIncludes(summary, 'label="优惠/权益抵扣"', '详单展示优惠/权益抵扣真源字段')
expectIncludes(summary, 'label="已退款"', '详单展示已退款真源字段')
expectIncludes(summary, 'NET_PAID_UNRECORDED', '实付无独立字段，走未记录常量')
expectAbsent(summary, /print_duplex_surcharge|双面附加/, '详单不把双面标成金额项')
expectAbsent(summary, /amountCents[\s\S]{0,40}-[\s\S]{0,40}discountCents/, '详单不按应付减优惠推算实付')
expectIncludes(copy, "NET_PAID_UNRECORDED = '未记录'", 'paymentCopy 标明实付未记录')
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

// 2026-09-23 退役：原「历史变更集 allowlist / unexpectedChanged」范围检查。
//
// 它断言：只要 PR 碰了 /me/print-orders，origin/main...HEAD 的**整个变更集**就必须落在
// 墨青纸感视觉收口批次的清单内。那个批次早已合入，目的已达成；留下来之后对任何正当改
// 这一页的工作都是敌对的 —— 序 13（2026-09-06）横跨四层 19 个文件全在清单外，同一个 PR
// 内级联触发五处加行；2026-09-06 此处记下的建议裁决即「退役这段变更集范围检查，保留其余
// 全部断言」。到多批次集成候选上，它把几百个已审计的合法文件一律判越界，清单只剩历史流水账。
//
// 本守卫现在只验上方的页面/行为合同（页面结构、真实 API、支付字段、取件码、分页筛选、
// 自动刷新、反馈跳转，以及三个兄弟守卫不得回头拦截本页）。文件范围由
// verify:profile-commercial-first-batch（触碰 /me/* 时委托 verify:fusion-w5 精确合同）、
// project graph 与 CI diff 合同负责；支付诚实性另有 verify:member-print-orders-ui 覆盖。
console.log('  INFO 本守卫只验页面/行为合同，不检查文件范围；集成候选的文件范围由 verify:profile-commercial-first-batch / verify:fusion-w5 / project graph / CI diff 合同负责')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — /me/print-orders 页面/行为合同守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — /me/print-orders 页面/行为合同守卫通过（不含文件范围检查）\n')
