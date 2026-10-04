import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import { CJK_FONT_MISSING_USER_MESSAGE } from '../common/pdf/cjk-font'
import { INTERVIEW_PRACTICE_RESULT_DISCLAIMER } from './interview-practice-sheet'
import { registerInterviewCjkFont } from './interview-report-pdf.service'

// ============================================================
// 「本场题目和我的回答」PDF。与两张已有的纸分开：
//
//   AI 练习报告    逐题点评 / 等级，来自模型，没有报告行就出不来
//   通用题目单    写死的题库 + 空白作答行，没有用户这次的回答
//   本场作答记录  这一场已经问过的题和候选人自己的回答，不调模型
//
// 纸上不出现模型写的评语、评分。但题目是 AI 面试官（模型）出的，所以显式写明
// 「题目由 AI 面试官生成」，元数据 AIGenerated 也写 true（AI 生成合成内容的标识要求）；
// 回答是本人作答、未经模型改写。
// ============================================================

const TRANSCRIPT_SERVICE_PROVIDER_CODE = 'zyd-interview-transcript-v1'

/** 表头下的显式标识：题目来自模型，回答来自本人。 */
export const TRANSCRIPT_AI_SOURCE_NOTE = '题目由 AI 面试官生成；回答为你本人作答，未经 AI 修改。'
/** 页脚口径。改这句话要同时改 verify-mock-interview 里剥掉它再查禁词的断言。 */
export const TRANSCRIPT_PRINT_FOOTER = '本页为练习记录，不含 AI 点评'

export const TRANSCRIPT_PRINT_TITLE = '本场面试作答记录'

export interface TranscriptPdfItem {
  question: string
  /** 跳过题为 null，纸上印「本题跳过」，不把库里的占位句当回答印出来。 */
  answer: string | null
  skipped: boolean
}

export interface TranscriptPdfContent {
  readonly date: string
  readonly position: string
  readonly industry: string
  readonly interviewerLabel: string
  readonly items: readonly TranscriptPdfItem[]
}

@Injectable()
export class InterviewTranscriptPdfService {
  private readonly logger = new Logger(InterviewTranscriptPdfService.name)

  async render(content: TranscriptPdfContent): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
    this.applyHonestMetadata(doc)

    if (!registerInterviewCjkFont(doc)) {
      doc.end()
      throw new InternalServerErrorException({
        error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: CJK_FONT_MISSING_USER_MESSAGE },
      })
    }

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    doc.fontSize(17).fillColor('#111827').text(TRANSCRIPT_PRINT_TITLE)
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280').text(
      `目标岗位：${content.position} ｜ 行业：${content.industry} ｜ 面试官：${content.interviewerLabel} ｜ 日期：${content.date}`,
    )
    doc.moveDown(0.15)
    doc.fontSize(9).fillColor('#6b7280').text(INTERVIEW_PRACTICE_RESULT_DISCLAIMER)
    doc.fontSize(9).fillColor('#6b7280').text(TRANSCRIPT_AI_SOURCE_NOTE)

    doc.moveDown(0.6)
    content.items.forEach((item, index) => {
      doc.moveDown(0.5)
      doc.fontSize(11.5).fillColor('#111827').text(`${index + 1}. ${item.question}`, { lineGap: 3 })
      if (item.skipped || !item.answer) {
        doc.fontSize(10.5).fillColor('#6b7280').text('本题跳过', { lineGap: 4 })
        return
      }
      doc.fontSize(10.5).fillColor('#374151').text(`回答：${item.answer}`, { lineGap: 4 })
    })

    doc.moveDown(0.8)
    doc.fontSize(9).fillColor('#9ca3af').text(TRANSCRIPT_PRINT_FOOTER, { lineGap: 2 })
    doc.fontSize(9).fillColor('#9ca3af').text(
      '本页仅供本人面试练习参考，不代表任何招聘结果承诺，不参与企业筛选、面试邀约或录用决策。',
      { lineGap: 2 },
    )

    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    this.logger.log(`interview.transcript_pdf_ok bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }

  /** 键名与题目单同一组，便于检索。题目由模型生成，所以 AIGenerated 写 true。 */
  private applyHonestMetadata(doc: { info: PDFKit.DocumentInfo }): void {
    const generatedAt = new Date()
    const info = doc.info as unknown as Record<string, string | Date>
    info['Title'] = TRANSCRIPT_PRINT_TITLE
    info['Author'] = '青序 AI 求职服务'
    info['Subject'] = '本场练习的题目（由 AI 面试官生成）与求职者本人的回答，不含模型评语；仅供本人练习参考，不代表任何招聘结果'
    info['CreationDate'] = generatedAt
    info['AIGenerated'] = 'true'
    info['ServiceProviderCode'] = TRANSCRIPT_SERVICE_PROVIDER_CODE
    info['GeneratedAt'] = generatedAt.toISOString()
  }
}
