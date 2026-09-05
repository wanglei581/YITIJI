import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

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
const LOCAL_PRINT_WAKE = 'src/services/print/localPrintWakeApi.ts'
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
const localPrintWakeSrc = read(LOCAL_PRINT_WAKE)
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

// 位置断言:定位关键锚点（fileUrl 守卫必须紧跟 setSubmitError，排除 useEffect 报价分支）
const httpIndex = confirmSrc.search(httpBranch)
const guardIndex = confirmSrc.search(/if\s*\(\s*!file\.fileUrl\s*\)\s*\{\s*setSubmitError/)

// SIM 跳转 = 无 taskId 的 /print/progress 导航(仅非 http mock 模式使用)
const simNavPattern = /navigate\('\/print\/progress',\s*\{\s*state:\s*\{\s*\.\.\.\(isContractReport\s*\?\s*\{\}\s*:\s*location\.state\),\s*file,\s*params,\s*source\s*\}\s*,?\s*\}\)/
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
  // C5-6 起入参扩展可选 channel（PaymentSessionInput & { channel?: string }）；
  // 守卫不变量不变：入参必须是包含 paymentSessionToken 的 PaymentSessionInput 对象。
  /createPayAttempt\(input:\s*PaymentSessionInput\b/,
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
  // C5-6 起出码额外携带 channel；守卫不变量不变：出码调用必须携带 paymentSessionToken。
  /createPayAttempt\(\{\s*orderId,\s*paymentSessionToken\s*,\s*channel\s*\}\)/,
  'PrintCashierPage 出码时携带 paymentSessionToken',
)
expectMatches(
  cashierSrc,
  /getPayStatus\(\{\s*orderId,\s*paymentSessionToken\s*\}\)/,
  'PrintCashierPage 轮询/模拟后查单时携带 paymentSessionToken',
)
expectMatches(
  doneSrc,
  /getPayStatus\(\{\s*orderId,\s*paymentSessionToken\s*\}\)/,
  'PrintDonePage 查询取件码时携带 paymentSessionToken',
)
expectMatches(
  doneSrc,
  /error:\s*'取件凭证暂时无法读取，请联系工作人员核验订单'/,
  'PrintDonePage 取件码查询失败时显式提示工作人员核验，不静默隐藏',
)

// 8) P0-1：确认页 / 预览页不得硬编码单价；确认页改读后端报价。
const PREVIEW = 'src/pages/print/PrintPreviewPage.tsx'
const PRINT_JOBS_API = 'src/services/print/printJobsApi.ts'
const previewSrc = read(PREVIEW)
const printJobsApiSrc = read(PRINT_JOBS_API)
expectMatches(
  printJobsApiSrc,
  /export\s+async\s+function\s+quotePrintOrder/,
  'printJobsApi 提供 quotePrintOrder（POST /orders/quote）',
)
expectMatches(
  printJobsApiSrc,
  /\$\{API_BASE_URL\}\/orders\/quote/,
  'quotePrintOrder 请求 /orders/quote',
)
expectMatches(
  confirmSrc,
  /import\s*\{[^}]*quotePrintOrder[^}]*\}\s*from\s*'\.\.\/\.\.\/services\/print\/printJobsApi'/,
  'PrintConfirmPage 引入 quotePrintOrder',
)
// 2026-08-18：报价入参新增 terminalId（彩色/双面须按本机能力登记 fail-closed 复核），
// 故不再钉死实参列表末尾。断言意图不变：必须用**真实** fileUrl + params 去问后端要价，
// 不得改用本地估算或写死金额。
expectMatches(
  confirmSrc,
  /quotePrintOrder\(\{\s*fileUrl:\s*file\.fileUrl,\s*params\b/,
  'PrintConfirmPage 用真实 fileUrl + params 请求后端报价',
)
if (!/PRICE_BW|PRICE_COLOR/.test(confirmSrc)) {
  pass('PrintConfirmPage 无硬编码 PRICE_BW / PRICE_COLOR')
} else {
  fail('PrintConfirmPage 仍含硬编码 PRICE_BW / PRICE_COLOR')
}
if (!/PRICE_BW|PRICE_COLOR|¥0\.20|¥0\.50/.test(previewSrc)) {
  pass('PrintPreviewPage 无硬编码单价 / 0.20 / 0.50 展示')
} else {
  fail('PrintPreviewPage 仍含硬编码单价文案')
}
expectMatches(
  confirmSrc,
  /演示模式不显示金额|页数待服务端确认，以最终计费为准|打印文件尚未就绪，无法报价/,
  'PrintConfirmPage 在无可靠报价时不展示具体金额',
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
expectMatches(
  progressSrc,
  /wakeRequestedTaskIdRef\.current\s*!==\s*taskId[\s\S]*?wakeLocalPrintQueue\(\)/,
  'PrintProgressPage 仅对真实 taskId 发起一次本机打印队列唤醒',
)
expectMatches(
  localPrintWakeSrc,
  /\/local\/print\/wake[\s\S]*?method:\s*'POST'/,
  '本机打印唤醒使用 wake-only POST 协议',
)
if (/body\s*:/.test(localPrintWakeSrc)) {
  fail('本机打印唤醒不得携带 taskId、文件或任意请求体')
} else {
  pass('本机打印唤醒不携带请求体')
}
expectMatches(
  localPrintWakeSrc,
  /catch\s*\{[\s\S]*?return\s+'unavailable'/,
  '本机 Agent 不可达时静默回落到既有云端轮询',
)

// ============================================================
// S0-B：PrintProgressPage SIM 演示真值
//
// 非 http 模拟路径不得伪装成真实建单 / 支付 / 出纸 / 取件成功。
// 以下断言刻意结合结构与调用次数，避免仅靠可随意塞进注释的单词。
// ============================================================
console.log('\n=== S0-B PrintProgressPage SIM 演示真值 ===')

function countMatches(source, pattern) {
  const flags = pattern.global ? pattern.flags : `${pattern.flags}g`
  return [...source.matchAll(new RegExp(pattern.source, flags))].length
}

function stripComments(source) {
  // 去掉块注释 / JSX `{/* ... */}` 与行注释，防止仅靠注释字面量混过断言
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const progressCode = stripComments(progressSrc)

/** 从 openIdx（指向 '('）提取平衡括号内的正文；失败返回 null */
function sliceBalancedParen(source, openIdx) {
  if (openIdx < 0 || source[openIdx] !== '(') return null
  let depth = 0
  for (let i = openIdx; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openIdx + 1, i)
    }
  }
  return null
}

/** 收集 `gateRe`（须以 `(` 结尾）匹配处的平衡括号正文 */
function collectParenBodies(source, gateRe) {
  const bodies = []
  const re = new RegExp(gateRe.source, gateRe.flags.includes('g') ? gateRe.flags : `${gateRe.flags}g`)
  for (const match of source.matchAll(re)) {
    const openIdx = match.index + match[0].lastIndexOf('(')
    const body = sliceBalancedParen(source, openIdx)
    if (body != null) bodies.push(body)
  }
  return bodies
}

/** isSim ? (trueBody) : (falseBody) → 收集 true / false 括号体 */
function collectIsSimTernaryBodies(source) {
  const trues = []
  const falses = []
  for (const match of source.matchAll(/isSim\s*\?/g)) {
    let i = match.index + match[0].length
    while (i < source.length && /\s/.test(source[i])) i += 1
    if (source[i] !== '(') continue
    const trueBody = sliceBalancedParen(source, i)
    if (trueBody == null) continue
    let j = i + trueBody.length + 2
    while (j < source.length && /\s/.test(source[j])) j += 1
    if (source[j] !== ':') continue
    j += 1
    while (j < source.length && /\s/.test(source[j])) j += 1
    if (source[j] !== '(') continue
    const falseBody = sliceBalancedParen(source, j)
    if (falseBody == null) continue
    trues.push(trueBody)
    falses.push(falseBody)
  }
  return { trues, falses }
}

function rangesFromBodies(source, bodies) {
  const ranges = []
  for (const body of bodies) {
    let from = 0
    while (true) {
      const idx = source.indexOf(body, from)
      if (idx < 0) break
      ranges.push({ start: idx, end: idx + body.length })
      from = idx + body.length
    }
  }
  return ranges
}

/** 文案位于 isSim 真分支：`isSim && (` 或 `isSim ? (` … `)` */
function inIsSimTrueBranch(source, needle) {
  if (!source.includes(needle)) return false
  const andBodies = collectParenBodies(source, /isSim\s*&&\s*\(/g)
  const { trues } = collectIsSimTernaryBodies(source)
  return [...andBodies, ...trues].some((body) => body.includes(needle))
}

/**
 * 文案只能出现在 !isSim 分支：`!isSim && (` 或 `isSim ? (…) : (` 假分支。
 * 用平衡括号正文判断，避免已关闭三元假阳性覆盖后续无条件 JSX。
 */
function inNotIsSimBranch(source, needle) {
  if (!source.includes(needle)) return false
  const andBodies = collectParenBodies(source, /!isSim\s*&&\s*\(/g)
  const { falses } = collectIsSimTernaryBodies(source)
  const ranges = rangesFromBodies(source, [...andBodies, ...falses])
  let from = 0
  let any = false
  while (true) {
    const idx = source.indexOf(needle, from)
    if (idx < 0) break
    any = true
    if (!ranges.some((r) => idx >= r.start && idx < r.end)) return false
    from = idx + needle.length
  }
  return any
}

// 1) 常驻可见文案「演示模式·非真实打印」——须为字符串字面量或 JSX 文本，不能只出现在注释
const demoBannerLiteral =
  /(?:['"`]演示模式·非真实打印['"`])|(?:>\s*演示模式·非真实打印\s*<)/
if (demoBannerLiteral.test(progressCode) && inIsSimTrueBranch(progressCode, '演示模式·非真实打印')) {
  pass('SIM 真分支含常驻文案「演示模式·非真实打印」(字符串/JSX，非注释)')
} else {
  fail('SIM 真分支必须常驻展示「演示模式·非真实打印」(不可仅写在注释或死代码)')
}

// 2) 本地 simDone / simFinished 终态，并声明未真实打印
const hasSimEndState =
  /\b(?:simDone|simFinished)\b/.test(progressCode) &&
  /set(?:SimDone|SimFinished)\s*\(\s*true\s*\)/.test(progressCode)
const declaresNoRealPrint = /未真实打印/.test(progressCode)
if (hasSimEndState && declaresNoRealPrint) {
  pass('SIM 具备本地 simDone/simFinished 终态，并声明未真实打印')
} else {
  fail('SIM 必须有本地 simDone/simFinished 终态(含 set* (true))，并声明未真实打印')
}

// 3) SIM effect 结束须 set 本地终态，禁止调用 navigateSuccess
const simEffectMatch = progressCode.match(
  /useEffect\(\(\)\s*=>\s*\{([\s\S]*?canSimulate[\s\S]*?)\},\s*\[[^\]]*canSimulate[^\]]*\]\)/,
)
const simEffectBody = simEffectMatch?.[1] ?? ''
const simEffectSetsLocalEnd = /set(?:SimDone|SimFinished)\s*\(\s*true\s*\)/.test(simEffectBody)
const simEffectCallsNavigateSuccess = /navigateSuccess\s*\(/.test(simEffectBody)
const simEffectNavigatesDoneDirectly =
  /navigate\s*\(\s*['"]\/print\/done['"]/.test(simEffectBody) ||
  /navigate\s*\([\s\S]{0,200}?success\s*:\s*true/.test(simEffectBody)
if (
  simEffectMatch &&
  simEffectSetsLocalEnd &&
  !simEffectCallsNavigateSuccess &&
  !simEffectNavigatesDoneDirectly
) {
  pass('SIM effect 结束 set 本地终态，不调用或直接跳转真实成功页')
} else {
  fail('SIM effect 结束必须 setSimDone/setSimFinished(true)，且不得调用或直接跳转真实成功页')
}

// 4) navigateSuccess() 在整个文件仅允许真实轮询使用一次
const navigateSuccessCallCount = countMatches(progressCode, /navigateSuccess\s*\(\s*\)/)
if (navigateSuccessCallCount === 1) {
  pass(`navigateSuccess() 仅真实轮询使用一次 (count=${navigateSuccessCallCount})`)
} else {
  fail(`navigateSuccess() 在整个文件仅允许真实轮询调用一次，实际 ${navigateSuccessCallCount} 次`)
}

// 5) 真实话术须被 isSim 分支隔离；演示分支明确未建单 / 未支付 / 未出纸
const hasIsSim = /(?:const|let)\s+isSim\s*=/.test(progressCode)
const realPhrases = [
  { phrase: '完成支付确认', label: '完成支付确认' },
  { phrase: '打印机正在出纸', label: '打印机正在出纸' },
]
let realPhrasesIsolated = hasIsSim
for (const { phrase, label } of realPhrases) {
  // 真实话术须出现在 isSim 三元的假分支（isSim ? demo : real），容忍换行与引号风格
  const isolated = new RegExp(
    String.raw`isSim\s*\?[\s\S]{0,240}?\s*:\s*[\s\S]{0,160}?${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  ).test(progressCode)
  if (isolated) {
    pass(`真实话术「${label}」位于 isSim 假分支`)
  } else {
    realPhrasesIsolated = false
    fail(`真实话术「${label}」必须经 isSim 三元隔离(假分支)，不得对 SIM 路径无条件展示`)
  }
}

const realStatusHelperHonest =
  /case\s+'pending':[\s\S]{0,800}?stageTitle:\s*'等待终端领取'[\s\S]{0,800}?终端尚未领取/.test(progressCode) &&
  /case\s+'claimed':[\s\S]{0,800}?stageTitle:\s*'终端已领取任务'[\s\S]{0,800}?终端已领取任务，正在准备打印/.test(progressCode) &&
  /case\s+'printing':[\s\S]{0,800}?stageTitle:\s*'正在打印'[\s\S]{0,800}?打印机正在出纸/.test(progressCode)
const realStatusPresentationIsolated =
  /label:\s*isSim\s*\?[\s\S]{0,160}?:\s*realStatus\.queueLabel/.test(progressCode) &&
  /desc:\s*isSim\s*\?[\s\S]{0,200}?:\s*realStatus\.queueDesc/.test(progressCode) &&
  /:\s*realStatus\.stageTitle/.test(progressCode) &&
  /:\s*realStatus\.stageSubtitle/.test(progressCode)
if (realStatusHelperHonest && realStatusPresentationIsolated) {
  pass('pending / claimed / printing 三态话术独立定义，且仅在真实任务分支渲染')
} else {
  fail('pending / claimed / printing 必须独立定义诚实话术，并与 SIM 演示分支隔离')
}

const simHonest =
  /isSim\s*\?[\s\S]{0,320}?未建单/.test(progressCode) &&
  /isSim\s*\?[\s\S]{0,320}?未支付/.test(progressCode) &&
  /isSim\s*\?[\s\S]{0,320}?未出纸/.test(progressCode)
if (simHonest) {
  pass('演示分支明确声明未建单 / 未支付 / 未出纸')
} else {
  fail('演示分支必须明确声明未建单、未支付、未出纸(出现在 isSim ? … 真分支)')
}

if (!hasIsSim) {
  fail('PrintProgressPage 须定义 isSim，用于隔离真实进度话术与演示文案')
} else if (realPhrasesIsolated && realStatusHelperHonest && realStatusPresentationIsolated && simHonest) {
  pass('isSim 分支同时隔离真实话术并提供演示诚实文案')
}

// ============================================================
// S0-B 第二轮：右栏不得对 SIM 展示真实任务提示
//
// mock 浏览器验收：主时间线已诚实，但右栏仍无条件展示「预计出纸」
// 「打印机缺纸 / 卡纸」「已支付但打印失败」「请勿离开…取走文件」。
// 以下断言要求 JSX 条件结构 + 可见文案，注释字面量不算。
// ============================================================
console.log('\n=== S0-B 第二轮：SIM 右栏演示说明 / 真实提示隔离 ===')

// 6) SIM 必须有独立「演示说明」区（标题 + 四条诚实声明，均在 isSim 真分支）
const demoExplainTitleLiteral =
  /(?:['"`]演示说明['"`])|(?:>\s*演示说明\s*<)|(?:aria-label\s*=\s*['"]演示说明['"])/
const hasDemoExplainTitle = demoExplainTitleLiteral.test(progressCode)
const demoExplainTitleInSim = inIsSimTrueBranch(progressCode, '演示说明')
if (hasDemoExplainTitle && demoExplainTitleInSim) {
  pass('SIM 含独立「演示说明」区标题(字符串/JSX/aria-label，且在 isSim 真分支)')
} else {
  fail('SIM 必须有独立「演示说明」区：标题须为可见字面量/JSX/aria-label，并位于 isSim && / isSim ? 真分支')
}

const simSideHonesty = [
  { phrase: '未创建真实打印任务', label: '未创建真实打印任务' },
  { phrase: '未产生订单或费用', label: '未产生订单或费用' },
  { phrase: '未向打印机发送文件', label: '未向打印机发送文件' },
  { phrase: '不会产生取件码', label: '不会产生取件码' },
]
let simSideHonest = hasDemoExplainTitle && demoExplainTitleInSim
for (const { phrase, label } of simSideHonesty) {
  // 已 stripComments；须落在 isSim && (…)/isSim ? (…) 真分支正文内
  if (inIsSimTrueBranch(progressCode, phrase)) {
    pass(`演示说明声明「${label}」位于 isSim 真分支(非注释)`)
  } else {
    simSideHonest = false
    fail(`演示说明必须在 isSim 真分支明确「${label}」(JSX/字符串，不可仅注释)`)
  }
}
if (simSideHonest) {
  pass('SIM 演示说明区四条诚实声明齐全且均在 isSim 真分支')
}

// 7) 「预计出纸」行、真实常见情况处理区、出纸口隐私提示只能在 !isSim 分支渲染
const realSideGates = [
  { needle: '预计出纸', label: '「预计出纸」行' },
  { needle: '常见情况处理', label: '真实常见情况处理区(aria-label/标题)' },
  { needle: '打印机缺纸 / 卡纸', label: '真实 FAQ「打印机缺纸 / 卡纸」' },
  { needle: '已支付但打印失败', label: '真实 FAQ「已支付但打印失败」' },
  { needle: '请勿离开，打印完成后请及时取走文件', label: '出纸口隐私提示' },
]
let realSideIsolated = true
for (const { needle, label } of realSideGates) {
  if (inNotIsSimBranch(progressCode, needle)) {
    pass(`${label}仅在 !isSim 分支渲染`)
  } else {
    realSideIsolated = false
    fail(`${label}必须经 !isSim && (…)/isSim ? … : (…) 假分支隔离，不得对 SIM 无条件展示`)
  }
}
if (realSideIsolated) {
  pass('右栏真实任务提示(预计出纸/常见情况/隐私提示)均已用 !isSim 隔离')
}

// ============================================================
// S0-B 第三轮：时间线 label 按 isSim 隔离 + simDone 全项完成图标
//
// 真实 1080×1920 截图：SIM 演示结束后时间线仍显示真实标签
// 「打印中 / 完成取件」，且最后一步仍是时钟（tlIdx < 3 漏掉末项）。
// 断言要求 TL label 结构隔离 + 完成图标覆盖全部 TL_ITEMS；注释不算。
// ============================================================
console.log('\n=== S0-B 第三轮：时间线 SIM label / simDone 全项完成 ===')

/** label: isSim ? 'simLabel' : 'realLabel' — 容忍换行、引号、可选括号 */
function timelineLabelIsolatedByIsSim(source, simLabel, realLabel) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    String.raw`label\s*:\s*isSim\s*\?\s*\(?\s*['"\`]${esc(simLabel)}['"\`]\s*\)?\s*:\s*\(?\s*['"\`]${esc(realLabel)}['"\`]\s*\)?`,
  ).test(source)
}

// 8) 时间线 label 必须按 isSim 隔离
//    SIM 至少「打印演示」「演示结束」；真实假分支继续「打印中」「完成取件」
const printLabelOk = timelineLabelIsolatedByIsSim(progressCode, '打印演示', '打印中')
const pickupLabelOk = timelineLabelIsolatedByIsSim(progressCode, '演示结束', '完成取件')
if (printLabelOk) {
  pass('时间线 label「打印演示」/「打印中」按 isSim 隔离')
} else {
  fail('时间线 label 须为 isSim ? 「打印演示」 : 「打印中」（SIM 不得继续展示真实「打印中」）')
}
if (pickupLabelOk) {
  pass('时间线 label「演示结束」/「完成取件」按 isSim 隔离')
} else {
  fail('时间线 label 须为 isSim ? 「演示结束」 : 「完成取件」（SIM 不得继续展示真实「完成取件」）')
}
if (printLabelOk && pickupLabelOk) {
  pass('时间线关键 label 已按 isSim 隔离（SIM 演示名 / 真实假分支原名）')
}

// 9) simDone 时全部 TL_ITEMS（含最后一项）进入完成图标逻辑，不能只 tlIdx < 3
const simDoneCheckCutsLast =
  /isSim\s*&&\s*simDone\s*&&\s*tlIdx\s*<\s*3/.test(progressCode) ||
  /simDone\s*&&\s*tlIdx\s*<\s*3/.test(progressCode)
const simDoneChecksAllItems =
  /isDone\s*\|\|\s*\(\s*isSim\s*&&\s*simDone\s*\)/.test(progressCode) ||
  /isDone\s*\|\|\s*\(\s*isSim\s*&&\s*simDone\s*&&\s*tlIdx\s*<\s*TL_ITEMS\.length\s*\)/.test(
    progressCode,
  )
const simDoneClassifiesAllItems =
  /const\s+cls\s*=\s*isSim\s*&&\s*simDone\s*&&\s*!failed\s*\?\s*['"]tl-done['"]\s*:\s*tlItemClass\s*\(/.test(
    progressCode,
  )
if (!simDoneCheckCutsLast && simDoneChecksAllItems && simDoneClassifiesAllItems) {
  pass('simDone 时全部 TL_ITEMS（含最后一项）进入完成样式与 CheckIcon 逻辑')
} else if (simDoneCheckCutsLast) {
  fail('simDone 完成图标不能只判断 tlIdx < 3（最后一项会仍显示时钟）')
} else {
  fail(
    'simDone 时所有 TL_ITEMS 须进入 tl-done 完成样式与 CheckIcon 逻辑（含最后一项）',
  )
}

// 10) 仅执行中的真实任务或 SIM 演示保持 busy lock；失败、超时和结束态须释放
const activeTaskBusyLock =
  /useBusyLock\s*\(\s*\(\s*useRealApi\s*&&\s*!failed\s*&&\s*!timedOut\s*\)\s*\|\|\s*\(\s*isSim\s*&&\s*!failed\s*&&\s*!simDone\s*\)\s*,?\s*\)/.test(
    progressCode,
  )
if (activeTaskBusyLock) {
  pass('真实任务执行中与 SIM 演示进行中保持 busy lock，失败、超时和结束态释放')
} else {
  fail(
    'useBusyLock 须仅覆盖执行中的真实任务或 SIM 演示，并在失败、超时和结束态释放',
  )
}

// 11) SIM / 失败跳转定时器须可清理，避免离页后回调继续执行
const simTimerCleanup =
  /simTimerRef/.test(progressCode) &&
  /clearTimeout\s*\(\s*simTimerRef\.current\s*\)/.test(progressCode)
const failTimerCleanup =
  /failTimerRef/.test(progressCode) &&
  /clearTimeout\s*\(\s*failTimerRef\.current\s*\)/.test(progressCode)
if (simTimerCleanup && failTimerCleanup) {
  pass('SIM 动画与失败跳转 timer 均在离页时清理')
} else {
  fail('SIM 动画与失败跳转须分别保存 timer ref，并在 cleanup 中 clearTimeout')
}

// 12) 静态 SIM 标识不重复 aria-live；动态结束态由底部 status chip 播报
const simTrueBodies = [
  ...collectParenBodies(progressCode, /isSim\s*&&\s*\(/g),
  ...collectIsSimTernaryBodies(progressCode).trues,
].filter((body) => body.includes('演示模式·非真实打印'))
if (simTrueBodies.length >= 2 && simTrueBodies.every((body) => !/aria-live/.test(body))) {
  pass('常驻 SIM 标识均为静态语义，不重复 aria-live 播报')
} else {
  fail('常驻 SIM badge / 提示条不得携带 aria-live；动态状态统一由底部 status chip 播报')
}

// 13) mock 非法上下文（只有 taskId、无 file）必须进入错误守卫，不能渲染真实话术
if (
  /if\s*\(\s*!hasContext\s*\|\|\s*\(\s*!isHttpMode\s*&&\s*!canSimulate\s*\)\s*\)/.test(
    progressCode,
  )
) {
  pass('mock 仅 taskId / 无 file 的非法上下文进入错误守卫')
} else {
  fail('无真实 API 且不可模拟时必须进入错误守卫，禁止卡在伪真实进度 UI')
}

// 14) DEV/SIM 失败也留在演示页，不跳真实结果页
const navigateFailMatch = progressCode.match(
  /const\s+navigateFail\s*=\s*useCallback\s*\(\s*\(reason:[^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[[^\]]*\]\s*,?\s*\)/,
)
const navigateFailBody = navigateFailMatch?.[1] ?? ''
const simFailStaysLocal =
  /if\s*\(\s*isSim\s*\)/.test(navigateFailBody) &&
  /setSimDone\s*\(\s*true\s*\)/.test(navigateFailBody) &&
  /return/.test(navigateFailBody)
if (simFailStaysLocal) {
  pass('DEV/SIM 失败设置本地结束态并留在演示页')
} else {
  fail('navigateFail 在 isSim 时必须 setSimDone(true) 后 return，不得跳真实结果页')
}

// 15) SIM 失败保留失败步进态，同时仍提供触控出口
const simEndActionsIncludeFailure =
  /isSim\s*&&\s*simDone\s*&&\s*\(/.test(progressCode) &&
  !/isSim\s*&&\s*simDone\s*&&\s*!failed\s*&&\s*\(/.test(progressCode)
if (simEndActionsIncludeFailure) {
  pass('SIM 成功或失败结束态均提供返回首页 / 重新上传操作')
} else {
  fail('SIM 结束操作区不得排除 failed；失败演示也必须有返回首页 / 重新上传出口')
}

expectMatches(
  confirmSrc,
  /useTerminalDeviceStatus/,
  'PrintConfirmPage 接 useTerminalDeviceStatus 复核打印机状态',
)
expectMatches(
  confirmSrc,
  /printerBlocked|!printerReady/,
  'PrintConfirmPage 打印机未就绪时禁用主按钮',
)
expectMatches(
  confirmSrc,
  /PRINTER_UNAVAILABLE/,
  'PrintConfirmPage 将 PRINTER_UNAVAILABLE 映射为中文',
)
expectMatches(
  progressCode,
  /result\.status\s*===\s*'cancelled'[\s\S]{0,200}abandoned/,
  '进度页 cancelled/abandoned 走终态分支',
)
expectMatches(
  progressCode,
  /POLL_FAIL_LIMIT\s*=\s*5/,
  '进度页轮询连续失败 ≥5 次才判失败',
)
expectMatches(
  progressCode,
  /暂时无法读取状态/,
  '进度页轮询失败文案为「暂时无法读取状态」',
)
expectMatches(
  printJobsApiSrc,
  /'cancelled'[\s\S]{0,40}'abandoned'/,
  'BackendJobStatus 含 cancelled/abandoned',
)

// ============================================================
// 16) 参数摘要：展示的值必须与真实参数同源（AST 断言）
//
// 2026-08-18 事故面：#692 放开彩色/双面后，确认页摘要卡的「色彩模式」和预览页
// 「用量预估」的「颜色模式」两行仍写死 '黑白'，而报价
// （unitCentsFor(config, params.colorMode)）与建单读的是真实值。
// TerminalCapability 表里 color_print 零记录时彩色被禁用，撞不到；管理员一标
// available，用户就会看到「黑白」、按彩色单价（print_color_page 50 分/页 vs
// print_bw_page 20 分/页）扣款、拿到彩色纸 —— 多付钱 + CLAUDE.md §9 不伪造能力。
//
// 断言形态刻意不是「源码里必须出现 params.colorMode」这类字面量匹配 ——
// 那种门禁被重构时会被顺手改掉字符串，洞原样打回。这里走 AST：
//   16a) summaryRows 每一行的 value 表达式必须取自某个对象属性（即真实数据），
//        纯字面量只允许出现在**白名单**里，且白名单每条都要有硬件事实作依据。
//   16b) 展示色彩模式的表达式，必须与喂给 unitCentsFor(...) 的那个表达式**同源**
//        （逐字比较两处的属性访问文本，而不是比对某个写死的名字：
//         把 params 整体改名，两边一起变，仍然通过）。
//   16c) 预览页 InfoRow 同理：value 不得是纯字符串字面量，白名单同上。
//
// 白名单只有硬件事实可以进：奔图 CM2800/CM2820 只有 A4，PrintJobParams.paperSize
// 的类型就是字面量 'A4'（packages/shared/src/types/print.ts）。放宽白名单 = 放宽门禁。
// ============================================================
const LITERAL_ROW_ALLOWLIST = new Map([
  ['纸张规格', 'CM2800/CM2820 仅 A4，PrintJobParams.paperSize 类型即字面量 A4（CLAUDE.md §3）'],
])

const parseTsx = (relativePath) =>
  ts.createSourceFile(relativePath, read(relativePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function findVariableInitializer(sourceFile, name) {
  let found = null
  const visit = (node) => {
    if (
      !found &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function objectProperty(objectLiteral, name) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const key = property.name
    if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === name) return property.initializer
  }
  return null
}

/** 表达式里出现的所有属性访问（a.b / a[b]）文本；空数组 = 该表达式没读任何数据。 */
function propertyAccessTexts(node) {
  const texts = []
  const visit = (child) => {
    if (ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) texts.push(child.getText())
    ts.forEachChild(child, visit)
  }
  visit(node)
  return texts
}

/** 第 index 个实参；找不到调用返回 null。 */
function findCallArgument(sourceFile, calleeName, index) {
  let found = null
  const visit = (node) => {
    if (
      !found &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === calleeName &&
      node.arguments.length > index
    ) {
      found = node.arguments[index]
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

const confirmAst = parseTsx(CONFIRM)
const summaryRowsInit = findVariableInitializer(confirmAst, 'summaryRows')

if (!summaryRowsInit || !ts.isArrayLiteralExpression(summaryRowsInit)) {
  fail('确认页找不到 summaryRows 数组字面量 —— 摘要卡真实性无法审计，不得静默通过')
} else {
  const rows = []
  for (const element of summaryRowsInit.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue
    const labelNode = objectProperty(element, 'label')
    const valueNode = objectProperty(element, 'value')
    if (!labelNode || !valueNode || !ts.isStringLiteralLike(labelNode)) continue
    rows.push({ label: labelNode.text, valueNode })
  }

  if (rows.length !== summaryRowsInit.elements.length || rows.length === 0) {
    fail('summaryRows 每一项都必须是 { label: 字面量, value: ... }，否则本守卫审计不到')
  } else {
    // 16a) 每行 value 必须读真实数据；纯字面量只允许在白名单里。
    let allSourced = true
    for (const { label, valueNode } of rows) {
      const reads = propertyAccessTexts(valueNode)
      if (reads.length > 0) continue
      const reason = LITERAL_ROW_ALLOWLIST.get(label)
      if (reason) {
        pass(`摘要行「${label}」写死值已登记豁免：${reason}`)
      } else {
        allSourced = false
        fail(
          `摘要行「${label}」的展示值没有读取任何真实字段（value = ${valueNode.getText().trim()}）——` +
            ' 展示写死而计价用真实值，就是「看到的和付的钱不一致」',
        )
      }
    }
    if (allSourced) pass('确认页参数摘要每一行的展示值都取自真实参数（白名单外无写死值）')

    // 16b) 展示的色彩模式必须与计价用的色彩模式同源。
    const colorRow = rows.find((row) => row.label === '色彩模式')
    const pricedColorArg = findCallArgument(confirmAst, 'unitCentsFor', 1)
    if (!colorRow) {
      fail('确认页摘要卡必须保留「色彩模式」行 —— 删掉它不算修好，用户仍然核对不到彩色/黑白')
    } else if (!pricedColorArg) {
      fail('确认页找不到 unitCentsFor(config, <色彩模式>) 调用 —— 无法证明展示与计价同源')
    } else {
      const pricedText = pricedColorArg.getText().trim()
      const displayedReads = propertyAccessTexts(colorRow.valueNode).map((text) => text.trim())
      if (displayedReads.includes(pricedText)) {
        pass(`确认页展示的色彩模式与计价用的是同一个表达式（${pricedText}）`)
      } else {
        fail(
          `确认页「色彩模式」展示值读的是 [${displayedReads.join(', ') || '无'}]，` +
            `计价读的是 ${pricedText} —— 两者不同源，用户看到的会和扣款口径对不上`,
        )
      }
    }
  }
}

// 16c) 预览页「用量预估」的 InfoRow 同类守卫（确认页的上一步，同一批写死值来源）。
const previewAst = parseTsx(PREVIEW)
const infoRows = []
const collectInfoRows = (node) => {
  const isSelfClosing = ts.isJsxSelfClosingElement(node)
  if (isSelfClosing || ts.isJsxElement(node)) {
    const opening = isSelfClosing ? node : node.openingElement
    if (opening.tagName.getText() === 'InfoRow') {
      const attributes = opening.attributes.properties.filter(ts.isJsxAttribute)
      const labelAttr = attributes.find((attr) => attr.name.getText() === 'label')
      const valueAttr = attributes.find((attr) => attr.name.getText() === 'value')
      if (labelAttr?.initializer && ts.isStringLiteralLike(labelAttr.initializer) && valueAttr) {
        infoRows.push({ label: labelAttr.initializer.text, initializer: valueAttr.initializer })
      }
    }
  }
  ts.forEachChild(node, collectInfoRows)
}
collectInfoRows(previewAst)

if (infoRows.length === 0) {
  fail('预览页找不到任何带字面量 label 的 InfoRow —— 用量预估真实性无法审计')
} else {
  let previewSourced = true
  for (const { label, initializer } of infoRows) {
    // value="写死" 或 value={'写死'} / value={`写死`}（无插值）都算写死。
    const isLiteral =
      ts.isStringLiteralLike(initializer) ||
      (ts.isJsxExpression(initializer) &&
        initializer.expression !== undefined &&
        ts.isStringLiteralLike(initializer.expression))
    if (!isLiteral) continue
    const reason = LITERAL_ROW_ALLOWLIST.get(label)
    if (reason) {
      pass(`预览页 InfoRow「${label}」写死值已登记豁免：${reason}`)
    } else {
      previewSourced = false
      fail(
        `预览页 InfoRow「${label}」写死成 ${initializer.getText().trim()} ——` +
          ' 用户在同一页选了彩色/双面，摘要却说另一回事',
      )
    }
  }
  if (previewSourced) pass('预览页用量预估的每一行都取自真实状态（白名单外无写死值）')
}

// ============================================================
// 17) 打印完成页文件保留时点必须来自后端真实字段（商用清单第 5 项）
// ============================================================
const retentionHelper = read('src/pages/print/components/printFileRetention.ts')
const retentionNotice = read('src/pages/print/components/PrintFileRetentionNotice.tsx')
const deletionRecords = read('src/pages/print/components/PrintFileDeletionRecords.tsx')
const retentionHelperCode = stripComments(retentionHelper)
const doneCode = stripComments(doneSrc)

expectMatches(
  printJobsApiSrc,
  /fileRetentionAvailable\?:\s*boolean/,
  'PrintJobStatusResult 含 fileRetentionAvailable（后端是否读到 FileObject）',
)
expectMatches(
  printJobsApiSrc,
  /fileExpiresAt\?:\s*string\s*\|\s*null/,
  'PrintJobStatusResult 含 fileExpiresAt（FileObject.expiresAt）',
)
expectMatches(
  doneSrc,
  /fileRetentionFromStatus\(result\)/,
  'PrintDonePage 把 getPrintJobStatus 的文件保留字段写入核验结果',
)
expectMatches(
  doneSrc,
  /<PrintFileRetentionNotice/,
  '打印完成页渲染文件保留说明',
)
expectMatches(
  doneSrc,
  /<PrintFileDeletionRecords/,
  '打印完成页提供本人删除记录查阅',
)
expectMatches(
  retentionHelperCode,
  /fileRetentionAvailable\s*!==\s*true/,
  '取不到保留字段时走「以后台策略为准」，不编造时长',
)
expectMatches(
  retentionHelper,
  /未能读取本次文件的保留期，保留期以后台策略为准/,
  '取不到到期时间时如实标注「保留期以后台策略为准」',
)
expectMatches(
  retentionHelper,
  /这不是对存储介质的物理销毁/,
  '文案不承诺物理销毁',
)
expectMatches(
  retentionNotice,
  /data-print-file-retention/,
  '文件保留说明有可核验标记',
)
expectMatches(
  deletionRecords,
  /getMyDeletedDocuments/,
  '删除记录走 GET /me/documents/deleted，不造假列表',
)
expectMatches(
  deletionRecords,
  /游客打印的文件不绑定账号，无法事后查阅删除记录/,
  '游客态如实说明无法查阅删除记录',
)
if (!/24\s*小时|24h|FILE_DEFAULT_TTL/.test(doneCode + retentionHelperCode)) {
  pass('打印完成页与保留文案不写死 24 小时')
} else {
  fail('打印完成页不得写死 24 小时或复用 FILE_DEFAULT_TTL')
}
if (!/彻底销毁|彻底删除|已销毁/.test(doneCode + retentionHelperCode + stripComments(deletionRecords))) {
  pass('打印完成页不承诺彻底销毁')
} else {
  fail('打印完成页不得承诺彻底销毁 / 彻底删除')
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — Kiosk 打印确认页诚实性守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Kiosk 打印确认页诚实性守卫一致\n')
