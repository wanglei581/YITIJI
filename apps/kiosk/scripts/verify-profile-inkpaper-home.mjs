import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')
const readOptional = (relativePath) => {
  const absolutePath = join(root, relativePath)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}
const readRepo = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8')
const ciWorkflow = readRepo('.github/workflows/ci.yml')

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
  if (canResolveMergeBase(baseRef)) return
  git(['fetch', '--no-tags', '--deepen=50', 'origin'])
  if (!canResolveMergeBase(baseRef)) throw new Error(`无法解析 ${baseRef}...HEAD 的 merge-base`)
}
function resolveDiffBase() {
  const githubBaseRef = process.env.GITHUB_BASE_REF?.trim()
  if (githubBaseRef) {
    const githubBase = `origin/${githubBaseRef}`
    if (!canResolveGitRef(githubBase)) fetchRemoteBaseRef(githubBaseRef)
    if (canResolveGitRef(githubBase)) return githubBase
  }
  if (canResolveGitRef('origin/main')) return 'origin/main'
  throw new Error('无法解析 diff base：origin/main 不存在，且 GITHUB_BASE_REF 未提供或无法获取')
}
function listChangedFiles() {
  const diffBase = resolveDiffBase()
  ensureMergeBase(diffBase)
  const committed = git(['diff', '--name-only', `${diffBase}...HEAD`]).split('\n').filter(Boolean)
  const unstaged = git(['diff', '--name-only']).split('\n').filter(Boolean)
  const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean)
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
  return [...new Set([...committed, ...unstaged, ...staged, ...untracked])]
}
function checkScopedCss(relativePath, source) {
  if (!source) {
    fail(`${relativePath} 已拆分为 Profile 局部样式文件`)
    return
  }
  expectAbsent(source, /(^|\n)\s*(html|body|:root)\b/, `${relativePath} 不污染全局`)
  expectAbsent(source, /\.me-inkdetail\b/, `${relativePath} 不触碰 /me 明细样式`)
  const selectors = [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].trim())
    .filter((selector) => selector && !selector.startsWith('@'))
    .flatMap((selector) => selector.split(',').map((part) => part.trim()))
  if (selectors.every((selector) => selector.startsWith('.kprofile.kprofile-lightflow'))) {
    pass(`${relativePath} 的所有 selector 从 .kprofile.kprofile-lightflow 开始`)
  } else {
    fail(`${relativePath} 存在未从 .kprofile.kprofile-lightflow 开始的 selector`)
  }
}

console.log('\n=== Profile 主入口 LightFlow 与 /me 明细边界守卫 ===')

expectMatches(
  ciWorkflow,
  /uses:\s*actions\/checkout@v4\s*\n\s*with:\s*\n\s*fetch-depth:\s*0/,
  'CI checkout 获取完整 Git 历史，范围守卫可计算 merge-base',
)

const profile = read('src/pages/profile/ProfilePage.tsx')
const header = read('src/pages/profile/components/ProfileHeader.tsx')
const section = read('src/pages/profile/components/ProfileEntrySection.tsx')
const records = read('src/pages/profile/components/ProfileSessionRecords.tsx')
const entries = read('src/pages/profile/profileEntries.ts')
const types = read('src/pages/profile/profileTypes.ts')
const cssEntry = read('src/pages/profile/profile-inkpaper.css')
const profileCssPaths = [
  'src/pages/profile/profile-inkpaper.css',
  'src/pages/profile/profile-lightflow-shell.css',
  'src/pages/profile/profile-lightflow-directory.css',
  'src/pages/profile/profile-lightflow-state.css',
]
const profileCss = profileCssPaths.map(readOptional)
const combinedProfileCss = profileCss.join('\n')
const detailCss = read('src/pages/profile/me/me-detail-inkpaper.css')
const routes = read('src/routes/index.tsx')
const favoritesPage = read('src/pages/profile/me/MyFavoritesPage.tsx')
const benefitsPage = read('src/pages/profile/me/MyBenefitsPage.tsx')
const settingsPage = read('src/pages/profile/me/MySettingsPage.tsx')
const aiRecordsPage = read('src/pages/profile/me/MyAiRecordsPage.tsx')
const jobAiRecords = read('src/pages/profile/me/JobAiSessionRecords.tsx')
const activityPage = read('src/pages/profile/me/MyActivityPage.tsx')
const packageJson = read('package.json')
const lightflowProfileVerify = read('scripts/verify-lightflow-profile-entry.mjs')

