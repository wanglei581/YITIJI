import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:kiosk-feedback-entry —— 一体机「反馈问题」入口守卫
//
// 产品定案（2026-08-16）：不做一体机自助退款。退款裁决权在后台，
// 一体机只提供「反馈问题」上报入口。用户点「申请退款」会形成
// 「点一下就能拿到钱」的预期，而实际要经过后台判定 —— 给一个诚实的
// 「反馈问题」比给一个会落空的承诺好。
//
// 本守卫静态断言四件事：
//   1. 反馈入口打匿名端点 /kiosk/feedback，不再跳登录墙 /me/feedback。
//   2. 匿名提交面不带 Authorization、不捎带 Cookie、不收联系方式。
//   3. 一体机反馈相关文案不出现退款 / 赔付字样，也不承诺推送回复。
//   4. 前端 issueCode 词表与后端 DTO 白名单逐项一致（漂移即 FAIL）。
//
// 注意：PrintCashierPage 的「本机不提供自助退款」是**允许**出现「退款」的唯一位置 ——
// 那句话本身就是在声明不提供退款，且定案要求它继续为真，因此不在扫描范围内。
// ============================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(root, '../..')

const DIALOG = 'src/components/KioskFeedbackDialog.tsx'
const CLIENT = 'src/services/api/kioskFeedback.ts'
const DONE = 'src/pages/print/PrintDonePage.tsx'
const HUB = 'src/pages/print-scan/PrintScanHomePage.tsx'
const CASHIER = 'src/pages/print/PrintCashierPage.tsx'
const BACKEND_DTO = 'services/api/src/member-feedback/dto/kiosk-feedback.dto.ts'

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const readRepo = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

