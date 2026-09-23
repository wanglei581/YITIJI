import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:profile-documents-inkpaper
//
// 目标：/me/documents 的页面/行为合同 —— 青序会员壳结构与旧壳排除，
// 短期签名 URL、打印确认、删除、保存期限、错误提示真实链路、隐私与招聘合规。
// 集成候选的文件范围不归本守卫：由 verify:profile-commercial-first-batch、
// verify:fusion-w5、project graph 与 CI diff 合同负责（见文件末尾退役说明）。
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
function readImportedCss(entryPath, expectedImports, message) {
  const entry = read(entryPath)
  const imports = [...entry.matchAll(/^@import\s+['"]([^'"]+)['"];\s*$/gm)].map((match) => match[1])
  if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
    fail(`${message} — ${entryPath} 的显式 CSS imports 已变化: ${imports.join(' | ')}`)
    return ''
  }
  pass(`${message} — 仅拼接聚合入口显式导入的 CSS`)
  return imports.map((importPath) => read(join(dirname(entryPath), importPath))).join('\n')
}

console.log('\n=== /me/documents 页面/行为合同守卫 ===')

const page = read('src/pages/profile/me/MyDocumentsPage.tsx')
const convertAction = read('src/pages/profile/me/components/DocumentConvertAction.tsx')
const retentionOverlay = read('src/pages/profile/me/components/RetentionConfirmOverlay.tsx')
const css = readImportedCss(
  'src/pages/profile/me/me-detail-inkpaper.css',
  [
    './styles/me-detail-base.css',
    './styles/me-assets.css',
    './styles/me-orders.css',
    './styles/me-records.css',
    './styles/me-settings-feedback.css',
  ],
  '明细页 CSS 聚合入口保持封闭',
)
const routes = read('src/routes/index.tsx')
const packageJson = read('package.json')
const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
const homeVerify = read('scripts/verify-profile-inkpaper-home.mjs')
const feedbackVerify = read('scripts/verify-profile-feedback-inkpaper.mjs')
const resumesVerify = read('scripts/verify-profile-resumes-notifications-inkpaper.mjs')

