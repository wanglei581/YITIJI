import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:profile-feedback-inkpaper
//
// 目标：/me/feedback 先拆分再迁移墨青纸感视觉，
// 保留反馈提交 / 列表 / 详情 / 回复 / 关闭 / 打印订单关联能力。
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

console.log('\n=== Profile 意见反馈页墨青纸感守卫 ===')

const page = read('src/pages/profile/me/MyFeedbackPage.tsx')
const formPanel = read('src/pages/profile/me/feedback/FeedbackFormPanel.tsx')
const listPanel = read('src/pages/profile/me/feedback/FeedbackListPanel.tsx')
const detailPanel = read('src/pages/profile/me/feedback/FeedbackDetailPanel.tsx')
const types = read('src/pages/profile/me/feedback/types.ts')
const packageJson = read('package.json')
const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
const homeVerify = read('scripts/verify-profile-inkpaper-home.mjs')

expectIncludes(page, "import './me-detail-inkpaper.css'", 'MyFeedbackPage 引入明细页局部 CSS')
expectIncludes(page, "useInkRipple('.me-inkdetail .me-ripple')", 'MyFeedbackPage 只在 .me-inkdetail 作用域启用涟漪')
expectMatches(page, /className="me-inkdetail me-inkdetail-feedback/, 'MyFeedbackPage 使用独立 me-inkdetail-feedback 根作用域')
expectIncludes(page, 'KIcon', 'MyFeedbackPage 复用 KIcon 图标系统')

expectIncludes(page, 'getMyFeedback(getToken(), { pageSize: 50 })', '意见反馈保留本人反馈真实列表 API')
expectIncludes(page, 'getMyFeedbackDetail(getToken(), selectedId)', '意见反馈保留 query ticket 详情拉取')
expectIncludes(page, 'getMyFeedbackDetail(getToken(), id)', '意见反馈保留点击列表读取详情')
expectIncludes(page, 'createMyFeedback(getToken(), {', '意见反馈保留创建反馈 API')
expectIncludes(page, "category: relatedPrintTaskId ? 'print' : form.category", '关联打印订单时创建反馈固定 print 分类')
expectIncludes(page, 'relatedPrintTaskId: relatedPrintTaskId || undefined', '创建反馈保留 relatedPrintTaskId 透传')
expectIncludes(page, 'addMyFeedbackReply(getToken(), selected.id, content)', '意见反馈保留追加描述 API')
expectIncludes(page, 'closeMyFeedback(getToken(), selected.id)', '意见反馈保留关闭反馈 API')
expectIncludes(page, "MemberFeedbackApiError && error.code === 'FEEDBACK_PRINT_TASK_INVALID'", '意见反馈保留关联打印订单错误提示')
expectIncludes(page, 'setSearchParams({ ticket: detail.id })', '提交反馈后保留 ticket 深链')
expectIncludes(page, 'setSearchParams({ ticket: id })', '打开详情后保留 ticket 深链')
expectIncludes(page, "loginFrom=\"/me/feedback\"", '意见反馈保留登录回跳来源')
expectIncludes(page, 'setItems([])', '意见反馈保留游客态清空列表')
expectIncludes(page, 'setSelected(null)', '意见反馈保留游客态清空详情')
expectIncludes(page, 'parseFeedbackCategory(searchParams.get', '意见反馈保留 category 查询参数解析')

expectIncludes(formPanel, 'disabled={Boolean(relatedPrintTaskId)}', '反馈表单保留打印订单关联时分类禁用')
expectIncludes(formPanel, '关联打印订单时固定为打印服务', '反馈表单保留打印订单关联说明')
expectIncludes(formPanel, 'maxLength={11}', '反馈表单保留联系电话长度限制')
expectIncludes(formPanel, 'maxLength={80}', '反馈表单保留标题长度限制')
expectIncludes(formPanel, 'maxLength={500}', '反馈表单保留反馈内容长度限制')
expectIncludes(formPanel, '提交反馈', '反馈表单保留提交按钮')
expectIncludes(formPanel, 'KIcon name="send"', '反馈表单使用 KIcon 发送图标')

expectIncludes(listPanel, 'formatTime(item.updatedAt)', '反馈列表保留更新时间展示')
expectIncludes(listPanel, 'selected?.id === item.id || selectedId === item.id', '反馈列表保留当前详情高亮逻辑')
expectIncludes(listPanel, 'onOpen(item.id)', '反馈列表保留点击打开详情')
expectIncludes(listPanel, '还没有反馈记录', '反馈列表保留空态标题')

expectIncludes(detailPanel, "detail.status !== 'closed'", '反馈详情保留关闭态禁止继续写入')
expectIncludes(detailPanel, 'detail.replies.length === 0', '反馈详情保留无沟通记录空态')
expectIncludes(detailPanel, 'onReplyChange(event.target.value)', '反馈详情保留补充描述输入')
expectIncludes(detailPanel, 'onAddReply', '反馈详情保留追加描述操作')
expectIncludes(detailPanel, 'onClose', '反馈详情保留关闭反馈操作')
expectIncludes(detailPanel, '我的补充', '反馈详情保留用户补充文案')
expectIncludes(detailPanel, '服务回复', '反馈详情保留服务回复文案')

expectIncludes(types, "device', label: '设备使用'", '反馈分类保留设备使用')
expectIncludes(types, "print', label: '打印服务'", '反馈分类保留打印服务')
expectIncludes(types, "file_process', label: '文件处理'", '反馈分类保留文件处理')
expectIncludes(types, "general', label: '一般建议'", '反馈分类保留一般建议')
expectIncludes(types, "pending: { label: '已提交'", '反馈状态保留已提交')
expectIncludes(types, "processing: { label: '处理中'", '反馈状态保留处理中')
expectIncludes(types, "replied: { label: '已回复'", '反馈状态保留已回复')
expectIncludes(types, "closed: { label: '已关闭'", '反馈状态保留已关闭')
expectIncludes(types, 'parseFeedbackCategory', '反馈保留 category 查询参数白名单解析')

for (const [label, source] of [
  ['MyFeedbackPage', page],
  ['FeedbackFormPanel', formPanel],
  ['FeedbackListPanel', listPanel],
  ['FeedbackDetailPanel', detailPanel],
  ['feedback/types', types],
]) {
  expectAbsent(source, /一键投递|立即投递|平台投递|投递简历/, `${label} 不出现招聘闭环禁用文案`)
}

expectIncludes(packageJson, '"verify:profile-feedback-inkpaper"', 'package.json 注册本守卫')
expectIncludes(ci, 'verify:profile-feedback-inkpaper', 'CI Verify suites 接入本守卫')
expectIncludes(homeVerify, 'MyFeedbackPage.tsx', 'profile-inkpaper-home 范围守卫允许本批反馈页换装')
expectIncludes(homeVerify, 'src/pages/profile/me/feedback/', 'profile-inkpaper-home 范围守卫允许反馈页子组件')

let changedFiles = []
try {
  changedFiles = listChangedFiles()
} catch (error) {
  if (error instanceof Error) console.error(`  ${error.message}`)
  fail('范围守卫无法读取 git diff')
}

const forbiddenChanged = changedFiles.filter((file) =>
  [
    'apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx',
    'apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx',
    'apps/kiosk/src/pages/profile/me/MyActivityPage.tsx',
    'apps/kiosk/src/pages/profile/me/MyFavoritesPage.tsx',
    'apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx',
    'apps/kiosk/src/pages/profile/me/MySettingsPage.tsx',
    'apps/kiosk/src/pages/profile/me/MyResumesPage.tsx',
    'apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx',
    'apps/kiosk/src/pages/profile/ProfilePage.tsx',
  ].includes(file) ||
  /^apps\/kiosk\/src\/pages\/profile\/me\/printOrders\//.test(file) ||
  /^apps\/kiosk\/src\/pages\/(assistant|campus|companies|help)\//.test(file) ||
  /^services\/|^packages\/shared\/|^apps\/terminal-agent\//.test(file) ||
  /prisma/i.test(file)
)

if (forbiddenChanged.length === 0) {
  pass('diff 未触碰 /me/print-orders、其他已换装明细页、后端、数据库或终端链路；/me/documents 已由专属守卫覆盖')
} else {
  fail(`diff 出现禁止范围变更：${forbiddenChanged.join(', ')}`)
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 意见反馈页墨青纸感守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — /me/feedback 拆分与墨青纸感换装守卫通过\n')
