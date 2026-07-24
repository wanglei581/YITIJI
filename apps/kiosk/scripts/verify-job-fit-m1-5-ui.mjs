import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const read = (base, relativePath) => readFileSync(join(base, relativePath), 'utf8')

let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => { failures += 1; console.error(`  FAIL ${message}`) }
const expectIncludes = (source, fragment, message) => source.includes(fragment) ? pass(message) : fail(`${message} — missing ${fragment}`)
const expectMatches = (source, pattern, message) => pattern.test(source) ? pass(message) : fail(`${message} — ${pattern}`)
const expectAbsent = (source, pattern, message) => !pattern.test(source) ? pass(message) : fail(`${message} — forbidden ${pattern}`)
const expectFile = (relativePath, message) => {
  const fullPath = join(kioskRoot, relativePath)
  if (!existsSync(fullPath)) {
    fail(`${message} — missing ${relativePath}`)
    return ''
  }
  pass(message)
  return readFileSync(fullPath, 'utf8')
}

function readLocalCssGraph(entryRelativePath) {
  const root = realpathSync(kioskRoot)
  const visiting = new Set()
  const visited = new Set()

  const collect = (absolutePath) => {
    if (!existsSync(absolutePath)) throw new Error(`missing CSS import: ${absolutePath}`)
    const realPath = realpathSync(absolutePath)
    const escaped = relative(root, realPath)
    if (escaped.startsWith('..') || isAbsolute(escaped)) throw new Error(`CSS import escapes kiosk root: ${absolutePath}`)
    if (extname(realPath) !== '.css') throw new Error(`CSS import is not a .css file: ${absolutePath}`)
    if (visiting.has(realPath)) throw new Error(`CSS import cycle: ${[...visiting, realPath].join(' -> ')}`)
    if (visited.has(realPath)) return ''
    visiting.add(realPath)

    const source = readFileSync(realPath, 'utf8')
    const imports = [...source.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?\s*;/g)]
    const importStatements = source.match(/@import\s+[^;]+;/g) ?? []
    if (imports.length !== importStatements.length) throw new Error(`unsupported CSS import syntax: ${realPath}`)
    const imported = imports.map((match) => {
      const specifier = match[2]
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(`non-local CSS import: ${specifier}`)
      return collect(resolve(dirname(realPath), specifier))
    }).join('\n')

    visiting.delete(realPath)
    visited.add(realPath)
    return `${source.replace(/@import\s+[^;]+;/g, '')}\n${imported}`
  }

  return collect(resolve(root, entryRelativePath))
}

console.log('\n=== 岗位匹配 M1.5 前端整合门禁 ===')

const sharedAi = read(repoRoot, 'packages/shared/src/types/ai.ts')
const jobFitApi = read(kioskRoot, 'src/services/api/jobFit.ts')
const jobFitPage = read(kioskRoot, 'src/pages/resume/JobFitPage.tsx')
const recordsPage = read(kioskRoot, 'src/pages/profile/me/MyAiRecordsPage.tsx')
const packageJson = read(kioskRoot, 'package.json')
const ci = read(repoRoot, '.github/workflows/ci.yml')
const summary = expectFile('src/pages/resume/jobFit/DecisionSummaryBar.tsx', '决策摘要组件存在')
const fitMap = expectFile('src/pages/resume/jobFit/FitSkillMap.tsx', '匹配依据组件存在')
const gaps = expectFile('src/pages/resume/jobFit/GapActionCards.tsx', '差距行动组件存在')
const rewrite = expectFile('src/pages/resume/jobFit/ResumeRewriteCard.tsx', '简历改写组件存在')
expectFile('src/pages/resume/jobFit-inkpaper.css', '岗位匹配墨青纸感样式存在')
let inkpaperCss = ''
try {
  inkpaperCss = readLocalCssGraph('src/pages/resume/jobFit-inkpaper.css')
  pass('岗位匹配样式聚合器仅跟随本地 CSS import 且无缺失、越界或循环')
} catch (error) {
  fail(`岗位匹配样式聚合失败 — ${error instanceof Error ? error.message : String(error)}`)
}

