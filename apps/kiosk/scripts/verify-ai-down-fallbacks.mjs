import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// 门禁：三条主链在 AI 挂掉时必须各有一条**真的**非 AI 出路。
//
// 项目硬规矩：AI 是加速器不是前置条件 —— AI 挂掉时功能退化成手动，绝不消失或瘫痪。
// 全站对账发现三条主链违反得最彻底（V6 原型写了 127 处 ai-down 支线，实现侧一条没落）：
//
//   ① 简历诊断失败   文件还在服务端，用户却一张纸也拿不走
//   ② 访谈式生成失败 只显示一行红字，填了半天的内容没有任何出口
//   ③ 模拟面试 start 一 503，整条能力从屏幕上消失
//   ④ 职业规划       整条动作条被 AI 任务态包着，ai-down 时连打印按钮都没有
//
// 判据（比「有没有渲染一个按钮」严格）：
//   A. 出路存在 —— 该分支下有明确的非 AI 动作。
//   B. 出路是真的 —— 动作处理函数里真的走了打印链路 / 真实路由，不是空 onClick。
//   C. 出路不伪造 —— 降级产物必须标成降级（元数据 AIGenerated='false'、文案写明未含 AI）。
//   D. 禁用可解释 —— 置灰一律 aria-disabled + 常驻原因，禁止原生 disabled。
//   E. 触控达标 —— 主按钮 ≥56px。
//
// 纯静态：只读仓库源码，不连数据库 / 硬件 / 外网。
// ============================================================================

const kioskRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = join(kioskRoot, '../..')

const read = (abs) => readFileSync(abs, 'utf8')
const kiosk = (rel) => read(join(kioskRoot, rel))
const repo = (rel) => read(join(repoRoot, rel))

const files = {
  source: kiosk('src/pages/resume/ResumeSourcePage.tsx'),
  report: kiosk('src/pages/resume/ResumeReportPage.tsx'),
  reportExits: kiosk('src/pages/resume/components/ResumeDiagnosisFailExits.tsx'),
  generate: kiosk('src/pages/resume/ResumeGeneratePage.tsx'),
  interviewSetup: kiosk('src/pages/interview/InterviewSetupPage.tsx'),
  careerPlan: kiosk('src/pages/resume/CareerPlanPage.tsx'),
  aiApi: kiosk('src/services/api/ai.ts'),
  interviewApi: kiosk('src/services/api/interview.ts'),
  sharedAi: repo('packages/shared/src/types/ai.ts'),
  sharedInterview: repo('packages/shared/src/types/mockInterview.ts'),
  apiInterviewController: repo('services/api/src/mock-interview/mock-interview.controller.ts'),
  apiInterviewService: repo('services/api/src/mock-interview/mock-interview.service.ts'),
  apiPracticeBank: repo('services/api/src/mock-interview/interview-practice-sheet.ts'),
  apiPracticePdf: repo('services/api/src/mock-interview/interview-practice-sheet-pdf.service.ts'),
  apiInterviewModule: repo('services/api/src/mock-interview/mock-interview.module.ts'),
  apiResumePdf: repo('services/api/src/ai/resume/resume-pdf.service.ts'),
  apiCareerPlan: repo('services/api/src/ai/resume/career-plan.service.ts'),
}

const failures = []
const assert = (condition, message) => { if (!condition) failures.push(message) }

const hit = (content, pattern) =>
  pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)

const must = (key, pattern, message) => assert(hit(files[key], pattern), `${key}: ${message}`)
const mustNot = (key, pattern, message) => assert(!hit(files[key], pattern), `${key}: ${message}`)

/**
 * 取出某个箭头函数处理器的函数体（大括号配对，跨嵌套）。
 *
 * 这是「出路是真的」这条判据的落点：只断言页面里有一个按钮毫无意义 ——
 * 一个 `onClick={() => {}}` 的按钮同样能让那种断言变绿。必须读到处理器体里
 * 真的调了打印链路 / 真实路由，断言才有意义。
 */
function handlerBody(content, name) {
  const start = content.indexOf(`const ${name} =`)
  if (start === -1) return null
  const open = content.indexOf('{', content.indexOf('=>', start))
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < content.length; i += 1) {
    if (content[i] === '{') depth += 1
    else if (content[i] === '}') {
      depth -= 1
      if (depth === 0) return content.slice(open, i + 1)
    }
  }
  return null
}

