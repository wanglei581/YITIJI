import assert from 'node:assert/strict'
import ts from 'typescript'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const reportScores = readOptional('src/pages/resume/components/resume-report/ResumeReportScores.tsx')
const reportAll = `${report}\n${reportScores}`
const deliver = [
  'src/pages/resume/components/resume-deliver/ResumeDeliverPanel.tsx',
  'src/pages/resume/components/resume-deliver/OptimizeReadyBody.tsx',
  'src/pages/resume/components/resume-deliver/ResumeFactConfirmDialog.tsx',
  'src/pages/resume/components/resume-deliver/ResumePricingBar.tsx',
  'src/pages/resume/components/resume-deliver/ResumeExportResult.tsx',
  'src/pages/resume/components/resume-deliver/constants.ts',
  'src/pages/resume/components/resume-deliver/useResumeExportPricing.ts',
  'src/pages/resume/components/resume-deliver/useOptimizeLoad.ts',
  'src/pages/resume/components/resume-deliver/optimizeStateCopy.ts',
  'src/pages/resume/components/resume-deliver/optimizeQuery.ts',
  'src/pages/resume/components/resume-deliver/generatePreviewQuery.ts',
  'src/pages/resume/components/resume-deliver/facts.ts',
  'src/pages/resume/components/resume-deliver/ResumeAigcBadge.tsx',
  'src/pages/resume/components/resume-deliver/CompareDecisionsApplyDialog.tsx',
  'src/pages/resume/components/resume-deliver/useCompareDecisionsReturn.ts',
].map((path) => readOptional(path)).join('\n')
const optimize = `${read('src/pages/resume/ResumeOptimizePage.tsx')}\n${deliver}`
const generatePreview = `${read('src/pages/resume/ResumeGeneratePreviewPage.tsx')}\n${read('src/pages/resume/GeneratePreviewChrome.tsx')}\n${deliver}`
// S2-1 拆页：逐条 diff 搬到对照页，因此 diff 的触控安全断言随之搬过去（覆盖面不缩水）。
const optimizeCompare = [
  'src/pages/resume/ResumeOptimizeComparePage.tsx',
  'src/pages/resume/components/resume-compare/ResumeCompareCard.tsx',
  'src/pages/resume/components/resume-compare/ResumeCompareState.tsx',
  'src/pages/resume/components/resume-compare/resumeCompareModel.ts',
  'src/pages/resume/components/resume-compare/ResumeCompareBatchBar.tsx',
  'src/pages/resume/components/resume-compare/ResumeCompareDraft.tsx',
  'src/pages/resume/components/resume-compare/ResumeCompareCustomEditor.tsx',
].map((path) => read(path)).join('\n')
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
assertIncludes(parse, '不代表实时进度', 'parse page explains that capability steps are not server telemetry')
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
assertIncludes(reportAll, 'role="progressbar"', 'report section bars expose progressbar semantics')
assertIncludes(reportAll, 'aria-valuenow', 'report section bars expose current score')