// 1) /profile 主入口恢复 4188 独立页面语法，且不再保留 InkPaper 壳层。
expectIncludes(profile, "import './profile-inkpaper.css'", 'ProfilePage 引入局部 profile-inkpaper.css')
expectAbsent(profile, /ReferenceServiceNav|lf-reference-/, 'ProfilePage 移除首页专属导航与服务卡骨架')
expectMatches(profile, /useInkRipple\(\s*'\.kprofile/, 'ProfilePage 只在 .kprofile 作用域启用涟漪')
expectMatches(profile, /className="kprofile kprofile-lightflow"/, 'ProfilePage 外层容器使用局部 LightFlow 根')
expectIncludes(profile, '<h1 className="kprofile-sr-only">我的</h1>', 'ProfilePage 仅保留读屏可见的 我的 标题')
expectMatches(profile, /className="kp-inner"/, 'ProfilePage 使用 .kp-inner 内容宽度容器')
expectIncludes(profile, 'className="kp-service-directory"', 'ProfilePage 使用五区服务目录')
expectIncludes(profile, 'SECTIONS.map((section) =>', 'ProfilePage 数据驱动渲染五个真实区块')
expectAbsent(header, /p-hero|<h[1-6][^>]*>\s*我的\s*<\//, 'ProfileHeader 不再使用 p-hero 或 我的 标题')
expectIncludes(header, 'className="kp-profile-header', 'ProfileHeader 使用开放式身份摘要')
expectIncludes(header, 'className="kp-profile-main"', 'ProfileHeader 保留身份主行')
expectIncludes(header, 'className="kp-profile-boundary"', 'ProfileHeader 展示真实信息边界')
expectIncludes(section, 'className="kp-section"', 'ProfileEntrySection 使用独立信息区块')
expectIncludes(section, 'className="kp-section-head"', 'ProfileEntrySection 使用原型分区标题')
expectIncludes(section, 'className={`kp-entry-grid kp-entry-grid--${section.layout}`}', 'ProfileEntrySection 使用等权入口网格')
expectIncludes(section, "const disabled = entry.tag === '建设中'", 'ProfileEntrySection 仅将建设中入口识别为禁用态')
expectIncludes(section, 'disabled={disabled}', 'ProfileEntrySection 使用原生 disabled 阻止未开放能力办理')
expectAbsent(section, /primaryEntry|lf-reference-/, 'ProfileEntrySection 不再放大首项或复用首页卡骨架')
expectIncludes(records, 'className="kp-session-records"', 'ProfileSessionRecords 使用当前服务记录区块')
expectIncludes(records, 'className="kp-section-head"', 'ProfileSessionRecords 使用当前服务记录分组头')
expectAbsent(`${header}\n${section}\n${records}`, /lf-reference-/, 'Profile 组件完全移除首页服务卡原语')
expectAbsent(section, /sec-head/, 'ProfileEntrySection 不再使用 sec-head 旧骨架')
expectAbsent(combinedProfileCss, /p-hero|sec-head|--paper:|--serif:|#f4f1e8|Noto Serif|Source Han Serif|Songti|SimSun|repeating-linear-gradient/, 'Profile CSS 不回退纸感视觉或旧入口骨架')
expectAbsent(combinedProfileCss, /box-shadow\s*:/, 'Profile CSS 不恢复大型投影')

const expectedCssImports = [
  "@import './profile-lightflow-shell.css';",
  "@import './profile-lightflow-directory.css';",
  "@import './profile-lightflow-state.css';",
].join('\n')
if (cssEntry.trim() === expectedCssImports) pass('profile-inkpaper.css 只保留三份局部样式 import')
else fail('profile-inkpaper.css 必须只保留 shell/directory/state 三份局部样式 import')
for (let index = 0; index < profileCssPaths.length; index += 1) {
  checkScopedCss(profileCssPaths[index], profileCss[index])
}
expectMatches(combinedProfileCss, /\.kprofile\.kprofile-lightflow\s*\{[\s\S]*--lf-canvas:\s*#eaf5ff/, 'CSS 定义冰蓝服务台底色变量')
expectMatches(combinedProfileCss, /\.kprofile\.kprofile-lightflow\s+\.k-ripple/, 'CSS 定义局部点击涟漪')
expectIncludes(combinedProfileCss, 'min-block-size: 56px;', 'Profile CSS 保留 56px 主操作触控高度')
expectIncludes(combinedProfileCss, 'min-block-size: 48px;', 'Profile CSS 保留 48px 次操作触控高度')
expectIncludes(combinedProfileCss, 'min-block-size: 92px;', 'Profile CSS 保留桌面端 92px 等权入口')
expectMatches(combinedProfileCss, /@media\s*\(max-width:\s*520px\)[\s\S]*?\.kprofile\.kprofile-lightflow \.kp-entry-grid[\s\S]*?grid-template-columns:\s*1fr;/, 'Profile CSS 在 520px 收口为单列')
expectAbsent(combinedProfileCss, /lf-reference-/, 'Profile CSS 不保留首页服务卡 selector')

// 2) 入口、route、tag、真实会话和登录行为保持现有合同。
for (const marker of [
  'useAuth()',
  'useMemberProfileOverview(isLoggedIn, getToken)',
  'reserveBannerSpace={isLoggedIn && hasSessionRecords}',
  '<PendingTaskBanner',
  '<ProfileSessionRecords',
  'hasSessionRecords &&',
  "navigate('/me/settings')",
  "navigate('/me/notifications')",
  "navigate('/print/preview'",
]) {
  expectIncludes(profile, marker, `ProfilePage preserves ${marker}`)
}
for (const marker of ['onPrintFile', 'onDeleteResume', 'onDeleteScan', 'onDeleteAiRecord']) {
  expectIncludes(records, marker, `ProfileSessionRecords preserves ${marker}`)
}
expectMatches(types, /EntryLayout\s*=\s*'grid'\s*\|\s*'chips'\s*\|\s*'account'/, 'profileTypes 保留三种原入口布局定义')
expectMatches(types, /KioskIconName/, 'profileTypes 使用 KIcon 图标名')

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
  ['权益活动', '/activities'],
  ['政策补贴指引', '/renshi?tab=policy'],
  ['消息通知', '/me/notifications'],
  ['账号设置', '/me/settings'],
  ['帮助中心', '/help'],
  ['意见反馈', '/me/feedback'],
]
for (const [label, route] of expectedEntries) {
  expectMatches(
    entries,
    new RegExp(`label:\\s*'${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]{0,180}?route:\\s*'${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
    `入口保留：${label} -> ${route}`,
  )
}
expectMatches(entries, /label:\s*'权益活动'[\s\S]{0,180}?route:\s*'\/activities'/, '权益活动只保留真实入口')
expectAbsent(entries, /招聘会扫码凭证|招聘会权益活动|求职打印套餐|AI服务套餐|\/activities\?source=fair/, 'Profile 不展示重复或占位入口')
expectAbsent(entries, /label:\s*'身份切换'/, 'Profile 不重复暴露账号设置入口')
for (const title of ['我的资产', '常用服务', '招聘会与活动', '权益与政策', '账户与支持']) {
  expectMatches(entries, new RegExp(`title:\\s*'${title}'`), `Profile 保留五区边界：${title}`)
}
expectAbsent(entries, /entries:\s*\[\.\.\.FAIRS,\s*\.\.\.BENEFITS\]/, 'Profile 不再合并招聘会与权益服务区')
expectAbsent(entries, /一键投递|立即投递|平台投递|投递简历/, 'Profile 入口不出现招聘闭环禁用文案')

// 3) 三个低风险明细页继续只做局部视觉换装，保留真实路由、真实能力与诚实空态。
for (const [route, element] of [
  ['me/favorites', 'MyFavoritesPage'],
  ['me/benefits', 'MyBenefitsPage'],
  ['me/settings', 'MySettingsPage'],
]) {
  expectMatches(routes, new RegExp(`path:\\s*'${route}'[\\s\\S]{0,80}?element:\\s*<${element}\\s*/>`), `目标路由存在：/${route} -> ${element}`)
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

expectIncludes(favoritesPage, 'loginFrom="/me/favorites"', '我的收藏保留登录回跳来源')
expectIncludes(favoritesPage, 'return `/jobs/${item.targetId}`', '我的收藏保留岗位详情跳转')
expectIncludes(favoritesPage, 'return `/job-fairs/${item.targetId}`', '我的收藏保留招聘会详情跳转')
expectIncludes(favoritesPage, "return '/renshi'", '我的收藏保留政策入口跳转')
expectIncludes(favoritesPage, '还没有收藏', '我的收藏保留空态标题')
expectIncludes(favoritesPage, '在岗位 / 招聘会 / 政策详情页点收藏', '我的收藏保留空态说明')

expectIncludes(benefitsPage, 'getMyBenefits(getToken(), { pageSize: 50 })', '我的权益保留真实 API 拉取')
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

// 4) Diff 范围守卫：本批仅允许批准的 Profile 主入口文件和既有低风险 /me 明细小步文件。
let changedFiles = []
try {
  changedFiles = listChangedFiles()
} catch (error) {
  changedFiles = ['<git-scope-unavailable>']
  if (error instanceof Error) console.error(`  ${error.message}`)
  fail('范围守卫无法比对 origin/main 或读取未跟踪文件，禁止静默通过')
}
const allowedProfileLandingChanged = new Set([
  'apps/kiosk/src/pages/profile/ProfilePage.tsx',
  'apps/kiosk/src/pages/profile/profileEntries.ts',
  'apps/kiosk/src/pages/profile/profile-inkpaper.css',
  'apps/kiosk/src/pages/profile/profile-lightflow-shell.css',
  'apps/kiosk/src/pages/profile/profile-lightflow-directory.css',
  'apps/kiosk/src/pages/profile/profile-lightflow-state.css',
  'apps/kiosk/src/pages/profile/components/ProfileHeader.tsx',
  'apps/kiosk/src/pages/profile/components/ProfileEntrySection.tsx',
  'apps/kiosk/src/pages/profile/components/ProfileSessionRecords.tsx',
  'apps/kiosk/scripts/verify-lightflow-profile-entry.mjs',
  'apps/kiosk/scripts/verify-profile-inkpaper-home.mjs',
])
const allowedLowRiskInkpaperChanged = new Set([
  'apps/kiosk/src/pages/profile/me/MyFavoritesPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MySettingsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx',
  'apps/kiosk/src/pages/profile/me/feedback/FeedbackDetailPanel.tsx',
  'apps/kiosk/src/pages/profile/me/feedback/FeedbackFormPanel.tsx',
  'apps/kiosk/src/pages/profile/me/feedback/FeedbackListPanel.tsx',
  'apps/kiosk/src/pages/profile/me/feedback/types.ts',
  'apps/kiosk/src/pages/profile/me/MyResumesPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx',
  'apps/kiosk/src/pages/profile/me/JobAiSessionRecords.tsx',
  'apps/kiosk/src/pages/profile/me/MyActivityPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx',
  'apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css',
  'apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-ai-records-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-activity-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-resumes-notifications-inkpaper.mjs',
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
const allowedPrintOrdersInkpaperChanged = new Set([
  '.github/workflows/ci.yml',
  'docs/acceptance/member-print-orders-login-smoke.md',
  'apps/kiosk/package.json',
  'apps/kiosk/scripts/verify-profile-print-orders-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-print-orders-login-smoke.mjs',
  'apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-resumes-notifications-inkpaper.mjs',
  'apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx',
  'apps/kiosk/src/pages/profile/me/printOrders/OrderPaymentSummary.tsx',
  'apps/kiosk/src/pages/profile/me/printOrders/PickupCodePanel.tsx',
  'apps/kiosk/src/pages/profile/me/printOrders/__fixtures__/member-print-orders-login-smoke.json',
  'apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css',
])
const allowedChanged = new Set([
  'apps/kiosk/src/layouts/KioskRoot.tsx',
  ...allowedProfileLandingChanged,
  ...allowedLowRiskInkpaperChanged,
  ...allowedPrintOrderRefreshChanged,
  ...allowedPrintOrdersInkpaperChanged,
])
const profileRelatedChanged = changedFiles.filter(
  (file) => file.startsWith('apps/kiosk/src/pages/profile/') || file.startsWith('apps/kiosk/scripts/verify-profile-inkpaper-home'),
)
const unexpectedChanged = profileRelatedChanged.filter((file) => !allowedChanged.has(file))
if (unexpectedChanged.length === 0) pass('Profile 相关 diff 仅修改已批准的 LightFlow 主入口或既有 /me 明细小步与对应守卫')
else fail(`Profile 相关 diff 出现范围外变更：${unexpectedChanged.join(', ')}`)

const delegatesMeBoundary =
  lightflowProfileVerify.includes("path.startsWith('apps/kiosk/src/pages/profile/me/')") &&
  lightflowProfileVerify.includes('forbiddenMeChanges.length === 0') &&
  ciWorkflow.includes('verify:profile-inkpaper-home') &&
  ciWorkflow.includes('verify:lightflow-profile-entry')
if (delegatesMeBoundary) {
  pass('/me/documents 已由专属守卫覆盖，/me/print-orders 已由专属守卫覆盖；LightFlow 本批 /me/* 禁入已委托给同一 CI 中的 verify:lightflow-profile-entry')
} else {
  fail('LightFlow 本批 /me/* 禁入委托缺失或未与 Profile 主守卫共同接入 CI')
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
  console.error(`\n❌ ${failures} 项失败 — Profile 主入口 LightFlow 与 /me 明细边界守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Profile 主入口 LightFlow 与低风险 /me 明细边界保持符合预期\n')
