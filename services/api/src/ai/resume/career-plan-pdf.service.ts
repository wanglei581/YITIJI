import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import type { CareerPlanPayload } from './llm-career-plan.service'

// ============================================================
// 职业规划建议单 PDF（2E）：专属版式（非面试报告复用——语境与分节不同）。
// 字体解析与 Resume/Interview PDF 同源候选；找不到中文字体诚实报错。
// 内容不写日志。
// ============================================================

interface FontCandidate { path: string; family?: string }

function fontCandidates(): FontCandidate[] {
  const envPath = process.env['RESUME_PDF_FONT_PATH']?.trim()
  const list: FontCandidate[] = []
  if (envPath) list.push({ path: envPath })
  if (process.platform === 'win32') {
    const winDir = process.env['WINDIR'] ?? 'C:\\Windows'
    list.push(
      { path: `${winDir}\\Fonts\\msyh.ttc`, family: 'Microsoft YaHei' },
      { path: `${winDir}\\Fonts\\simsun.ttc`, family: 'SimSun' },
    )
  } else if (process.platform === 'darwin') {
    list.push(
      { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' },
      { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'HiraginoSansGB-W3' },
      { path: '/System/Library/Fonts/STHeiti Light.ttc', family: 'STHeitiSC-Light' },
    )
  } else {
    list.push(
      { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
      { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
    )
  }
  return list
}

@Injectable()
export class CareerPlanPdfService {
  private readonly logger = new Logger(CareerPlanPdfService.name)

  async render(
    meta: { date: string; basedOn: { jobFit: string | null; interview: string | null } },
    plan: CareerPlanPayload,
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
    const ok = fontCandidates().some((c) => {
      if (!existsSync(c.path)) return false
      try {
        if (c.family) doc.registerFont('cjk', c.path, c.family)
        else doc.registerFont('cjk', c.path)
        doc.font('cjk')
        return true
      } catch { return false }
    })
    if (!ok) {
      doc.end()
      throw new InternalServerErrorException({ error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: '服务器缺少中文字体，无法生成建议单' } })
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
