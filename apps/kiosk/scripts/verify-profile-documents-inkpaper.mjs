import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:profile-documents-inkpaper
//
// 目标：/me/documents 只做墨青纸感视觉换装，
// 保留短期签名 URL、打印确认、删除、保存期限和错误提示真实链路。
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

console.log('\n=== Profile 我的文档页墨青纸感守卫 ===')

const page = read('src/pages/profile/me/MyDocumentsPage.tsx')
const css = read('src/pages/profile/me/me-detail-inkpaper.css')
const routes = read('src/routes/index.tsx')
const packageJson = read('package.json')
const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
const homeVerify = read('scripts/verify-profile-inkpaper-home.mjs')
const feedbackVerify = read('scripts/verify-profile-feedback-inkpaper.mjs')
const resumesVerify = read('scripts/verify-profile-resumes-notifications-inkpaper.mjs')

expectIncludes(page, "import './me-detail-inkpaper.css'", 'MyDocumentsPage 引入明细页局部 CSS')
expectIncludes(page, "useInkRipple('.me-inkdetail .me-ripple')", 'MyDocumentsPage 只在 .me-inkdetail 作用域启用涟漪')
expectMatches(page, /className="me-inkdetail me-inkdetail-documents h-full"/, 'MyDocumentsPage 使用独立 me-inkdetail-documents 根作用域')
expectIncludes(page, 'KIcon', 'MyDocumentsPage 复用 KIcon 图标系统')
expectIncludes(css, '.me-inkdetail-documents .me-document-card', '明细页 CSS 提供文档卡片独立作用域样式')
expectIncludes(css, '.me-inkdetail-documents .me-doc-actions', '明细页 CSS 提供文档操作区独立作用域样式')
expectIncludes(css, '.me-retention-dialog', '明细页 CSS 提供保存期限确认弹层样式')
expectAbsent(css, /\.kprofile|\.khome|\.kassistant|\.kcampus/, '文档页样式不污染其他墨青页面作用域')

