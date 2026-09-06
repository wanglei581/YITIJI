import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import { applyAigcPdfMetadata } from '../../common/pdf/aigc-pdf-metadata'
import { CJK_FONT_MISSING_USER_MESSAGE, registerCjkFont as registerCommonCjkFont } from '../../common/pdf/cjk-font'
import type { CareerPlanPayload } from './llm-career-plan.service'

// ============================================================
// 职业规划建议单 PDF（2E）：专属版式（非面试报告复用——语境与分节不同）。
// 字体解析与 Resume/Interview PDF 同源候选；找不到中文字体诚实报错。
// 内容不写日志。
// ============================================================

/**
 * 注册中文字体并选中；找不到任何候选返回 false（调用方负责诚实报错）。
 *
 * 抽出来是为了让降级版式（career-plan-degraded-pdf.service.ts）复用同一套候选，
 * 避免两套版式在不同机器上「一套出得来、一套出不来」。
 */
export function registerCjkFont(doc: PDFKit.PDFDocument): boolean {
  return registerCommonCjkFont(doc)
}

@Injectable()
export class CareerPlanPdfService {
  private readonly logger = new Logger(CareerPlanPdfService.name)

  async render(
    meta: {
      date: string
      basedOn: {
        jobFit: string | null
        interview: string | null
        selfAssessment?: string | null
      }
    },
    plan: CareerPlanPayload,
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
    // S0-4 / 风险 R4：AI 产物必须带文件级 AIGC 标识（本批次只加隐式 metadata，不加可见水印）
    applyAigcPdfMetadata(doc, {
      title: 'AI 职业规划建议',
      subject: 'AI 生成的职业方向与技能计划建议，仅供求职者本人参考，不构成就业结果或薪资承诺',
      kind: 'careerplan',
    })
    const ok = registerCjkFont(doc)
    if (!ok) {
      doc.end()
      throw new InternalServerErrorException({ error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: CJK_FONT_MISSING_USER_MESSAGE } })
    }

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    const title = (t: string) => { doc.moveDown(0.8); doc.fontSize(13).fillColor('#111827').text(t); doc.moveDown(0.3) }
    const bullet = (t: string) => doc.fontSize(10.5).fillColor('#374151').text(`· ${t}`, { lineGap: 3 })

    doc.fontSize(18).fillColor('#111827').text('职业规划建议单')
    doc.moveDown(0.3)
    const basis = ['本人简历']
    if (meta.basedOn.jobFit) basis.push(`岗位匹配参考（${meta.basedOn.jobFit}）`)
    if (meta.basedOn.interview) basis.push(`模拟面试表现（${meta.basedOn.interview}）`)
    if (meta.basedOn.selfAssessment) basis.push('自我探索倾向参考')
    doc.fontSize(10).fillColor('#6b7280').text(`生成时间：${meta.date} ｜ 依据材料：${basis.join('、')}`)
    doc.moveDown(0.2)
    doc.fontSize(9).fillColor('#9ca3af').text('本建议单仅供本人职业发展参考，不构成任何就业、薪资或录用承诺；行动请基于本人真实经历，不要虚构。')

    title('一、总览')
    doc.fontSize(10.5).fillColor('#374151').text(plan.summary, { lineGap: 3 })

    title('二、现状画像（含简历原文依据）')
    plan.currentSnapshot.forEach((c) => {
      doc.fontSize(10.5).fillColor('#111827').text(`· ${c.point}`, { lineGap: 2 })
      doc.fontSize(9.5).fillColor('#6b7280').text(`   依据：${c.evidence}`, { lineGap: 4 })
    })

    title('三、发展方向建议（参考）')
    plan.directions.forEach((d, i) => {
      doc.fontSize(11).fillColor('#1d4ed8').text(`${i + 1}. ${d.title}`, { lineGap: 2 })
      doc.fontSize(10).fillColor('#374151').text(`   为什么适合：${d.why}`, { lineGap: 2 })
      doc.fontSize(10).fillColor('#374151').text(`   第一步：${d.firstStep}`, { lineGap: 4 })
    })

    title('四、技能提升计划')
    plan.skillPlan.forEach((s) => bullet(`${s.skill}（${s.timeframe}）：${s.action}`))

    title('五、近期行动清单')
    plan.actionChecklist.forEach((a) => doc.fontSize(10.5).fillColor('#374151').text(`□ ${a}`, { lineGap: 4 }))

    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    this.logger.log(`careerplan.pdf_ok bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }
}
