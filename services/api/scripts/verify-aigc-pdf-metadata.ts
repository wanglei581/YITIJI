/**
 * S0-4 / 风险 R4：AI 产物 PDF 必须带隐式 AIGC 元数据标识。
 *
 * 为什么需要这条守门：
 *   `interface-handoff.md` §3 要求「所有 AI 生成内容（含打印件）必须带可见标识与
 *   文件元数据标识」。实测只有合同审查报告做到了；岗位匹配 / 职业规划 / 参会计划 /
 *   自我探索 / 面试报告 5 个 PDF 只有首页一行免责声明，metadata 里没有任何 AIGC 字段，
 *   简历 PDF 更是只有一个 Title。打印出去的纸质件事后无从判定是否 AI 生成。
 *
 * 本批次范围：**只加隐式 metadata，不加可见水印**。
 *   简历 PDF 是否加可见标识需产品裁决（用户要拿去投递），本脚本因此
 *   **不断言可见水印**，只断言元数据 —— 未来产品裁决后另加断言。
 *
 * 覆盖：
 *   1. applyAigcPdfMetadata 写入的键与合同审查那套一致
 *   2. 6 个 AI 产物 PDF 服务真实渲染出的 buffer 里能读到 AIGC 标识
 *   3. 元数据不含简历正文 / 结论 / 用户身份信息（只写标识与时间）
 *   4. 合同审查报告原有标识未被本次改动破坏
 *   5. 静态：6 个服务都在构造 PDFDocument 后立即写元数据
 *
 * 渲染依赖系统 CJK 字体（CI 已装 fonts-noto-cjk）。
 * 无字体时诚实报 FAIL 而不是静默跳过 —— 「没验证」不能算「验证通过」。
 *
 * 不触网、不碰 DB。
 * 运行：pnpm --filter @ai-job-print/api verify:aigc-pdf-metadata
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import PDFDocument from 'pdfkit'
import { applyAigcPdfMetadata } from '../src/common/pdf/aigc-pdf-metadata'
import { JobFitPdfService } from '../src/ai/resume/job-fit-pdf.service'
import { CareerPlanPdfService } from '../src/ai/resume/career-plan-pdf.service'
import { FairVisitPlanPdfService } from '../src/ai/resume/fair-visit-plan-pdf.service'
import { SelfAssessmentPdfService } from '../src/ai/resume/self-assessment-pdf.service'
import { InterviewReportPdfService } from '../src/mock-interview/interview-report-pdf.service'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'

const ROOT = join(__dirname, '..')

let passCount = 0
let failCount = 0

function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }

function read(rel: string): string {
  const path = join(ROOT, rel)
  if (!existsSync(path)) { fail(`文件不存在: ${rel}`); return '' }
  return readFileSync(path, 'utf8')
}

function assertContains(src: string, pattern: string | RegExp, label: string) {
  const ok = typeof pattern === 'string' ? src.includes(pattern) : pattern.test(src)
  ok ? pass(label) : fail(label)
}

// ─── 1. helper 写入的键 ──────────────────────────────────────────────────────

{
  const doc = new PDFDocument({ size: 'A4' })
  applyAigcPdfMetadata(doc, { title: 'T', subject: 'S', kind: 'unit', contentId: 'task-1' })
  const info = doc.info as unknown as Record<string, unknown>
  for (const [key, expected] of [
    ['AIGenerated', 'true'],
    ['ServiceProviderCode', 'zyd-unit-v1'],
    ['ContentId', 'task-1'],
    ['Title', 'T'],
    ['Subject', 'S'],
  ] as const) {
    if (info[key] === expected) pass(`helper: info.${key} = ${expected}`)
    else fail(`helper: info.${key} 应为 ${expected}，实际 ${String(info[key])}`)
  }
  if (typeof info['GeneratedAt'] === 'string' && !Number.isNaN(Date.parse(info['GeneratedAt']))) {
    pass('helper: info.GeneratedAt 是合法 ISO 时间')
  } else {
    fail(`helper: info.GeneratedAt 非法 ${String(info['GeneratedAt'])}`)
  }
  doc.end()

  // contentId 不传时不得写空串（空 ContentId 是噪音）
  const doc2 = new PDFDocument({ size: 'A4' })
  applyAigcPdfMetadata(doc2, { title: 'T', subject: 'S', kind: 'unit' })
  if ((doc2.info as unknown as Record<string, unknown>)['ContentId'] === undefined) pass('helper: 未传 contentId 时不写该键')
  else fail('helper: 未传 contentId 时仍写了 ContentId')
  doc2.end()
}

// ─── 2–3. 真实渲染后的 buffer 里能读到标识 ──────────────────────────────────

const SAMPLE_TEXT = '这是一段仅用于验证的示例内容，不含任何真实用户信息。'

async function renderAll(): Promise<Array<{ label: string; kind: string; buffer: Buffer }>> {
  const out: Array<{ label: string; kind: string; buffer: Buffer }> = []

  out.push({
    label: '岗位匹配参考',
    kind: 'jobfit',
    buffer: (await new JobFitPdfService().render(
      {
        date: '2026-08-16',
        job: { id: 'job-verify-1', title: '后端开发工程师', company: '某科技公司', sourceName: '来源平台', sourceUrl: null, externalId: 'ext-1' },
        decisionSupport: undefined,
      },
      {
        fitLevel: 'reference_medium',
        summary: SAMPLE_TEXT,
        matchPoints: [{ point: '匹配点', evidence: '证据' }],
        gapPoints: [{ gap: '差距', suggestion: '建议' }],
        targetedSuggestions: ['建议一', '建议二'],
      } as never,
    )).buffer,
  })

  out.push({
    label: '职业规划建议',
    kind: 'careerplan',
    buffer: (await new CareerPlanPdfService().render(
      { date: '2026-08-16', basedOn: { jobFit: null, interview: null } },
      {
        summary: SAMPLE_TEXT,
        currentSnapshot: [{ point: '现状', evidence: '证据' }],
        directions: [{ title: '方向', why: '原因', firstStep: '第一步' }],
        skillPlan: [{ skill: '技能', action: '行动', timeframe: '1-3 个月' }],
        actionChecklist: ['行动一', '行动二', '行动三'],
      } as never,
    )).buffer,
  })

  out.push({
    label: '招聘会参会准备单',
    kind: 'fairvisit',
    buffer: (await new FairVisitPlanPdfService().render(
      { date: '2026-08-16', fairName: '示例招聘会', sourceName: '来源机构', venue: '示例会场', sourceUrl: 'https://example.com' },
      {
        summary: SAMPLE_TEXT,
        fairHighlights: ['看点一'],
        priorityCompanies: [{ companyName: '某企业', reason: '原因', sourceUrl: null }],
        preparationChecklist: ['准备一'],
        questionsToAsk: ['问题一'],
        onsiteTips: ['提醒一'],
      } as never,
    )).buffer,
  })

  out.push({
    label: '自我探索倾向参考',
    kind: 'selfassessment',
    buffer: (await new SelfAssessmentPdfService().render({
      date: '2026-08-16',
      dimensions: [{ key: 'interest', label: '兴趣偏好', strength: 3, note: SAMPLE_TEXT }] as never,
      summary: SAMPLE_TEXT,
    })).buffer,
  })

  out.push({
    label: '模拟面试练习报告',
    kind: 'interview',
    buffer: (await new InterviewReportPdfService().render(
      { position: '后端开发工程师', industry: '互联网', interviewerLabel: 'HR', date: '2026-08-16' },
      {
        overall: { level: 'pass', summary: SAMPLE_TEXT },
        expression: ['表达要点一'],
        positionFit: ['岗位契合要点一'],
        credibility: ['可信度要点一'],
        professional: ['专业度要点一'],
        adaptability: ['应变要点一'],
        risks: ['改进点一'],
        predictedQuestions: [{ question: '示例问题', why: '原因', approach: '思路' }],
        starAdvice: { s: '情境', t: '任务', a: '行动', r: '结果', reminder: '提醒' },
        checklist: ['准备一'],
      } as never,
    )).buffer,
  })

  out.push({
    label: 'AI 简历',
    kind: 'resume',
    buffer: (await new ResumePdfService().render({
      basic: { name: '示例求职者', phone: '', email: '', city: '' },
      intention: { position: '后端开发工程师' },
      summary: SAMPLE_TEXT,
      education: [],
      experience: [],
      projects: [],
      skills: [],
      certificates: [],
    } as never)).buffer,
  })

  return out
}

async function runtimeChecks(): Promise<void> {
  let rendered: Array<{ label: string; kind: string; buffer: Buffer }>
  try {
    rendered = await renderAll()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 字体缺失也算 FAIL：没渲染成功就等于没验证到，不能当作通过
    fail(`渲染失败（缺中文字体时请先安装 fonts-noto-cjk 或设置 RESUME_PDF_FONT_PATH）：${message}`)
    return
  }

  for (const { label, kind, buffer } of rendered) {
    const raw = buffer.toString('latin1')
    if (raw.includes('/AIGenerated')) pass(`产物: ${label} PDF 带 AIGenerated 标识`)
    else fail(`产物: ${label} PDF 缺 AIGenerated 标识`)
    if (raw.includes(`zyd-${kind}-v1`)) pass(`产物: ${label} ServiceProviderCode=zyd-${kind}-v1`)
    else fail(`产物: ${label} ServiceProviderCode 缺失或不匹配`)
    if (raw.includes('/GeneratedAt')) pass(`产物: ${label} PDF 带 GeneratedAt`)
    else fail(`产物: ${label} PDF 缺 GeneratedAt`)
    // 元数据只写标识，不得把正文/结论塞进 Subject。
    // 版面正文走压缩内容流，不会以明文出现在 buffer 里；这里若命中明文，
    // 说明正文被写进了 Info 字典（未压缩），即元数据泄漏了用户内容。
    if (!raw.includes(SAMPLE_TEXT)) pass(`产物: ${label} 元数据未写入正文`)
    else fail(`产物: ${label} 元数据疑似写入了正文内容`)
  }
}

// ─── 4. 合同审查原有标识未被破坏 ────────────────────────────────────────────

const contractPdf = read('src/contract-review/contract-review-report-pdf.service.ts')
assertContains(contractPdf, "metadata['AIGenerated'] = 'true'", '回归: 合同审查报告仍写 AIGenerated')
assertContains(contractPdf, "metadata['ServiceProviderCode'] = 'zyd-contract-v1'", '回归: 合同审查 ServiceProviderCode 未变')

// ─── 5. 静态：6 个服务都调用了 helper ───────────────────────────────────────

const services: Array<[string, string]> = [
  ['src/ai/resume/job-fit-pdf.service.ts', '岗位匹配'],
  ['src/ai/resume/career-plan-pdf.service.ts', '职业规划'],
  ['src/ai/resume/fair-visit-plan-pdf.service.ts', '参会计划'],
  ['src/ai/resume/self-assessment-pdf.service.ts', '自我探索'],
  ['src/mock-interview/interview-report-pdf.service.ts', '面试报告'],
  ['src/ai/resume/resume-pdf.service.ts', '简历'],
]
for (const [rel, label] of services) {
  const src = read(rel)
  assertContains(src, 'applyAigcPdfMetadata(doc, {', `接线: ${label} PDF 调用 applyAigcPdfMetadata`)
  // 必须紧跟 PDFDocument 构造（doc.end() 之后写元数据无效）
  const ctorIdx = src.indexOf('new PDFDocument(')
  const applyIdx = src.indexOf('applyAigcPdfMetadata(doc, {')
  const endIdx = src.indexOf('doc.end()')
  if (ctorIdx >= 0 && applyIdx > ctorIdx && (endIdx < 0 || applyIdx < endIdx)) {
    pass(`接线: ${label} 元数据写在构造之后、doc.end() 之前`)
  } else {
    fail(`接线: ${label} 元数据写入位置不正确`)
  }
}

// 本批次刻意不加可见水印：如果哪天要加，应先有产品裁决再改本断言。
const resumePdfSrc = read('src/ai/resume/resume-pdf.service.ts')
assertContains(resumePdfSrc, '不加任何可见水印', '边界: 简历 PDF 明确记录「可见标识待产品裁决」')

// ─── 结果 ────────────────────────────────────────────────────────────────────

void (async () => {
  try {
    await runtimeChecks()
  } catch (error) {
    fail(`运行时检查异常: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(`\nS0-4 AI 产物 PDF AIGC 元数据验证: ${passCount} PASS, ${failCount} FAIL`)
  if (failCount > 0) process.exit(1)
})()