expectMatches(routes, /path:\s*'me\/documents'[\s\S]{0,80}?element:\s*<MyDocumentsPage\s*\/>/, '路由仍指向 /me/documents -> MyDocumentsPage')
expectIncludes(page, 'getMyDocuments(getToken(), { pageSize: 50 })', '我的文档保留本人文档真实 API 拉取')
expectIncludes(page, "loginFrom=\"/me/documents\"", '我的文档保留登录回跳来源')
expectIncludes(page, 'setItems([])', '我的文档保留游客态清空列表')
expectIncludes(page, 'fetchAccessUrl(doc.previewUrlPath, token)', '我的文档查看/打印保留短期签名 URL 现取现用')
expectMatches(page, /fetchAccessUrl\(doc\.previewUrlPath,\s*token\)[\s\S]{0,180}?window\.open\(res\.url,\s*'_blank',\s*'noopener'\)/, '查看文档保留短期 URL 新窗口打开')
expectMatches(
  page,
  /navigate\('\/print\/confirm'[\s\S]*?fileUrl:\s*res\.url[\s\S]*?mimeType:\s*doc\.mimeType[\s\S]*?makePrintParams\(\{\s*copies:\s*1,\s*duplex:\s*'single',\s*color:\s*'bw'\s*\}\)/,
  '打印文档保留 /print/confirm state 结构和默认打印参数',
)
expectIncludes(page, "doc.mimeType === 'application/pdf' || doc.mimeType === 'image/jpeg' || doc.mimeType === 'image/png'", '我的文档保留可打印 MIME 白名单')
expectIncludes(page, '该文件格式暂不支持打印', '我的文档保留不可打印格式说明')

expectIncludes(page, 'deleteMyDocument(token, doc.id)', '我的文档保留本人删除 API')
expectIncludes(page, 'confirmId !== doc.id', '我的文档保留两步删除确认状态')
expectIncludes(page, '再次点击确认删除', '我的文档保留二次确认删除文案')
expectIncludes(page, 'setItems((prev) => prev.filter((item) => item.id !== doc.id))', '删除成功后保留本地列表移除')

expectIncludes(page, 'updateMyDocumentRetention(token, doc.id, policy)', '我的文档保留保存期限更新 API')
expectIncludes(page, 'allowedRetentionPolicies', '我的文档保留后端允许策略驱动选项')
expectIncludes(page, 'needsRetentionConsent(policy)', '我的文档保留 6 个月/长期保存确认门槛')
expectIncludes(page, '同意并保存', '我的文档保留保存期限确认按钮')
expectIncludes(page, 'error instanceof MemberAssetsApiError', '我的文档保留后端可读错误透出')
expectIncludes(page, '保存期限已更新', '我的文档保留保存期限成功提示')
expectIncludes(page, 'const isAnyPending = Boolean(opening || printingId || busyId || retentionBusy)', '我的文档保留异步互斥锁')
expectIncludes(page, 'disabled={viewDisabled}', '查看按钮保留禁用态')
expectIncludes(page, 'disabled={printDisabled}', '打印按钮保留禁用态')
expectIncludes(page, 'disabled={deleteDisabled}', '删除按钮保留禁用态')

expectIncludes(page, 'role="dialog"', '保存期限确认弹层保留 dialog 语义')
expectIncludes(page, 'aria-modal="true"', '保存期限确认弹层保留 aria-modal')
expectIncludes(page, '还没有文档', '我的文档保留空态标题')
expectIncludes(page, '保存简历 / 打印材料等文档后，这里会显示你的文档记录', '我的文档保留空态说明')
expectIncludes(page, '访问链接短期有效', '我的文档保留短期访问链接合规说明')
expectIncludes(page, '原始简历/求职材料默认 90 天', '我的文档保留默认保存期限说明')

for (const [label, source] of [
  ['MyDocumentsPage', page],
  ['me-detail-inkpaper.css', css],
]) {
  expectAbsent(source, /一键投递|立即投递|平台投递|投递简历/, `${label} 不出现招聘闭环禁用文案`)
  expectAbsent(source, /立即支付|去支付|确认核销|核销成功|办理成功/, `${label} 不新增支付/核销/办理结果口径`)
}

expectIncludes(packageJson, '"verify:profile-documents-inkpaper"', 'package.json 注册本守卫')
expectIncludes(ci, 'verify:profile-documents-inkpaper', 'CI Verify suites 接入本守卫')
expectIncludes(homeVerify, 'MyDocumentsPage.tsx', 'profile-inkpaper-home 范围守卫允许文档页换装')
expectIncludes(homeVerify, '/me/documents 已由专属守卫覆盖', 'profile-inkpaper-home 不再把文档页视作禁止范围')
expectAbsent(feedbackVerify, /'apps\/kiosk\/src\/pages\/profile\/me\/MyDocumentsPage\.tsx'/, 'feedback 守卫不再拦截文档页专属批次')
expectAbsent(resumesVerify, /'apps\/kiosk\/src\/pages\/profile\/me\/MyDocumentsPage\.tsx'/, 'resumes/notifications 守卫不再拦截文档页专属批次')

let changedFiles = []
try {
  changedFiles = listChangedFiles()
} catch (error) {
  if (error instanceof Error) console.error(`  ${error.message}`)
  fail('范围守卫无法读取 git diff')
}

const allowedChanged = new Set([
  '.env.example',
  '.github/workflows/ci.yml',
  'apps/kiosk/package.json',
  'apps/kiosk/scripts/verify-print-confirm-honest.mjs',
  'apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs',
  'apps/kiosk/scripts/verify-profile-inkpaper-home.mjs',
  'apps/kiosk/scripts/verify-profile-resumes-notifications-inkpaper.mjs',
  'apps/kiosk/scripts/verify-job-material-library-ui.mjs',
  'apps/kiosk/src/pages/print/PrintCashierPage.tsx',
  'apps/kiosk/src/pages/print/PrintConfirmPage.tsx',
  'apps/kiosk/src/pages/print/PrintDonePage.tsx',
  'apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx',
  'apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css',
  'apps/kiosk/src/services/print/paymentApi.ts',
  'apps/kiosk/src/services/print/printJobsApi.ts',
  'docs/progress/current-progress.md',
  'docs/progress/next-tasks.md',
  'docs/superpowers/plans/2026-07-04-profile-commercial-first-batch-execution.md',
  'services/api/scripts/verify-kiosk-cashier-ui.ts',
  'services/api/scripts/verify-payment-flow.ts',
  'services/api/scripts/verify-production-real-services.ts',
  'services/api/scripts/verify-production-runtime-gates.ts',
  'services/api/src/config/production-runtime-gates.ts',
  'services/api/src/payment/online-payment.service.ts',
  'services/api/src/payment/payment-session-token.ts',
  'services/api/src/payment/payment.controller.ts',
  'services/api/src/print-jobs/print-jobs.service.ts',
])

const unexpectedChanged = changedFiles.filter((file) => !allowedChanged.has(file))
if (unexpectedChanged.length === 0) {
  pass('diff 仅触碰文档页换装、局部 CSS、守卫、package、CI 与本次 payment session 精确范围')
} else {
  fail(`diff 出现禁止范围变更：${unexpectedChanged.join(', ')}`)
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 我的文档页墨青纸感守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — /me/documents 墨青纸感换装守卫通过\n')
