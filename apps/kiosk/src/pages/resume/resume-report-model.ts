import type {
  ResumeContentBlock,
  ResumeContentBlockKey,
  ResumeIssue,
  ResumePriority,
  ResumeReport,
  ResumeScoringDimensionKey,
  ResumeSection,
  ResumeTargetContext,
} from '@ai-job-print/shared'
import { RESUME_CONTENT_BLOCKS, RESUME_SCORING_DIMENSIONS } from '@ai-job-print/shared'

export const EXPORT_CAPTURE_STATES = [
  'export-ready',
  'export-failed',
  'pricing-charged',
  'pricing-unavailable',
] as const
export type ExportCaptureState = (typeof EXPORT_CAPTURE_STATES)[number]

export const REPORT_STATES = [
  'no-context',
  'loading',
  'report',
  'report-minimal',
  'report-empty',
  'read-error',
  'diagnose-failed',
  'unavailable',
  'illegal',
  ...EXPORT_CAPTURE_STATES,
] as const
export type ReportViewState = (typeof REPORT_STATES)[number]

export const FIXTURE_STATES = ['report', 'report-minimal', 'report-empty', ...EXPORT_CAPTURE_STATES] as const
export type FixtureState = (typeof FIXTURE_STATES)[number]

export const REPORT_SEGS = ['structure', 'issues', 'scores', 'conclusions'] as const
export type ReportSeg = (typeof REPORT_SEGS)[number]

export const TASK_ID_RE = /^[A-Za-z0-9_-]{1,24}$/
export const GUEST_TAKEAWAY_COPY = '登录后可存我的文档，本次可扫码带走'
export const SAVED_TO_DOCUMENTS_COPY = '已存入我的文档'
export const EXPORT_BEFORE_PRINT_COPY = '请先导出 PDF，成功后才能打印或扫码带走。'
export const EXPORT_ERROR_COPY: Record<string, string> = {
  AI_RESULT_NOT_READY: '诊断结果还没准备好，请稍后再导出。刷新本页或重新诊断后再试。',
  RESUME_PDF_FONT_NOT_FOUND: '服务器缺少中文字体，已通知运维；你可以先打印原件或扫码保存。',
  RESUME_EXPORT_UNAVAILABLE: '简历导出当前不可用（价目已停用，不是免费）。',
  AI_TASK_NOT_FOUND: '找不到这份报告，可能已过期或无权查看。请从简历来源重新进入。',
}
export const TIER_RULE =
  '档位与严重度都由同一个分数机械分档：八成及以上（较强／低），一半到八成（中等／中），不足一半（偏弱／高）。它们不是新结论，也不是排名或通过率。'

export const DIM_ABOUT: Record<ResumeScoringDimensionKey, string> = {
  basic: '看姓名、联系方式、求职意向是否齐全好找。',
  objective: '看有没有写明目标岗位，全篇是否围绕它。',
  experience: '看每段经历有没有交代做法与结果。',
  quantification: '看成果有没有用可核实的数字说明。',
  keyword: '看用词与目标岗位的常见表述是否对得上。',
  readability: '看分区、留白与长度是否便于快速阅读。',
}

export const MANUAL_CHECKS = [
  '姓名、手机号、邮箱在第一屏就能看到',
  '每段经历都写了起止时间',
  '职责后面跟着结果，不只写「负责什么」',
  '技能写清工具名称和熟练程度',
  '通读一遍，没有错别字和断行',
  '控制在一到两页，导出后再看一次排版',
]

export const FLOW_RAIL = ['上传与方向', 'AI 解析', '诊断报告', '优化打印'] as const

export const REPORT_HEAD: Record<ReportViewState, { title: string; sub: string; tag: string; rail: number }> = {
  'no-context': { title: '简历诊断报告', sub: '需要一份已完成解析的本人简历，才会有报告。', tag: '无报告', rail: 0 },
  loading: { title: '简历诊断报告', sub: '正在按编号读取这份报告，读取本身不会改动任何文件。', tag: '读取中', rail: 2 },
  report: { title: '简历诊断报告', sub: '简历被读成七块，问题各自指到原文那一句。', tag: '报告已读取', rail: 2 },
  'report-minimal': { title: '简历诊断报告', sub: '这是一份早期报告：有分数和建议，但没有优先级和风险提醒。', tag: '早期报告', rail: 2 },
  'report-empty': { title: '简历诊断报告', sub: '报告读回来了，但里面一条内容都没有。', tag: '空报告', rail: 2 },
  'read-error': { title: '简历诊断报告', sub: '这次没能取到报告，你上传的原件不受影响。', tag: '读取失败', rail: 2 },
  'diagnose-failed': { title: '简历诊断报告', sub: '解析中断，你上传的文件没有丢。', tag: '解析失败', rail: 1 },
  unavailable: { title: '简历诊断报告', sub: '这台机器还没有接通报告读取能力，不是你的简历有问题。', tag: '未接通', rail: 0 },
  illegal: { title: '简历诊断报告', sub: '地址里的参数不在登记范围内，已按不可用处理。', tag: '参数不合法', rail: 0 },
  'export-ready': { title: '简历诊断报告', sub: '诊断报告 PDF 已生成，可打印或扫码带走。', tag: '导出已生成', rail: 2 },
  'export-failed': { title: '简历诊断报告', sub: '这次没有生成文件，按钮不会假装成功。', tag: '导出失败', rail: 2 },
  'pricing-charged': { title: '简历诊断报告', sub: '导出按次收费，没有可用权益时按钮不可用。', tag: '收费导出', rail: 2 },
  'pricing-unavailable': { title: '简历诊断报告', sub: '导出当前不可用，不是免费。', tag: '导出不可用', rail: 2 },
}

