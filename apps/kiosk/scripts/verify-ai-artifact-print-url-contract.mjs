import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(kioskRoot, '../..')
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => { failures += 1; console.error(`  FAIL ${message}`) }
const expectMatch = (source, pattern, message) => pattern.test(source) ? pass(message) : fail(`${message} — ${pattern}`)
const expectNoMatch = (source, pattern, message) => !pattern.test(source) ? pass(message) : fail(`${message} — forbidden ${pattern}`)
const interfaceBody = (source, typeName) => {
  const match = source.match(new RegExp(`interface\\s+${typeName}\\s*\\{([^}]*)\\}`))
  return match?.[1] ?? ''
}

console.log('\n=== AI / 求职产物内部打印 URL 契约守卫 ===')

const sharedAi = read('packages/shared/src/types/ai.ts')
const sharedInterview = read('packages/shared/src/types/mockInterview.ts')
const sharedMaterials = read('packages/shared/src/types/jobMaterials.ts')
const sharedFiles = read('packages/shared/src/types/file.ts')
const apiFileTypes = read('services/api/src/files/file.types.ts')
const sharedFair = read('packages/shared/src/types/fairDto.ts')
const resumePreview = read('apps/kiosk/src/pages/resume/ResumeGeneratePreviewPage.tsx')
const interviewReport = read('apps/kiosk/src/pages/interview/InterviewReportPage.tsx')
const careerPlan = read('apps/kiosk/src/pages/resume/CareerPlanPage.tsx')
const jobFit = read('apps/kiosk/src/pages/resume/JobFitPage.tsx')
const selfAssessment = read('apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx')
const fairPlan = read('apps/kiosk/src/pages/job-fairs/FairVisitPlanPage.tsx')
const materialsPage = read('apps/kiosk/src/pages/resume/JobMaterialLibraryPage.tsx')
const myDocumentsPage = read('apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx')
const fairMaterialsPage = read('apps/kiosk/src/pages/job-fairs/FairMaterialsPage.tsx')
const careerService = read('services/api/src/ai/resume/career-plan.service.ts')
const jobFitService = read('services/api/src/ai/resume/job-fit.service.ts')
const fairService = read('services/api/src/ai/resume/fair-visit-plan.service.ts')
const interviewService = read('services/api/src/mock-interview/mock-interview.service.ts')
const materialsService = read('services/api/src/job-materials/job-materials.service.ts')
const filesService = read('services/api/src/files/files.service.ts')
const adminFairsService = read('services/api/src/jobs/admin-fairs.service.ts')
// N5 拆分后 printBridges.prepare 委托逻辑移至 fair-material.service.ts
const fairMaterialService = (() => { try { return read('services/api/src/jobs/fair-material.service.ts') } catch { return '' } })()
const fairMaterialPrintBridgeService = read('services/api/src/jobs/fair-material-print-bridge.service.ts')
const jobsController = read('services/api/src/jobs/jobs.controller.ts')

for (const [source, typeName, printFileUrlPattern] of [
  [sharedAi, 'CareerPlanPrintResponse', /printFileUrl\?:\s*string/],
  [sharedAi, 'JobFitPrintResponse', /printFileUrl:\s*string/],
  [sharedAi, 'FairVisitPlanPrintResponse', /printFileUrl\?:\s*string/],
  [sharedInterview, 'InterviewPrintResponse', /printFileUrl\?:\s*string/],
  [sharedMaterials, 'JobMaterialGenerateResponse', /printFileUrl\?:\s*string/],
]) {
  expectMatch(
    interfaceBody(source, typeName),
    printFileUrlPattern,
    `${typeName} additive 声明内部 HMAC printFileUrl`,
  )
}

for (const [source, label] of [
  [sharedFiles, 'shared FileAccessUrlResponse'],
  [apiFileTypes, 'API FileAccessUrlResponse 本地副本'],
]) {
  expectMatch(interfaceBody(source, 'FileAccessUrlResponse'), /printFileUrl\?:\s*string/, `${label}声明内部 HMAC printFileUrl`)
}
expectMatch(interfaceBody(sharedFair, 'FairMaterialPrintResponse'), /printFileUrl:\s*string/, 'FairMaterialPrintResponse 声明按需生成的内部 HMAC printFileUrl')

