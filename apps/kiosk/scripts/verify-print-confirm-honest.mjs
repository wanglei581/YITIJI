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
//   3) 无 taskId 的 SIM 跳转只存在于 http 分支 return 之后(即仅非 http 模式可达)。
// ============================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIRM = 'src/pages/print/PrintConfirmPage.tsx'
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

const src = read(CONFIRM)

// 1) 读取 API_MODE
expectMatches(
  src,
  /import\s*\{\s*API_MODE\s*\}\s*from\s*'\.\.\/\.\.\/services\/api\/client'/,
  'PrintConfirmPage 读取 API_MODE',
)

// 2) handleConfirm 以 http 模式作为外层分支
const httpBranch = /if\s*\(\s*API_MODE\s*===\s*'http'\s*\)\s*\{/
expectMatches(src, httpBranch, 'handleConfirm 以 API_MODE === http 作为外层分支')

// 3) http 分支内:无 fileUrl 先拦截报错并 return(诚实失败)
const guard = /if\s*\(\s*!file\.fileUrl\s*\)\s*\{[\s\S]{0,240}?setSubmitError\([\s\S]{0,240}?return/
expectMatches(
  src,
  guard,
  'http 模式无真实 fileUrl 时先 setSubmitError 并 return,不伪造打印成功',
)

// 位置断言:定位关键锚点
const httpIndex = src.search(httpBranch)
const guardIndex = src.search(/if\s*\(\s*!file\.fileUrl\s*\)/)

// SIM 跳转 = 无 taskId 的 /print/progress 导航
const simNavPattern = /navigate\('\/print\/progress',\s*\{\s*state:\s*\{\s*\.\.\.location\.state,\s*file,\s*params,\s*source\s*\}\s*\}\)/
const realNavPattern = /navigate\('\/print\/progress',\s*\{\s*state:\s*\{\s*\.\.\.location\.state,\s*file,\s*params,\s*taskId,\s*source\s*\}\s*\}\)/
const simIndex = src.search(simNavPattern)

// 4) fileUrl 守卫必须早于 SIM 跳转(结构上 SIM 仅在 http 分支 return 之后可达)
if (httpIndex >= 0 && guardIndex > httpIndex && simIndex > guardIndex) {
  pass('SIM 假进度跳转位于 http 分支与 fileUrl 守卫之后,http 模式不可达')
} else {
  fail('SIM 假进度跳转必须晚于 http 分支及 !file.fileUrl 守卫,避免 http 模式落入伪造成功')
}

// 5) 真任务跳转带 taskId;SIM 跳转不带 taskId(防误加)
expectMatches(src, realNavPattern, '真任务跳转携带 taskId 以轮询真实状态')
expectMatches(src, simNavPattern, 'SIM 跳转不携带 taskId(仅非 http 模式使用)')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — Kiosk 打印确认页诚实性守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Kiosk 打印确认页诚实性守卫一致\n')
