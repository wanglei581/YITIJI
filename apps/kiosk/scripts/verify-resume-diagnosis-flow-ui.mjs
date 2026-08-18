import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function readOptional(path) {
  try {
    return read(path)
  } catch {
    return ''
  }
}

function assertIncludes(src, marker, label) {
  if (!src.includes(marker)) throw new Error(`${label}: missing ${marker}`)
  console.log(`PASS ${label}`)
}

function assertNotIncludes(src, marker, label) {
  if (src.includes(marker)) throw new Error(`${label}: unexpected ${marker}`)
  console.log(`PASS ${label}`)
}

function assertCountAtLeast(src, marker, min, label) {
  const count = src.split(marker).length - 1
  if (count < min) throw new Error(`${label}: expected at least ${min} ${marker}, got ${count}`)
  console.log(`PASS ${label}`)
}

const source = read('src/pages/resume/ResumeSourcePage.tsx')
const diagnosisForm = read('src/pages/resume/components/DiagnosisDirectionForm.tsx')
const parse = read('src/pages/resume/ResumeParsePage.tsx')
const report = read('src/pages/resume/ResumeReportPage.tsx')
const optimize = read('src/pages/resume/ResumeOptimizePage.tsx')
// S2-1 拆页：逐条 diff 搬到对照页，因此 diff 的触控安全断言随之搬过去（覆盖面不缩水）。
const optimizeCompare = read('src/pages/resume/ResumeOptimizeComparePage.tsx')
const generate = read('src/pages/resume/ResumeGeneratePage.tsx')
const resumeVoiceButton = read('src/pages/resume/components/ResumeVoiceInputButton.tsx')
const resumeVoiceDialog = read('src/pages/resume/components/ResumeTranscriptConfirmDialog.tsx')
const wavRecorder = read('src/utils/wavRecorder.ts')
const layoutControls = readOptional('src/pages/resume/components/ResumeLayoutControls.tsx')
const optimizedEditor = readOptional('src/pages/resume/components/OptimizedResumeEditor.tsx')
const layoutHook = readOptional('src/pages/resume/hooks/useResumeLayout.ts')
const mockAdapter = read('src/services/api/aiMockAdapter.ts')

assertIncludes(source, 'selectedDimensions', 'source page tracks diagnosis focus dimensions')
assertIncludes(source, 'targetContext', 'source page builds target context')
assertIncludes(source, 'DiagnosisDirectionForm', 'source page extracts diagnosis direction form')
assertIncludes(source, 'targetContext:', 'source page passes target context to parse')
assertIncludes(source, 'selectedDimensions:', 'source page passes selected dimensions to parse')
assertIncludes(source, 'const sourceBusy = uploading || phoneBusy || usbBusy', 'source page combines every upload channel into one busy state')
assertIncludes(source, 'useBusyLock(sourceBusy)', 'source page prevents standby during every upload channel')
assertNotIncludes(source, 'Windows Agent 盘符直达待真机接入', 'source page removes internal usb implementation copy')
assertNotIncludes(source, '不直接连接第三方网盘', 'source page removes internal cloud implementation copy')

assertIncludes(diagnosisForm, 'RESUME_SCORING_DIMENSIONS', 'diagnosis form uses shared six dimensions')
assertIncludes(diagnosisForm, '通用诊断', 'diagnosis form supports generic diagnosis')
assertIncludes(diagnosisForm, '目标岗位', 'diagnosis form collects target job')
assertIncludes(diagnosisForm, 'aria-pressed', 'diagnosis dimension buttons expose pressed state')

