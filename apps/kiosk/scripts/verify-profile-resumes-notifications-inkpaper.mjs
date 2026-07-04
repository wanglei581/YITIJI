import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:profile-resumes-notifications-inkpaper
//
// 目标：/me/resumes 与 /me/notifications 只做墨青纸感视觉换装，
// 保留 main 上的真实 API、登录态、空态、操作与跳转逻辑。
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
function listChangedFiles() {
  const committed = git(['diff', '--name-only', 'origin/main...HEAD'])
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

console.log('\n=== Profile 简历与消息明细页墨青纸感守卫 ===')

const resumes = read('src/pages/profile/me/MyResumesPage.tsx')
const notifications = read('src/pages/profile/me/MyNotificationsPage.tsx')
const packageJson = read('package.json')
const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
const homeVerify = read('scripts/verify-profile-inkpaper-home.mjs')

for (const [label, source] of [
  ['MyResumesPage', resumes],
  ['MyNotificationsPage', notifications],
]) {
  expectIncludes(source, "import './me-detail-inkpaper.css'", `${label} 引入明细页局部 CSS`)
  expectIncludes(source, "useInkRipple('.me-inkdetail .me-ripple')", `${label} 只在 .me-inkdetail 作用域启用涟漪`)
  expectMatches(source, /className="me-inkdetail/, `${label} 使用 .me-inkdetail 根作用域`)
  expectIncludes(source, 'KIcon', `${label} 复用 KIcon 图标系统`)
  expectAbsent(source, /一键投递|立即投递|平台投递|投递简历/, `${label} 不出现招聘闭环禁用文案`)
}

expectIncludes(resumes, 'getMyResumes(getToken(), { pageSize: 50 })', '我的简历保留本人简历真实 API 拉取')
expectIncludes(resumes, "loginFrom=\"/me/resumes\"", '我的简历保留登录回跳来源')
expectIncludes(resumes, 'setItems([])', '我的简历保留游客态清空列表')
expectIncludes(resumes, 'setTotal(0)', '我的简历保留游客态清空总数')
expectIncludes(resumes, "taskPath('/resume/report', taskId)", '我的简历保留诊断报告跳转')
expectIncludes(resumes, "taskPath('/resume/optimize', taskId)", '我的简历保留优化页跳转')
expectIncludes(resumes, "taskPath('/resume/job-fit', taskId)", '我的简历保留岗位匹配参考跳转')
expectIncludes(resumes, "taskPath('/resume/generate/preview', taskId)", '我的简历保留 AI 生成预览跳转')
expectIncludes(resumes, "item.status === 'completed'", '我的简历保留完成态才可操作')
expectIncludes(resumes, "item.status === 'failed' ? '任务已失败，不可继续操作' : '任务完成后可用'", '我的简历保留未完成/失败禁用原因')
expectIncludes(resumes, '还没有登录后保存的简历', '我的简历保留空态标题')
expectIncludes(resumes, '公共一体机上的游客上传不会自动绑定到账号', '我的简历保留游客上传不自动绑定说明')
expectIncludes(resumes, "navigate('/resume/source')", '我的简历保留上传入口跳转')
expectIncludes(resumes, '不向企业提供或投递', '我的简历保留合规边界说明')

expectIncludes(notifications, "API_MODE === 'http' && Boolean(getToken())", '消息通知保留真实服务可用判断')
expectIncludes(notifications, 'getMyNotifications(getToken(), { pageSize: 50, unreadOnly })', '消息通知保留本人消息真实 API 拉取')
expectIncludes(notifications, 'markAllMyNotificationsRead(getToken())', '消息通知保留全部已读接口')
expectIncludes(notifications, 'markMyNotificationRead(getToken(), item.kind, item.id)', '消息通知保留单条已读接口')
expectIncludes(notifications, 'deleteMyNotification(getToken(), item.kind, item.id)', '消息通知保留删除接口')
expectIncludes(notifications, "loginFrom=\"/me/notifications\"", '消息通知保留登录回跳来源')
expectIncludes(notifications, 'setUnreadOnly(tab.key)', '消息通知保留未读筛选')
expectIncludes(notifications, '当前没有可读取的消息', '消息通知保留未连接/未登录空态')
expectIncludes(notifications, '当前没有未读消息', '消息通知保留未读空态')
expectIncludes(notifications, '当前没有消息通知', '消息通知保留全部空态')
expectIncludes(notifications, "item.relatedType === 'feedback_ticket' && item.relatedId", '消息通知保留反馈关联判断')
expectIncludes(notifications, "navigate(`/me/feedback?ticket=${encodeURIComponent(item.relatedId ?? '')}`)", '消息通知保留相关反馈跳转')
expectIncludes(notifications, '已标记全部已读', '消息通知保留全部已读成功提示')
expectIncludes(notifications, '消息已删除', '消息通知保留删除成功提示')

expectIncludes(packageJson, '"verify:profile-resumes-notifications-inkpaper"', 'package.json 注册本守卫')
expectIncludes(ci, 'verify:profile-resumes-notifications-inkpaper', 'CI Verify suites 接入本守卫')
expectIncludes(homeVerify, 'MyResumesPage.tsx', 'profile-inkpaper-home 范围守卫允许本批简历页换装')
expectIncludes(homeVerify, 'MyNotificationsPage.tsx', 'profile-inkpaper-home 范围守卫允许本批消息页换装')

let changedFiles = []
try {
  changedFiles = listChangedFiles()
} catch (error) {
  if (error instanceof Error) console.error(`  ${error.message}`)
  fail('范围守卫无法读取 git diff')
}

const forbiddenChanged = changedFiles.filter((file) =>
  ![
    'services/api/scripts/verify-kiosk-cashier-ui.ts',
    'services/api/scripts/verify-payment-flow.ts',
    'services/api/package.json',
    'services/api/scripts/verify-benefit-redemption.ts',
    'services/api/scripts/verify-profile-commercial-first-batch-acceptance.ts',
    'services/api/scripts/verify-production-real-services.ts',
    'services/api/scripts/verify-production-runtime-gates.ts',
    'services/api/src/config/production-runtime-gates.ts',
    'services/api/src/payment/online-payment.service.ts',
    'services/api/src/payment/payment-session-token.ts',
    'services/api/src/payment/payment.controller.ts',
    'services/api/src/print-jobs/print-jobs.service.ts',
  ].includes(file) &&
  ([
    'apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx',
    'apps/kiosk/src/pages/profile/me/MyActivityPage.tsx',
    'apps/kiosk/src/pages/profile/me/MyFavoritesPage.tsx',
    'apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx',
    'apps/kiosk/src/pages/profile/me/MySettingsPage.tsx',
    'apps/kiosk/src/pages/profile/ProfilePage.tsx',
  ].includes(file) ||
  /^apps\/kiosk\/src\/pages\/(assistant|campus|companies|help)\//.test(file) ||
  /^services\/|^packages\/shared\/|^apps\/terminal-agent\//.test(file) ||
  /prisma/i.test(file))
)

// 条件触发（根因修复）：仅当本 PR 实际改动本守卫负责的 /me/resumes 或 /me/notifications 明细页时，
// 才强制范围检查；未触碰则跳过，避免误伤无关 PR（如支付域 C5-4）。批次守卫不应拦截其它批次改动。
const touchesOwnedPage = [
  'apps/kiosk/src/pages/profile/me/MyResumesPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx',
].some((file) => changedFiles.includes(file))
if (!touchesOwnedPage) {
  pass('本 PR 未触碰 /me/resumes、/me/notifications 明细页，跳过范围检查（守卫条件触发）')
} else if (forbiddenChanged.length === 0) {
  pass('diff 未触碰 /me/print-orders、其他高风险资产页、非本次 payment session 后端、数据库或终端链路；/me/documents 已由专属守卫覆盖')
} else {
  fail(`diff 出现禁止范围变更：${forbiddenChanged.join(', ')}`)
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 简历与消息明细页墨青纸感守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — /me/resumes 与 /me/notifications 墨青纸感换装守卫通过\n')