assertNotIncludes(optimize, 'estimateUplift', 'optimize page removes fake uplift estimator')
assertNotIncludes(optimize, '综合评分提升', 'optimize page removes fake numeric score uplift card')
assertIncludes(optimize, '表达调整参考', 'optimize page uses qualitative improvement language')
assertIncludes(optimize, 'useBusyLock(exporting || printNavigating || Boolean(adjusting))', 'optimize page prevents standby during export, print navigation or AI adjustment')
assertIncludes(optimize, 'printNavigating', 'optimize page locks repeated print navigation')
assertIncludes(optimize, 'confirmLeave', 'optimize page protects edited resume content before leaving')
assertIncludes(optimizeCompare, 'wordDiff(props.item.before, shown)', 'optimize diff uses in-house inline word diff for the displayed revision')
assertIncludes(optimizeCompare, "props.decision === 'custom' && props.customText ? props.customText : props.item.after", 'diff uses the selected custom text or the original AI revision')
assertIncludes(optimize, "confirmLeave ? 'overflow-hidden'", 'optimize page locks background scroll behind leave dialog')
assertIncludes(optimizeCompare, 'className="qxc-copy qxc-diff-text"', 'both full-text columns retain the wrapping class')
assertIncludes(optimizeCompare, "renderSide('before')", 'comparison preserves the full original column')
assertIncludes(optimizeCompare, "renderSide('after')", 'comparison preserves the full revised column')
// 拆页后母页不得再同屏渲染 diff，否则等于没拆。
assertNotIncludes(optimize, 'ReactDiffViewer', 'optimize page no longer renders per-item diff inline (split to compare page)')
assertIncludes(optimize, "navigate('/resume/optimize/compare'", 'optimize page links to the split comparison page')
// 拆出去的那页必须诚实说明「本次选择不保存」——没有采纳落库端点。
assertIncludes(optimizeCompare, '未保存', 'compare page states the adoption selection is not persisted')
assertNotIncludes(optimizeCompare, '已保存', 'compare page avoids copy implying the selection was saved')
assertIncludes(optimizeCompare, '这是阅读草稿，不是简历最终稿', 'compare draft states it is a reading draft, not the final resume')
assertIncludes(optimizeCompare, '已采纳', 'compare draft labels adopted items as 已采纳 (reading-layer, not persisted)')
assertIncludes(optimizeCompare, '可采纳的全部采纳', 'compare page exposes batch adopt')
assertIncludes(optimizeCompare, '其余保留原文', 'compare page exposes batch keep original')
assertIncludes(optimizeCompare, '清空全部选择', 'compare page exposes batch clear (稿 23 uses user-facing 选择)')
assertIncludes(optimizeCompare, 'data-tone="danger"', 'compare clear action uses danger tone')
assertIncludes(optimize, 'CompareDecisionsApplyDialog', 'optimize page asks before applying compare decisions')
assertIncludes(optimize, '应用到编辑区', 'optimize apply dialog confirms writing into the editor')
assertIncludes(optimize, '暂不应用', 'optimize apply dialog can discard compare decisions')
assertNotIncludes(optimize, 'if (changes.length > 0) apply(changes)', 'optimize page no longer auto-applies compare decisions')
assertIncludes(optimizeCompare, 'setModules([])', 'compare page clears stale modules before reading another task')
assertIncludes(optimizeCompare, 'loadedTaskId === taskId', 'compare page renders modules only for the current task')
assertIncludes(optimizeCompare, 'setDecisions({})', 'compare page clears stale decisions before reading another task')
assertIncludes(optimizeCompare, 'setConfirmedByModule({})', 'compare page clears stale fact confirmations before reading another task')
assertIncludes(optimizeCompare, "label: '缺少简历'", 'compare page does not label missing context as ready for a decision')
assertIncludes(optimizeCompare, 'aria-pressed={decisions[keyAt(currentIndex)]', 'compare page exposes the current decision non-visually')

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
// 2026-09-23 迁入青序流光（稿 21）：两条拉伸断言从 Tailwind 类串改锚到本页 Qx 样式，判据不变。
const triageCss = read('src/pages/resume/resume-triage-qx.css')
assertIncludes(source, 'className="qx-rt-dropzone"', 'upload dropzone stretches to balance the direction column')
// 最终稿要求内容向下顺排，上传条不能为了平衡方向区拉成空白框。
assertIncludes(read('src/pages/resume/resume-r1-qx2.css'), ".qx-rt-dropzone { flex: none; min-height: 76px", 'source upload strip follows content without stretching an empty card')
assertIncludes(source, 'className="qx-rt-main"', 'upload column stays a stretch column')
assertIncludes(triageCss, '.qx-resume-triage .qx-rt-main { display: flex; flex-direction: column; min-width: 0;', 'upload column stays a stretch column (css)')

assertIncludes(report, "navigate('/resume/optimize'", 'report page navigates to optimize page')
assertIncludes(report, 'targetContext: state.targetContext', 'report page forwards targetContext into optimize navigate state')

assertIncludes(optimize, "'pdf'", 'optimize page offers pdf export format')
assertIncludes(optimize, "'docx'", 'optimize page offers docx export format')
assertIncludes(optimize, "'txt'", 'optimize page offers txt export format')
assertIncludes(optimize, "'md'", 'optimize page offers md export format')
assertIncludes(optimize, 'Word', 'optimize page labels docx as Word')
assertIncludes(optimize, 'Markdown', 'optimize page labels md as Markdown')
assertIncludes(optimize, 'exportFormat', 'optimize page tracks selected export format state')
assertIncludes(optimize, 'exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined', 'optimize page exports with selected format and layout')
assertIncludes(optimize, 'getResumeExportPricing', 'optimize export reads GET /resume/export/pricing')
assertIncludes(optimize, '免费试运营', 'optimize page shows free-mode copy from the pricing contract')
assertIncludes(optimize, 'factsConfirmedAt', 'optimize export sends factsConfirmedAt after the confirmation wall')
assertIncludes(optimize, "kind: 'change_list'", 'optimize page exports the change-list PDF')
assertIncludes(generatePreview, 'getResumeExportPricing', 'generate preview reads export pricing')
assertIncludes(generatePreview, 'exportGeneratedResume(resume, result.taskId, getToken()', 'generate preview keeps real export wrapper')

{
  const match = httpAdapter.match(/const LLM_TIMEOUT_MS\s*=\s*([0-9_]+)/)
  const clientMs = match ? Number(match[1].replace(/_/g, '')) : 0
  if (!(clientMs >= 90_000)) {
    throw new Error(`AI-01: kiosk LLM_TIMEOUT_MS must be >= 90000, got ${clientMs}`)
  }
  console.log(`PASS kiosk LLM timeout ${clientMs}ms >= 90s backend long timeout`)
}

