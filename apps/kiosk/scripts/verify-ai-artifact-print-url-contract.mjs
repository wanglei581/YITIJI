import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  expectMatch(source, /import\s*\{\s*signFileUrl\s*\}\s*from\s*['"][^'"]+files\/signing['"]/, `${label}复用 signFileUrl`)
  expectMatch(source, /printFileUrl:\s*signFileUrl\(uploaded\.fileId\)\.url/, `${label}响应返回内部 HMAC URL`)
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
expectMatch(materialsPage, /disabled=\{!generated\.printFileUrl\}/, '求职材料 mock/缺 URL 时打印按钮诚实禁用')

expectMatch(filesService, /printFileUrl:\s*signFileUrl\(record\.id\)\.url/, '文件访问响应同时返回内部 HMAC printFileUrl')
expectMatch(myDocumentsPage, /fileUrl:\s*res\.printFileUrl/, '我的文档打印只传 printFileUrl')
expectNoMatch(myDocumentsPage, /fileUrl:\s*res\.url/, '我的文档不得把预览或下载 URL 传给打印任务')
expectMatch(myDocumentsPage, /if\s*\(\s*!res\.printFileUrl\s*\)\s*throw/, '我的文档缺内部打印 URL 时诚实报错')

expectMatch(adminFairsService, /async\s+prepareFairMaterialPrint\s*\(/, '招聘会资料提供按需标准 FileObject 打印桥接')
expectMatch(adminFairsService, /return\s+this\.printBridges\.prepare\(fairId,\s*materialId\)/, '招聘会资料入口委托可复用打印桥接服务')
expectMatch(fairMaterialPrintBridgeService, /printFileUrl:\s*signFileUrl\(fileId\)\.url/, '招聘会资料桥接返回内部 HMAC printFileUrl')
expectMatch(fairMaterialPrintBridgeService, /validationMode:\s*'intent'/, '招聘会资料桥接仅以内部 intent 模式跨越 HTTP proxy 上限')
expectMatch(fairMaterialPrintBridgeService, /assertSourceIntegrity\(material,\s*buffer\)/, '招聘会资料桥接复核源内容完整性')
expectMatch(jobsController, /@Post\('job-fairs\/:id\/materials\/:materialId\/print-url'\)/, '招聘会资料暴露受控 print-url 端点')
expectMatch(fairMaterialsPage, /fileUrl:\s*[^\n]*printFileUrl/, '招聘会资料打印只传 printFileUrl')
expectNoMatch(fairMaterialsPage, /fileUrl:\s*(?:latest\.)?previewUrl/, '招聘会资料不得把专用预览 URL 传给打印任务')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — AI / 求职产物打印 URL 契约未闭环`)
  process.exit(1)
}

console.log('\n✅ ALL PASS — AI / 求职产物只使用内部 HMAC printFileUrl 打印')