function mustHandler(key, name, checks) {
  const body = handlerBody(files[key], name)
  if (!body) {
    failures.push(`${key}: 找不到处理器 ${name}（这条出路的动作没有实现）`)
    return
  }
  for (const [pattern, message] of checks) {
    assert(hit(body, pattern), `${key}.${name}: ${message}`)
  }
}

// ── ① 简历诊断失败 → 至少能把上传的原件打出来 ───────────────────────────────
// 原型口径：09-resume-workbench.html:1325「解析中断，文件没有丢 / 可打印或存档」
//          :1357「带去打印：原件 3 页」（data-when="ai-down"）

// 打印原件的前提是报告页拿得到打印链接。上传页只透传 name/size/format 的话，
// 后面的按钮再怎么写都点不出东西来 —— 所以这一条是整条出路的地基。
must('source', /fileUrl: uploadedFile\.fileUrl/, '上传页必须把 fileUrl 透传给解析链路，否则诊断失败后无法打印原件')
must('source', /mimeType: uploadedFile\.mimeType/, '上传页必须把 mimeType 透传给解析链路')

must('report', /if \(!success\)/, '报告页必须保留诊断失败分支')
must('report', /<ResumeDiagnosisFailExits/, '诊断失败分支必须挂上非 AI 出路组件')

mustHandler('reportExits', 'printOriginal', [
  [/if \(!file\?\.fileUrl\) return/, '必须在没有打印链接时提前返回，不给一个点了没反应的按钮'],
  ["navigate('/print/confirm'", '打印原件必须走既有打印链路 /print/confirm'],
  [/fileUrl: file\.fileUrl/, '必须把真实 HMAC content URL 交给打印链路'],
  ['makePrintParams', '必须给出真实打印参数，不构造裸对象'],
])

// 其余三条出路（原型 09 的 ai-down 支线：去打印 / 看岗位 / 看招聘会）必须真的通到路由。
for (const route of ['/print-scan', '/jobs', '/job-fairs']) {
  must('reportExits', `navigate('${route}')`, `诊断失败态必须保留通往 ${route} 的非 AI 出路`)
}

// D：置灰可解释。原生 disabled 会退出 Tab 序列、读屏跳过，触屏没有 hover 读不到原因。
must('reportExits', /aria-disabled="true"/, '打印链接不可用时必须用 aria-disabled 置灰')
must('reportExits', /aria-describedby="resume-fail-print-reason"/, '置灰按钮必须用 aria-describedby 指向常驻原因')
must('reportExits', /id="resume-fail-print-reason"/, '置灰原因必须是常驻可见元素，不能只放 title/tooltip')
mustNot('reportExits', /<button[^>]*\sdisabled(\s|=|>)/, '禁止对置灰按钮使用原生 disabled')

// E：触控。1080×1920 竖屏，主操作 ≥56px。
assert(
  (files.reportExits.match(/min-h-\[56px\]/g) ?? []).length >= 4,
  'reportExits: 每条出路按钮都必须 ≥56px（min-h-[56px]）',
)

// C：不伪造 —— 诊断没跑出来就不许给任何结论。
must('reportExits', '不拿通用建议顶替', '失败态必须写明不给结论，不用通用建议冒充诊断')

// ── ② 访谈式生成失败 → 已答内容能变成纸带走 ─────────────────────────────────
// 原型口径：10-resume-interview.html:394「把已答的部分导出成草稿带走」/ :523「草稿 ≠ 成文简历」

must('generate', /<AiTaskRegion/, '生成页失败态必须挂 AiTaskRegion（fallback 是必填 prop，防止支线被摘掉）')
must('generate', /mode: 'blocked'/, '降级模式必须是 blocked —— 草稿不是 AI 润色的等价替代，套 manual 就是伪造能力')
must('generate', /没有丢/, 'stillAvailable 必须如实告诉用户已填内容没丢')
must('generate', /onClick: \(\) => void handleExportDraft\(\)/, '降级动作必须真的挂到草稿导出处理器上')

mustHandler('generate', 'handleExportDraft', [
  ['exportResumeDraft', '草稿导出必须走不经过模型的 export 端点'],
  [/if \(!file\.printFileUrl\) throw/, '拿不到打印链接必须如实报错，不静默跳转到一个打不出的页面'],
  ["navigate('/print/confirm'", '草稿必须进入既有打印链路'],
  [/fileUrl: file\.printFileUrl/, '必须把真实打印链接交给打印链路'],
])