assertIncludes(parse, 'selectedDimensions', 'parse page sends selected dimensions')
assertIncludes(parse, 'targetContext', 'parse page sends target context')
assertIncludes(parse, 'RESUME_SCORING_DIMENSIONS', 'parse page uses shared six dimensions')
assertNotIncludes(parse, 'MIN_STEP_MS', 'parse page removes fixed dwell that impersonates server stages')
assertNotIncludes(parse, 'DIMENSION_PROGRESS_BY_STEP', 'parse page removes fake dimension lighting progress')
assertNotIncludes(parse, 'function delay(', 'parse page removes timer-driven stage animation')
assertNotIncludes(parse, "setCurrent('ocr')", 'parse page does not claim a live OCR stage without server evidence')
assertNotIncludes(parse, "setCurrent('extracting')", 'parse page does not claim a live extraction stage without server evidence')
assertNotIncludes(parse, '评分维度准备进度（逐项点亮）', 'parse page does not present dimensions as live progress')
assertIncludes(parse, '处理内容说明 · 非实时阶段', 'parse page visibly labels the stage list as non-realtime')
assertIncludes(parse, '不代表服务端实时阶段', 'parse page explains that capability steps are not server telemetry')
assertIncludes(parse, 'useBusyLock(Boolean(fileId) && !failed)', 'parse page prevents standby only while waiting for a real result')
assertIncludes(parse, 'startedRef', 'parse page prevents duplicate submit in repeated effect setup')
assertNotIncludes(parse, 'simulateFailure', 'parse page removes the unused Strict Mode fragile auto-failure branch')
assertIncludes(parse, "result.status !== 'completed'", 'parse page only treats the backend completed status as success')
assertIncludes(parse, 'failTimerRef', 'parse page tracks the failure navigation timer')
assertIncludes(parse, 'clearTimeout(failTimerRef.current)', 'parse page clears the failure timer on leave')
assertIncludes(parse, '未找到简历文件', 'parse page fails closed when opened without a real file id')
assertIncludes(parse, '返回上一步', 'parse page does not falsely claim it can cancel the submitted server task')
assertNotIncludes(parse, '取消解析', 'parse page removes the misleading server-cancel label')
assertIncludes(parse, '简历原文不会发送给企业', 'parse page retains the enterprise non-disclosure privacy boundary')
assertIncludes(parse, '不进入平台候选人简历库', 'parse page retains the platform candidate-library privacy boundary')
assertIncludes(parse, 'role="status"', 'parse page exposes processing status to assistive tech')
assertIncludes(parse, 'if (!fileId)', 'parse page blocks missing fileId')
assertNotIncludes(parse, 'local-${Date.now()}', 'parse page does not fabricate local file id')
assertNotIncludes(parse, 'duration:', 'parse page does not use fake timed step durations')

assertIncludes(report, 'targetContext', 'report keeps target context summary')
assertIncludes(report, '目标方向', 'report displays target direction summary')
assertIncludes(report, 'ReportNoticePanel', 'report page consolidates top notices')
assertIncludes(report, 'role="progressbar"', 'report section bars expose progressbar semantics')
assertIncludes(report, 'aria-valuenow', 'report section bars expose current score')

assertNotIncludes(optimize, 'estimateUplift', 'optimize page removes fake uplift estimator')
assertNotIncludes(optimize, '综合评分提升', 'optimize page removes fake numeric score uplift card')
assertIncludes(optimize, '表达调整参考', 'optimize page uses qualitative improvement language')
assertIncludes(optimize, 'useBusyLock(exporting || printNavigating || Boolean(adjusting))', 'optimize page prevents standby during export, print navigation or AI adjustment')
assertIncludes(optimize, 'printNavigating', 'optimize page locks repeated print navigation')
assertIncludes(optimize, 'confirmLeave', 'optimize page protects edited resume content before leaving')
assertIncludes(optimizeCompare, 'splitView={false}', 'optimize diff uses touch-safe inline comparison')
assertIncludes(optimize, "confirmLeave ? 'overflow-hidden'", 'optimize page locks background scroll behind leave dialog')
assertIncludes(optimizeCompare, '[&_pre]:whitespace-pre-wrap', 'optimize diff wraps long lines on touch screens')
// 拆页后母页不得再同屏渲染 diff，否则等于没拆。
assertNotIncludes(optimize, 'ReactDiffViewer', 'optimize page no longer renders per-item diff inline (split to compare page)')
assertIncludes(optimize, "navigate('/resume/optimize/compare'", 'optimize page links to the split comparison page')
// 拆出去的那页必须诚实说明「本次选择不保存」——没有采纳落库端点。
assertIncludes(optimizeCompare, '未保存', 'compare page states the adoption selection is not persisted')
assertNotIncludes(optimizeCompare, '已采纳', 'compare page avoids copy implying the selection was saved')