for (const [source, label] of [
  [careerService, '职业规划打印服务'],
  [jobFitService, '岗位匹配打印服务'],
  [fairService, '招聘会准备单打印服务'],
  [interviewService, '模拟面试报告打印服务'],
  [materialsService, '求职材料生成服务'],
]) {
  expectMatch(source, /import\s*\{[^}]*\bsignFileUrl\b[^}]*\}\s*from\s*['"][^'"]+files\/signing['"]/, `${label}复用 signFileUrl`)
  expectMatch(source, /printFileUrl:\s*signFileUrl\(uploaded\.fileId,\s*PRINT_ARTIFACT_URL_TTL_MS\)\.url/, `${label}响应返回内部 HMAC URL（30 分钟）`)
}

for (const [source, label, variable] of [
  [resumePreview, 'AI 简历生成预览', 'exported'],
  [interviewReport, '模拟面试报告', 'file'],
  [careerPlan, '职业规划建议单', 'file'],
  [jobFit, '岗位匹配决策报告', 'file'],
  [fairPlan, '招聘会参会准备单', 'file'],
  [materialsPage, '求职材料', 'file'],
]) {
  expectMatch(source, new RegExp(`fileUrl:\\s*${variable}\\.printFileUrl`), `${label}打印只传 printFileUrl`)
  expectNoMatch(source, /fileUrl:\s*(?:exported|file)\.signedUrl/, `${label}不得把下载 signedUrl 传给打印任务`)
}