must('aiApi', /export const exportResumeDraft/, 'kiosk 必须提供不经过模型的草稿导出入口')
must(
  'aiApi',
  /exportGeneratedResume\(resume, undefined, token, 'pdf', undefined, undefined, true\)/,
  '草稿导出必须显式传 draft=true，否则产物会被标成 AI 生成',
)

// C：不伪造 —— 草稿 PDF 一个字都不是模型写的，绝不能标 AIGenerated='true'。
must('apiResumePdf', /if \(renderOptions\.draft\)/, '简历 PDF 必须区分草稿版式与 AI 版式')
must('apiResumePdf', /info\['AIGenerated'\] = 'false'/, '草稿 PDF 必须写 AIGenerated=false')
must('apiResumePdf', /zyd-resume-draft-v1/, '草稿产物必须有独立标识，便于事后与 AI 版区分')

// ── ③ 模拟面试 start 503 → 通用题目与答案单 ─────────────────────────────────
// 原型口径：20-interview-pod.html:497「AI 不可用 · 只能用通用题库」
//          :1137「生成题目与答案单」/ :1894「本单不含点评」

// 载荷所在：sessionId 必须在 start 之前记下来。start 一 503 就抛，写在它后面等于没写。
{
  const setIdx = files.interviewSetup.indexOf('setPendingSession({ sessionId: created.sessionId')
  const startIdx = files.interviewSetup.indexOf('await startInterview(')
  assert(setIdx > -1, 'interviewSetup: 必须在 start 之前记下 sessionId，否则 503 后无处生成题目单')
  assert(
    setIdx > -1 && startIdx > -1 && setIdx < startIdx,
    'interviewSetup: setPendingSession 必须排在 startInterview 之前 —— start 抛错后就不会执行到它了',
  )
}

// 表单校验失败（「请先填写目标岗位」）不是 AI 挂了。直接拿 `error` 点亮降级区，
// 等于把用户少填一个字说成服务不可用 —— 那是另一种伪造。
mustNot('interviewSetup', /failed: Boolean\(error\)/, 'ai-down 判据不得直接用 error（它也承载表单校验提示）')
must('interviewSetup', /failed: startFailed \|\| Boolean\(aiOutage\)/, 'ai-down 判据必须来自「进面试间真的失败过」而不是任意 error')

must('interviewSetup', /<AiTaskRegion/, '面试设置页失败态必须挂 AiTaskRegion')
must('interviewSetup', /mode: 'blocked'/, '降级模式必须是 blocked —— 通用题目单不是模拟面试的等价替代')
must('interviewSetup', /通用题库/, '降级文案必须写明题目来自通用题库，不是按岗位定制')
must('interviewSetup', /不含任何点评/, '降级文案必须写明本单不含点评')
must('interviewSetup', "navigate('/interview/tips')", '必须保留一条完全不依赖 AI 的准备要点出路')

mustHandler('interviewSetup', 'handlePracticeSheet', [
  ['printInterviewPracticeSheet', '题目单必须走不经过模型的题目单端点'],
  [/if \(!file\.printFileUrl\) throw/, '拿不到打印链接必须如实报错'],
  ["navigate('/print/confirm'", '题目单必须进入既有打印链路'],
  [/fileUrl: file\.printFileUrl/, '必须把真实打印链接交给打印链路'],
])