// 2026-08-18：这三条原本断言「mock 报告的分项 key 与 SSOT 对齐」（objective /
// quantification / readability），前提是 mock **会返回一份报告**。走查证明那份报告
// 本身就是事故源头：8 份不同文件（含打印机说明书、加密 PDF）全部拿到同一份 37/60。
// 修复后 mock 改为抛 MOCK_MODE、不再返回任何报告，于是「分项对不对」这个问题消失，
// 取而代之的是更强的一条：**产物里一个分项 key 都不许再有**。
// 下面 8 条覆盖 SSOT 六个 key + 已退役的 education/layout，严格蕴含原来的 114/115 两条。
for (const key of ['basic', 'objective', 'experience', 'quantification', 'keyword', 'readability', 'education', 'layout']) {
  assertNotIncludes(mockAdapter, `key: '${key}'`, `mock adapter no longer fabricates the ${key} report dimension`)
}

// ════════════════════════════════════════════════════════════════════════
// 2026-08-18 走查修复：换文件不清 session / 排版按钮 18px / 主 CTA 被切一半
// ════════════════════════════════════════════════════════════════════════

/**
 * 取某个箭头函数处理器的函数体（大括号配对）。
 *
 * R3 必须落在处理器体内断言：整文件搜 `clearAiResumeSession` 会被一个没用到的
 * import 骗绿，而事故恰恰是「函数存在、就是没人在选文件时调它」。
 */
function handlerBody(src, name) {
  const start = src.indexOf(`const ${name} =`)
  if (start === -1) return null
  const open = src.indexOf('{', src.indexOf('=>', start))
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return null
}

function assertHandlerIncludes(src, handler, marker, label) {
  const body = handlerBody(src, handler)
  if (!body) throw new Error(`${label}: 找不到处理器 ${handler}`)
  if (!body.includes(marker)) throw new Error(`${label}: ${handler} 体内缺少 ${marker}`)
  console.log(`PASS ${label}`)
}

// ── R3 换新简历必须清掉上一份的 taskId ────────────────────────────────────
// 事故原样：优化过 A 之后回上传页选 B，sessionStorage 里仍是 A 的 taskId；
// 此时直接进对照页，渲染的是 **A 的四条改写建议**，不是空态。已实测复现。
// 三页读 taskId 的顺序都是 state → query → session，所以只要 session 不清，
// 直接进页面就一定会读到上一份。与后端模式无关，真实后端下同样成立。
//
// 边界（同样重要）：只有「选中了一份新文件」才清。中途返回上一步、原地重进
// 都不许清 —— 那会把用户刚做完的诊断白白清掉，等于逼他重跑一遍。
// 因此断言落在三个**文件选中**处理器上，不落在页面 mount / unmount 上。
for (const handler of ['handleFileChosen', 'handlePhoneUploaded', 'handleUsbUploaded']) {
  assertHandlerIncludes(source, handler, 'clearAiResumeSession()', `source page clears the previous AI resume session in ${handler}`)
}
// 反向：不许挂在 mount/卸载上 —— 那正是「回退再继续」被清掉的写法。
assertNotIncludes(source, 'useEffect(() => {\n    clearAiResumeSession()', 'source page does not clear the session merely on mount')

// ── R4 排版分段控件的可点区必须 ≥48px ─────────────────────────────────────
// 事故原样：14 个分段按钮在 1080×1920 实测各宽 **18px**（硬约束要求 ≥48px），
// 文字被压成一字一行竖排。根因是 5 组控件在 348px 宽的侧栏里并排（md:grid-cols-5），
// 每组再自己切 3 列 → 每个按钮只剩 18px。修法：每组一行。
assertNotIncludes(layoutControls, 'md:grid-cols-5', 'layout controls no longer squeeze five groups into one row')
assertIncludes(layoutControls, 'min-h-[48px]', 'layout control choices meet the 48px touch floor')
assertIncludes(layoutControls, 'min-w-[48px]', 'layout control choices meet the 48px touch floor on the horizontal axis too')

