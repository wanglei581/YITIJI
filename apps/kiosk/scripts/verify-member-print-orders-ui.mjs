import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:member-print-orders-ui — 「我的打印订单」支付展示诚实性守卫（C5 P0b）
//
// 背景：C5-1 后端 /me/print-orders 已返回 Order 支付安全字段
// （amountCents / payStatus / paymentSource / billablePages / billingPageSource / pickupCode），
// 无 live 网关，paymentSource 只允许 offline / free / manual_confirmed。
// 本守卫静态断言 Kiosk 前端展示层的诚实红线：
//   1) 支付来源文案只含白名单（线下收款 / 免费 / 人工确认），全文件禁出现微信 / 支付宝；
//   2) unpaid → 「待现场确认」；历史无 Order → 「暂无支付信息」，不显示金额 0、不推断；
//   3) pickupCode 只从后端字段渲染（item.pickupCode 真值门控），前端不依据
//      payStatus 推断可见性、不本地生成取件码；
//   4) 金额来自 amountCents 整数分运算，无硬编码价格；
//   5) 旧「无金额（后端无对应列）」过时口径已清除；
//   6) 「再打一份」不从订单侧直连：无 /print/confirm 跳转、无任务创建调用，
//      只有「去我的文档再打印」引导（新任务新订单走我的文档链路）；
//   7) W5 换装约束：新增/改造文件禁用 gray/slate/blue 默认色阶。
// ============================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = 'src/pages/profile/me/MyPrintOrdersPage.tsx'
const COPY = 'src/pages/profile/me/printOrders/paymentCopy.ts'
const SUMMARY = 'src/pages/profile/me/printOrders/OrderPaymentSummary.tsx'
const PANEL = 'src/pages/profile/me/printOrders/PickupCodePanel.tsx'
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
function expectAbsent(source, pattern, message) {
  if (!pattern.test(source)) pass(message)
  else fail(`${message} — forbidden pattern ${pattern} matched`)
}

console.log('\n=== Kiosk「我的打印订单」支付展示诚实性守卫 ===')

const pageSrc = read(PAGE)
const copySrc = read(COPY)
const summarySrc = read(SUMMARY)
const panelSrc = read(PANEL)
const all = [
  [PAGE, pageSrc],
  [COPY, copySrc],
  [SUMMARY, summarySrc],
  [PANEL, panelSrc],
]

// 1) 支付来源文案白名单（SSOT 在 paymentCopy.ts）
expectMatches(copySrc, /offline:\s*'线下收款'/, '支付来源 offline → 线下收款')
expectMatches(copySrc, /free:\s*'免费'/, '支付来源 free → 免费')
expectMatches(copySrc, /manual_confirmed:\s*'人工确认'/, '支付来源 manual_confirmed → 人工确认')
for (const [name, src] of all) {
  expectAbsent(src, /微信|支付宝|wechat|alipay/i, `${name} 不出现微信 / 支付宝（线上渠道未接入）`)
}

// 2) 诚实状态文案：unpaid 与历史无 Order
expectMatches(copySrc, /unpaid:\s*\{\s*label:\s*'待现场确认'/, 'payStatus unpaid → 待现场确认（不写线上支付渠道）')
expectMatches(pageSrc, /payStatus\s*==\s*null\)\s*return\s*'暂无支付信息'/, '列表卡片：无 Order（payStatus 为 null）→ 暂无支付信息')
expectMatches(summarySrc, /payStatus\s*===\s*null\s*\?[\s\S]{0,200}?暂无支付信息/, '详单：无 Order 分支只显示暂无支付信息')

// 3) pickupCode 只从后端字段渲染，前端不推断、不生成
expectMatches(pageSrc, /\{item\.pickupCode\s*&&/, '列表卡片取件码提示以 item.pickupCode 真值门控')
expectMatches(summarySrc, /\{item\.pickupCode\s*&&\s*<PickupCodePanel/, '详单取件码面板以 item.pickupCode 真值门控')
for (const [name, src] of all) {
  expectAbsent(src, /^.*pickupCode.*payStatus.*$|^.*payStatus.*pickupCode.*$/m, `${name} 不依据 payStatus 推断取件码可见性（门控在服务端）`)
  expectAbsent(src, /pickupCode\s*=[^=]/, `${name} 不本地赋值 / 生成取件码`)
  expectAbsent(src, /Math\.random/, `${name} 无随机生成逻辑`)
}

// 4) 金额：整数分运算，无硬编码价格
expectMatches(copySrc, /Math\.floor\(amountCents\s*\/\s*100\)/, '金额元部分来自 amountCents 整数除法')
expectMatches(copySrc, /amountCents\s*%\s*100/, '金额分部分来自 amountCents 取余')
expectMatches(copySrc, /if\s*\(amountCents\s*===\s*0\)\s*return\s*'免费'/, '0 分订单显示免费')
for (const [name, src] of all) {
  expectAbsent(src, /¥\s*\d/, `${name} 无硬编码人民币金额`)
}

// 5) 过时口径清除：页面不得再宣称「无金额 / 不含金额」
expectAbsent(pageSrc, /不含文件内容与金额/, '旧底部文案「不含金额」已更新')
expectAbsent(pageSrc, /无页数\s*\/\s*设备名\s*\/\s*金额/, '旧头部注释「无金额（后端无对应列）」已清除')

// 6) 再打一份：只做诚实引导，不从订单侧直连创建任务
expectMatches(summarySrc, /去我的文档再打印/, '详单提供「去我的文档再打印」引导')
expectMatches(summarySrc, /navigate\('\/me\/documents'\)/, '引导跳转 /me/documents（走重签 → 新任务新订单链路）')
for (const [name, src] of all) {
  expectAbsent(src, /\/print\/confirm/, `${name} 不直接跳打印确认页（无可重签文件源）`)
  expectAbsent(src, /createPrint/i, `${name} 不从订单侧创建打印任务`)
}

// 7) 换装约束：禁 gray / slate / blue 默认色阶
for (const [name, src] of all) {
  expectAbsent(
    src,
    /(?:bg|text|border|ring|divide|from|to|via)-(?:gray|slate|blue)-\d+/,
    `${name} 不使用 gray/slate/blue 默认色阶（用 token）`,
  )
}

// 8) 加载更多 / 筛选为真实数据行为
expectMatches(pageSrc, /\{nextCursor\s*&&/, '加载更多仅在后端返回 nextCursor 时出现')
expectMatches(pageSrc, /aria-pressed=\{filterKey === f\.key\}/, '状态筛选 chips 带 aria-pressed')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 「我的打印订单」支付展示诚实性守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — 「我的打印订单」支付展示诚实口径一致\n')
