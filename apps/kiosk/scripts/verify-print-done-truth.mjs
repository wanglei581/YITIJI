import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

/** 剥注释后再判：否则「写清为什么不再跳 /me/feedback」的注释会把负向断言弄红。 */
const withoutComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const doneSource = read('src/pages/print/PrintDonePage.tsx')
const doneRuntime = withoutComments(doneSource)
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
    // 反馈入口曾断言「跳 /me/feedback?category=print&relatedPrintTaskId=」。那个会员面
    // 必须登录，匿名用户点了只会撞登录墙 —— 断言钉死的正是本批次要修的缺陷。
    // 现在的真实入口是就地开 KioskFeedbackDialog（匿名，直发 POST /kiosk/feedback），
    // 所以改为断言「弹层真的接上了真实提交面，且带上本次打印任务号」。
    assert.match(
      doneRuntime,
      /import\s*\{[^}]*KioskFeedbackDialog[^}]*\}\s*from\s*'\.\.\/\.\.\/components\/KioskFeedbackDialog'/,
    )
    // `[\s/>]` 收尾：否则改名成 <KioskFeedbackDialogXX 也能匹配，等于断言没生效。
    assert.match(doneRuntime, /<KioskFeedbackDialog[\s/>]/)
    assert.match(doneRuntime, /relatedPrintTaskId=\{taskId\}/)
    assert.match(doneRuntime, /from '\.\.\/\.\.\/services\/api\/kioskFeedback'/)
    // 不得回退到登录墙入口（剥注释后判，注释里提到旧路径不算回退）。
    assert.doesNotMatch(doneRuntime, /\/me\/feedback/)
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
