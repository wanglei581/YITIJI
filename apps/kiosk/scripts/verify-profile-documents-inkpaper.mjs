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
// me-detail-inkpaper.css 聚合入口：2026-09-23 /me/settings 也迁入青序后已无 src 引用；文件未删，封闭性断言保留。
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
expectIncludes(page, 'getMyDocuments(token, { pageSize: 50, cursor })', '我的文档保留本人文档真实 API 拉取')
// 登录回跳来源：青序壳的底栏由 recordsCtabar 统一生成，loginFrom 是它的第 4 个位置参数；
// 钉住这个位置，再钉 recordsCtabar 确实把它作为 /login 的 from 传出去。
expectMatches(page, /recordsCtabar\(uiState, navigate, \(\) => setReloadKey\(\(k\) => k \+ 1\), '\/me\/documents',/, '我的文档保留登录回跳来源')
expectIncludes(read('src/pages/profile/me/qx/QxMeChrome.tsx'), "navigate('/login', { state: { from: loginFrom } })", '青序会员底栏登录键带回跳来源')
expectIncludes(read('src/pages/profile/me/useMemberCursorPage.ts'), 'setItems([])', '我的文档保留游客态清空列表')
expectIncludes(page, 'fetchAccessUrl(doc.previewUrlPath, token)', '我的文档查看/打印保留短期签名 URL 现取现用')
expectMatches(page, /fetchAccessUrl\(doc\.previewUrlPath,\s*token\)[\s\S]{0,180}?setPreview\(\{\s*url:\s*res\.url/, '查看文档在当前隐私根内使用短期 URL')
expectIncludes(page, '<FileContentPreview', '我的文档使用页内真实文件预览')
expectIncludes(page, 'aria-labelledby="document-preview-title"', '文档预览弹层保留可访问标题')
expectIncludes(page, 'aria-modal="true"', '文档预览弹层保留 aria-modal')
expectAbsent(page, /window\.open\(/, '我的文档不打开会逃逸公共终端隐私清场的新窗口')
// 2026-09-28 商用收口 P0-5：生产强制 PRINT_REQUIRE_PII_SCAN=true，本人原件没做完隐私检查
// 就建单会被拒。所以这里先组好带 fileId 的文件（doc.id 就是 FileObject id），按与服务端闸门
// 同一判据分流：原件整份写打印材料会话后去材料检查；派生 / 优化产物照旧直达 /print/confirm，
// state 结构和默认打印参数不变。原先「printFileUrl 之后紧跟 navigate('/print/confirm')」的
// 顺序断言随分流改成下面这组；它要守的三件事（只传内部 printFileUrl、派生直达确认页、
// 默认黑白单面）一条没少，另加了「原件不许绕过检查」。
expectMatches(
  page,
  // 2026-09-29 P0-5：本人原件 / 派生产物的分流收进打印交接上下文（requiresCheck → printHandoffPolicy 定入口），
  // 跳转只带交接编号；转换件按原件过材料检查（convertedFrom）。只传内部 printFileUrl、带 fileId 两条不变。
  /if\s*\(\s*!res\.printFileUrl\s*\)\s*throw[\s\S]*?fileId:\s*doc\.id,\s*\n\s*fileUrl:\s*res\.printFileUrl,\s*\n\s*mimeType:\s*doc\.mimeType[\s\S]*?const requiresCheck = documentNeedsPrintMaterialCheck\(doc, convertedFrom\)[\s\S]*?startPrint\(\{\s*\n\s*origin:\s*'my_documents',\s*\n\s*requiresCheck,/,
  '打印文档只传内部 printFileUrl 并带 fileId：写打印交接上下文，本人原件（含原件转出的 PDF）先去材料检查，派生产物直达确认页',
)
{
  // 分流判据必须与服务端建单闸门同一份用途清单：服务端多管一种用途而这里没跟上，
  // 那种原件会直达报价页、在建单时被拒；反过来则是派生之外的文件被白送去检查。
  const setItems = (source, name) => {
    const match = source.match(new RegExp(`${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`))
    return match ? [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort() : null
  }
  // 1.8 P-1 起用途清单定义在 material-check-policy.ts（闸门与「我的文档」materialCheckRequired 共用），pii-scan-gate.ts 只再导出。
  const server = setItems(readFileSync(join(repoRoot, 'services/api/src/print-jobs/material-check-policy.ts'), 'utf8'), 'PII_SCAN_REQUIRED_PURPOSES')
  const kiosk = setItems(read('src/pages/profile/me/components/documentReprint.ts'), 'PRINT_PII_CHECK_PURPOSES')
  if (server && kiosk && JSON.stringify(server) === JSON.stringify(kiosk)) {
    pass(`我的文档的原件分流判据与服务端 PII_SCAN_REQUIRED_PURPOSES 同一份用途清单（${kiosk.join(' / ')}）`)
  } else {
    fail(`我的文档的原件分流判据与服务端建单闸门不一致 — 服务端 ${JSON.stringify(server)}，一体机 ${JSON.stringify(kiosk)}`)
  }
}
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
// 2026-10-06 C1-3：空态标题和说明改成稿 38「还没有保存的文档」/「这个账号下没有已保存的文件…」。
// 旧句「还没有文档」「保存简历 / 打印材料等文档后…」不再出现；断言改成稿文案，不放宽「空态必须有标题和说明」。
expectIncludes(page, '还没有保存的文档', '我的文档保留空态标题')
expectIncludes(page, '这个账号下没有已保存的文件。还没有任何记录。办过之后会列在这里。', '我的文档保留空态说明')
expectIncludes(page, '访问链接短期有效', '我的文档保留短期访问链接合规说明')
expectIncludes(page, '原始简历/求职材料默认 90 天', '我的文档保留默认保存期限说明')
expectIncludes(page, 'documentsLoggedInTruth(resultIdleLogoutLabel())', '已登录的文档说明引用结果页空闲时长')
expectAbsent(page, /不会显示上一位/, '已登录的文档页不承诺看不到上一位的资料')
const loadingBlock = read('src/pages/profile/me/qx/QxMeStateBits.tsx')
const meGuide = read('src/pages/profile/me/qx/QxMeChrome.tsx')
expectIncludes(loadingBlock, '上一位若没点结束使用，读出来的仍是那个账号。', '文档加载说明承认没结束使用时仍是那个账号')
expectAbsent(loadingBlock, /不会闪回上一位用户的内容/, '文档加载不再写「不会闪回上一位」')
expectIncludes(meGuide, '离开前请点结束使用，否则一段时间无操作后才会自动退出', '共用加载说明改为离开前结束使用')
expectAbsent(meGuide, /上一位用户的内容不会残留在屏幕上/, '共用加载说明不再写上一位的内容不会残留')

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