// ── R5 上传页主 CTA 必须完整落在首屏 ──────────────────────────────────────
// 事故原样：56px 的「开始 AI 诊断」首屏只露 21px（内容 1903px 挤进 1844px 可视区）。
// 一体机没有滚动条，用户看到的就是一个被切坏的条。复验还发现两处更糟的：
// `?intent=optimize` 与「上传失败横幅在屏」时 CTA 完全 0px 可见。
// 修法：诊断维度清单收进可折叠区（默认收起）+ 削掉纵向留白。
assertIncludes(source, '<details', 'source page collapses the diagnosis dimension list so the primary CTA stays on the first screen')
// 折叠掉的只能是清单本身；「不编造结论」这句合规声明必须常驻可见。
assertIncludes(source, '系统不会编造', 'source page keeps the no-fabrication statement outside the collapsed area')

// ── R5b 上传成功与预览失败不得同屏互相打脸 ────────────────────────────────
// 事故原样：文件卡写「已就绪」，正下方预览卡写「预览链接不可用或已过期，请重新上传文件」。
// 用户以为传失败了，于是重传一次，还是这样。预览失败 ≠ 上传失败，不许指挥用户重传。
const filePreview = read('src/components/FileContentPreview.tsx')
assertNotIncludes(filePreview, '请重新上传文件', 'preview failure no longer instructs a re-upload that would not help')

