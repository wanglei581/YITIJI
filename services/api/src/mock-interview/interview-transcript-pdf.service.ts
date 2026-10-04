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
// 纸上不出现模型写的评语。刻意不写 AIGenerated='true'：
// applyAigcPdfMetadata 会固定写成 true，而这张纸里没有模型生成的句子。
// ============================================================

const TRANSCRIPT_SERVICE_PROVIDER_CODE = 'zyd-interview-transcript-v1'

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

  /** 键名与题目单同一组，便于检索。值必须是 false：这张纸不是模型产物。 */
  private applyHonestMetadata(doc: { info: PDFKit.DocumentInfo }): void {
    const generatedAt = new Date()
    const info = doc.info as unknown as Record<string, string | Date>
    info['Title'] = TRANSCRIPT_PRINT_TITLE
    info['Author'] = '青序 AI 求职服务'
    info['Subject'] = '求职者本人本场练习的题目与回答，不含模型评语；仅供本人练习参考，不代表任何招聘结果'
    info['CreationDate'] = generatedAt
    info['AIGenerated'] = 'false'
    info['ServiceProviderCode'] = TRANSCRIPT_SERVICE_PROVIDER_CODE
    info['GeneratedAt'] = generatedAt.toISOString()
  }
}
