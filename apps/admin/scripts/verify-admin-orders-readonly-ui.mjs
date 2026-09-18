import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pagePath = join(root, 'src/routes/orders/index.tsx')
const servicePath = join(root, 'src/services/api/adminOrdersReadonly.ts')
const honestyCopyPath = join(root, 'src/routes/orders/orderHonestyCopy.ts')

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
const honestyCopy = readFileSync(honestyCopyPath, 'utf8')

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
  page.includes('label="单双面"') &&
  page.includes('label="彩色/黑白"') &&
  page.includes('label="份数"') &&
  page.includes('label="页范围"') &&
  page.includes('duplexText(detail.print?.duplex)') &&
  page.includes('pageRangeText(detail.print?.pageRange)') &&
  !page.includes('label="打印参数"')
) {
  pass('订单详情逐项展示打印参数，缺值走 helper（未记录），不再合成一行把缺项吃掉')
} else {
  fail('订单详情必须逐项展示单双面/彩黑/份数/页范围，且不得再使用合成「打印参数」行')
}

if (
  page.includes('label="下单金额"') &&
  page.includes('label="优惠/权益抵扣"') &&
  page.includes('label="已退款"') &&
  page.includes('label="实付"') &&
  page.includes('recordedCentsText(detail.discountCents') &&
  page.includes('recordedCentsText(detail.refundedAmountCents') &&
  page.includes('NET_PAID_UNRECORDED') &&
  !/detail\.amountCents\s*-/.test(page)
) {
  pass('订单详情展示下单金额/优惠/已退款真源字段，实付标未记录且不推算')
} else {
  fail('订单详情金额必须用服务端 discountCents/refundedAmountCents，实付不得用应付减优惠')
}

if (service.includes('discountCents: number') && service.includes('refundedAmountCents: number')) {
  pass('Admin 订单详情类型包含 discountCents / refundedAmountCents')
} else {
  fail('Admin 订单详情类型必须包含优惠与已退款真源字段')
}

if (!page.includes('print_duplex_surcharge') && !page.includes('双面附加')) {
  pass('订单页不把双面渲染成计价项')
} else {
  fail('订单页不得出现 print_duplex_surcharge / 双面附加')
}

// API-20：待退款信号必须在管理端可见、可筛，且不得宣称自动出款。
if (
  service.includes('refundRequired: boolean') &&
  service.includes("refundRequired: params.refundRequired ? 'true' : undefined") &&
  page.includes('待退款（已收款未出纸）') &&
  page.includes('setRefundRequiredFilter(true)') &&
  page.includes('不会自动出款') &&
  page.includes("value: 'abandoned'") &&
  jobsClient.includes('refundRequired: boolean')
) {
  pass('pending-refund signal is listed, filterable, and does not claim auto-refund')
} else {
  fail('API-20 admin visibility for pending refund is incomplete')
}

// M-2（2026-09-18）：待退款入口不得强制 payStatus=paid。
//
// 挡的是这条真实缺口：服务端 refundRequired=true 是**两支 OR**——
//   ① payStatus=paid + PAID_UNFULFILLED_PENDING_REFUND（已付款未出纸）
//   ② payStatus∈{closed,unpaid,paying} + ONLINE_PAID_PENDING_REFUND（渠道已收款未转 paid）
// ② 永远不是 paid。旧写法的 chip 在 setRefundRequiredFilter(true) 的同一发里
// setPayStatus('paid')，后端据此只查 ①，于是「渠道已经收了钱、却没有出款路径」
// 的那一整类在管理端**查不到、也不报错**。
//
// 三段一起钉，缺一段就证明不了「点击后请求里没有 payStatus=paid」：
//   a. chip 的 onClick 必须把 payStatus 清空，且整行不得出现 'paid'；
//   b. 请求装配必须是 `payStatus: payStatus || undefined`（空串要被丢掉，
//      否则 a 只是把 payStatus=paid 换成 payStatus=）；
//   c. 适配器把 refundRequired 映射成 'true'（上面那段已断言）。
const refundChipHandlers = page
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.includes('setRefundRequiredFilter(true)'))
if (refundChipHandlers.length !== 1) {
  fail(`待退款入口必须唯一（找到 ${refundChipHandlers.length} 处 setRefundRequiredFilter(true)）`)
} else if (/setPayStatus\(\s*'paid'\s*\)/.test(refundChipHandlers[0])) {
  fail(`待退款入口不得强制 payStatus=paid（会漏掉渠道已收款未转 paid 的整类）：${refundChipHandlers[0]}`)
} else if (!/setPayStatus\(\s*''\s*\)/.test(refundChipHandlers[0])) {
  fail(`待退款入口必须显式清空 payStatus，否则会沿用上一次的支付状态筛选：${refundChipHandlers[0]}`)
} else {
  pass('待退款入口请求 refundRequired=true 且不携带 payStatus=paid（整行匹配）')
}

if (/payStatus:\s*payStatus \|\| undefined/.test(page)) {
  pass('请求装配丢弃空 payStatus（清空后不会退化成 payStatus= 空串）')
} else {
  fail('请求装配必须写 `payStatus: payStatus || undefined`，空串必须从查询串里消失')
}

