import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const doneSource = read('src/pages/print/PrintDonePage.tsx')
const routeCasesSource = read('tests/visual/fixtures/fusion-w6-route-cases.ts')
const browserSpecSource = read('tests/visual/print-done-truth.spec.ts')

const checks = [
  ['完成页读取真实打印任务接口', () => {
    assert.match(doneSource, /import\s*\{[^}]*getPrintJobStatus[^}]*\}\s*from\s*'\.\.\/\.\.\/services\/print\/printJobsApi'/)
    assert.match(doneSource, /getPrintJobStatus\(taskId\)/)
    assert.match(doneSource, /result\.taskId\s*!==\s*taskId/)
    assert.match(doneSource, /verification\?\.taskId\s*===\s*taskId/)
    assert.match(browserSpecSource, /a response for a different task cannot confirm the current task/)
  }],
  ['只有 completed 状态进入成功视图', () => {
    assert.match(doneSource, /result\.status\s*===\s*'completed'/)
    assert.match(doneSource, /setVerification\(\{\s*taskId,\s*result:\s*'completed'\s*\}\)/)
  }],
  ['pending、claimed、printing 返回真实进度页', () => {
    assert.match(doneSource, /\['pending',\s*'claimed',\s*'printing'\]/)
    assert.match(doneSource, /navigate\(\s*'\/print\/progress',\s*\{[\s\S]*?replace:\s*true/)
    assert.match(browserSpecSource, /\['claimed', 'printing'\]/)
  }],
  ['缺上下文、404 与网络错误都显示无法确认', () => {
    assert.match(doneSource, /无法确认打印结果/)
    assert.match(doneSource, /setVerification\(\{\s*taskId,\s*result:\s*'unknown'\s*\}\)/)
    assert.match(browserSpecSource, /direct visit without a task context cannot claim success/)
    assert.match(browserSpecSource, /name:\s*'404'/)
    assert.match(browserSpecSource, /name:\s*'network'/)
    assert.match(browserSpecSource, /network failures remain unknown/)
  }],
  ['路由 state 的 success 不能作为真实性来源', () => {
    assert.doesNotMatch(doneSource, /state\.success|success\s*=\s*true/)
    assert.match(browserSpecSource, /forged success cannot override pending or failed backend status/)
    assert.match(browserSpecSource, /completed backend status overrides a forged failure state/)
  }],
  ['未知状态不提供重打，且反馈和帮助进入真实入口', () => {
    assert.doesNotMatch(doneSource, /const\s+handleRetry|>\s*重试打印\s*</)
    assert.match(doneSource, /navigate\(\s*'\/help'\s*\)/)
    assert.match(doneSource, /\/me\/feedback\?category=print&relatedPrintTaskId=/)
  }],
  ['无持久化来源的满意度控件已移除', () => {
    assert.doesNotMatch(doneSource, /满意度评分|setRating|print-done-rate-chip/)
    assert.match(doneSource, /pickupLookup\?\.orderId === state\.orderId/)
    assert.match(browserSpecSource, /same-page task switch hides the previous task and pickup code immediately/)
  }],
  ['W6 直达完成页预期为无法确认', () => {
    assert.match(routeCasesSource, /pattern:\s*'\/print\/done'[\s\S]*?featureText:\s*'无法确认打印结果'/)
  }],
]

let failures = 0
console.log('\n=== Kiosk 打印完成页真实性守卫 ===')
for (const [name, check] of checks) {
  try {
    check()
    console.log(`  PASS ${name}`)
  } catch (error) {
    failures += 1
    console.error(`  FAIL ${name}`)
    console.error(`       ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 打印完成页仍可能展示未经后端确认的成功\n`)
  process.exit(1)
}

console.log('\n✅ ALL PASS — 打印完成页仅以真实任务状态为准\n')