// 2026-09-23 稿 38-member-assets：本页从墨青纸感（MeListShell + me-detail-inkpaper）迁入青序流光。
// 下面四条原来钉的是墨青纸感的**形状**（局部 CSS 导入、涟漪作用域、根类名、KIcon），
// 迁移后换成青序壳的同位断言；能力与诚实性断言（签名 URL、打印确认、删除、保存期限……）一条不删。
// me-detail-inkpaper.css 聚合入口仍被 /me/settings 使用，封闭性断言保留。
const qxCss = [
  read('src/pages/profile/me/styles/member-records-qx.css'),
  read('src/pages/profile/me/styles/qx-me-shared.css'),
].join('\n')
expectIncludes(page, "import './styles/member-records-qx.css'", 'MyDocumentsPage 引入青序记录页 CSS')
expectMatches(page, /<QxMePage[\s\S]{0,120}?view="documents"/, 'MyDocumentsPage 使用青序会员壳的「我的文档」分域视图')
expectAbsent(page, /MeListShell|me-detail-inkpaper|useInkRipple|me-inkdetail|KioskPageFrame/, 'MyDocumentsPage 已离开墨青纸感 / V6 旧壳')
expectIncludes(qxCss, '.qx-me-asset-item', '青序 CSS 提供文档卡片样式')
expectIncludes(qxCss, '.qx-me-acts', '青序 CSS 提供文档操作区样式')
expectIncludes(qxCss, '.qx-me-assets .me-retention-dialog', '青序 CSS 提供保存期限确认弹层样式')
expectIncludes(qxCss, '.qx-me-asset-overlay', '青序 CSS 提供文档预览弹层样式')
expectAbsent(qxCss, /#[0-9a-fA-F]{3,8}\b/, '青序文档页样式只用 var(--qx-*) 令牌，无裸 hex')
expectAbsent(css, /\.kprofile|\.khome|\.kassistant|\.kcampus/, '文档页样式不污染其他墨青页面作用域')

expectMatches(routes, /path:\s*'me\/documents'[\s\S]{0,80}?element:\s*<MyDocumentsPage\s*\/>/, '路由仍指向 /me/documents -> MyDocumentsPage')
expectIncludes(page, 'getMyDocuments(getToken(), { pageSize: 50 })', '我的文档保留本人文档真实 API 拉取')
// 登录回跳来源：青序壳的底栏由 recordsCtabar 统一生成，loginFrom 是它的第 4 个位置参数；
// 钉住这个位置，再钉 recordsCtabar 确实把它作为 /login 的 from 传出去。
expectMatches(page, /recordsCtabar\(uiState, navigate, \(\) => setReloadKey\(\(k\) => k \+ 1\), '\/me\/documents',/, '我的文档保留登录回跳来源')
expectIncludes(read('src/pages/profile/me/qx/QxMeChrome.tsx'), "navigate('/login', { state: { from: loginFrom } })", '青序会员底栏登录键带回跳来源')
expectIncludes(page, 'setItems([])', '我的文档保留游客态清空列表')
expectIncludes(page, 'fetchAccessUrl(doc.previewUrlPath, token)', '我的文档查看/打印保留短期签名 URL 现取现用')
expectMatches(page, /fetchAccessUrl\(doc\.previewUrlPath,\s*token\)[\s\S]{0,180}?setPreview\(\{\s*url:\s*res\.url/, '查看文档在当前隐私根内使用短期 URL')
expectIncludes(page, '<FileContentPreview', '我的文档使用页内真实文件预览')
expectIncludes(page, 'aria-labelledby="document-preview-title"', '文档预览弹层保留可访问标题')
expectIncludes(page, 'aria-modal="true"', '文档预览弹层保留 aria-modal')
expectAbsent(page, /window\.open\(/, '我的文档不打开会逃逸公共终端隐私清场的新窗口')
expectMatches(
  page,
  /if\s*\(\s*!res\.printFileUrl\s*\)\s*throw[\s\S]*?navigate\('\/print\/confirm'[\s\S]*?fileUrl:\s*res\.printFileUrl[\s\S]*?mimeType:\s*doc\.mimeType[\s\S]*?makePrintParams\(\{\s*copies:\s*1,\s*duplex:\s*'single',\s*color:\s*'bw'\s*\}\)/,
  '打印文档使用内部 printFileUrl，并保留 /print/confirm state 结构和默认打印参数',
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
expectIncludes(retentionOverlay, '同意并保存', '我的文档保留保存期限确认按钮')
expectIncludes(page, 'error instanceof MemberAssetsApiError', '我的文档保留后端可读错误透出')
expectIncludes(page, '保存期限已更新', '我的文档保留保存期限成功提示')
expectIncludes(page, 'const isAnyPending = Boolean(opening || printingId || signingId || busyId || retentionBusy || convertingId)', '我的文档保留异步互斥锁')
expectIncludes(page, 'disabled={viewDisabled}', '查看按钮保留禁用态')
expectIncludes(page, 'disabled={printDisabled}', '打印按钮保留禁用态')
expectIncludes(page, 'aria-disabled={reprintBlocked || undefined}', '不可打印报告的重新打印键使用 aria-disabled')
expectIncludes(page, 'DOCUMENT_NOT_REPRINTABLE_COPY', '不可打印报告展示仅可查看文案')
expectIncludes(page, '<DocumentConvertAction', 'Word 转 PDF 入口拆到 DocumentConvertAction')
expectIncludes(convertAction, 'WORD_CONVERSION_UNAVAILABLE_COPY', '转 PDF 关闭态写明 Word 转换未开放')
expectIncludes(convertAction, 'WORD_CONVERSION_DISCLOSURE', '转 PDF 开放态附带版式偏差提示')
expectIncludes(convertAction, 'useRemainingSeconds', '转换结果展示有效期倒计时')
expectIncludes(convertAction, "if (!available || converting || busy) return", 'convert 仅在能力为真且未忙碌时调用')
expectIncludes(convertAction, '打印这份 PDF', '转换结果卡提供打印这份 PDF')
expectIncludes(convertAction, 'onPreview(result.fileId)', '转换结果卡预览走 onPreview(fileId)')
expectIncludes(convertAction, 'onPrint(result.fileId)', '转换结果卡打印走 onPrint(fileId)')
expectIncludes(convertAction, '链接已过期，请在列表里重新打开', '转换结果卡链接过期提示回列表')
expectIncludes(page, 'onPreview=', '我的文档把既有预览处理器传给结果卡')
expectIncludes(page, 'onPrint=', '我的文档把既有打印处理器传给结果卡')
expectIncludes(page, 'documentForConvertedPdf', '结果卡预览/打印复用本页 open/print，不另起链路')
expectIncludes(page, 'reprintable={isDocumentReprintable(doc)}', '结果卡打印按转换前记录的 reprintable 判定')
expectIncludes(page, 'disabled={deleteDisabled}', '删除按钮保留禁用态')

expectIncludes(retentionOverlay, 'role="dialog"', '保存期限确认弹层保留 dialog 语义')
expectIncludes(page, 'aria-modal="true"', '保存期限确认弹层保留 aria-modal')
expectIncludes(page, '还没有文档', '我的文档保留空态标题')
expectIncludes(page, '保存简历 / 打印材料等文档后，这里会显示你的文档记录', '我的文档保留空态说明')
expectIncludes(page, '访问链接短期有效', '我的文档保留短期访问链接合规说明')
expectIncludes(page, '原始简历/求职材料默认 90 天', '我的文档保留默认保存期限说明')

for (const [label, source] of [
  ['MyDocumentsPage', page],
  ['DocumentConvertAction', convertAction],
  ['RetentionConfirmOverlay', retentionOverlay],
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

// 2026-09-23 退役：原「历史变更集 allowlist / unexpectedChanged」范围检查。
// 它按 origin/main...HEAD 取整个变更集，再用当年墨青换装批次的清单逐文件比对 ——
// 该批次早已合入，清单只能靠每个正当 PR 追加行才变绿，已退化成历史流水账；
// 在多批次集成候选上它会把几百个已审计的合法文件一律判越界，挡不住任何东西。
// 本守卫现在只验上方的页面/行为合同；文件范围由 verify:profile-commercial-first-batch
// （触碰 /me/* 时委托 verify:fusion-w5 精确合同）、project graph 与 CI diff 合同负责。
console.log('  INFO 本守卫只验页面/行为合同，不检查文件范围；集成候选的文件范围由 verify:profile-commercial-first-batch / verify:fusion-w5 / project graph / CI diff 合同负责')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — /me/documents 页面/行为合同守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — /me/documents 页面/行为合同守卫通过（不含文件范围检查）\n')