assertIncludes(httpAdapter, 'format?: ResumeExportFormat', 'http adapter accepts optional export format')
assertIncludes(httpAdapter, 'layout?: ResumeLayoutSettings', 'http adapter accepts optional layout')
assertIncludes(httpAdapter, 'format ?? ', 'http adapter defaults export format to pdf when omitted')
assertIncludes(httpAdapter, '...(layout ? { layout } : {})', 'http adapter sends layout only when provided')
assertIncludes(
  httpAdapter,
  '...(charge?.factsConfirmedAt ? { factsConfirmedAt: charge.factsConfirmedAt } : {})',
  'http adapter forwards factsConfirmedAt on generate/export',
)
assertIncludes(httpAdapter, 'DTO 已收该字段，登录会员必发，否则 400', 'http adapter documents that members must send factsConfirmedAt')
assertNotIncludes(httpAdapter, 'DTO 尚无该字段', 'http adapter no longer omits factsConfirmedAt for the old DTO whitelist')

// ── Wave1 wrapper-consistency fix:导出格式必须走统一 API wrapper,不直连 adapter ──
const aiWrapper = read('src/services/api/ai.ts')

assertNotIncludes(optimize, "from '../../services/api/aiHttpAdapter'", 'optimize page does not import http adapter directly')
assertNotIncludes(optimize, "from '../../services/api/aiMockAdapter'", 'optimize page does not import mock adapter directly')
assertIncludes(optimize, "from '../../services/api'", 'optimize page imports resume actions from the api wrapper barrel')

assertIncludes(aiWrapper, 'format?: ResumeExportFormat', 'api wrapper exportGeneratedResume accepts optional export format')
assertIncludes(aiWrapper, 'layout?: ResumeLayoutSettings', 'api wrapper exportGeneratedResume accepts optional layout')
assertIncludes(aiWrapper, 'adapter.exportGeneratedResume(resume, taskId, token, format, layout, templateId, draft, charge)', 'api wrapper delegates format / layout / draft / charge to the selected adapter')

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
assertIncludes(optimize, 'exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined', 'optimize page exports with selected layout')
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
assertIncludes(optimize, "setAdjustWarnings(result.warnings?.length ? ['调整后的内容仍需你逐项核对，确认事实无误。'] : [])", 'layout adjust warnings map to one visible user hint without raw technical strings')
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
assertIncludes(optimize, 'templates.map', 'optimize page renders template choices')
assertIncludes(optimize, 'handleTemplateChange', 'optimize page clears stale export when template changes')
assertIncludes(optimize, 'PDF 导出按所选模板自动填充版式', 'optimize page explains PDF template fill scope')
assertIncludes(optimize, 'Word/TXT/Markdown 保持内容格式导出', 'optimize page does not overpromise non-PDF template printing')
assertIncludes(optimize, 'exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout, selectedTemplateId || undefined', 'optimize page exports with selected template id')
assertIncludes(aiWrapper, 'templateId?: string', 'api wrapper exportGeneratedResume accepts optional templateId')
assertIncludes(aiWrapper, 'adapter.exportGeneratedResume(resume, taskId, token, format, layout, templateId, draft, charge)', 'api wrapper delegates templateId / draft / charge to selected adapter')
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