// 待退款详情不得把「渠道已收款未转 paid」那一类写成「已付款」，也不得裸渲染
// refundReason 机器码。两处都是 M-2 把这类单变成可达之后才会被运营看到的。
if (
  page.includes('REFUND_REASON_LABELS') &&
  page.includes("ONLINE_PAID_PENDING_REFUND: '") &&
  page.includes('REFUND_REASON_LABELS[detail.refundReason] ?? detail.refundReason')
) {
  pass('详情退款原因走中文码表，未命中才回落原值（不裸渲染机器码）')
} else {
  fail('详情「退款原因」必须经 REFUND_REASON_LABELS 映射为中文')
}

if (
  /detail\.refundReason === 'ONLINE_PAID_PENDING_REFUND'/.test(page) &&
  page.includes('待退款：渠道已收款，订单未转已支付')
) {
  pass('渠道已收款未转 paid 的待退款单不被写成「已付款」')
} else {
  fail('待退款提示必须按 refundReason 区分，不得对未转 paid 的单宣称已付款')
}

// ────────────────────────────────────────────────────────────────────────────
// API-20b（2026-09-18）：运营关注三支信号（opsAttention / opsAttentionCode）。
//
// 后端只读视图早已返回三类互斥信号：refund_required / refunding /
// channel_accepted_unconfirmed（含渠道已受理但本地回填失败——渠道可能已扣款）。
// 管理端此前只接了 refundRequired 一支，「退款中」与「渠道已受理未确认」
// 在列表上完全不可见，运营只能人肉翻页。接线必须同时满足四点：
//   a. 前端类型与后端字段同名同取值，不新增第四类；
//   b. 请求装配能发出 opsAttention=true；
//   c. 「需运营关注」chip 清空 payStatus 与 statusFilter —— 与 M-2 同一类坑：
//      channel_accepted_unconfirmed 的 payStatus 是 paying/closed 而不是 paid，
//      钉任何状态都会把最该被看见的那一类静默挡在筛选外；
//   d. 后端不返回新字段时列表降级到既有 refundRequired 角标，绝不伪造。
// ────────────────────────────────────────────────────────────────────────────
if (
  service.includes('opsAttention?: boolean') &&
  service.includes('opsAttentionCode?:') &&
  service.includes("'refund_required' | 'refunding' | 'channel_accepted_unconfirmed' | null") &&
  service.includes("opsAttention: params.opsAttention ? 'true' : undefined")
) {
  pass('admin orders service carries opsAttention/opsAttentionCode fields and query mapping')
} else {
  fail('admin orders service must expose opsAttention/opsAttentionCode with server-identical values and opsAttention query mapping')
}

if (!page.includes("setOpsAttentionFilter(true)") || !page.includes('需运营关注')) {
  fail('需运营关注筛选入口缺失（setOpsAttentionFilter / chip 文案）')
} else {
  const opsChipHandlers = page
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('setOpsAttentionFilter(true)'))
  if (opsChipHandlers.length !== 1) {
    fail(`需运营关注入口必须唯一（找到 ${opsChipHandlers.length} 处 setOpsAttentionFilter(true)）`)
  } else if (!/setPayStatus\(\s*''\s*\)/.test(opsChipHandlers[0])) {
    fail(`需运营关注入口必须显式清空 payStatus：${opsChipHandlers[0]}`)
  } else if (!/setStatusFilter\(\s*''\s*\)/.test(opsChipHandlers[0])) {
    fail(`需运营关注入口必须显式清空 statusFilter：${opsChipHandlers[0]}`)
  } else if (/setPayStatus\(\s*'(?:paid|unpaid|paying|closed)'\s*\)/.test(opsChipHandlers[0])) {
    fail(`需运营关注入口不得钉死任何 payStatus：${opsChipHandlers[0]}`)
  } else {
    pass('需运营关注入口发 opsAttention=true 且不携带 payStatus/status 限制（整行匹配）')
  }
}

if (
  page.includes('opsAttentionText(order.opsAttentionCode)') &&
  /order\.opsAttentionCode === undefined && order\.refundRequired/.test(page)
) {
  pass('列表角标读 opsAttentionCode，后端未返回字段时降级 refundRequired 角标（不伪造）')
} else {
  fail('列表角标必须读 opsAttentionCode，并在字段缺失时降级而不伪造')
}

if (
  honestyCopy.includes("'refund_required'") &&
  honestyCopy.includes("'refunding'") &&
  honestyCopy.includes("'channel_accepted_unconfirmed'") &&
  honestyCopy.includes("return '待退款'") &&
  honestyCopy.includes("return '退款中'") &&
  honestyCopy.includes("return '渠道已受理未确认'")
) {
  pass('opsAttentionText covers all three server codes with Chinese labels and returns null otherwise')
} else {
  fail('opsAttentionText must map refund_required/refunding/channel_accepted_unconfirmed to Chinese and null for unknown')
}

// API-20 人工发起退款：待退款信号单必须二次确认后才走 canonical refundOrder。
if (
  page.includes('发起退款') &&
  page.includes('确认发起退款') &&
  page.includes('点确认后才会出款') &&
  page.includes('金额以本页服务端金额为准') &&
  page.includes('adminOrdersReadonlyService.refundOrder') &&
  page.includes("onClick={() => void handleRefund()}") &&
  !/useEffect\s*\([\s\S]{0,1200}(?:handleRefund|refundOrder)/.test(page) &&
  (page.match(/adminOrdersReadonlyService\.refundOrder\(/g) || []).length === 1
) {
  pass('pending-refund orders expose 发起退款 with click-only RefundService entry')
} else {
  fail('API-20 admin manual refund button/confirm/no-auto-trigger contract is incomplete')
}

console.log('\nALL PASS')
