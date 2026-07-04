import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:print-confirm-honest — Kiosk 打印确认页诚实性守卫
//
// 背景(合规 bug B):部分 AI 产物打印入口把 fileUrl 设为 `signedUrl || undefined`
// (CareerPlanPage / ResumeGeneratePreviewPage / InterviewReportPage / FairVisitPlanPage)。
// 一旦上游导出没拿到 signedUrl,file.fileUrl 即为空。若确认页在生产 http 模式下
// 遇到空 fileUrl 时退回 SIM 前端模拟动画,会伪造"打印成功"却从未向打印机提交任务,
// 直接违反 CLAUDE.md §9(无真实结果不得展示已打印)。
//
// 本守卫静态断言:PrintConfirmPage.handleConfirm 在 http 模式下,
//   1) 以 `if (API_MODE === 'http')` 作为外层分支;
//   2) 无真实 fileUrl 时先 setSubmitError + return 拦截,绝不落入 SIM;
//   3) 真实建单后按 amountCents 分流(C5-3 收银):付费单(>0/unpaid)进 /print/cashier,
//      免费/已付单(0/paid+free)进真实 /print/progress;两分支共用 nextState
//      (必带 taskId + orderId),绝不落入 SIM;
//   4) 无 taskId 的 SIM 跳转只存在于 http 分支 return 之后(即仅非 http 模式可达)。
// ============================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIRM = 'src/pages/print/PrintConfirmPage.tsx'
const PROGRESS = 'src/pages/print/PrintProgressPage.tsx'
const CASHIER = 'src/pages/print/PrintCashierPage.tsx'
const DONE = 'src/pages/print/PrintDonePage.tsx'
const PAYMENT_API = 'src/services/print/paymentApi.ts'
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

let failures = 0
function pass(message) {
  console.log(`  PASS ${message}`)
}
function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}
function expectMatches(source, pattern, message) {
  if (pattern.test(source)) pass(message)
  else fail(`${message} — pattern ${pattern} not found`)
}

console.log('\n=== Kiosk 打印确认页诚实性守卫 ===')

const confirmSrc = read(CONFIRM)
const progressSrc = read(PROGRESS)
const cashierSrc = read(CASHIER)
const doneSrc = read(DONE)
const paymentApiSrc = read(PAYMENT_API)

// 1) 读取 API_MODE
expectMatches(
  confirmSrc,
  /import\s*\{\s*API_MODE\s*\}\s*from\s*'\.\.\/\.\.\/services\/api\/client'/,
  'PrintConfirmPage 读取 API_MODE',
)