assertIncludes(optimize, 'QxPageFrame', 'optimize page uses the Qingxu frame')
assertIncludes(generatePreview, 'QxPageFrame', 'generate preview uses the Qingxu frame')
assertIncludes(generatePreview, 'navbar={<GeneratePreviewNavbar', 'generate preview uses the QxPageFrame navbar slot instead of a page-local bar')
assertIncludes(generatePreview, '返回服务大厅', 'session-lost CTA matches prototype 返回服务大厅 → /')
assertIncludes(generatePreview, '重新填一份', 'session-lost / failed CTA keeps the refill action under the prototype name')
assertIncludes(generatePreview, '回去改资料', 'ready CTA refill is named 回去改资料')
assertIncludes(generatePreview, '内容没问题，去导出', 'ready CTA export is named 内容没问题，去导出')
assertIncludes(generatePreview, '去填资料', 'preview-no-result CTA refill is named 去填资料')
assertIncludes(generatePreview, '再读一次', 'preview-failed keeps the reread action')
assertNotIncludes(generatePreview, '重新填写生成', 'generate preview no longer duplicates refill as the old third control')
assertNotIncludes(generatePreview, '>重新填写<', 'generate preview no longer has a third same-meaning refill control')
assertNotIncludes(generatePreview, '>返回首页<', 'empty-state home exit uses prototype hub/home labels, not a third home control next to refill')
assertIncludes(optimize, '合成演示', 'optimize capture fixtures are labeled synthetic')
assertIncludes(optimize, "q.get('capture') === '1'", 'optimize fixtures require capture=1')
// 3.5c：屏显标识从本地写死的「AI 优化稿，请自行核对」改为共享标识（审计表一「简历优化对照（屏）」）。
// 三条合起来仍钉住原断言的全部内容：徽标绑定哪句、徽标真的渲染、那句逐字是什么。
assertIncludes(optimize, 'AIGC_SCREEN_MARK = AI_LABEL_COPY.RESUME_OPTIMIZE', 'optimize keeps the on-screen AIGC mark bound to the shared AI label')
assertIncludes(optimize, '<b>{AIGC_SCREEN_MARK}</b>', 'optimize renders the on-screen AIGC mark')
assertIncludes(read('../../packages/shared/src/types/complianceCopy.ts'), "RESUME_OPTIMIZE: 'AI 生成，仅供参考，请自行核对'", 'the on-screen AIGC mark reads AI 生成，仅供参考，请自行核对')
assertIncludes(optimize, '示意，非打印稿', 'HTML preview is labeled as non-print')
assertIncludes(optimize, '打印的就是这一份', 'real PDF copy is identified as the print file')
assertIncludes(optimize, '压到一页', 'optimize offers compress-to-one-page')
assertIncludes(optimize, 'expiresAt', 'optimize preview dialog receives expiresAt')
assertIncludes(optimize, 'useCountdown', 'QR countdown uses useCountdown')
for (const stateName of ['no-context', 'loading', 'ready', 'empty', 'read-error', 'optimize-failed', 'unavailable', 'illegal']) {
  assertIncludes(optimize, `'${stateName}'`, `optimize view state ${stateName} is registered`)
}
for (const stateName of ['preview-no-result', 'preview-loading', 'preview-failed', 'preview-ready', 'preview-hints', 'preview-editing', 'export-chooser', 'export-exporting', 'export-failed', 'export-ready', 'export-url-expired', 'export-print-unavailable', 'session-lost', 'illegal']) {
  assertIncludes(generatePreview, `'${stateName}'`, `generate preview view state ${stateName} is registered`)
}

// W-107 / W-108：执行真实源码片段，覆盖默认提交、密码识别和失败屏出路。
function sourceNode(text, name) {
  const ast = ts.createSourceFile('fixture.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `source node ${name} exists`)
  return ts.isVariableDeclaration(found) ? `const ${found.getText(ast)};` : found.getText(ast)
}
function executable(text) {
  return ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
}
const targetNames = ['genericDiagnosis', 'targetIndustry', 'targetJob', 'targetExperience', 'targetScene', 'targetMajor', 'targetDegree']
// 解构声明的 name 是整个 [value, setter]，按完整源码名称查找。
const targetSetters = ['setGenericDiagnosis', 'setTargetIndustry', 'setTargetJob', 'setTargetExperience', 'setTargetScene', 'setTargetMajor', 'setTargetDegree']
const targetSource = targetNames.map((name, i) => sourceNode(source, `[${name}, ${targetSetters[i]}]`)).join('\n')
const buildTarget = new Function('useState', executable(`${targetSource}\n${sourceNode(source, 'buildTargetContext')}\nreturn { values: [targetIndustry, targetExperience, targetScene], target: buildTargetContext() };`))
assert.deepEqual(buildTarget((value) => [value]).values, ['', undefined, undefined], 'W-107 行业、经验、求职场景均不预选')
assert.deepEqual(buildTarget((value) => [value]).target, { skipped: true }, 'W-107 不选方向按通用标准提交')
let targetIndex = 0
const chosen = [false, '制造业', '理货员', '5年以上', '社招', '', '']
assert.deepEqual(buildTarget(() => [chosen[targetIndex++]]).target, {
  industry: '制造业', targetJob: '理货员', experience: '5年以上', scene: '社招', major: undefined, degree: undefined, skipped: false,
}, 'W-107 本人选择原样参与诊断')
assertIncludes(source, '没选方向，按通用标准看', 'W-107 页面如实说明未选方向')
assertIncludes(source, 'selectedDimensions: buildTargetContext().skipped ? [] : selectedDimensions', 'W-107 通用诊断不带默认重点')

const pdfSource = read('src/components/PdfCanvasPreview.tsx')
const pdfModule = { exports: {} }
let passwordFixture = false
let brokenFixture = false
let destroyCount = 0
const loadPdfjs = async () => ({ getDocument: () => {
  let reject
  const task = { destroyed: false, promise: new Promise((resolve, fail) => {
    reject = fail
    queueMicrotask(() => {
      if (passwordFixture) task.onPassword?.()
      else if (brokenFixture) fail(new Error('invalid PDF'))
      else resolve({ numPages: 1 })
    })
  }), destroy: async () => { destroyCount++; task.destroyed = true; reject(new Error('destroyed')) } }
  return task
} })
new Function('exports', 'loadPdfjs', 'pdfjsDataUrl', 'fetch', executable([
  sourceNode(pdfSource, 'createPdfLoadingTask'), sourceNode(pdfSource, 'checkPdfOpeningPassword'),
].join('\n')))(pdfModule.exports, loadPdfjs, () => '/pdfjs/', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }))
passwordFixture = true
assert.equal(await pdfModule.exports.checkPdfOpeningPassword('/original.pdf', new AbortController().signal), true, 'W-108 共用 PDF.js 打开密码回调认出加密')
passwordFixture = false
assert.equal(await pdfModule.exports.checkPdfOpeningPassword('/ordinary.pdf', new AbortController().signal), false, 'W-108 普通 PDF 不算加密')
brokenFixture = true
await assert.rejects(pdfModule.exports.checkPdfOpeningPassword('/broken.pdf', new AbortController().signal), /invalid PDF/, 'W-108 普通损坏保持普通失败')
assert.equal(destroyCount, 4, 'W-108 密码、普通、损坏核查均释放 PDF 任务')
assertIncludes(pdfSource, 'const loadingTask = await createPdfLoadingTask(bytes,', 'W-108 预览与诊断复用打开密码识别')
assertIncludes(report, 'checkPdfOpeningPassword(failedPdfUrl, controller.signal)', 'W-108 失败页实际核查原件')
assertIncludes(report, "inspectionSignalsEncrypted([state.failureCode ?? '', reason ?? '', recoveredFail ?? ''])", 'W-108 同时识别服务端明确错误码')
assertIncludes(parse, "undefined, false, aiErrorCodeOf(err))", 'W-108 错误码从解析页传到报告页')