export const REPORT_STATUS: Record<ReportViewState, { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }> = {
  'no-context': { tone: 'unknown', label: '无报告' },
  loading: { tone: 'unknown', label: '读取中' },
  report: { tone: 'ok', label: '报告已读取' },
  'report-minimal': { tone: 'ok', label: '早期报告' },
  'report-empty': { tone: 'warn', label: '空报告' },
  'read-error': { tone: 'bad', label: '读取失败' },
  'diagnose-failed': { tone: 'bad', label: '解析失败' },
  unavailable: { tone: 'warn', label: '能力未接通' },
  illegal: { tone: 'warn', label: '参数不合法' },
  'export-ready': { tone: 'ok', label: '导出已生成' },
  'export-failed': { tone: 'bad', label: '导出失败' },
  'pricing-charged': { tone: 'warn', label: '收费导出' },
  'pricing-unavailable': { tone: 'warn', label: '导出不可用' },
}

export type ScoreTier = { word: '较强' | '中等' | '偏弱'; tone: 'ok' | 'mid' | 'low' }
export type Severity = { key: 'high' | 'mid' | 'low'; word: string }

export interface ReportSearch {
  capture: boolean
  debug: boolean
  tech: boolean
  flat: boolean
  fallback: boolean
  urlState: ReportViewState | null
  queryTaskId: string | undefined
  ridBad: boolean
  seg: ReportSeg | null
  dim: ResumeScoringDimensionKey | null
  blk: ResumeContentBlockKey | null
}

export interface ReportRecord {
  report?: ResumeReport
  providerName?: string
  extractionNotice?: {
    textSource: string
    confidence: 'high' | 'medium' | 'low'
    warnings: string[]
  }
  targetContext?: ResumeTargetContext
  failReason?: string
  status?: string
}

function isState(value: string): value is ReportViewState {
  return (REPORT_STATES as readonly string[]).includes(value)
}
function isSeg(value: string): value is ReportSeg {
  return (REPORT_SEGS as readonly string[]).includes(value)
}
function isDim(value: string): value is ResumeScoringDimensionKey {
  return RESUME_SCORING_DIMENSIONS.some((item) => item.key === value)
}
function isBlk(value: string): value is ResumeContentBlockKey {
  return RESUME_CONTENT_BLOCKS.some((item) => item.key === value)
}
function isFixtureState(value: string): value is FixtureState {
  return (FIXTURE_STATES as readonly string[]).includes(value)
}

export function isExportCaptureState(value: string | null | undefined): value is ExportCaptureState {
  return Boolean(value && (EXPORT_CAPTURE_STATES as readonly string[]).includes(value))
}

export function shouldSkipReportFetch(tech: boolean, urlState: ReportViewState | null): boolean {
  return Boolean(tech && urlState)
}

export function showsReportBody(viewState: ReportViewState): boolean {
  return viewState === 'report' || viewState === 'report-minimal' || isExportCaptureState(viewState)
}

export function parseReportSearch(search: string): ReportSearch {
  const q = new URLSearchParams(search)
  const capture = q.get('capture') === '1'
  const debug = q.get('debug') === '1'
  const tech = capture || debug
  const flat = q.get('flat') === '1' || capture
  let fallback = false

  const wanted = q.get('state')
  let urlState: ReportViewState | null = null
  if (wanted === null) urlState = null
  else if (!isState(wanted)) {
    fallback = true
    urlState = 'illegal'
  } else urlState = wanted

  const rawRid = q.get('taskId') || q.get('resumeId')
  const queryTaskId = rawRid && TASK_ID_RE.test(rawRid) ? rawRid : undefined
  const ridBad = Boolean(rawRid) && !queryTaskId
  if (ridBad) fallback = true

  const rawSeg = q.get('seg')
  let seg: ReportSeg | null = rawSeg === null ? null : isSeg(rawSeg) ? rawSeg : ((fallback = true), null)
  const rawDim = q.get('dim')
  let dim: ResumeScoringDimensionKey | null =
    rawDim === null ? null : isDim(rawDim) ? rawDim : ((fallback = true), null)
  const rawBlk = q.get('blk')
  let blk: ResumeContentBlockKey | null =
    rawBlk === null ? null : isBlk(rawBlk) ? rawBlk : ((fallback = true), null)

  if (dim && rawSeg === null) seg = 'scores'
  else if (dim && seg !== 'scores') {
    dim = null
    fallback = true
  }
  if (blk && rawSeg === null) seg = 'structure'
  else if (blk && seg !== 'structure') {
    blk = null
    fallback = true
  }

  if (urlState && isFixtureState(urlState) && !tech) {
    urlState = 'no-context'
    fallback = true
  }
  if (urlState && isFixtureState(urlState) && ridBad) urlState = 'no-context'
  if (urlState === 'loading' && !queryTaskId && tech) {
    urlState = 'no-context'
    fallback = true
  }

  return { capture, debug, tech, flat, fallback, urlState, queryTaskId, ridBad, seg, dim, blk }
}