expectMatch(resumePreview, /if\s*\(\s*!exported\?\.printFileUrl\s*\)\s*return/, 'AI 简历生成预览缺内部打印 URL 时阻断')
expectMatch(interviewReport, /if\s*\(\s*!file\.printFileUrl\s*\)\s*throw/, '模拟面试报告缺内部打印 URL 时诚实报错')
expectMatch(careerPlan, /if\s*\(\s*!file\.printFileUrl\s*\)\s*throw/, '职业规划缺内部打印 URL 时诚实报错')
expectMatch(jobFit, /if\s*\(\s*!file\.printFileUrl\s*\)\s*throw/, '岗位匹配缺内部打印 URL 时诚实报错')
expectMatch(fairPlan, /if\s*\(\s*!file\.printFileUrl\s*\)\s*throw/, '招聘会准备单缺内部打印 URL 时诚实报错')
expectMatch(materialsPage, /if\s*\(\s*!file\.printFileUrl\s*\)\s*return/, '求职材料缺内部打印 URL 时不进入打印')
// 这里曾断言原生 `disabled={!generated.printFileUrl}`。批次 KIOSK-DEBT ③ 把能力门禁
// 从原生 disabled 改成 `aria-disabled` + 常显原因 + onClick 短路：触屏上 title 永不显示，
// 原生 disabled 的按钮既不可聚焦也说不出为什么，读屏用户与一体机用户都拿不到原因。
// 断言意图（缺 URL 时按钮必须诚实禁用、且不得偷偷放行）不变，且现在要求得更多：
// 除禁用态外还必须给出可见原因，并在 onClick 里真的短路。
expectMatch(
  materialsPage,
  /aria-disabled=\{!generated\.printFileUrl\s*\|\|\s*undefined\}/,
  '求职材料 mock/缺 URL 时打印按钮诚实禁用（aria-disabled）',
)
expectMatch(
  materialsPage,
  /onClick=\{\(\)\s*=>\s*\{\s*if\s*\(generated\.printFileUrl\)/,
  '求职材料打印按钮在缺 URL 时于 onClick 内短路（置灰不是装饰）',
)
expectMatch(
  materialsPage,
  /aria-describedby=\{!generated\.printFileUrl\s*\?\s*'material-print-blocked'/,
  '求职材料打印禁用态绑定常显原因（触屏上 title 不显示）',
)
expectNoMatch(
  materialsPage,
  /disabled=\{!generated\.printFileUrl\}/,
  '求职材料打印按钮不得退回原生 disabled（原因说不出口）',
)

expectMatch(filesService, /printFileUrl:\s*signFileUrl\(record\.id,\s*PRINT_ARTIFACT_URL_TTL_MS\)\.url/, '文件访问响应同时返回内部 HMAC printFileUrl（30 分钟）')
expectMatch(myDocumentsPage, /fileUrl:\s*res\.printFileUrl/, '我的文档打印只传 printFileUrl')
expectNoMatch(myDocumentsPage, /fileUrl:\s*res\.url/, '我的文档不得把预览或下载 URL 传给打印任务')
expectMatch(myDocumentsPage, /if\s*\(\s*!res\.printFileUrl\s*\)\s*throw/, '我的文档缺内部打印 URL 时诚实报错')

expectMatch(adminFairsService, /async\s+prepareFairMaterialPrint\s*\(/, '招聘会资料提供按需标准 FileObject 打印桥接')
// N5 拆分后委托逻辑在 fair-material.service.ts，adminFairsService 或 fairMaterialService 命中均可
expectMatch(fairMaterialService || adminFairsService, /return\s+this\.printBridges\.prepare\(fairId,\s*materialId\)/, '招聘会资料入口委托可复用打印桥接服务')
expectMatch(fairMaterialPrintBridgeService, /printFileUrl:\s*signFileUrl\(fileId,\s*PRINT_ARTIFACT_URL_TTL_MS\)\.url/, '招聘会资料桥接返回内部 HMAC printFileUrl（30 分钟）')
expectMatch(fairMaterialPrintBridgeService, /validationMode:\s*'intent'/, '招聘会资料桥接仅以内部 intent 模式跨越 HTTP proxy 上限')
expectMatch(fairMaterialPrintBridgeService, /assertSourceIntegrity\(material,\s*buffer\)/, '招聘会资料桥接复核源内容完整性')
expectMatch(jobsController, /@Post\('job-fairs\/:id\/materials\/:materialId\/print-url'\)/, '招聘会资料暴露受控 print-url 端点')
expectMatch(fairMaterialsPage, /fileUrl:\s*[^\n]*printFileUrl/, '招聘会资料打印只传 printFileUrl')
expectNoMatch(fairMaterialsPage, /fileUrl:\s*(?:latest\.)?previewUrl/, '招聘会资料不得把专用预览 URL 传给打印任务')

// ── P28 自我探索（S2-7 接线）──────────────────────────────────────────────
// 报告 PDF 有两条出口，用途不同、URL 不能互换：
//   页内预览：会按 PDF 画且有 printFileUrl 时用同站 printFileUrl（页面自己 fetch 字节；对象存储直链跨站取不到），没有才退回 signedUrl
//   手机扫码 / 二维码 → signedUrl（整页打开，仍用下载直链）
//   打印交接 → printFileUrl（内部 HMAC，/print/jobs 只认这个）
// 交换打印与下载的后果是「点了打印但打不出来」，而页面已经把用户送进了核价流程。
expectMatch(selfAssessment, /fileUrl:\s*printed\.printFileUrl/, '自我探索打印交接只传内部 HMAC printFileUrl')
expectNoMatch(selfAssessment, /fileUrl:\s*printed\.signedUrl/, '自我探索不得把预览签名 URL 传给打印任务')
expectMatch(selfAssessment, /if\s*\(\s*!printed\?\.printFileUrl\s*\)\s*return/, '自我探索缺内部打印 URL 时不进入打印')
expectMatch(
  selfAssessment,
  /blockedReason=\{printed\.printFileUrl\s*\?\s*null\s*:/,
  '自我探索缺内部打印 URL 时按钮置灰并给出常驻可见原因',
)
// AI 不可用 / 缺凭证的置灰一律 aria-disabled：原生 disabled 会退出 Tab 序列、
// 读屏跳过，用户读不到「为什么灰」（CLAUDE.md §9 / ai/AiTaskRegion.tsx 同一口径）。
expectNoMatch(selfAssessment, /\sdisabled=\{/, '自我探索置灰不使用原生 disabled')
expectMatch(selfAssessment, /aria-disabled=\{blocked \|\| undefined\}/, '自我探索置灰走 aria-disabled')

// ── F-20b：剩下五处页内 PDF 预览改取同站地址 ────────────────────────────────
// JSX 写成 fileUrl={…} 时，上面「fileUrl: 标识符」的正则看不住花括号。这里按整段表达式断言，并真执行。
const filePreview = read('apps/kiosk/src/components/FileContentPreview.tsx')
const versionsPanel = read('apps/kiosk/src/pages/resume/components/resume-deliver/ResumeVersionsPanel.tsx')
const conversionApi = read('apps/kiosk/src/services/api/documentConversion.ts')

function sourceNode(text, name) {
  const ast = ts.createSourceFile('fixture.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!found) throw new Error(`source node ${name} missing`)
  const body = ts.isVariableDeclaration(found) ? `const ${found.getText(ast)};` : found.getText(ast).replace(/^export /, '')
  return body
}
function executable(text) {
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
}
const previewModule = { exports: {} }
new Function('exports', executable([
  sourceNode(conversionApi, 'WORD_EXTENSIONS'),
  sourceNode(conversionApi, 'WORD_MIME_TYPES'),
  sourceNode(conversionApi, 'isWordDocument'),
  sourceNode(filePreview, 'resolvePreviewKind'),
  sourceNode(filePreview, 'inPagePreviewUrl'),
  'exports.inPagePreviewUrl = inPagePreviewUrl',
].join('\n')))(previewModule.exports)
const inPagePreviewUrl = previewModule.exports.inPagePreviewUrl
const SAME = '/api/v1/files/f-20b/content?expires=1&sig=test'
const DIRECT = 'https://cos.example.invalid/object.pdf'
const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const expectEqual = (actual, expected, message) => actual === expected ? pass(message) : fail(`${message} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
expectEqual(inPagePreviewUrl({ url: DIRECT, printFileUrl: SAME, fileName: 'a.pdf', mimeType: 'application/pdf' }), SAME, 'inPagePreviewUrl：PDF 且有同站地址时用同站地址')
expectEqual(inPagePreviewUrl({ url: DIRECT, printFileUrl: '', fileName: 'a.pdf', mimeType: 'application/pdf' }), DIRECT, 'inPagePreviewUrl：空的同站地址退回原地址')
expectEqual(inPagePreviewUrl({ url: DIRECT, fileName: 'a.pdf', mimeType: 'application/pdf' }), DIRECT, 'inPagePreviewUrl：没有同站地址退回原地址')
expectEqual(inPagePreviewUrl({ url: DIRECT, printFileUrl: SAME, fileName: 'a.png', mimeType: 'image/png' }), DIRECT, 'inPagePreviewUrl：图片仍用原地址')
expectEqual(inPagePreviewUrl({ url: DIRECT, printFileUrl: SAME, fileName: 'a.docx', mimeType: WORD_MIME }), DIRECT, 'inPagePreviewUrl：Word 仍用原地址')
expectEqual(inPagePreviewUrl({ url: DIRECT, printFileUrl: SAME, fileName: 'a.bin', mimeType: 'application/octet-stream', format: 'pdf' }), SAME, 'inPagePreviewUrl：只标了 pdf 格式时仍按 PDF 取同站地址')
expectEqual(inPagePreviewUrl({ url: DIRECT, printFileUrl: SAME, fileName: '报告.pdf' }), SAME, 'inPagePreviewUrl：扩展名是 pdf 时取同站地址')

// 下面三处是写死的「同站地址 || 原地址」，按源码原文断言。对一段固定的字再求值只是在测 || 运算，测不出东西，不做（agy 反方指出）。
expectMatch(selfAssessment, /fileUrl=\{printed\.printFileUrl \|\| printed\.signedUrl\}/, '自我探索页内预览：有 printFileUrl 用它，否则退回 signedUrl')
expectMatch(selfAssessment, /phoneDownloadUrl=\{printed\.signedUrl\}/, '自我探索手机扫码仍是下载直链')
expectNoMatch(selfAssessment, /fileUrl=\{printed\.signedUrl\}/, '自我探索页内预览不得再只取下载直链')

expectMatch(versionsPanel, /fileUrl=\{preview\.printFileUrl \|\| preview\.url\}/, '已确认版本页内预览：有 printFileUrl 用它，否则退回 url')
expectMatch(versionsPanel, /printFileUrl:\s*access\.printFileUrl/, '已确认版本把 preview-url 回包里的 printFileUrl 存进预览状态')
expectMatch(versionsPanel, /if\s*\(\s*!access\.url\s*\)/, '已确认版本「没有可用的预览链接」仍看 access.url')
expectMatch(versionsPanel, /phoneDownloadUrl=\{preview\.url\}/, '已确认版本手机扫码仍是下载直链')
expectNoMatch(versionsPanel, /fileUrl=\{preview\.url\}/, '已确认版本页内预览不得再只取下载直链')

expectMatch(
  materialsPage,
  /setPreview\(\{\s*file,\s*url:\s*res\.url,\s*printFileUrl:\s*res\.printFileUrl\s*\}\)/,
  '求职材料库预览把 preview-url 回包的 url 与 printFileUrl 一起留下',
)
expectMatch(
  materialsPage,
  /fileUrl=\{inPagePreviewUrl\(\{\s*url:\s*currentPreview\.url \?\? '',\s*printFileUrl:\s*currentPreview\.printFileUrl,\s*fileName:\s*generated\.filename,\s*mimeType:\s*generated\.mimeType,\s*\}\)\}/,
  '求职材料库页内预览经 inPagePreviewUrl：PDF 用同站地址，否则用原地址',
)
expectNoMatch(materialsPage, /fileUrl=\{currentPreview\.url\}/, '求职材料库页内预览不得再只取 preview-url 的 url')

expectMatch(
  myDocumentsPage,
  /setPreview\(\{\s*url:\s*res\.url,\s*printFileUrl:\s*res\.printFileUrl,/,
  '我的文档预览仍先存 res.url，并带上 printFileUrl',
)
expectMatch(
  myDocumentsPage,
  /fileUrl=\{inPagePreviewUrl\(\{\s*url:\s*preview\.url,\s*printFileUrl:\s*preview\.printFileUrl,\s*fileName:\s*preview\.filename,\s*mimeType:\s*preview\.mimeType,\s*\}\)\}/,
  '我的文档页内预览经 inPagePreviewUrl：PDF 用同站地址，图片和 Word 用原地址',
)
expectNoMatch(myDocumentsPage, /fileUrl=\{preview\.url\}/, '我的文档页内预览不得再只取 preview.url')

expectMatch(filePreview, /setConvertedUrl\(result\.printFileUrl \|\| result\.signedUrl\)/, 'Word 转 PDF 后的页内预览：有 printFileUrl 用它，否则退回 signedUrl')
expectNoMatch(filePreview, /setConvertedUrl\(result\.signedUrl\)/, 'Word 转 PDF 后的预览不得再只取 signedUrl')

// ── 产物打印链接有效期 30 分钟（9/29 主执行窗口提）────────────────────────────
// 看完报告、改完参数再点打印常超过 5 分钟；默认 5 分钟会让确认页报「打印链接已过期」。
// 与打印交接上下文、上传、图片转换的 30 分钟对齐。下载链接不在此列，仍走默认 5 分钟。
const signingSource = read('services/api/src/files/signing.ts')
expectMatch(signingSource, /export const PRINT_ARTIFACT_URL_TTL_MS = 30 \* 60 \* 1000\b/, 'signing.ts 定义产物打印链接有效期 30 分钟')
const artifactPrintSites = [
  ['services/api/src/advisor/advisor-artifact.service.ts', 'uploaded.fileId'],
  ['services/api/src/document-conversion/document-conversion.service.ts', 'uploaded.fileId'],
  ['services/api/src/ai/resume/self-assessment.service.ts', 'uploaded.fileId'],
  ['services/api/src/ai/resume/appended-self-assessment.service.ts', 'uploaded.fileId'],
  ['services/api/src/jobs/fair-company-print.service.ts', 'uploaded.fileId'],
  ['services/api/src/ai/ai.service.ts', 'printFileId'],
  ['services/api/src/ai/resume-report-export.controller.ts', 'access.fileId'],
]
for (const [file, arg] of artifactPrintSites) {
  const escaped = arg.replace('.', '\\.')
  expectMatch(read(file), new RegExp(`signFileUrl\\(${escaped},\\s*PRINT_ARTIFACT_URL_TTL_MS\\)\\.url`), `${path.basename(file)} 打印链接用 30 分钟`)
}
// 全量扫描（按调用点，不按变量名）：services/api/src 里任何给 printFileUrl 用单参数（默认 5 分钟）签名的都算回退。
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name)
  if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full)
  return entry.name.endsWith('.ts') ? [full] : []
})
const regressions = walk(path.join(repoRoot, 'services/api/src'))
  .filter((file) => /printFileUrl\s*[:=]\s*signFileUrl\(\s*[^,()]+\)/.test(fs.readFileSync(file, 'utf8')))
  .map((file) => path.relative(repoRoot, file))
if (regressions.length === 0) pass('services/api/src 没有任何打印链接用默认 5 分钟签名（按调用点扫描）')
else fail(`产物打印链接退回默认有效期：${regressions.join(', ')}`)

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — AI / 求职产物打印 URL 契约未闭环`)
  process.exit(1)
}

console.log('\n✅ ALL PASS — AI / 求职产物只使用内部 HMAC printFileUrl 打印')