// ── R7 报告页同屏出现两个「目标岗位匹配参考」入口 ─────────────────────────
// 事故原样：底部动作条里一个、正下方独立整行又一个，两个 onClick 完全一样
// （都是 navigate('/resume/job-fit', { state: { taskId, accessToken } })）。
// 副作用不只是重复：动作条被挤成三等分后，「重新诊断」「查看优化建议」
// 在按钮内被拆成两行。去掉动作条里那个，剩下两个按钮就够宽了。
{
  const jobFitEntries = (report.match(/navigate\('\/resume\/job-fit'/g) ?? []).length
  if (jobFitEntries !== 1) {
    throw new Error(`report page must expose exactly one 岗位匹配 entry, found ${jobFitEntries}`)
  }
  console.log('PASS report page exposes a single job-fit entry (no same-screen duplicate)')
}

// ── R9 文案写支持 DOC，accept 里没有 DOC ──────────────────────────────────
// 后端对旧版 .doc 固定返回 UNSUPPORTED_FILE_TYPE，前端 accept 已按此移除 .doc，
// 只剩这句文案还在承诺 DOC —— 用户照它准备文件，到了机器前才发现选不中。
assertNotIncludes(source, '支持 PDF / DOC / DOCX', 'upload copy no longer promises DOC support the picker cannot accept')

// ── Wave1 Task 8:目标维度(专业/学历)输入 + 优化版多格式导出入口 ──────────
const httpAdapter = read('src/services/api/aiHttpAdapter.ts')

assertIncludes(source, 'targetMajor', 'source page tracks major input')
assertIncludes(source, 'targetDegree', 'source page tracks degree input')
assertIncludes(source, 'major: targetMajor', 'source page merges major into target context')
assertIncludes(source, 'degree: targetDegree', 'source page merges degree into target context')

// ── Commercial density Wave 1: merge optional context into direction form ──
assertIncludes(diagnosisForm, '专业', 'diagnosis form includes optional major field')
assertIncludes(diagnosisForm, '学历', 'diagnosis form includes optional degree field')
assertIncludes(diagnosisForm, 'targetMajor', 'diagnosis form receives major props')
assertIncludes(diagnosisForm, 'targetDegree', 'diagnosis form receives degree props')
assertNotIncludes(source, '补充方向（可选）', 'source page no longer uses orphan context card that creates L-shaped void')
assertNotIncludes(source, 'resume-source-context', 'source page removes separate context card class')
assertIncludes(source, '更换文件', 'source action bar exposes change-file when a resume is staged')
assertIncludes(source, 'resume-source-dropzone flex flex-1', 'upload dropzone stretches to balance the direction column')
assertIncludes(source, 'resume-source-main flex min-w-0 flex-1 flex-col', 'upload column stays a stretch column')

assertIncludes(report, "navigate('/resume/optimize'", 'report page navigates to optimize page')
assertIncludes(report, 'targetContext: state.targetContext', 'report page forwards targetContext into optimize navigate state')

assertIncludes(optimize, "'pdf'", 'optimize page offers pdf export format')
assertIncludes(optimize, "'docx'", 'optimize page offers docx export format')
assertIncludes(optimize, "'txt'", 'optimize page offers txt export format')
assertIncludes(optimize, "'md'", 'optimize page offers md export format')
assertIncludes(optimize, 'Word', 'optimize page labels docx as Word')
assertIncludes(optimize, 'Markdown', 'optimize page labels md as Markdown')
assertIncludes(optimize, 'exportFormat', 'optimize page tracks selected export format state')
assertIncludes(optimize, 'exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined)', 'optimize page exports with selected format and layout')
assertNotIncludes(optimize, '¥', 'optimize page shows no pricing copy')
assertNotIncludes(optimize, '付费', 'optimize page shows no paywall copy')
assertNotIncludes(optimize, '元/', 'optimize page shows no per-unit pricing copy')

assertIncludes(httpAdapter, 'format?: ResumeExportFormat', 'http adapter accepts optional export format')
assertIncludes(httpAdapter, 'layout?: ResumeLayoutSettings', 'http adapter accepts optional layout')
assertIncludes(httpAdapter, 'format ?? ', 'http adapter defaults export format to pdf when omitted')
assertIncludes(httpAdapter, '...(layout ? { layout } : {})', 'http adapter sends layout only when provided')

// ── Wave1 wrapper-consistency fix:导出格式必须走统一 API wrapper,不直连 adapter ──
const aiWrapper = read('src/services/api/ai.ts')

assertNotIncludes(optimize, "from '../../services/api/aiHttpAdapter'", 'optimize page does not import http adapter directly')
assertNotIncludes(optimize, "from '../../services/api/aiMockAdapter'", 'optimize page does not import mock adapter directly')
assertIncludes(optimize, "from '../../services/api'", 'optimize page imports resume actions from the api wrapper barrel')

assertIncludes(aiWrapper, 'format?: ResumeExportFormat', 'api wrapper exportGeneratedResume accepts optional export format')
assertIncludes(aiWrapper, 'layout?: ResumeLayoutSettings', 'api wrapper exportGeneratedResume accepts optional layout')
assertIncludes(aiWrapper, 'adapter.exportGeneratedResume(resume, taskId, token, format, layout, templateId, draft)', 'api wrapper delegates format / layout / draft to the selected adapter')

// ── Wave2 Task 3:优化页拆分 + 受控排版参数 + PDF layout 导出 ────────────────
assertIncludes(optimize, 'ResumeLayoutControls', 'optimize page renders layout controls component')
assertIncludes(optimize, 'OptimizedResumeEditor', 'optimize page renders extracted structured resume editor')
assertIncludes(optimize, 'useResumeLayout', 'optimize page uses layout hook')
assertIncludes(layoutHook, 'DEFAULT_RESUME_LAYOUT', 'layout hook defines default resume layout')
assertIncludes(layoutHook, 'fontScale', 'layout hook tracks font scale')
assertIncludes(layoutHook, 'lineSpacing', 'layout hook tracks line spacing')
assertIncludes(layoutHook, 'margin', 'layout hook tracks margin')
assertIncludes(layoutHook, 'columns', 'layout hook tracks columns')
assertIncludes(layoutHook, 'accent', 'layout hook tracks accent')
assertIncludes(layoutControls, '字号', 'layout controls expose font scale choices')
assertIncludes(layoutControls, '行距', 'layout controls expose line spacing choices')
assertIncludes(layoutControls, '页边距', 'layout controls expose margin choices')
assertIncludes(layoutControls, '主色', 'layout controls expose accent choices')
assertIncludes(layoutControls, '单栏', 'layout controls expose single column choice')
assertIncludes(layoutControls, '双栏', 'layout controls expose double column choice')
assertIncludes(optimizedEditor, 'GeneratedResume', 'optimized resume editor is typed around GeneratedResume')
assertIncludes(optimize, 'exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined)', 'optimize page exports with selected layout')
assertIncludes(optimize, 'setExported(null)', 'optimize page clears stale export when layout/content changes')
assertIncludes(optimize, 'printFileUrl', 'optimize page still uses printFileUrl for PDF print path')
assertNotIncludes(optimize, 'signedUrl || exported.printFileUrl', 'optimize page must not fall back from printFileUrl to signedUrl for printing')

// ── Wave2 Task 5:AI 一键精简 / 调整排版接线 ────────────────────────────────
assertIncludes(optimize, 'AI 精简', 'optimize page exposes AI condense action')
assertIncludes(optimize, 'AI 调整排版', 'optimize page exposes AI reformat action')
assertIncludes(optimize, '撤销 AI 调整', 'optimize page can undo AI adjustment')
assertIncludes(optimize, 'adjustResumeLayoutDraft', 'optimize page calls the unified layout adjust wrapper')
assertNotIncludes(optimize, "from '../../services/api/aiHttpAdapter'", 'optimize page does not directly import http adapter for layout adjust')
assertNotIncludes(optimize, "from '../../services/api/aiMockAdapter'", 'optimize page does not directly import mock adapter for layout adjust')
assertIncludes(optimize, 'loading || exporting || !optimizedResume', 'AI adjust buttons are disabled while busy or no resume')
assertIncludes(optimize, 'lastResumeBeforeAiAdjust', 'AI adjustment keeps an undo snapshot')
assertIncludes(optimize, 'adjustWarnings', 'AI adjustment warnings are displayed separately')
assertIncludes(optimize, 'setAdjustWarnings(result.warnings ?? [])', 'layout adjust warnings are handled as UI hints')
assertNotIncludes(optimize, '录用概率', 'optimize page does not promise hiring results')

assertIncludes(aiWrapper, 'adjustResumeLayoutDraft', 'api wrapper exposes layout adjust function')
assertIncludes(aiWrapper, "action: ResumeLayoutAdjustAction", 'api wrapper uses typed layout adjust action')
assertIncludes(httpAdapter, "layout-adjust", 'http adapter posts to layout-adjust endpoint')
assertIncludes(httpAdapter, 'ResumeLayoutAdjustResponse', 'http adapter returns typed layout adjust response with warnings')
assertIncludes(mockAdapter, 'adjustResumeLayoutDraft', 'mock adapter implements layout adjust wrapper')
assertIncludes(mockAdapter, 'warnings', 'mock adapter returns layout adjust warnings')

// ── Wave3:简历模板库自动填充到优化版导出 ────────────────────────────────
const jobMaterialsApi = read('src/services/api/jobMaterials.ts')

assertIncludes(jobMaterialsApi, 'getResumeTemplates', 'job materials api exposes resume template list')
assertIncludes(jobMaterialsApi, 'filter(isResumeTemplate)', 'resume template list only returns resume_template entries')
assertIncludes(optimize, 'getResumeTemplates', 'optimize page loads resume templates')
assertIncludes(optimize, 'selectedTemplateId', 'optimize page tracks selected resume template')
assertIncludes(optimize, 'resumeTemplates.map', 'optimize page renders template choices')
assertIncludes(optimize, 'handleTemplateChange', 'optimize page clears stale export when template changes')
assertIncludes(optimize, 'PDF 导出按所选模板自动填充版式', 'optimize page explains PDF template fill scope')
assertIncludes(optimize, 'Word/TXT/Markdown 保持内容格式导出', 'optimize page does not overpromise non-PDF template printing')
assertIncludes(optimize, 'exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined)', 'optimize page exports with selected template id')
assertIncludes(aiWrapper, 'templateId?: string', 'api wrapper exportGeneratedResume accepts optional templateId')
assertIncludes(aiWrapper, 'adapter.exportGeneratedResume(resume, taskId, token, format, layout, templateId, draft)', 'api wrapper delegates templateId / draft to selected adapter')
assertIncludes(httpAdapter, 'templateId?: string', 'http adapter accepts optional templateId')
assertIncludes(httpAdapter, '...(templateId ? { templateId } : {})', 'http adapter sends templateId only when selected')
assertIncludes(mockAdapter, '_templateId?: string', 'mock adapter accepts templateId without fabricating files')
assertNotIncludes(optimize, '一键投递', 'optimize page keeps compliance wording')

// ── Wave4:语音生成简历文本(字段级转写 + 人工确认) ─────────────────────
assertIncludes(generate, 'ResumeVoiceInputButton', 'generate page renders resume voice input buttons')
assertIncludes(generate, 'appendVoiceText', 'generate page appends confirmed voice transcripts into existing text')
assertIncludes(generate, 'label="在校情况"', 'generate page offers voice input for education narrative')
assertIncludes(generate, 'label="工作内容"', 'generate page offers voice input for work narrative')
assertIncludes(generate, 'label="项目内容"', 'generate page offers voice input for project narrative')
assertIncludes(generate, 'label="技能"', 'generate page offers voice input for skills narrative')
assertIncludes(generate, 'label="证书资质"', 'generate page offers voice input for certificates narrative')
assertIncludes(generate, 'label="自我评价"', 'generate page offers voice input for self introduction narrative')
assertCountAtLeast(generate, '<ResumeVoiceInputButton', 6, 'generate page limits voice entry to narrative fields')
assertNotIncludes(generate, 'localStorage', 'generate page does not persist voice transcripts locally')
assertNotIncludes(generate, 'sessionStorage', 'generate page does not persist voice transcripts in session storage')

assertIncludes(resumeVoiceButton, 'ResumeTranscriptConfirmDialog', 'voice button opens confirmation dialog before writing text')
assertIncludes(resumeVoiceButton, '语音填写', 'voice button uses clear voice input copy')
assertIncludes(resumeVoiceButton, 'onConfirm(text)', 'voice button writes only confirmed transcript text')

assertIncludes(resumeVoiceDialog, 'MAX_RECORD_SECONDS = 58', 'voice dialog caps one recording below short ASR limit')
assertIncludes(resumeVoiceDialog, 'startWavRecorder', 'voice dialog reuses in-memory wav recorder')
assertIncludes(resumeVoiceDialog, 'transcribeResumeVoice(audio)', 'voice dialog calls resume voice transcription adapter')
assertIncludes(resumeVoiceDialog, '语音仅用于本次转写，不保存原始音频', 'voice dialog shows privacy warning')
assertIncludes(resumeVoiceDialog, '确认写入', 'voice dialog requires explicit confirmation before writing')
assertIncludes(resumeVoiceDialog, 'cancelRecorder()', 'voice dialog releases recorder on close/cancel/unmount')
assertNotIncludes(resumeVoiceDialog, 'localStorage', 'voice dialog does not use localStorage')
assertNotIncludes(resumeVoiceDialog, 'sessionStorage', 'voice dialog does not use sessionStorage')
assertNotIncludes(resumeVoiceDialog, 'FileObject', 'voice dialog does not create file records')
assertNotIncludes(resumeVoiceDialog, 'signedUrl', 'voice dialog does not expose signed URLs')
assertIncludes(wavRecorder, 'MIC_PERMISSION_TIMEOUT', 'wav recorder times out stalled microphone permission prompts')
assertIncludes(wavRecorder, 'timedOut', 'wav recorder tracks late microphone permission resolution')
assertIncludes(wavRecorder, 'lateStream.getTracks().forEach((track) => track.stop())', 'wav recorder releases late microphone streams after timeout')

console.log('PASS resume diagnosis flow UI verification')
