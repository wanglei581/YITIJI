import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import { registerInterviewCjkFont } from './interview-report-pdf.service'
import {
  PRACTICE_SHEET_CAVEAT,
  PRACTICE_SHEET_TITLE,
  type PracticeSheetContent,
} from './interview-practice-sheet'

// ============================================================
// 「题目与答案单」PDF —— 第二套版式，与 interview-report-pdf.service.ts 的
// AI 练习报告并列，不是它的分支。两张纸的内容来源完全不同：
//
//   AI 练习报告  逐题点评 / 等级 / 风险提示，全部来自模型
//   题目与答案单 通用题库题干 + 空白作答行，一个字都不来自模型
//
// 混在一个版式里迟早会印串，所以刻意分文件（同 career-plan-degraded-pdf.service.ts）。
//
// 刻意不写 AIGenerated='true'：
//   `applyAigcPdfMetadata` 固定把 AIGenerated 写成 'true'。这张纸里没有任何模型
//   生成的内容，标成 AI 产物和反过来把 AI 产物标成人工一样是失真的。
// ============================================================

/** 与 AI 练习报告区分开的产物标识。 */
const PRACTICE_SHEET_SERVICE_PROVIDER_CODE = 'zyd-interview-practice-sheet-v1'

/** 每题留几行手写作答空间。A4 竖版 8 题时正好一页出头，不挤。 */
const ANSWER_LINES_PER_QUESTION = 4

@Injectable()
export class InterviewPracticeSheetPdfService {
  private readonly logger = new Logger(InterviewPracticeSheetPdfService.name)

  async render(content: PracticeSheetContent): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
    this.applyHonestMetadata(doc)

    if (!registerInterviewCjkFont(doc)) {
      doc.end()
      throw new InternalServerErrorException({
        error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: '服务器缺少中文字体，无法生成题目单' },
      })
    }

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    // ── 抬头：降级口径写在最显眼的位置 ────────────────────────────────────
    doc.fontSize(17).fillColor('#111827').text(PRACTICE_SHEET_TITLE)
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280').text(
      `目标岗位：${content.position} ｜ 行业：${content.industry} ｜ 面试官身份：${content.interviewerLabel} ｜ 生成日期：${content.date}`,
    )
    doc.moveDown(0.2)
    doc.fontSize(10).fillColor('#b45309').text(PRACTICE_SHEET_CAVEAT, { lineGap: 3 })
    doc.moveDown(0.2)
    doc.fontSize(9.5).fillColor('#6b7280').text(
      '用法：对着题目自己写答案，写完再念一遍。AI 恢复后回到「模拟面试」，可以拿到按你回答逐条点评的完整练习报告。',
      { lineGap: 3 },
    )

    // ── 正文：题干 + 考察点 + 空白作答行 ──────────────────────────────────
    doc.moveDown(0.6)
    content.questions.forEach((q, i) => {
      doc.moveDown(0.5)
      doc.fontSize(11.5).fillColor('#111827').text(`${i + 1}. ${q.question}`, { lineGap: 3 })
      doc.fontSize(9.5).fillColor('#6b7280').text(`考察点：${q.examines}（通用说明，不是对你答案的判断）`, { lineGap: 4 })
      this.drawAnswerLines(doc)
    })

    // ── 页脚口径 ──────────────────────────────────────────────────────────
    doc.moveDown(0.8)
    doc.fontSize(9).fillColor('#9ca3af').text(
      '本单仅供本人面试练习与准备参考，不代表任何招聘结果承诺，不参与企业筛选、面试邀约或录用决策；'
      + '题目为通用题库内容，不代表用人单位实际提问。',
      { lineGap: 2 },
    )

    // pageCount 必须在 end() 之前读取（pdfkit 行为）
    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    // 只记尺寸与页数，不记内容。
    this.logger.log(`interview.practice_sheet_pdf_ok bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }

  /** 手写作答行。用真实横线，不用下划线字符 —— 后者在不同字体下宽度会崩。 */
  private drawAnswerLines(doc: PDFKit.PDFDocument): void {
    const left = doc.page.margins.left
    const right = doc.page.width - doc.page.margins.right
    for (let i = 0; i < ANSWER_LINES_PER_QUESTION; i += 1) {
      // 触发分页判断：y 超出可写区域时 pdfkit 会在下一次 text 调用换页，
      // 所以先写一个空行占位再画线，保证线不会画到页边距外面。
      doc.fontSize(10).fillColor('#ffffff').text(' ', { lineGap: 6 })
      const y = doc.y - 4
      doc.save()
      doc.strokeColor('#d1d5db').lineWidth(0.6).moveTo(left, y).lineTo(right, y).stroke()
      doc.restore()
    }
  }

  /**
   * 诚实元数据。刻意不复用 `applyAigcPdfMetadata` —— 那个 helper 固定写 AIGenerated='true'，
   * 而这份产物里没有任何模型生成的内容。键名沿用同一组，便于统一检索。
   */
  private applyHonestMetadata(doc: { info: PDFKit.DocumentInfo }): void {
    const generatedAt = new Date()
    const info = doc.info as unknown as Record<string, string | Date>
    info['Title'] = PRACTICE_SHEET_TITLE
    info['Author'] = '青序 AI 求职服务'
    info['Subject'] = '本机通用题库生成的面试题目与答案单，不含 AI 点评；仅供求职者本人练习参考，不代表任何招聘结果'
    info['CreationDate'] = generatedAt
    info['AIGenerated'] = 'false'
    info['ServiceProviderCode'] = PRACTICE_SHEET_SERVICE_PROVIDER_CODE
    info['GeneratedAt'] = generatedAt.toISOString()
  }
}