// 执行真实失败 CTA 的分支，避免仅凭新文案存在就通过。
const renderFailCta = new Function('encryptedPdf', 'checkingPassword', 'state', 'React', 'stepActions', 'navigate', 'handleRetry', 'intent', executable(`${sourceNode(report, 'failCta')}\n${sourceNode(report, 'fileFailureCta')}\nreturn fileFailureCta;`))
const React = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment' }
function labels(node) { return typeof node === 'string' ? node : node?.children?.map(labels).join('') ?? '' }
let destination
const encryptedCta = renderFailCta(true, false, {}, React, null, (...args) => { destination = args }, () => { throw new Error('encrypted retry') }, 'optimize')
assert.equal(labels(encryptedCta), '重新选择文件', 'W-108 加密文件只给重新选择文件')
encryptedCta.props.onClick()
assert.deepEqual(destination, ['/resume/source?intent=optimize', { replace: true }], 'W-108 换文件保留优化意图')
assert.match(labels(renderFailCta(false, false, {}, React, null, () => {}, () => {}, 'diagnose')), /重新解析/, 'W-108 非加密失败保留重新解析')
assertIncludes(report, '!encryptedPdf && !checkingPassword && <ResumeDiagnosisFailExits', 'W-108 加密或尚未核查时不显示打印原件等出路')
assertIncludes(report, 'encryptedPdf ? <p>{ENCRYPTED_PDF_BLOCK_COPY}。</p>', 'W-108 加密失败显示打印链的密码原句')
const printKindSource = read('src/pages/print/components/printPreviewKind.ts')
const printKindModule = { exports: {} }
new Function('exports', executable([
  sourceNode(printKindSource, 'ENCRYPTED_PDF_BLOCK_COPY'),
  sourceNode(printKindSource, 'ENCRYPTED_PDF_CODES'),
  sourceNode(printKindSource, 'inspectionSignalsEncrypted'),
].join('\n')))(printKindModule.exports)
for (const code of ['PDF_ENCRYPTED', 'PII_REDACT_ENCRYPTED', 'encrypted']) {
  assert.equal(printKindModule.exports.inspectionSignalsEncrypted([code]), true, `W-108 识别明确加密码 ${code}`)
}
assert.equal(printKindModule.exports.inspectionSignalsEncrypted(['PDF_PAGE_COUNT_NOT_DETECTED', 'UNSUPPORTED_FILE_TYPE']), false, 'W-108 普通错误码不冒充加密')
class ApiHttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code } }
const errorOutcome = new Function('aiErrorCodeOf', 'inspectionSignalsEncrypted', 'ApiHttpError', executable(`${sourceNode(parse, 'NO_REPLY_CODES')}\n${sourceNode(parse, 'parseErrorOutcome')}\nreturn parseErrorOutcome;`))((error) => error.code, printKindModule.exports.inspectionSignalsEncrypted, ApiHttpError)
assert.equal(errorOutcome(new ApiHttpError(400, 'PDF_ENCRYPTED')), 'failed', 'W-108 明确加密码进入失败屏')
assert.equal(errorOutcome(new ApiHttpError(500, 'PDF_ENCRYPTED')), 'failed', 'W-108 有明确加密码时不误留在未知结果屏')
assert.equal(errorOutcome(new ApiHttpError(500, 'UNSUPPORTED_FILE_TYPE')), 'unknown', 'W-108 普通 5xx 继续保持结果未知边界')