must('interviewApi', /export function printInterviewPracticeSheet/, 'kiosk 必须提供题目单调用')
must('interviewApi', /\/practice-sheet`/, '题目单必须打到 /practice-sheet 端点')
must('apiInterviewController', /@Post\(':id\/practice-sheet'\)/, '后端必须提供题目单端点')
must('apiInterviewModule', /InterviewPracticeSheetPdfService/, '题目单渲染器必须注册，否则 AI 挂掉时这张纸也生成不出来')

// 这条路径存在的唯一理由就是「不经过模型」。一旦有人往里加 LLM 调用，它就失去意义。
{
  const body = handlerBody(files.apiInterviewService, 'printPracticeSheet')
    ?? (() => {
      const start = files.apiInterviewService.indexOf('async printPracticeSheet(')
      if (start === -1) return null
      const open = files.apiInterviewService.indexOf('{', start)
      let depth = 0
      for (let i = open; i < files.apiInterviewService.length; i += 1) {
        if (files.apiInterviewService[i] === '{') depth += 1
        else if (files.apiInterviewService[i] === '}') {
          depth -= 1
          if (depth === 0) return files.apiInterviewService.slice(open, i + 1)
        }
      }
      return null
    })()
  assert(body !== null, 'apiInterviewService: 找不到 printPracticeSheet 实现')
  if (body) {
    assert(!body.includes('this.llm'), 'apiInterviewService.printPracticeSheet: 禁止调用模型 —— 它存在的理由就是 AI 挂掉时照常能出纸')
    assert(body.includes('pickPracticeQuestions'), 'apiInterviewService.printPracticeSheet: 题目必须来自确定性通用题库')
    assert(body.includes("variant: 'degraded' as const"), 'apiInterviewService.printPracticeSheet: 必须如实回传 variant=degraded')
    assert(body.includes('signFileUrl'), 'apiInterviewService.printPracticeSheet: 必须签发真实打印链接')
  }
}

// C：不伪造 —— 题目单里没有任何模型内容，不得标成 AIGC。
// 只禁「调用」与「导入」，不禁注释里提到它 —— 那句注释正是在解释为什么不能用。
mustNot('apiPracticePdf', /applyAigcPdfMetadata\(/, '题目单不得调用 AIGC 元数据 helper（它固定写 AIGenerated=true）')
mustNot('apiPracticePdf', /^import .*applyAigcPdfMetadata/m, '题目单不得导入 AIGC 元数据 helper')
must('apiPracticePdf', /info\['AIGenerated'\] = 'false'/, '题目单必须写 AIGenerated=false')
must('apiPracticePdf', /PRACTICE_SHEET_CAVEAT/, '题目单必须把「通用题库 / 不含点评」口径印在纸上')
must('apiPracticeBank', /本单不含任何点评、评分或通过率/, '口径常量必须写明不含点评')

// 题库必须覆盖最长一档（8 分钟 ≈ 8 题），否则最长时长会印出一张缺题的纸。
for (const group of ['HR_QUESTIONS', 'MANAGER_QUESTIONS', 'TECH_QUESTIONS', 'CAMPUS_QUESTIONS', 'FINAL_QUESTIONS']) {
  const start = files.apiPracticeBank.indexOf(`const ${group}`)
  const end = files.apiPracticeBank.indexOf('\n]', start)
  assert(start > -1 && end > -1, `apiPracticeBank: 找不到题库分组 ${group}`)
  if (start > -1 && end > -1) {
    const count = (files.apiPracticeBank.slice(start, end).match(/\{ question:/g) ?? []).length
    assert(count >= 8, `apiPracticeBank: ${group} 只有 ${count} 道题，最长一档需要 8 道`)
  }
}

must('sharedInterview', /variant: 'degraded'/, '题目单响应类型必须把 variant 钉成字面量 degraded')

// ── ④ 职业规划：出纸能力不得被 AI 任务态包住 ────────────────────────────────

// 这是改动前的原样：整条动作条被 AI 任务态包着，ai-down 时整页没有打印按钮。
mustNot(
  'careerPlan',
  /\{\(aiTask\.canStart \|\| aiTask\.isRunning\) && \(\s*<KioskActionBar/,
  '动作条不得被 AI 任务态包住 —— 打印不依赖 AI，AI 挂了也必须留在屏幕上',
)
must('careerPlan', /打印求职参考单（未含 AI 规划）/, '无规划时的打印按钮文案必须先说清拿到的是降级版')
must('sharedAi', /variant\?: PrintArtifactVariant/, '共享类型必须声明 variant，否则前端拿到降级版也没法如实告诉用户')
must('apiCareerPlan', /variant: rendered\.variant/, '后端必须继续回传 variant')
must('careerPlan', /file\.variant === 'degraded'/, '前端必须真的消费 variant')
mustNot('careerPlan', /variant \?\? 'ai'/, "禁止把缺失的 variant 默认当成 AI 版")

// ── 合规文案 ────────────────────────────────────────────────────────────────
// 刻意**不**在本门禁里再抄一份禁词表。仓库根已有 `pnpm verify:compliance-copy`
// 全量扫 apps/{admin,kiosk,partner}/src，且它带上下文判定（「去来源平台投递」是
// 白名单文案本身、「不参与平台内投递」是边界声明，都不算违规）。再抄一份只会
// 得到一份更粗糙、判据会漂移的第二清单 —— 那正是那个门禁建立时要解决的问题。

if (failures.length > 0) {
  console.error('verify-ai-down-fallbacks failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`verify-ai-down-fallbacks passed (${Object.keys(files).length} files checked)`)
