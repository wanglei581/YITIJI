import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:profile-inkpaper-home — 「我的」主入口 + 低风险明细页墨青纸感守卫
//
// 目标：
// 1. ProfilePage 主入口继续保持已合入的墨青纸感结构，不回退；
// 2. 允许 /me/settings、/me/benefits、/me/favorites、/me/ai-records 做已守卫的低风险视觉换装；
// 3. 允许 /me/activity 做已守卫的低风险视觉换装；
// 4. 允许已确认的 /me/print-orders 状态自动刷新小步；
// 5. /me/documents 和未声明的 /me/print-orders 子模块不能被本守卫覆盖。
// ============================================================

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
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
function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
function canResolveGitRef(ref) {
  try {
    git(['rev-parse', '--verify', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}
function fetchRemoteBaseRef(baseRef) {
  git(['fetch', '--no-tags', '--depth=1', 'origin', `${baseRef}:refs/remotes/origin/${baseRef}`])
}
function canResolveMergeBase(baseRef) {
  try {
    git(['merge-base', baseRef, 'HEAD'])
    return true
  } catch {
    return false
  }
}
function ensureMergeBase(baseRef) {
  if (canResolveMergeBase(baseRef)) {
    return
  }

  git(['fetch', '--no-tags', '--deepen=50', 'origin'])
  if (!canResolveMergeBase(baseRef)) {
    throw new Error(`无法解析 ${baseRef}...HEAD 的 merge-base`)
  }
}
function resolveDiffBase() {
  const githubBaseRef = process.env.GITHUB_BASE_REF?.trim()
  if (githubBaseRef) {
    const githubBase = `origin/${githubBaseRef}`
    if (!canResolveGitRef(githubBase)) {
      fetchRemoteBaseRef(githubBaseRef)
    }
    if (canResolveGitRef(githubBase)) {
      return githubBase
    }
  }

  if (canResolveGitRef('origin/main')) {
    return 'origin/main'
  }

  throw new Error('无法解析 diff base：origin/main 不存在，且 GITHUB_BASE_REF 未提供或无法获取')
}
function listChangedFiles() {
  const diffBase = resolveDiffBase()
  ensureMergeBase(diffBase)
  const committed = git(['diff', '--name-only', `${diffBase}...HEAD`])
    .split('\n')
    .filter(Boolean)
  const unstaged = git(['diff', '--name-only'])
    .split('\n')
    .filter(Boolean)
  const staged = git(['diff', '--cached', '--name-only'])
    .split('\n')
    .filter(Boolean)
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)

  return [...new Set([...committed, ...unstaged, ...staged, ...untracked])]
}

console.log('\n=== Profile 主入口墨青纸感换装守卫 ===')

const profile = read('src/pages/profile/ProfilePage.tsx')
const header = read('src/pages/profile/components/ProfileHeader.tsx')
const section = read('src/pages/profile/components/ProfileEntrySection.tsx')
const entries = read('src/pages/profile/profileEntries.ts')
const types = read('src/pages/profile/profileTypes.ts')
const css = read('src/pages/profile/profile-inkpaper.css')
const detailCss = read('src/pages/profile/me/me-detail-inkpaper.css')
const routes = read('src/routes/index.tsx')
const favoritesPage = read('src/pages/profile/me/MyFavoritesPage.tsx')
const benefitsPage = read('src/pages/profile/me/MyBenefitsPage.tsx')
const settingsPage = read('src/pages/profile/me/MySettingsPage.tsx')
const aiRecordsPage = read('src/pages/profile/me/MyAiRecordsPage.tsx')
const jobAiRecords = read('src/pages/profile/me/JobAiSessionRecords.tsx')
const activityPage = read('src/pages/profile/me/MyActivityPage.tsx')
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

// 4) 三个低风险明细页必须只做局部视觉换装，保留真实路由、真实能力与诚实空态。
for (const [route, element] of [
  ['me/favorites', 'MyFavoritesPage'],
  ['me/benefits', 'MyBenefitsPage'],
  ['me/settings', 'MySettingsPage'],
]) {
  expectMatches(
    routes,
    new RegExp(`path:\\s*'${route}'[\\s\\S]{0,80}?element:\\s*<${element}\\s*/>`),
    `目标路由存在：/${route} -> ${element}`,
  )
}

for (const [label, source] of [
  ['MyFavoritesPage', favoritesPage],
  ['MyBenefitsPage', benefitsPage],
  ['MySettingsPage', settingsPage],
]) {
  expectIncludes(source, "import './me-detail-inkpaper.css'", `${label} 引入明细页局部 CSS`)
  expectIncludes(source, "useInkRipple('.me-inkdetail", `${label} 只在 .me-inkdetail 作用域启用涟漪`)
  expectMatches(source, /className="me-inkdetail/, `${label} 使用 .me-inkdetail 根作用域`)
  expectIncludes(source, 'KIcon', `${label} 复用 KIcon 图标系统`)
}

expectMatches(detailCss, /\.me-inkdetail\s*\{[\s\S]*--paper:\s*#f4f1e8/, '明细页 CSS 定义米纸底色变量')
expectMatches(detailCss, /\.me-inkdetail::before/, '明细页 CSS 使用局部纸纹层')
expectMatches(detailCss, /\.me-inkdetail \.k-ripple/, '明细页 CSS 定义局部墨水涟漪')
expectAbsent(detailCss, /\.kprofile|\.khome|\.kassistant|\.kcampus/, '明细页 CSS 不污染其他墨青页面作用域')

expectIncludes(favoritesPage, "loginFrom=\"/me/favorites\"", '我的收藏保留登录回跳来源')
expectIncludes(favoritesPage, "return `/jobs/${item.targetId}`", '我的收藏保留岗位详情跳转')
expectIncludes(favoritesPage, "return `/job-fairs/${item.targetId}`", '我的收藏保留招聘会详情跳转')
expectIncludes(favoritesPage, "return '/renshi'", '我的收藏保留政策入口跳转')
expectIncludes(favoritesPage, '还没有收藏', '我的收藏保留空态标题')
expectIncludes(favoritesPage, '在岗位 / 招聘会 / 政策详情页点收藏', '我的收藏保留空态说明')

expectIncludes(benefitsPage, "getMyBenefits(getToken(), { pageSize: 50 })", '我的权益保留真实 API 拉取')
expectIncludes(benefitsPage, '还没有权益', '我的权益保留空态标题')
expectIncludes(benefitsPage, '政策资格提示只提供信息指引，具体办理与结果以官方平台为准', '我的权益保留政策合规说明')
expectAbsent(benefitsPage, /立即支付|去支付|确认核销|核销成功|办理成功/, '我的权益不新增支付/核销/办理结果口径')

expectIncludes(settingsPage, 'getJobAiConsentStatus', '账号设置保留岗位 AI 授权状态查询')
expectIncludes(settingsPage, 'revokeJobAiConsent', '账号设置保留撤回岗位 AI 授权能力')
expectIncludes(settingsPage, '手机号登录', '账号设置保留游客登录按钮')
expectIncludes(settingsPage, '公共终端会话说明', '账号设置保留公共终端会话说明')
expectIncludes(settingsPage, '退出登录', '账号设置保留退出登录操作')
expectIncludes(settingsPage, '昵称修改、手机号换绑、账号注销等功能暂未开放', '账号设置保留未开放能力说明')

expectIncludes(aiRecordsPage, "import './me-detail-inkpaper.css'", 'AI服务记录引入明细页局部 CSS')
expectIncludes(aiRecordsPage, "useInkRipple('.me-inkdetail", 'AI服务记录只在 .me-inkdetail 作用域启用涟漪')
expectMatches(aiRecordsPage, /className="me-inkdetail/, 'AI服务记录使用 .me-inkdetail 根作用域')
expectIncludes(aiRecordsPage, 'deleteMyAiRecord', 'AI服务记录保留本人 AI 记录删除接口')
expectIncludes(jobAiRecords, '删除岗位 AI 参考记录', '岗位 AI 参考记录保留删除操作文案')

expectIncludes(activityPage, "import './me-detail-inkpaper.css'", '浏览与跳转记录引入明细页局部 CSS')
expectIncludes(activityPage, "useInkRipple('.me-inkdetail", '浏览与跳转记录只在 .me-inkdetail 作用域启用涟漪')
expectMatches(activityPage, /className="me-inkdetail/, '浏览与跳转记录使用 .me-inkdetail 根作用域')
expectIncludes(activityPage, 'getMyBrowseLogs', '浏览与跳转记录保留浏览记录真实 API 拉取')
expectIncludes(activityPage, 'getMyJumpLogs', '浏览与跳转记录保留外部跳转真实 API 拉取')
expectIncludes(activityPage, '投递 / 预约结果以来源平台为准，本系统不记录', '浏览与跳转记录保留投递/预约边界文案')

// 5) Diff 范围守卫：只允许本守卫覆盖的低风险明细换装文件 + 打印订单状态自动刷新小步文件。
let changedFiles = []
try {
  changedFiles = listChangedFiles()
} catch (error) {
  changedFiles = ['<git-scope-unavailable>']
  if (error instanceof Error) {
    console.error(`  ${error.message}`)
  }
  fail('范围守卫无法比对 origin/main 或读取未跟踪文件，禁止静默通过')
}
const allowedLowRiskInkpaperChanged = new Set([
  'apps/kiosk/src/pages/profile/me/MyFavoritesPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MySettingsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx',
  'apps/kiosk/src/pages/profile/me/JobAiSessionRecords.tsx',
  'apps/kiosk/src/pages/profile/me/MyActivityPage.tsx',
  'apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css',
  'apps/kiosk/scripts/verify-profile-inkpaper-home.mjs',
  'apps/kiosk/scripts/verify-profile-ai-records-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-activity-inkpaper.mjs',
])
const allowedPrintOrderRefreshChanged = new Set([
  'apps/kiosk/scripts/verify-member-print-orders-ui.mjs',
  'apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx',
  'apps/kiosk/src/pages/profile/me/printOrders/statusRefresh.ts',
  'docs/product/user-data-flow-matrix.md',
  'docs/progress/current-progress.md',
  'docs/progress/next-tasks.md',
  'docs/superpowers/plans/2026-07-04-print-status-tracking-ui.md',
])
const allowedChanged = new Set([...allowedLowRiskInkpaperChanged, ...allowedPrintOrderRefreshChanged])
const profileRelatedChanged = changedFiles.filter(
  (file) =>
    file.startsWith('apps/kiosk/src/pages/profile/') ||
    file === 'apps/kiosk/scripts/verify-profile-inkpaper-home.mjs',
)
const unexpectedChanged = profileRelatedChanged.filter((file) => !allowedChanged.has(file))
if (unexpectedChanged.length === 0) {
  pass('Profile 相关 diff 仅修改低风险明细页、打印订单状态刷新小步与对应局部守卫')
} else {
  fail(`Profile 相关 diff 出现范围外变更：${unexpectedChanged.join(', ')}`)
}

const forbiddenMeChanged = changedFiles.filter((file) => {
  if (/^apps\/kiosk\/src\/pages\/profile\/me\/MyDocumentsPage/.test(file)) {
    return true
  }
  if (file === 'apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx') {
    return !allowedPrintOrderRefreshChanged.has(file)
  }
  if (/^apps\/kiosk\/src\/pages\/profile\/me\/printOrders\//.test(file)) {
    return !allowedPrintOrderRefreshChanged.has(file)
  }
  return false
})
if (forbiddenMeChanged.length === 0) {
  pass('本批未触碰 /me/documents，且 /me/print-orders 仅限状态刷新小步')
} else {
  fail(`本批禁止触碰未声明的高风险 /me 明细页：${forbiddenMeChanged.join(', ')}`)
}

const forbiddenProfileChanged = changedFiles.filter((file) =>
  /^apps\/kiosk\/src\/pages\/profile\/(ProfilePage|profileEntries|profile-inkpaper|components\/Profile)/.test(file),
)
if (forbiddenProfileChanged.length === 0) {
  pass('本批未触碰 ProfilePage 主入口及其已合入换装文件')
} else {
  fail(`本批禁止触碰 ProfilePage 主入口：${forbiddenProfileChanged.join(', ')}`)
}

// 6) 不能引入旧 MyPrintOrdersPage 的回退口径。
const printOrders = read('src/pages/profile/me/MyPrintOrdersPage.tsx')
expectIncludes(printOrders, 'OrderPaymentSummary', 'MyPrintOrdersPage 仍引用订单详单组件')
expectIncludes(printOrders, 'paymentLine', 'MyPrintOrdersPage 仍展示支付概要')
expectIncludes(printOrders, 'nextCursor', 'MyPrintOrdersPage 仍保留游标分页')
expectIncludes(printOrders, '取件码', 'MyPrintOrdersPage 仍保留取件码提示')

// 7) package.json 注册本守卫。
expectIncludes(packageJson, '"verify:profile-inkpaper-home"', 'package.json 注册 verify:profile-inkpaper-home')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — Profile 主入口墨青纸感换装守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Profile 主入口、低风险 /me 明细页与打印订单状态刷新小步范围保持符合预期\n')