// 密码文案常量的 declaration 节点不含 export，用同一源码求值。
const passwordCopy = new Function(executable(`${sourceNode(printKindSource, 'ENCRYPTED_PDF_BLOCK_COPY')}\nreturn ENCRYPTED_PDF_BLOCK_COPY;`))()
const renderFailure = new Function('encryptedPdf', 'checkingPassword', 'React', 'QxPageFrame', 'navigate', 'REPORT_STATUS', 'nav', 'fileFailureCta', 'ResumeReportHead', 'ENCRYPTED_PDF_BLOCK_COPY', 'resumeUserReason', 'ResumeDiagnosisFailExits', 'state', executable(`${sourceNode(report, 'failView')}\nreturn failView('PDF 解析失败，请确认文件未损坏后重试');`))
const failedTree = (encrypted, checking = false) => renderFailure(encrypted, checking, React, 'frame', () => {}, {}, null, null, 'head', passwordCopy, (reason) => reason, 'original-exits', { file: { name: 'resume.pdf' }, fileId: 'original' })
function hasOriginalExits(node) { return node?.type === 'original-exits' || Boolean(node?.children?.some(hasOriginalExits)) }
assert.match(labels(failedTree(true)), /这份 PDF 设置了打开密码，本机没法读取。请在手机或电脑上去掉密码后重新上传。/, 'W-108 实际失败正文显示准确密码原因')
assert.equal(hasOriginalExits(failedTree(true)), false, 'W-108 实际加密失败屏不渲染打印原件')
assert.equal(hasOriginalExits(failedTree(false, true)), false, 'W-108 确认密码前不渲染打印原件')
assert.equal(hasOriginalExits(failedTree(false)), true, 'W-108 普通失败仍渲染原来出路')
assert.match(labels(failedTree(false)), /PDF 解析失败，请确认文件未损坏后重试/, 'W-108 普通失败保留原来原因')
assertIncludes(report, 'ctabar={fileFailureCta}', 'W-108 页面实际渲染选择文件 CTA')
console.log('PASS W-107 未预选与通用提交 / W-108 加密识别与真实出路')

const factsTest = join(dirname(fileURLToPath(import.meta.url)), 'tests/export-generated-resume-facts.test.mjs')
const factsRun = spawnSync(process.execPath, ['--test', factsTest], { stdio: 'inherit' })
if (factsRun.status !== 0) {
  throw new Error(`exportGeneratedResume factsConfirmedAt unit test failed (exit ${factsRun.status ?? 'null'})`)
}