export function tierOf(score: number, maxScore: number): ScoreTier {
  const ratio = maxScore > 0 ? score / maxScore : 0
  if (ratio >= 0.8) return { word: '较强', tone: 'ok' }
  if (ratio >= 0.5) return { word: '中等', tone: 'mid' }
  return { word: '偏弱', tone: 'low' }
}

export function sevOf(sections: ResumeSection[], dim: string): Severity {
  const section = sections.find((item) => item.key === dim)
  const ratio = section && section.maxScore > 0 ? section.score / section.maxScore : 0
  if (ratio < 0.5) return { key: 'high', word: '严重度 高' }
  if (ratio < 0.8) return { key: 'mid', word: '严重度 中' }
  return { key: 'low', word: '严重度 低' }
}

export function classifyReportKind(report: ResumeReport | undefined): 'full' | 'minimal' | 'empty' | null {
  if (!report) return null
  if (report.sections.length === 0 && report.suggestions.length === 0) return 'empty'
  const additive =
    (report.priorities?.length ?? 0) > 0 ||
    (report.riskNotes?.length ?? 0) > 0 ||
    (report.issues?.length ?? 0) > 0 ||
    (report.contentBlocks?.length ?? 0) > 0
  return additive ? 'full' : 'minimal'
}

export function deriveViewState(input: {
  urlState: ReportViewState | null
  tech: boolean
  taskId?: string
  success: boolean
  recoveredFail: string | null
  loading: boolean
  loadError: boolean
  outage: boolean
  report?: ResumeReport
}): ReportViewState {
  if (input.urlState === 'illegal') return 'illegal'
  if (input.tech && input.urlState) return input.urlState
  if (!input.success || input.recoveredFail) return 'diagnose-failed'
  if (input.outage) return 'unavailable'
  if (input.loading) return 'loading'
  if (input.loadError) return 'read-error'
  if (!input.report && !input.taskId) return 'no-context'
  if (!input.report) return 'read-error'
  const kind = classifyReportKind(input.report)
  if (kind === 'empty') return 'report-empty'
  if (kind === 'minimal') return 'report-minimal'
  return 'report'
}

export function defaultSeg(report: ResumeReport | undefined, requested: ReportSeg | null): ReportSeg {
  if (requested) return requested
  if ((report?.contentBlocks?.length ?? 0) > 0) return 'structure'
  if ((report?.issues?.length ?? 0) > 0) return 'issues'
  if ((report?.sections.length ?? 0) > 0) return 'scores'
  return 'conclusions'
}

export function targetSummary(tc?: ResumeTargetContext): string | null {
  if (!tc) return null
  if (tc.skipped) return '通用诊断（未指定方向）'
  const parts = [tc.industry, tc.targetJob, tc.experience, tc.scene].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function dimLabel(key: string): string {
  return RESUME_SCORING_DIMENSIONS.find((item) => item.key === key)?.label ?? key
}

export function blockLabel(key: string): string {
  return RESUME_CONTENT_BLOCKS.find((item) => item.key === key)?.label ?? key
}

export function derivedPriorities(sections: ResumeSection[]): ResumePriority[] {
  return [...sections]
    .filter((s) => s.maxScore > 0)
    .map((s) => ({ ...s, pct: Math.round((s.score / s.maxScore) * 100) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3)
    .filter((s) => s.pct < 100)
    .map((s) => ({
      focus: s.label,
      reason: `这一项得分 ${s.score}/${s.maxScore}，建议优先把表达补完整。`,
    }))
}

export function issuesOfBlock(issues: ResumeIssue[], key: string): ResumeIssue[] {
  return issues.filter((issue) => issue.evidence.some((ev) => ev.blockKey === key))
}

export function evidenceLineSet(issues: ResumeIssue[], key: string): Set<number> {
  const set = new Set<number>()
  for (const issue of issues) {
    for (const ev of issue.evidence) if (ev.blockKey === key) set.add(ev.lineIndex)
  }
  return set
}

export function quantHits(blocks: ResumeContentBlock[]): number {
  let n = 0
  for (const block of blocks) {
    if (block.key !== 'experience' && block.key !== 'project') continue
    for (let i = 1; i < block.lines.length; i += 1) {
      n += (block.lines[i]?.match(/\d+(?:[.．]\d+)*/g) ?? []).length
    }
  }
  return n
}

export function conclusionCount(report: ResumeReport): number {
  return (report.priorities?.length ?? 0) + report.suggestions.length + (report.riskNotes?.length ?? 0)
}