// 2) handleConfirm 以 http 模式作为外层分支
const httpBranch = /if\s*\(\s*API_MODE\s*===\s*'http'\s*\)\s*\{/
expectMatches(confirmSrc, httpBranch, 'handleConfirm 以 API_MODE === http 作为外层分支')

// 3) http 分支内:无 fileUrl 先拦截报错并 return(诚实失败)
const guard = /if\s*\(\s*!file\.fileUrl\s*\)\s*\{[^{}]*setSubmitError\([^{}]*return[^{}]*\}/
expectMatches(
  confirmSrc,
  guard,
  'http 模式无真实 fileUrl 时先 setSubmitError 并 return,不伪造打印成功',
)

// 位置断言:定位关键锚点
const httpIndex = confirmSrc.search(httpBranch)
const guardIndex = confirmSrc.search(/if\s*\(\s*!file\.fileUrl\s*\)/)

// SIM 跳转 = 无 taskId 的 /print/progress 导航(仅非 http mock 模式使用)
const simNavPattern = /navigate\('\/print\/progress',\s*\{\s*state:\s*\{\s*\.\.\.location\.state,\s*file,\s*params,\s*source\s*\}\s*\}\)/
const simIndex = confirmSrc.search(simNavPattern)

// C5-3:http 真实建单后按 amountCents 分流,两分支共用 nextState(履约状态载体)。
// nextState 必须携带 taskId(真实轮询)与 orderId(收银出码/取件码)。
const nextStateHasTaskId = /const\s+nextState\s*=\s*\{[\s\S]*?taskId:\s*created\.taskId[\s\S]*?\}/
const nextStateHasOrderId = /const\s+nextState\s*=\s*\{[\s\S]*?orderId:\s*created\.orderId[\s\S]*?\}/
const nextStateHasPaymentSession = /const\s+nextState\s*=\s*\{[\s\S]*?paymentSessionToken:\s*created\.paymentSessionToken[\s\S]*?\}/
// 付费单(amountCents>0 且未 paid)分流到收银页;免费/已付单进真实 progress。两者都携带 nextState。
const cashierBranchPattern = /created\.amountCents\s*>\s*0[\s\S]*?navigate\('\/print\/cashier',\s*\{\s*state:\s*nextState\s*\}\)/
const realProgressPattern = /navigate\('\/print\/progress',\s*\{\s*state:\s*nextState\s*\}\)/
const cashierIndex = confirmSrc.search(/navigate\('\/print\/cashier'/)

// 4) fileUrl 守卫必须早于 cashier / 真实 progress / SIM 跳转
//    (结构上真实建单跳转与 SIM 均在 http 分支 !file.fileUrl 守卫之后)
if (httpIndex >= 0 && guardIndex > httpIndex && cashierIndex > guardIndex && simIndex > guardIndex) {
  pass('cashier / 真实 progress / SIM 跳转均位于 http 分支与 fileUrl 守卫之后,http 模式不伪造成功')
} else {
  fail('cashier / 真实 progress / SIM 跳转必须晚于 http 分支及 !file.fileUrl 守卫')
}

// 5) C5-3 真实建单跳转:cashier 分流 + 免费/已付走真实 progress;状态载体 nextState 携带 taskId + orderId。
expectMatches(confirmSrc, cashierBranchPattern, 'C5-3 付费单(amountCents>0)分流到 /print/cashier')
expectMatches(confirmSrc, realProgressPattern, 'C5-3 免费/已付单进入真实 /print/progress(携带 nextState)')
expectMatches(confirmSrc, nextStateHasTaskId, '真实建单跳转 state 携带 taskId 以轮询真实状态')
expectMatches(confirmSrc, nextStateHasOrderId, 'C5-3 真实建单跳转 state 携带 orderId(收银/取件)')
expectMatches(confirmSrc, nextStateHasPaymentSession, 'C5-3 真实建单跳转 state 携带 paymentSessionToken(出码/查单授权)')
// SIM 跳转不带 taskId(防误加,仅非 http 模式使用)
expectMatches(confirmSrc, simNavPattern, 'SIM 跳转不携带 taskId(仅非 http 模式使用)')

// 6) Payment session token:cashier / done 调 paymentApi 必须带 token, paymentApi 必须下发 header。
expectMatches(
  paymentApiSrc,
  /export\s+interface\s+PaymentSessionInput\s*\{[\s\S]*paymentSessionToken\?:\s*string/,
  'paymentApi 定义 paymentSessionToken 输入契约',
)
expectMatches(
  paymentApiSrc,
  /'x-payment-session-token':\s*input\.paymentSessionToken/,
  'paymentApi 对出码/查单请求写入 x-payment-session-token header',
)
expectMatches(
  paymentApiSrc,
  /createPayAttempt\(input:\s*PaymentSessionInput\)/,
  'createPayAttempt 只能通过包含 token 的对象调用',
)
expectMatches(
  paymentApiSrc,
  /getPayStatus\(input:\s*PaymentSessionInput\)/,
  'getPayStatus 只能通过包含 token 的对象调用',
)
expectMatches(
  cashierSrc,
  /const\s+paymentSessionToken\s*=\s*typeof\s+state\.paymentSessionToken\s*===\s*'string'\s*\?\s*state\.paymentSessionToken\s*:\s*null/,
  'PrintCashierPage 从路由 state 读取 paymentSessionToken',
)
expectMatches(
  cashierSrc,
  /createPayAttempt\(\{\s*orderId,\s*paymentSessionToken\s*\}\)/,
  'PrintCashierPage 出码时携带 paymentSessionToken',
)
expectMatches(
  cashierSrc,
  /getPayStatus\(\{\s*orderId,\s*paymentSessionToken\s*\}\)/,
  'PrintCashierPage 轮询/模拟后查单时携带 paymentSessionToken',
)
expectMatches(
  doneSrc,
  /getPayStatus\(\{\s*orderId:\s*state\.orderId\s+as\s+string,\s*paymentSessionToken:\s*state\.paymentSessionToken\s*\}\)/,
  'PrintDonePage 查询取件码时携带 paymentSessionToken',
)

// 7) PrintProgressPage:生产 http 模式无 taskId 时也不能走 SIM 动画 / 成功页
expectMatches(
  progressSrc,
  /const\s+isHttpMode\s*=\s*API_MODE\s*===\s*'http'/,
  'PrintProgressPage 显式区分 http 模式',
)
expectMatches(
  progressSrc,
  /const\s+useRealApi\s*=\s*isHttpMode\s*&&\s*Boolean\(taskId\)/,
  'PrintProgressPage 仅有 taskId 时进入真实轮询',
)
expectMatches(
  progressSrc,
  /const\s+canSimulate\s*=\s*!isHttpMode\s*&&\s*hasFileContext/,
  'PrintProgressPage SIM 仅允许非 http 模式',
)
expectMatches(
  progressSrc,
  /if\s*\(\s*useRealApi\s*\|\|\s*!canSimulate\s*\)\s*return/,
  'PrintProgressPage SIM effect 在 http 无 taskId 时直接返回',
)
expectMatches(
  progressSrc,
  /if\s*\(\s*isHttpMode\s*&&\s*!taskId\s*\)\s*\{[\s\S]*?打印任务尚未创建[\s\S]*?返回确认页[\s\S]*?\}/,
  'PrintProgressPage http 无 taskId 时显示错误态而非伪造成功',
)

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — Kiosk 打印确认页诚实性守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Kiosk 打印确认页诚实性守卫一致\n')