// 批次 D：执行真实呈现分支，防旧服务端免费标签和未确认的保存状态再次上屏。
const pricingBarSource = read('src/pages/resume/components/resume-deliver/ResumePricingBar.tsx')
const freeCopySource = read('src/pages/resume/components/resume-deliver/constants.ts')
const freeCopy = new Function(executable(`${sourceNode(freeCopySource, 'FREE_PRICING_COPY')}\nreturn FREE_PRICING_COPY;`))()
const renderPricing = new Function('React', 'FREE_PRICING_COPY', executable(`${sourceNode(pricingBarSource, 'ResumePricingBar').replace('export ', '')}\nreturn ResumePricingBar;`))(React, freeCopy)
assert.equal(labels(renderPricing({ pricing: { mode: 'free', label: '旧的收费和权益附带说明' }, loading: false, blockedReason: null })), '免费试运营', '免费态只显示定稿，旧服务端 label 不上屏')
assert.match(labels(renderPricing({ pricing: { mode: 'charged', label: '核销一次', benefit: { available: 2 } }, loading: false, blockedReason: null })), /核销一次.*可用权益 2 次/, '收费态保留价目与权益次数')
const resultSource = read('src/pages/resume/components/resume-deliver/ResumeExportResult.tsx')
const renderResult = new Function('React', 'useCountdown', 'formatFileSize', 'PRINT_THIS_COPY', 'FileContentPreview', 'QRCodeSVG', executable(`${sourceNode(resultSource, 'ResumeExportResult').replace('export ', '')}\nreturn ResumeExportResult;`))(React, () => ({ expired: false, label: '10 分钟' }), () => '1 KB', '打印的就是这一份', 'preview', 'qr')
const fileProps = { exported: { signedUrl: 'https://example.invalid/file', filename: '本人简历.pdf', pageCount: 1, sizeBytes: 1 }, formatLabel: 'PDF', kind: 'resume', version: 1, guest: false }
assert.match(labels(renderResult({ ...fileProps, savedToDocuments: true })), /已存入「我的文档」/, '确认保存的优化稿说已存入')
assert.match(labels(renderResult({ ...fileProps, kind: 'change_list', savedToDocuments: true })), /已存入「我的文档」/, '确认保存的修改清单使用同一说法')
for (const savedToDocuments of [false, undefined]) assert.doesNotMatch(labels(renderResult({ ...fileProps, savedToDocuments })), /已存入/, '未确认保存时不说已存入')
assert.doesNotMatch(labels(renderResult({ ...fileProps, savedToDocuments: true, exported: { ...fileProps.exported, signedUrl: '' } })), /已存入/, '无真实文件不能宣称已存入')
assert.doesNotMatch(labels(renderResult({ ...fileProps, savedToDocuments: false })), /未登录/, '会员保存失败不冒充未登录')
const pageSource = read('src/pages/resume/ResumeOptimizePage.tsx')
const ownershipEffect = /useEffect\(\(\) => \{\n    if \(exportKind !== 'resume'[\s\S]*?\}, \[exported, exportKind, token, setSavedToDocuments\]\)/.exec(pageSource)?.[0]
assert.ok(ownershipEffect, '优化稿实际查询本人的文件归属')
const runOwnershipEffect = new Function('useEffect', 'exportKind', 'exported', 'token', 'getMyDocuments', 'setSavedToDocuments', executable(ownershipEffect))
for (const scenario of ['owned', 'other', 'failed', 'canceled', 'guest']) {
  const confirmed = []
  let cleanup
  runOwnershipEffect((fn) => { cleanup = fn() }, 'resume', { fileId: 'this-file' }, scenario === 'guest' ? null : 'member-token', async () => {
    if (scenario === 'failed') throw new Error('offline')
    return { items: [{ id: scenario === 'other' ? 'another-file' : 'this-file' }] }
  }, (value) => confirmed.push(value))
  if (scenario === 'canceled') cleanup()
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(confirmed, scenario === 'owned' ? [true] : [], `保存提示归属检查：${scenario}`)
}
assertIncludes(source, '这次想让我做什么', '取件页有实际意图选择')
assertIncludes(source, 'compact={!uploadedFile}', '未上传也有常驻方向摘要')
assertIncludes(read('src/pages/resume/components/resume-report/ResumeReportBody.tsx'), '<ResumeReportStates viewState="report-empty" />', '空报告复用真实出口与人工自查，不填造结论')
const formatChooser = read('src/pages/resume/components/resume-deliver/ResumeFormatChooser.tsx')
assertIncludes(formatChooser, 'aria-label="文件生成流程"', '导出等待态四步流程常驻')
assertIncludes(formatChooser, '系统没有提供逐步进度', '流程说明不冒充服务端逐步进度')
console.log('PASS batch D 免费标签、保存归属、取件摘要、空报告和导出流程')

const PAGE_AIGC_NOTE = '导出的简历每页底部有一行小字：含人工智能辅助生成内容'
const FILE_AIGC_NOTE = '导出的文件末尾有一行：含人工智能辅助生成内容'
const deliverPanel = read('src/pages/resume/components/resume-deliver/ResumeDeliverPanel.tsx')
for (const [src, label] of [[formatChooser, '选格式卡'], [deliverPanel, '导出格式区']]) {
  assertIncludes(src, PAGE_AIGC_NOTE, `${label}含页脚标注说明`)
  assertIncludes(src, FILE_AIGC_NOTE, `${label}含文末标注说明`)
  assertIncludes(src, 'function resumeExportAigcNote', `${label}按格式选择标注说明`)
}
assertIncludes(formatChooser, '{resumeExportAigcNote(props.format)}', '选格式卡按当前格式渲染标注说明')
assertIncludes(deliverPanel, '{resumeExportAigcNote(props.exportFormat)}', '导出格式区按当前格式渲染标注说明')
assertIncludes(formatChooser, "props.screen === 'export-chooser'", '选格式卡只在选格式屏渲染')

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && Array.isArray(node.children)) return textOf(node.children)
  return ''
}
const useStateStub = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}]
const renderChooser = new Function('React', 'useState', 'ResumeLayoutControls', 'COMPRESS_ONE_PAGE', 'ResumeExportResult', 'ResumePricingBar', executable([
  sourceNode(formatChooser, 'FORMATS'),
  sourceNode(formatChooser, 'FONT_CHOICES'),
  sourceNode(formatChooser, 'formatName'),
  sourceNode(formatChooser, 'resumeExportAigcNote'),
  sourceNode(formatChooser, 'ResumeFormatChooser').replace(/^export /, ''),
  sourceNode(formatChooser, 'SyntheticFileCard'),
  'return ResumeFormatChooser;',
].join('\n')))(React, useStateStub, () => null, '压到一页', () => null, () => null)
const chooserProps = {
  screen: 'export-chooser',
  format: 'pdf',
  onFormatChange: () => {},
  layout: { columns: 1, fontScale: 'standard', lineSpacing: 'standard', margin: 'standard', accent: 'teal' },
  onLayoutChange: () => {},
  templates: [],
  templatesError: false,
  selectedTemplateId: '',
  onTemplateChange: () => {},
  exporting: false,
  exported: null,
  exportError: null,
  exportVersion: 0,
  pricing: null,
  pricingLoading: false,
  blockedReason: null,
  guest: true,
  synthetic: false,
  printNavigating: false,
  onPrint: () => {},
  onOpenPreview: () => {},
  onClearExport: () => {},
  onHelp: () => {},
  estimatedPagesLabel: '导出后显示真实页数',
}
for (const format of ['pdf', 'docx']) {
  const shown = textOf(renderChooser({ ...chooserProps, format }))
  assert.match(shown, new RegExp(PAGE_AIGC_NOTE), `${format} 选格式卡渲染页脚标注说明`)
  assert.doesNotMatch(shown, new RegExp(FILE_AIGC_NOTE), `${format} 选格式卡不渲染文末标注说明`)
}
for (const format of ['txt', 'md']) {
  const shown = textOf(renderChooser({ ...chooserProps, format }))
  assert.match(shown, new RegExp(FILE_AIGC_NOTE), `${format} 选格式卡渲染文末标注说明`)
  assert.doesNotMatch(shown, new RegExp(PAGE_AIGC_NOTE), `${format} 选格式卡不渲染页脚标注说明`)
}
assert.doesNotMatch(textOf(renderChooser({ ...chooserProps, screen: 'export-exporting' })), /含人工智能辅助生成内容/, '还没进入选格式时不渲染标注说明')

