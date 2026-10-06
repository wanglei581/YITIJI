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
    assert.match(doneSource, /setVerification\(\{\s*taskId,\s*result:\s*'completed'/)
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
    assert.match(doneSource, /已在本机出纸/)
    assert.doesNotMatch(doneRuntime, /getPayStatus|pickupLookup|取件凭证暂时无法读取|取件码/)
    assert.match(browserSpecSource, /same-page task switch hides the previous task and pickup code immediately/)
    assert.match(browserSpecSource, /已在本机出纸/)
    assert.match(browserSpecSource, /OLD-PICKUP-001/)
  }],
  ['W6 直达完成页预期为无法确认', () => {
    assert.match(routeCasesSource, /pattern:\s*'\/print\/done'[\s\S]*?featureText:\s*'无法确认打印结果'/)
  }],
  // 2026-09-29 口径变更（产品负责人拍板「两处都堵，30 秒」，W-43）：到点不再只收起预览，
  // 而是真的结束这次使用 —— 走统一的 endKioskUse，结束人次、清本机数据、退出登录、回首页。
  // 这不是放宽：旧断言要求「不退出登录」，新断言要求「到点必须调用 endKioskUse 且它会退出登录」。
  ['60 秒到点真的结束本次使用并退出登录（统一 endKioskUse），文案如实', () => {
    // 倒计时归零那一刻调用的就是 endKioskUse('print_done_timeout')，不是自己清一半。
    const timeout = doneRuntime.match(/const endOnTimeout = useCallback\(\(\) => \{[\s\S]*?\}, \[endKioskUse\]\)/)
    assert.ok(timeout, '完成页有 endOnTimeout')
    assert.match(timeout[0], /endKioskUse\('print_done_timeout'\)/)
    assert.match(doneRuntime, /if \(n <= 0\) \{\s*window\.clearInterval\(timer\)\s*endOnTimeout\(\)/)
    assert.match(doneRuntime, /setIdleLeft\(60\)/)
    // 完成页自己不许 logout / 清数据：半清正是这次要堵的洞。
    assert.doesNotMatch(doneRuntime, /\blogout\s*\(|clearPrintMaterialSession\s*\(|clearKioskSensitiveSession\s*\(/)
    assert.doesNotMatch(doneRuntime, /setWiped|登录还在|账号还登录着|账号不会因此退出/)
    // 主按钮：两步确认后同样走 endKioskUse。
    assert.match(doneRuntime, /'我拿走了，结束使用'/)
    assert.match(doneRuntime, /endArmed \? '再按一次，确认结束使用'/)
    assert.match(doneRuntime, /if \(endArmed\) \{\s*endKioskUse\('end_use'\)/)
    // 倒计时文案如实：登录着就说会退出登录。
    assert.match(doneRuntime, /到点会结束本次使用并退出登录/)
    assert.match(doneRuntime, /秒后结束使用/)
    assert.doesNotMatch(
      doneRuntime,
      /隐私已清除|下一个人看不到|这次办理已清空|结束并清空|空闲超时自动清空|秒空闲后自动清空|已清除/,
    )
    // endKioskUse 这一步真的会退出登录：print_done_timeout 映射到空闲结束，四步里有 logout。
    const endUse = read('src/auth/kioskEndUse.ts')
    assert.match(endUse, /print_done_timeout: 'idle_timeout'/)
    assert.match(endUse, /attempt\(steps\.logout\)/)
    const guard = withoutComments(read('src/auth/KioskPrivacyGuard.tsx'))
    assert.match(guard, /runEndKioskUse\(reason, \{[\s\S]{0,400}?logout: \(\) => logout\(\)/)
    assert.match(guard, /endKioskUse: endKioskUseFromPage/)
  }],
  ['W-23 证件提醒只在证件件出现，且不声称文件上有水印（本机不盖水印）', () => {
    assert.match(doneRuntime, /const idDocument = state\.idDocument === true/)
    assert.match(doneRuntime, /\{idDocument \? \([\s\S]{0,280}原件和复印件一起带走/)
    assert.match(doneRuntime, /idDocument \? '拿走前记得核一下页数，证件原件和复印件一起带走/)
    // 服务端与 Agent 都没有加水印的实现：页面不得让用户去核对一个并不存在的水印。
    assert.doesNotMatch(doneRuntime, /仅供求职使用」?\s*(<\/?b>)?\s*水印|页数和水印/)
    assert.match(doneRuntime, /: '拿走前记得核一下页数，少页当场能处理。'/)
    const handoff = read('src/pages/print/printHandoff.ts')
    const confirm = read('src/pages/print/PrintConfirmPage.tsx')
    const scan = read('src/pages/scan/ScanResultPage.tsx')
    const documents = read('src/pages/profile/me/MyDocumentsPage.tsx')
    assert.match(handoff, /input\.idDocument === true/)
    assert.match(confirm, /idDocument:\s*handoff\.idDocument === true/)
    assert.match(scan, /idDocument: scanType === 'id'/)
    assert.match(documents, /doc\.purpose === 'id_scan'/)
  }],
  ['出纸后提醒核对并取走', () => {
    // 稿 15 completed 只留一句「都打好了，拿走前核一下」，不再并列「请取走文件 / 请取走纸张」。
    assert.match(doneSource, /都打好了，拿走前核一下/)
    assert.match(doneSource, /从出纸口取走/)
    assert.doesNotMatch(doneRuntime, /请取走纸张/)
    assert.doesNotMatch(doneRuntime, /请取走文件/)
  }],
  ['W-46/W-51 完成页只显示 ORD- 号，取纸按份数，再印一份按价目', () => {
    assert.match(doneRuntime, /displayOrderNo = publicOrderNo\(/)
    assert.match(doneRuntime, /doneTakeaway\(/)
    assert.match(doneRuntime, /reprintHint\(amountCents\)/)
    assert.doesNotMatch(doneRuntime, /任务号/)
    assert.doesNotMatch(doneRuntime, /不免费/)
    assert.doesNotMatch(doneRuntime, /共 0 面/)
    assert.doesNotMatch(doneRuntime, /errorCode = /)
    assert.doesNotMatch(doneRuntime, /displayOrderNo[\s\S]{0,80}orderId/)
    const progressRuntime = withoutComments(read('src/pages/print/PrintProgressPage.tsx'))
    const progressSections = withoutComments(read('src/pages/print/components/PrintProgressSections.tsx'))
    const doneSections = withoutComments(read('src/pages/print/components/PrintDoneSections.tsx'))
    const model = read('src/pages/print/printProgressModel.ts')
    assert.match(progressRuntime, /publicOrderNo\(/)
    assert.match(progressRuntime, /reprintHint\(amountCents\)/)
    assert.doesNotMatch(progressRuntime, /不免费/)
    assert.doesNotMatch(progressRuntime, /任务号/)
    assert.doesNotMatch(progressSections, /任务号/)
    assert.match(doneSections, /shownOrderNo = publicOrderNo\(orderNo\)/)
    assert.match(doneSections, /页数待识别/)
    assert.doesNotMatch(doneSections, /\{file\.pages\} 页/)
    assert.doesNotMatch(doneSections, /任务号/)
    assert.match(model, /return '重新选文件后再确认。免费试运营。'/)
    assert.doesNotMatch(model, /不免费/)
  }],
  ['失败态给出带走二维码、订单号和补打入口', () => {
    assert.match(doneSource, /文件带走/)
    assert.match(doneSource, /是否补打，回到订单重新打印/)
    assert.doesNotMatch(doneSource, /联系工作人员补打/)
    assert.match(doneSource, /重新提交打印/)
    assert.match(doneSource, /issuePrintJobTakeawayUrl/)
    assert.match(doneSource, /retryPrintJob/)
    assert.doesNotMatch(doneRuntime, /const\s+handleRetry/)
  }],
  ['W-114 重提版本门槛给求职者下一步，提示在固定按钮栏', () => {
    assert.match(doneRuntime, /errorCodeOf\(err\) === 'PRINT_RETRY_AGENT_VERSION'\s*\?\s*`这台机器的打印程序需要升级后才能重新提交。\$\{machineUnusableLine\(\)\}`/)
    const retryActions = doneRuntime.slice(doneRuntime.indexOf('const retryButton ='), doneRuntime.indexOf('const takeawayNotices ='))
    const takeawayNotices = doneRuntime.slice(doneRuntime.indexOf('const takeawayNotices ='), doneRuntime.indexOf("if (visual === 'out-of-paper')"))
    assert.match(retryActions, /retryError &&[\s\S]*role="alert"[\s\S]*flex: '1 1 100%'[\s\S]*order: -1[\s\S]*\{retryError\}/)
    assert.doesNotMatch(takeawayNotices, /retryError/)
    assert.equal((doneRuntime.match(/\{retryButton\}/g) ?? []).length, 2, '普通失败与缺纸失败都使用同一按钮栏提示')
    assert.match(browserSpecSource, /old agent retry rejection stays beside the actions in the first viewport/)
    assert.match(browserSpecSource, /toBeInViewport\(\{ ratio: 1 \}\)/)
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