/**
 * 去掉注释后的源码。
 *
 * 「不得出现退款字样」约束的是**用户看得见的文案**，不是解释这条规则的注释本身。
 * 不剥注释的话，本文件要求写清「为什么不提退款」的那些说明反而会把守卫弄红，
 * 逼下一个人把理由删掉 —— 那是把注释质量和门禁对立起来，方向错了。
 * `(?<!:)//` 避免误伤 https:// 这类协议前缀。
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '')

let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => {
  failures += 1
  console.error(`  FAIL ${message}`)
}
function expectMatches(source, pattern, message) {
  if (pattern.test(source)) pass(message)
  else fail(`${message} — 未匹配到 ${pattern}`)
}
function expectNoMatch(source, pattern, message) {
  if (!pattern.test(source)) pass(message)
  else fail(`${message} — 不应出现却匹配到 ${pattern}`)
}

console.log('\n=== 一体机「反馈问题」入口守卫 ===')

// 全部按「剥注释后」的源码判定：门禁看的是真正会渲染 / 真正会发出去的东西。
const dialogSrc = stripComments(read(DIALOG))
const clientSrc = stripComments(read(CLIENT))
const doneSrc = stripComments(read(DONE))
const hubSrc = stripComments(read(HUB))

// ── 1. 接匿名端点，不再跳登录墙 ──
console.log('\n[1] 入口接匿名端点')
expectMatches(clientSrc, /['"`]\$\{API_BASE_URL\}\/kiosk\/feedback['"`]/, '提交面打 POST /kiosk/feedback')
expectNoMatch(doneSrc, /\/me\/feedback/, '打印完成页不再跳会员反馈页（登录墙）')
expectNoMatch(hubSrc, /\/me\/feedback/, '打印 Hub 不再跳会员反馈页（登录墙）')
expectMatches(doneSrc, /KioskFeedbackDialog/, '打印完成页挂载匿名反馈弹层')
expectMatches(hubSrc, /KioskFeedbackDialog/, '打印 Hub 挂载匿名反馈弹层')
expectMatches(doneSrc, /反馈问题/, '打印完成页出现「反馈问题」入口文案')
expectMatches(hubSrc, /反馈问题/, '打印 Hub 出现「反馈问题」入口文案')

// ── 2. 匿名边界：不带凭证、不收联系方式 ──
console.log('\n[2] 匿名边界与最小收集')
expectNoMatch(clientSrc, /Authorization/, '匿名提交不带 Authorization 头')
expectMatches(clientSrc, /credentials:\s*'omit'/, "匿名提交显式 credentials: 'omit'，不捎带会话 Cookie")
expectNoMatch(clientSrc, /contactPhone/, '匿名提交面不含联系方式字段')
expectNoMatch(dialogSrc, /contactPhone|type="tel"|联系电话|手机号码/, '弹层不提供联系方式输入框')
expectMatches(
  dialogSrc,
  /请勿填写手机号、身份证号等个人信息/,
  '弹层提示用户不要填写个人信息（服务端另有 PII 拒绝）',
)

// ── 3. 诚实性与退款红线 ──
console.log('\n[3] 诚实性与退款红线')
const REFUND_COPY = /退款|退费|赔付|理赔|返还费用/
for (const [label, source] of [['弹层', dialogSrc], ['提交面', clientSrc], ['打印完成页', doneSrc], ['打印 Hub', hubSrc]]) {
  expectNoMatch(source, REFUND_COPY, `${label}不出现退款 / 赔付字样`)
}
// 匿名工单没有账号可送达：后台连回复入口都不渲染，前端不得承诺回复。
expectNoMatch(dialogSrc, /会回复你|回复您|我们会回复/, '不承诺向匿名用户推送回复（系统结构上做不到）')
expectMatches(dialogSrc, /本次为匿名反馈，系统不会把处理结果推送到账号/, '如实说明匿名工单不会推送处理结果')
// 失败必须走错误分支展示，不得静默吞掉。
expectMatches(dialogSrc, /data-kiosk-feedback-error/, '提交失败有可断言的错误展示钩子')
expectMatches(dialogSrc, /role="alert"/, '提交失败以 role="alert" 播报')
expectMatches(clientSrc, /throw new KioskFeedbackApiError\('NO_HTTP_BACKEND'/, 'mock 模式抛错而不是返回假回执')
expectNoMatch(dialogSrc, /已退款|退款成功|已受理退款/, '不显示任何退款已完成的结论')

// 定案：收银页那句「本机不提供自助退款」必须继续为真，不得被删。
console.log('\n[4] 收银页既有口径保持为真')
const cashierSrc = read(CASHIER)
expectMatches(
  cashierSrc,
  /如需退款请联系现场工作人员协助处理，本机不提供自助退款/,
  '收银页「本机不提供自助退款」文案保留',
)

// ── 5. 前后端词表一致 ──
console.log('\n[5] issueCode 词表与后端 DTO 一致')
function extractCodes(source, constName) {
  const match = new RegExp(`${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(source)
  if (!match) return null
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1])
}

const frontCodes = extractCodes(clientSrc, 'KIOSK_FEEDBACK_ISSUE_CODES')
const backCodes = extractCodes(readRepo(BACKEND_DTO), 'KIOSK_FEEDBACK_ISSUE_CODES')

if (!frontCodes) fail('未能从前端提交面解析出 KIOSK_FEEDBACK_ISSUE_CODES')
else if (!backCodes) fail('未能从后端 DTO 解析出 KIOSK_FEEDBACK_ISSUE_CODES')
else if (frontCodes.join('|') !== backCodes.join('|')) {
  fail(`前后端 issueCode 词表漂移：前端 [${frontCodes.join(', ')}] vs 后端 [${backCodes.join(', ')}]`)
} else {
  pass(`前后端 issueCode 词表一致（${frontCodes.length} 项）`)
}

// 各入口开放的选项必须都在白名单内，否则提交必被服务端 400。
const optionCodes = [...clientSrc.matchAll(/code:\s*'([a-z_]+)'/g)].map((entry) => entry[1])
if (optionCodes.length === 0) fail('未声明任何 issueCode 入口选项')
else {
  const unknown = optionCodes.filter((code) => !(frontCodes ?? []).includes(code))
  if (unknown.length) fail(`出现白名单外的 issueCode：${unknown.join(', ')}`)
  else pass(`入口选项 ${optionCodes.length} 项全部在白名单内`)
}

console.log(
  failures === 0
    ? '\n=== 一体机「反馈问题」入口守卫：全部通过 ===\n'
    : `\n=== 一体机「反馈问题」入口守卫：${failures} 项未通过 ===\n`,
)
process.exit(failures === 0 ? 0 : 1)
