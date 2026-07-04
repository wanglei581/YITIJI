import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:profile-inkpaper-home — 「我的」主入口墨青纸感第一批守卫
//
// 目标：只允许 ProfilePage 主入口换装；/me/* 明细页保持 main 真实逻辑。
// ============================================================

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
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

console.log('\n=== Profile 主入口墨青纸感换装守卫 ===')

const profile = read('src/pages/profile/ProfilePage.tsx')
const header = read('src/pages/profile/components/ProfileHeader.tsx')
const section = read('src/pages/profile/components/ProfileEntrySection.tsx')
const entries = read('src/pages/profile/profileEntries.ts')
const types = read('src/pages/profile/profileTypes.ts')
const css = read('src/pages/profile/profile-inkpaper.css')
const packageJson = read('package.json')

// 1) 主入口必须使用墨青纸感局部样式和涟漪，不外溢到 /me 明细页。
expectIncludes(profile, "import './profile-inkpaper.css'", 'ProfilePage 引入局部 profile-inkpaper.css')
expectIncludes(profile, "useInkRipple('.kprofile", 'ProfilePage 只在 .kprofile 作用域启用涟漪')
expectMatches(profile, /className="kprofile"/, 'ProfilePage 外层容器使用 .kprofile')
expectMatches(profile, /className="kp-inner"/, 'ProfilePage 使用 .kp-inner 内容宽度容器')
expectMatches(css, /\.kprofile\s*\{[\s\S]*--paper:\s*#f4f1e8/, 'CSS 定义米纸底色变量')
expectMatches(css, /\.kprofile::before/, 'CSS 使用 .kprofile::before 纸纹层')
expectMatches(css, /\.kprofile \.k-ripple/, 'CSS 定义局部墨水涟漪')

// 2) p-hero、分区 rail、资产大卡 / chips / account 视觉结构必须存在。
expectMatches(header, /className="p-hero"/, 'ProfileHeader 使用 p-hero 米纸卡')
expectMatches(header, /className="p-stats"/, 'ProfileHeader 保留真实统计 p-stats')
expectMatches(section, /className="sec-head"/, 'ProfileEntrySection 渲染分区标题 sec-head')
expectMatches(section, /entry-grid|chip-grid|account-grid/, 'ProfileEntrySection 支持资产大卡 / chips / account 布局')
expectMatches(types, /EntryLayout\s*=\s*'grid'\s*\|\s*'chips'\s*\|\s*'account'/, 'profileTypes 声明三种入口布局')
expectMatches(types, /KioskIconName/, 'profileTypes 使用 KIcon 图标名')

// 3) 入口数量、route、标签和合规文案保持当前 main 真实入口。
const expectedEntries = [
  ['我的简历', '/me/resumes'],
  ['我的文档', '/me/documents'],
  ['AI服务记录', '/me/ai-records'],
  ['打印订单', '/me/print-orders'],
  ['我的收藏', '/me/favorites'],
  ['我的权益', '/me/benefits'],
  ['AI简历服务', '/resume/source'],
  ['简历模板', '/resume/templates'],
  ['文档打印', '/print/upload'],
  ['打印扫描', '/print-scan'],
  ['扫描文件', '/scan/start'],
  ['岗位信息', '/jobs'],
  ['招聘会', '/job-fairs'],
  ['AI助手', '/assistant'],
  ['浏览记录', '/me/activity'],
  ['外部跳转记录', '/me/activity?tab=jump'],
  ['权益活动', '/activities?source=fair'],
  ['权益活动', '/activities'],
  ['政策补贴指引', '/renshi?tab=policy'],
  ['消息通知', '/me/notifications'],
  ['账号设置', '/me/settings'],
  ['身份切换', '/me/settings'],
  ['帮助中心', '/help'],
  ['意见反馈', '/me/feedback'],
]

for (const [label, route] of expectedEntries) {
  expectMatches(
    entries,
    new RegExp(`label:\\s*'${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]{0,120}?route:\\s*'${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
    `入口保留：${label} -> ${route}`,
  )
}
expectMatches(entries, /label:\s*'招聘会扫码凭证'[\s\S]{0,120}?tag:\s*'建设中'/, '招聘会扫码凭证仍为建设中，不新增入口能力')
expectMatches(entries, /label:\s*'求职打印套餐'[\s\S]{0,120}?tag:\s*'建设中'/, '求职打印套餐仍为建设中，不接支付')
expectMatches(entries, /label:\s*'AI服务套餐'[\s\S]{0,120}?tag:\s*'建设中'/, 'AI服务套餐仍为建设中，不接支付')
expectAbsent(entries, /一键投递|立即投递|平台投递|投递简历/, 'Profile 入口不出现招聘闭环禁用文案')

// 4) 禁止把旧版 /me 明细页带入本批 diff。
let changedFiles = []
try {
  changedFiles = execSync('git diff --name-only origin/main', { cwd: join(root, '..', '..'), encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
} catch {
  changedFiles = []
}
const forbiddenChanged = changedFiles.filter((file) =>
  /^apps\/kiosk\/src\/pages\/profile\/me\//.test(file),
)
if (forbiddenChanged.length === 0) {
  pass('本批 diff 未修改 /me/* 明细页')
} else {
  fail(`本批禁止修改 /me/* 明细页：${forbiddenChanged.join(', ')}`)
}

// 5) 不能引入旧 MyPrintOrdersPage 的回退口径。
const printOrders = read('src/pages/profile/me/MyPrintOrdersPage.tsx')
expectIncludes(printOrders, 'OrderPaymentSummary', 'MyPrintOrdersPage 仍引用订单详单组件')
expectIncludes(printOrders, 'paymentLine', 'MyPrintOrdersPage 仍展示支付概要')
expectIncludes(printOrders, 'nextCursor', 'MyPrintOrdersPage 仍保留游标分页')
expectIncludes(printOrders, '取件码', 'MyPrintOrdersPage 仍保留取件码提示')

// 6) package.json 注册本守卫。
expectIncludes(packageJson, '"verify:profile-inkpaper-home"', 'package.json 注册 verify:profile-inkpaper-home')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — Profile 主入口墨青纸感换装守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Profile 主入口墨青纸感换装范围与入口保持符合预期\n')
