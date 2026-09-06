import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import { applyAigcPdfMetadata } from '../../common/pdf/aigc-pdf-metadata'
import type {
  OptimizeResumeOutput,
  ParseResumeOutput,
  ResumeIssue,
  ResumeReport,
  ResumeScoringDimensionKey,
} from '../interfaces/ai-provider.interface'

export type ResumeReportExportKind = 'diagnosis_report' | 'change_list'
export type ResumeIssueSeverity = 'high' | 'medium' | 'low'

interface FontCandidate {
  path: string
  family?: string
}

interface DiagnosisReportPdfInput {
  taskId: string
  kind: ResumeReportExportKind
  report: ResumeReport
  extractionNotice?: ParseResumeOutput['extractionNotice']
  optimizeModules?: OptimizeResumeOutput['modules']
  generatedAt: Date
}

interface RenderOptions {
  fontCandidates?: FontCandidate[]
}

const PAGE_HEADER = 'AI 生成，仅供参考，请自行核对'
const SEVERITY_RULE = '严重度按所属维度得分机械分档：不足五成为高，五成到不足八成为中，八成及以上为低；不是排名、通过率或录用结论。'
const PAGE = { width: 595.28, height: 841.89 }
const MARGIN = 52

function defaultFontCandidates(): FontCandidate[] {
  const envPath = process.env['RESUME_PDF_FONT_PATH']?.trim()
  const envFamily = process.env['RESUME_PDF_FONT_FAMILY']?.trim() || undefined
  const list: FontCandidate[] = []
  if (envPath) list.push({ path: envPath, family: envFamily })
  if (process.platform === 'win32') {
    const winDir = process.env['WINDIR'] ?? 'C:\\Windows'
    list.push(
      { path: `${winDir}\\Fonts\\msyh.ttc`, family: 'Microsoft YaHei' },
      { path: `${winDir}\\Fonts\\msyh.ttf` },
      { path: `${winDir}\\Fonts\\simhei.ttf` },
      { path: `${winDir}\\Fonts\\simsun.ttc`, family: 'SimSun' },
    )
  } else if (process.platform === 'darwin') {
    list.push(
      { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' },
      { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'HiraginoSansGB-W3' },
      { path: '/System/Library/Fonts/STHeiti Light.ttc', family: 'STHeitiSC-Light' },
      { path: '/System/Library/Fonts/Supplemental/Songti.ttc', family: 'STSongti-SC-Regular' },
    )
  } else {
    list.push(
      { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
      { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
    )
  }
  return list
}

export function severityForDimension(
  report: ResumeReport,
  dim: ResumeScoringDimensionKey,
): ResumeIssueSeverity {
  const section = report.sections.find((item) => item.key === dim)
  const ratio = section && section.maxScore > 0 ? section.score / section.maxScore : 0
  if (ratio < 0.5) return 'high'
  if (ratio < 0.8) return 'medium'
  return 'low'
}

function severityLabel(severity: ResumeIssueSeverity): string {
  if (severity === 'high') return '高'
  if (severity === 'medium') return '中'
  return '低'
}

@Injectable()
export class DiagnosisReportPdfService {
  private readonly logger = new Logger(DiagnosisReportPdfService.name)

  async render(
    input: DiagnosisReportPdfInput,
    options: RenderOptions = {},
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 64, bottom: 56, left: MARGIN, right: MARGIN },
      bufferPages: true,
      autoFirstPage: false,
    })
    applyAigcPdfMetadata(doc, {
      title: input.kind === 'diagnosis_report' ? 'AI 简历诊断报告' : 'AI 简历修改清单',
      subject: 'AI 生成的简历诊断与修改参考，请求职者本人根据真实经历核对后使用',
      kind: input.kind === 'diagnosis_report' ? 'resume-diagnosis' : 'resume-change-list',
      contentId: input.taskId,
      generatedAt: input.generatedAt,
    })

    const candidates = options.fontCandidates ?? defaultFontCandidates()
    const fontReady = candidates.some((candidate) => {
      if (!existsSync(candidate.path)) return false
      try {
        if (candidate.family) doc.registerFont('cjk', candidate.path, candidate.family)
        else doc.registerFont('cjk', candidate.path)
        doc.font('cjk')
        return true
      } catch {
        return false
      }
    })
    if (!fontReady) {
      doc.end()
      throw new ServiceUnavailableException({
        error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: '服务器缺少可用中文字体，暂时无法生成诊断报告 PDF' },
      })
    }

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })
    doc.addPage()

    if (input.kind === 'diagnosis_report') this.renderDiagnosis(doc, input)
    else this.renderChangeList(doc, input)

    const pageRange = doc.bufferedPageRange()
    for (let index = pageRange.start; index < pageRange.start + pageRange.count; index += 1) {
      doc.switchToPage(index)
      doc.save()
      doc.font('cjk').fontSize(8.5).fillColor('#8a4b2b')
      doc.text(PAGE_HEADER, MARGIN, 25, { width: PAGE.width - MARGIN * 2, align: 'right' })
      doc.fontSize(8).fillColor('#6b7280')
      doc.text(`第 ${index - pageRange.start + 1} / ${pageRange.count} 页`, MARGIN, PAGE.height - 34, {
        width: PAGE.width - MARGIN * 2,
        align: 'center',
      })
      doc.restore()
    }

    const pageCount = pageRange.count
    doc.end()
    const buffer = await done
    this.logger.log(`resume_diagnosis_export.pdf_ok kind=${input.kind} bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }

  private renderDiagnosis(doc: PDFKit.PDFDocument, input: DiagnosisReportPdfInput): void {
    this.title(doc, 'AI 简历诊断报告', input.generatedAt)
    this.note(doc, '评分仅用于帮助定位简历表达问题，不代表招聘结果。所有修改请以本人真实经历为准。')

    const totalScore = input.report.sections.reduce((sum, item) => sum + item.score, 0)
    const totalMax = input.report.sections.reduce((sum, item) => sum + item.maxScore, 0)
    const normalized = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0
    this.section(doc, '一、综合参考分与六维明细')
    doc.fontSize(22).fillColor('#0f766e').text(`${normalized} / 100`, { continued: false })
    doc.fontSize(9).fillColor('#6b7280').text(`按服务端报告现有维度合计 ${totalScore} / ${totalMax} 归一化计算。`, { lineGap: 2 })
    input.report.sections.forEach((item) => {
      const severity = severityForDimension(input.report, item.key as ResumeScoringDimensionKey)
      this.bullet(doc, `${item.label}：${item.score} / ${item.maxScore}（对应问题严重度 ${severityLabel(severity)}）`)
    })
    this.note(doc, SEVERITY_RULE)

    this.section(doc, '二、先改这几处')
    const priorities = input.report.priorities ?? []
    if (priorities.length > 0) {
      priorities.forEach((item) => this.bullet(doc, `${item.focus}：${item.reason}`))
    } else {
      this.empty(doc, '本次报告没有单独给出修改优先级，请结合低分维度和问题清单逐项核对。')
    }

    this.section(doc, '三、问题清单')
    this.renderIssues(doc, input.report)

    this.section(doc, '四、内容结构摘录')
    if (input.report.contentBlocks?.length) {
      input.report.contentBlocks.forEach((block) => {
        doc.fontSize(10.5).fillColor('#111827').text(block.label)
        block.lines.forEach((line) => this.bullet(doc, line, '#4b5563'))
        doc.moveDown(0.25)
      })
    } else {
      this.empty(doc, '该历史报告没有可展示的内容结构摘录。')
    }

    this.section(doc, '五、风险表述提醒')
    this.renderStringList(doc, input.report.riskNotes, '本次报告没有单独给出风险表述提醒。')

    this.section(doc, '六、其他建议')
    this.renderStringList(doc, input.report.suggestions, '本次报告没有其他建议。')

    this.section(doc, '七、截断与识别说明')
    if (input.report.truncatedInput) {
      this.bullet(doc, '本次诊断只处理了简历前部内容，后部内容未送入模型，请人工补充核对。', '#9a3412')
    } else {
      this.bullet(doc, '服务端报告未标记输入截断。')
    }
    if (input.extractionNotice) {
      this.bullet(doc, `文字来源：${input.extractionNotice.textSource}；识别置信度：${input.extractionNotice.confidence}`)
      input.extractionNotice.warnings.forEach((warning) => this.bullet(doc, warning, '#9a3412'))
    } else {
      this.bullet(doc, '该历史报告没有额外的 OCR 或文字提取提示。')
    }
  }

  private renderChangeList(doc: PDFKit.PDFDocument, input: DiagnosisReportPdfInput): void {
    this.title(doc, '简历修改清单', input.generatedAt)
    this.note(doc, '请回自己的 Word 里改。清单只提供问题、原文引用和改法，不会直接改写原文件。')

    this.section(doc, '一、问题与改法')
    this.renderIssues(doc, input.report)

    this.section(doc, '二、已有优化前后对比')
    if (input.optimizeModules?.length) {
      input.optimizeModules.forEach((item, index) => {
        doc.fontSize(11).fillColor('#111827').text(`${index + 1}. ${item.title}`)
        doc.fontSize(9.5).fillColor('#6b7280').text(`修改前：${item.before}`, { lineGap: 2 })
        doc.fontSize(9.5).fillColor('#0f766e').text(`建议后：${item.after}`, { lineGap: 3 })
        doc.moveDown(0.35)
      })
    } else {
      this.empty(doc, '当前没有已完成的优化结果，因此不展示 before / after；不会为导出临时编造或自动生成。')
    }

    this.section(doc, '三、使用说明')
    this.bullet(doc, '逐项核对原文引用是否确实来自本人简历。')
    this.bullet(doc, '只采纳与本人真实经历一致的建议，不新增未确认的学校、公司、证书、时间或成果。')
    this.bullet(doc, '请回自己的 Word 里改，修改后重新预览版式与分页。')
    if (input.report.truncatedInput) {
      this.bullet(doc, '本次诊断没有看完全部简历，未覆盖部分也需要人工检查。', '#9a3412')
    }
  }

  private renderIssues(doc: PDFKit.PDFDocument, report: ResumeReport): void {
    if (!report.issues?.length) {
      this.empty(doc, '该历史报告没有带原文证据的问题清单。')
      return
    }
    report.issues.forEach((issue, index) => this.renderIssue(doc, report, issue, index))
  }

  private renderIssue(doc: PDFKit.PDFDocument, report: ResumeReport, issue: ResumeIssue, index: number): void {
    const section = report.sections.find((item) => item.key === issue.dim)
    const severity = severityForDimension(report, issue.dim)
    doc.fontSize(11).fillColor('#111827').text(`${index + 1}. ${issue.title}`)
    doc.fontSize(9).fillColor('#8a4b2b').text(`维度：${section?.label ?? issue.dim} ｜ 严重度：${severityLabel(severity)}`)
    issue.evidence.forEach((evidence) => {
      doc.fontSize(9.5).fillColor('#4b5563').text(`原文引用：「${evidence.quote}」`, { lineGap: 2 })
    })
    doc.fontSize(9.5).fillColor('#6b7280').text(`影响：${issue.impact}`, { lineGap: 2 })
    doc.fontSize(9.5).fillColor('#0f766e').text(`改法：${issue.fixIt}`, { lineGap: 3 })
    doc.moveDown(0.4)
  }

  private title(doc: PDFKit.PDFDocument, text: string, generatedAt: Date): void {
    doc.font('cjk').fontSize(20).fillColor('#111827').text(text)
    doc.moveDown(0.25)
    doc.fontSize(9).fillColor('#6b7280').text(`生成日期：${this.dateLabel(generatedAt)}`)
  }

  private section(doc: PDFKit.PDFDocument, text: string): void {
    doc.moveDown(0.8)
    doc.fontSize(13).fillColor('#111827').text(text)
    doc.moveDown(0.25)
  }

  private bullet(doc: PDFKit.PDFDocument, text: string, color = '#374151'): void {
    doc.fontSize(9.5).fillColor(color).text(`· ${text}`, { lineGap: 3 })
  }

  private note(doc: PDFKit.PDFDocument, text: string): void {
    doc.moveDown(0.35)
    doc.fontSize(8.8).fillColor('#6b7280').text(text, { lineGap: 2 })
  }

  private empty(doc: PDFKit.PDFDocument, text: string): void {
    doc.fontSize(9.5).fillColor('#6b7280').text(text, { lineGap: 3 })
  }

  private renderStringList(doc: PDFKit.PDFDocument, items: string[] | undefined, emptyText: string): void {
    if (!items?.length) {
      this.empty(doc, emptyText)
      return
    }
    items.forEach((item) => this.bullet(doc, item))
  }

  private dateLabel(date: Date): string {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  }
}
