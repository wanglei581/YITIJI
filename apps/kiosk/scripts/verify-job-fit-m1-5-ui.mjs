import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
const inkpaperCss = expectFile('src/pages/resume/jobFit-inkpaper.css', '岗位匹配墨青纸感样式存在')

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
expectIncludes(jobFitPage, "import './jobFit-inkpaper.css'", '岗位匹配页引入局部墨青纸感样式')
expectMatches(jobFitPage, /className="job-fit-inkpaper[^"]*"/, '岗位匹配页使用局部墨青纸感根作用域')
expectIncludes(inkpaperCss, '--job-fit-ink:', '墨青纸感样式定义墨青色令牌')
expectIncludes(inkpaperCss, '.job-fit-inkpaper .job-fit-card', '墨青纸感样式只在岗位匹配局部作用域重绘卡片')
expectIncludes(inkpaperCss, '.job-fit-inkpaper .job-fit-action-bar', '墨青纸感样式只在岗位匹配局部作用域重绘操作栏')
expectAbsent(inkpaperCss, /(^|\n)\s*(?:body|html)\s*\{/, '岗位匹配纸感样式不污染全局页面')

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