const deliverConstants = read('src/pages/resume/components/resume-deliver/constants.ts')
const renderDeliver = new Function('React', 'ResumeLayoutControls', 'COMPRESS_ONE_PAGE', 'EXPORT_FORMAT_OPTIONS', 'ResumeExportResult', 'ResumePricingBar', executable([
  sourceNode(deliverPanel, 'resumeExportAigcNote'),
  sourceNode(deliverPanel, 'ResumeDeliverPanel').replace(/^export /, ''),
  'return ResumeDeliverPanel;',
].join('\n')))(React, () => null, '压到一页', new Function(executable(`${sourceNode(deliverConstants, 'EXPORT_FORMAT_OPTIONS')}\nreturn EXPORT_FORMAT_OPTIONS;`))(), () => null, () => null)
const deliverProps = {
  layout: chooserProps.layout,
  onLayoutChange: () => {},
  templates: [],
  templatesError: false,
  selectedTemplateId: '',
  onTemplateChange: () => {},
  exportFormat: 'pdf',
  onExportFormatChange: () => {},
  exporting: false,
  printNavigating: false,
  exported: null,
  exportKind: 'resume',
  exportError: null,
  exportVersion: 0,
  pricing: null,
  pricingLoading: false,
  blockedReason: null,
  exportBlocked: false,
  onRequestExport: () => {},
  showChangeList: false,
  onPrint: () => {},
  onOpenPreview: () => {},
  guest: true,
  estimatedPagesLabel: '导出后显示真实页数',
}
for (const exportFormat of ['pdf', 'docx']) {
  const shown = textOf(renderDeliver({ ...deliverProps, exportFormat }))
  assert.match(shown, new RegExp(PAGE_AIGC_NOTE), `${exportFormat} 导出格式区渲染页脚标注说明`)
  assert.doesNotMatch(shown, new RegExp(FILE_AIGC_NOTE), `${exportFormat} 导出格式区不渲染文末标注说明`)
}
for (const exportFormat of ['txt', 'md']) {
  const shown = textOf(renderDeliver({ ...deliverProps, exportFormat }))
  assert.match(shown, new RegExp(FILE_AIGC_NOTE), `${exportFormat} 导出格式区渲染文末标注说明`)
  assert.doesNotMatch(shown, new RegExp(PAGE_AIGC_NOTE), `${exportFormat} 导出格式区不渲染页脚标注说明`)
}

const draftStart = generate.indexOf('const handleExportDraft')
const draftEnd = generate.indexOf('const availability', draftStart)
assert.ok(draftStart >= 0 && draftEnd > draftStart, '填写页有按原样导出函数')
const draftBranch = generate.slice(draftStart, draftEnd)
assert.match(draftBranch, /exportResumeDraft\(/, '按原样导出走 exportResumeDraft')
assert.doesNotMatch(draftBranch, /含人工智能辅助生成内容/, '按原样导出分支不渲染人工智能标注说明')
assert.doesNotMatch(draftBranch, /resumeExportAigcNote/, '按原样导出分支不调用标注说明')
assertNotIncludes(generate, PAGE_AIGC_NOTE, '按原样导出页不含页脚标注说明')
assertNotIncludes(generate, FILE_AIGC_NOTE, '按原样导出页不含文末标注说明')
assertNotIncludes(generate, 'ResumeFormatChooser', '按原样导出不渲染选格式卡')
assertNotIncludes(generate, 'ResumeDeliverPanel', '按原样导出不渲染优化导出区')
console.log('PASS 导出标注说明按格式显示，按原样导出不渲染')

console.log('PASS resume diagnosis flow UI verification')
