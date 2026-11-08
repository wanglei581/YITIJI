/**
 * 四核心次级入口停放守卫（2026-11-08 产品负责人定停放）。
 *
 * 源码保留、不注册页面、不进构建产物；旧链接由 八个停放地址 跳回首页。
 * import type 会被编译擦掉，不算打包边。值导入、副作用导入和再导出算。
 *
 * 运行：node scripts/verify-kiosk-parked-core4.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// 与 main.tsx 值导入可达性基线相比新增的不可达源码（含 CSS），原文件保留不改。
const PARKED = [
  "src/pages/activities/BenefitActivitiesPage.tsx",
  "src/pages/activities/BenefitActivityDetailPage.tsx",
  "src/pages/activities/activities-batch8.css",
  "src/pages/activities/activities-detail-inkpaper.css",
  "src/pages/assistant/AdvisorTools.tsx",
  "src/pages/print-scan/SignStampPage.tsx",
  "src/pages/print-scan/sign-stamp/SignStampBits.tsx",
  "src/pages/print-scan/sign-stamp/SignStampGateView.tsx",
  "src/pages/print-scan/sign-stamp/SignStampPickView.tsx",
  "src/pages/print-scan/sign-stamp/SignStampPreview.tsx",
  "src/pages/print-scan/sign-stamp/SignStampStatus.tsx",
  "src/pages/print-scan/sign-stamp/SignStampWorkbench.tsx",
  "src/pages/print-scan/sign-stamp/constants.ts",
  "src/pages/print-scan/sign-stamp/signStampCopy.ts",
  "src/pages/print-scan/sign-stamp/signStampModel.ts",
  "src/pages/print-scan/sign-stamp/useSignStampFlow.ts",
  "src/pages/print-scan/styles/sign-stamp-qx.css",
  "src/pages/resume/CareerPlanPage.tsx",
  "src/pages/resume/JobFitActionsPage.tsx",
  "src/pages/resume/JobFitPage.tsx",
  "src/pages/resume/JobMaterialLibraryPage.tsx",
  "src/pages/resume/ResumeTemplateLibraryPage.tsx",
  "src/pages/resume/SelfAssessmentFlow.tsx",
  "src/pages/resume/components/career-plan/CareerPlanExistingMaterials.tsx",
  "src/pages/resume/components/career-plan/CareerPlanGenerateKey.tsx",
  "src/pages/resume/components/career-plan/CareerPlanSection.tsx",
  "src/pages/resume/components/career-plan/CareerPlanSelfAssessmentExcluded.tsx",
  "src/pages/resume/components/career-plan/careerPlanGenerateCopy.ts",
  "src/pages/resume/components/self-assessment/SelfAssessmentConsentKit.tsx",
  "src/pages/resume/components/self-assessment/SelfAssessmentQxKit.tsx",
  "src/pages/resume/hooks/useRouteIdentityGuard.ts",
  "src/pages/resume/job-fit-qx.css",
  "src/pages/resume/jobFit/AnonymousJobFitConsentCard.tsx",
  "src/pages/resume/jobFit/AnonymousJobFitConsentDialog.tsx",
  "src/pages/resume/jobFit/DecisionSummaryBar.tsx",
  "src/pages/resume/jobFit/FitSkillMap.tsx",
  "src/pages/resume/jobFit/JobFitQxStates.tsx",
  "src/pages/resume/jobFit/MemberJobFitConsentCard.tsx",
  "src/pages/resume/jobFit/jobFitQxKit.tsx",
  "src/pages/resume/jobFit/jobFitResultSpec.ts",
  "src/pages/resume/resume-decision-qx.css",
  "src/pages/resume/resume-materials-qx.css",
  "src/pages/resume/resume-templates-qx.css",
  "src/pages/resume/self-assessment-qx.css",
  "src/pages/resume/selfAssessmentConsent.ts",
  "src/pages/resume/selfAssessmentInterpretation.ts",
  "src/pages/resume/touch/ResumeMaterialsTouch.tsx",
  "src/pages/resume/touch/ResumeStates.tsx",
  "src/pages/resume/touch/SaResultParts.tsx",
  "src/pages/resume/touch/resume-fit.css",
  "src/pages/resume/touch/resume-materials-touch.css",
  "src/pages/resume/touch/resume-sa.css",
  "src/pages/resume/touch/resume-states.css",
  "src/pages/resume/touch/resume-templates.css",
  "src/pages/resume/touch/saActItems.ts",
  "src/pages/resume/useSelfAssessmentConsentBundle.ts",
  "src/pages/resume/useSelfAssessmentIdleExit.ts",
  "src/services/api/benefitActivities.ts",
  "src/services/api/careerPlan.ts",
  "src/services/api/jobFit.ts",
  "src/services/api/printSign.ts"
]

const parkedSet = new Set(PARKED)
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) return []
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() ? [path] : []
  })
}

function resolveSpecifier(fromFile, specifier) {
  // 一体机配了 @ → src 的别名（vite.config.ts、tsconfig.json），走别名的导入也算。
  let base
  if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = join(dirname(fromFile), specifier)
  else return null
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.css`,
    `${base}.js`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    const rel = relative(ROOT, candidate).split('\\').join('/')
    if (parkedSet.has(rel)) return rel
  }
  return null
}

function valueImportSpecifiers(sourceFile) {
  const specs = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const typeOnly = Boolean(clause?.isTypeOnly)
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
        : []
      const hasValue = !typeOnly && (
        !clause
        || Boolean(clause.name)
        || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        || named.some((element) => !element.isTypeOnly)
      )
      if (hasValue) specs.push(node.moduleSpecifier.text)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      specs.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specs
}

function parkedRedirects(sourceText) {
  const source = ts.createSourceFile('routes.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = new Map()
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      let path = null
      let element = null
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const name = property.name.getText(source)
        if (name === 'path' && ts.isStringLiteral(property.initializer)) path = property.initializer.text
        if (name === 'element') element = property.initializer.getText(source)
      }
      if (path) found.set(path, element ?? '')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

let failed = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => {
  failed += 1
  console.error(`  FAIL ${message}`)
}

console.log('\n=== 四核心次级入口停放 ===')

for (const rel of PARKED) {
  if (existsSync(join(ROOT, rel))) pass(`① 停放源码仍在 ${rel}`)
  else fail(`① 停放源码被删 ${rel}`)
}

const routes = read('src/routes/index.tsx')
const redirects = parkedRedirects(routes)
const homeRedirect = (element) => /<Navigate\s+to="\/"\s+replace\s*\/>/.test(element.replace(/\s+/g, ' '))
for (const path of ['/resume/job-fit/*', '/resume/career-plan/*', '/resume/self-assessment/*', 'resume/templates/*', 'resume/materials/*', 'activities/*', 'print-scan/sign/*', 'print/scan-sign']) {
  const element = redirects.get(path)
  if (element && homeRedirect(element)) pass(`② ${path} 是跳回首页的 Navigate（2026-11-08 产品负责人定停放）`)
  else fail(`② ${path} 必须是 <Navigate to="/" replace />，实际 ${element ?? '缺失'}`)
}

const routeFile = join(ROOT, 'src/routes/index.tsx')
const routeSource = ts.createSourceFile('routes.tsx', routes, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const routeImports = valueImportSpecifiers(routeSource)
  .map((specifier) => resolveSpecifier(routeFile, specifier))
  .filter(Boolean)
if (routeImports.length === 0) pass('② routes/index.tsx 不 import 停放模块')
else fail(`② routes/index.tsx import 了停放模块: ${routeImports.join(', ')}`)

const srcRoot = join(ROOT, 'src')
const outsideHits = []
for (const file of walk(srcRoot)) {
  if (!/\.(ts|tsx)$/.test(file)) continue
  const rel = relative(ROOT, file).split('\\').join('/')
  if (parkedSet.has(rel)) continue
  if (rel.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/.test(rel)) continue
  const source = ts.createSourceFile(rel, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const specifier of valueImportSpecifiers(source)) {
    const hit = resolveSpecifier(file, specifier)
    if (hit) outsideHits.push(`${rel} -> ${hit}`)
  }
}
if (outsideHits.length === 0) pass('③ 停放清单之外没有值导入停放模块（不打包）')
else fail(`③ 停放模块仍被在用代码 import:\n${outsideHits.join('\n')}`)

// 入口收口检查保留可执行语义，避免只出现函数名或注释就算通过。
function check(ok, message) { if (ok) pass(`④ ${message}`); else fail(`④ ${message}`) }
const file = (name) => read(`src/pages/${name}`)
for (const name of ['resume/touch/ResumeTouchHub.tsx', 'interview/touch/InterviewHubTouch.tsx', 'service-hubs/QxServiceHubPage.tsx', 'recruitment-touch/SocialHubPage.tsx']) {
  const code = file(name)
  check(/\.filter\(\((?:item|entry)\) => !isParkedRoute\((?:item|entry)\.route\)\)/.test(code), `${name} 用 isParkedRoute 过滤入口`)
}
const assistant = file('assistant/AssistantPage.tsx')
const assistantSource = ts.createSourceFile('assistant.tsx', assistant, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let allowed = []
function findAllowed(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(assistantSource) === 'ALLOWED_ROUTE_PREFIXES') {
    let init = node.initializer
    if (ts.isAsExpression(init)) init = init.expression
    if (ts.isArrayLiteralExpression(init)) allowed = init.elements.filter(ts.isStringLiteral).map((value) => value.text)
  }
  ts.forEachChild(node, findAllowed)
}
findAllowed(assistantSource)
for (const route of ['/jobs', '/job-fairs', '/fairs-service', '/jobs-service', '/companies']) {
  check(allowed.length > 0 && !allowed.includes(route), `小青允许列表不含 ${route}`)
}
check(/const safeActions = [^\n]*!isParkedRoute\(action.route\)/.test(assistant), '小青回答动作过滤停放地址')
const sheetsFile = join(ROOT, 'src/pages/assistant/AssistantSheets.tsx')
const sheetsSource = ts.createSourceFile(sheetsFile, readFileSync(sheetsFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
check(!valueImportSpecifiers(sheetsSource).some((specifier) => specifier.includes('AdvisorTools')), '弹层不导入 AdvisorTools')
check(!file('assistant/AssistantTaskPicker.tsx').includes('本机 AI 专项'), '咨询选择器不显示本机 AI 专项')
// 执行纯文案模块，确认过滤后的真实导出而不是 ALL 定义。
function loadPure(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('exports', 'require', js)(exports, () => ({ isRecruitmentRoute: () => false }))
  return exports
}
const scenes = loadPure('src/pages/assistant/advisorScenes.ts')
check(!scenes.CONSULTATION_TASKS.some((task) => task.id === 'jobs'), '咨询主题不含 jobs')
check(scenes.PARKED_ASSISTANT_SKILLS.size === 11 && [...scenes.PARKED_ASSISTANT_SKILLS].every((skill) => scenes.normalizeToolboxSkill(skill) === undefined), '11 个旧 skill 回普通小青')
check(!file('assistant/AssistantSessionSummaryBar.tsx').includes('/ai/plan'), '会话保存后不再跳作业面')
check(/SIGN_ENTRY_PARKED \? undefined : sign/.test(file('print-scan/components/QxPrintHubView.tsx')), '打印台签名卡由 SIGN_ENTRY_PARKED 挡住')
check(/export const SIGN_ENTRY_PARKED: boolean = true/.test(file('print-scan/printHubContent.ts')), '签名停放开关为 true')
const registry = loadPure('src/routes/parkedRoutes.ts')
for (const route of ['/resume/career-plan', '/resume/self-assessment', '/resume/job-fit', '/resume/materials', '/resume/templates', '/activities', '/print-scan/sign', '/print/scan-sign']) {
  check(registry.PARKED_ROUTE_PREFIXES_1108.includes(route) && ['', '?x=1#part', '/deep?x=1#part'].every((suffix) => registry.isParkedRoute(route + suffix)) && !registry.isParkedRoute(route + '-other'), `停放登记表完整匹配 ${route} 及深链`)
}
check(routes.includes("path: 'ai/plan'") && routes.includes("import('../pages/ai-plan/AiPlanPage')"), '作业面路由保留给旧记录')

if (failed > 0) {
  console.error(`\n❌ ${failed} 项失败\n`)
  process.exit(1)
}
console.log('\n✅ ALL PASS — 四核心次级入口保持停放\n')