expectIncludes(sharedAi, 'export interface JobFitPrintResponse', 'shared 声明岗位匹配打印响应')
expectMatches(sharedAi, /interface\s+JobFitPrintResponse\s*\{[\s\S]*printFileUrl:\s*string/, '岗位匹配打印响应强制内部 printFileUrl')
expectAbsent(sharedAi.match(/interface\s+JobFitPrintResponse\s*\{[\s\S]*?\n\}/)?.[0] ?? '', /signedUrl/, '岗位匹配打印响应不暴露对象存储 signedUrl')

expectIncludes(jobFitApi, 'printJobFit', '岗位匹配 API 暴露打印方法')
expectMatches(jobFitApi, /\/resume\/job-fit\/\$\{encodeURIComponent\(taskId\)\}\/print/, '岗位匹配 API 调用既有打印报告端点')
expectIncludes(jobFitPage, 'printJobFit(taskId, { token: getToken(), accessToken })', '结果页使用当前会员或匿名凭证生成报告')
expectMatches(jobFitPage, /if\s*\(\s*!file\.printFileUrl\s*\)\s*throw/, '内部打印 URL 缺失时诚实阻断')
expectIncludes(jobFitPage, 'fileUrl: file.printFileUrl', '打印确认页只接收内部 printFileUrl')
expectIncludes(jobFitPage, "navigate('/print/confirm'", '岗位匹配进入现有打印确认页')
expectIncludes(jobFitPage, "makePrintParams({ copies: 1, duplex: 'single', color: 'bw' })", '岗位匹配复用统一打印参数')
expectAbsent(`${jobFitApi}\n${jobFitPage}`, /fileUrl:\s*file\.signedUrl|signedUrl/, '前端不把 signedUrl 交给打印任务')
expectMatches(jobFitPage, /<ResumeRewriteCard[\s\S]{0,1200}\{error && <p[^>]*>{error}<\/p>\}/, '结果态打印失败会在当前页面诚实展示错误')

expectIncludes(jobFitPage, 'result.job?.id', '恢复结果以持久化岗位 id 决定查看入口')
expectIncludes(jobFitPage, '查看岗位', '岗位 CTA 为查看岗位')
expectMatches(jobFitPage, /navigate\(`\/jobs\/\$\{result\.job\.id\}`\)/, '查看岗位进入既有岗位详情')
expectAbsent(jobFitPage, /\/jobs\/master|JobMaster|window\.open|去来源平台投递/, '岗位匹配页不复活独立入口或直接外跳')

for (const [source, label] of [[summary, '摘要'], [fitMap, '匹配依据'], [gaps, '差距行动'], [rewrite, '简历改写']]) {
  expectAbsent(source, /JobMaster|job_master|\/jobs\/master/, `${label}组件不依赖废弃岗位大师模型或路由`)
}
expectIncludes(fitMap, 'keywordCoverage', '关键词组件只读取可选 decisionSupport 关键词字段')
expectIncludes(jobFitPage, 'result.decisionSupport?.keywordCoverage', '旧缓存无 decisionSupport 时页面自然降级')
expectAbsent(`${jobFitPage}\n${summary}\n${fitMap}\n${gaps}\n${rewrite}`, /面试预判|晋升路径|风险与建议/, '无真实契约字段时不展示面试、晋升或风险结论')
expectIncludes(jobFitPage, "import './jobFit-inkpaper.css'", '岗位匹配页引入局部 LightFlow 样式')
expectMatches(jobFitPage, /className="service-desk job-fit-inkpaper[^"]*"/, '岗位匹配页使用局部 LightFlow 根作用域')
expectIncludes(jobFitPage, 'data-visual-theme="service-desk"', '岗位匹配页声明 service-desk 视觉主题')
expectIncludes(jobFitPage, 'data-ux-density="touch"', '岗位匹配页声明触控密度')
expectIncludes(jobFitPage, 'role="status"', '岗位匹配加载态声明状态语义')
expectIncludes(jobFitPage, 'role="alert"', '岗位匹配错误态声明告警语义')
expectIncludes(jobFitPage, "aria-pressed={tab === 'pick'}", '岗位选择标签声明当前选择态')
expectIncludes(jobFitPage, "aria-pressed={tab === 'manual'}", '手填岗位标签声明当前选择态')
expectIncludes(jobFitPage, 'aria-pressed={active}', '岗位列表声明当前选择态')
expectIncludes(jobFitPage, 'const accessToken = state.accessToken', '岗位匹配保留匿名访问凭证恢复链路')
expectIncludes(jobFitPage, 'getLatestJobFit(taskId, { token: currentToken, accessToken })', '岗位匹配保留历史结果恢复链路')
expectIncludes(jobFitPage, 'getJobFitConsentStatus(taskId, { accessToken })', '岗位匹配保留匿名授权状态恢复链路')
expectIncludes(jobFitPage, 'grantJobFitConsent(taskId, { accessToken })', '岗位匹配保留匿名授权确认链路')
expectIncludes(jobFitPage, 'revokeJobFitConsent(taskId, { accessToken })', '岗位匹配保留匿名授权撤回链路')
expectIncludes(jobFitPage, 'finally {\n      setAnalyzing(false)', '分析失败后保留再次尝试入口')
expectIncludes(jobFitPage, 'finally {\n      setPrinting(false)', '打印失败后保留再次尝试入口')
expectIncludes(jobFitPage, '本平台不提供投递功能', '岗位匹配保留不提供投递的合规文案')
expectIncludes(inkpaperCss, '--sd-color-canvas-outer:', 'LightFlow 样式定义冰蓝画布令牌')
expectIncludes(inkpaperCss, '--sd-color-primary:', 'LightFlow 样式定义亮蓝主操作令牌')
expectIncludes(inkpaperCss, '--sd-control-min: 48px;', 'LightFlow 样式定义普通触控最小高度')
expectIncludes(inkpaperCss, '--sd-primary-control-min: 56px;', 'LightFlow 样式定义主操作最小高度')
expectIncludes(inkpaperCss, 'min-height: 100dvh;', '岗位匹配空态覆盖完整触控视口')
expectIncludes(inkpaperCss, '.job-fit-inkpaper .job-fit-card', 'LightFlow 样式只在岗位匹配局部作用域重绘卡片')
expectIncludes(inkpaperCss, '.job-fit-inkpaper .job-fit-action-bar', 'LightFlow 样式只在岗位匹配局部作用域重绘操作栏')
expectMatches(inkpaperCss, /@media\s*\(max-width:\s*1080px\)/, 'LightFlow 样式覆盖 1080 竖屏布局')
expectMatches(inkpaperCss, /@media\s*\(max-width:\s*390px\)/, 'LightFlow 样式覆盖窄屏布局')
expectAbsent(inkpaperCss, /(?:Songti|SimSun|paper-texture|#f7f3e9|#fffdf8|#1e4c4d|radial-gradient)/i, 'LightFlow 样式不保留纸感、米色或宋体元素')
expectAbsent(inkpaperCss, /(^|\n)\s*(?:body|html)\s*\{/, '岗位匹配 LightFlow 样式不污染全局页面')
inkpaperCss.split(/\r?\n/).length < 300
  ? pass('岗位匹配局部 LightFlow 样式控制在 300 行内')
  : fail('岗位匹配局部 LightFlow 样式超过 300 行')

expectIncludes(recordsPage, 'completedJobFitTaskIds', '我的 AI 记录识别已完成岗位匹配结果')
expectIncludes(recordsPage, 'shouldDisplayJobAiSession', '我的 AI 记录仅折叠对应的已完成 match 会话')
expectIncludes(recordsPage, "session.session.operation !== 'match'", '推荐、解读等其他会话不被折叠')
expectIncludes(recordsPage, "session.session.status !== 'completed'", '失败或处理中 match 会话不被折叠')
expectIncludes(recordsPage, "record.kind === 'job_fit'", '删除岗位匹配结果时同步本地会话视图')
expectIncludes(recordsPage, "item.session.operation === 'match' && item.session.resumeTaskId === record.taskId", '删除岗位匹配结果只移除同任务 match 会话')

expectIncludes(packageJson, '"verify:job-fit-m1-5-ui"', 'package 注册 M1.5 前端门禁')
expectIncludes(ci, 'verify:job-fit-m1-5-ui', 'CI 执行 M1.5 前端门禁')

const anonymousConsentDialog = expectFile('src/pages/resume/jobFit/AnonymousJobFitConsentDialog.tsx', '匿名岗位匹配授权弹窗存在')
const anonymousConsentCard = expectFile('src/pages/resume/jobFit/AnonymousJobFitConsentCard.tsx', '匿名岗位匹配授权撤回卡片存在')
const memberConsentCard = expectFile('src/pages/resume/jobFit/MemberJobFitConsentCard.tsx', '会员岗位 AI 授权引导卡片存在')
expectIncludes(jobFitApi, 'grantJobFitConsent', '岗位匹配 API 暴露匿名授权方法')
expectIncludes(jobFitApi, 'getJobFitConsentStatus', '岗位匹配 API 暴露匿名授权状态读取')
expectIncludes(jobFitApi, 'revokeJobFitConsent', '岗位匹配 API 暴露匿名授权撤回方法')
expectIncludes(jobFitPage, "err.code === 'JOB_FIT_ANONYMOUS_CONSENT_REQUIRED'", '分析请求显式分流匿名授权 403')
expectIncludes(jobFitPage, 'AnonymousJobFitConsentDialog', '岗位匹配页编排匿名授权弹窗')
expectIncludes(anonymousConsentDialog, 'role="dialog"', '匿名授权弹窗声明对话框语义')
expectIncludes(anonymousConsentCard, '撤回仅影响后续分析', '匿名撤回不伪称删除既有报告')
expectIncludes(memberConsentCard, '岗位 AI 辅助', '会员授权引导保持既有岗位 AI 文案')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 岗位匹配 M1.5 前端整合未完成\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — 岗位匹配复用 2D、打印、历史与数据边界一致\n')
