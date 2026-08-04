// ============================================================
// 自我探索 · 倾向参考 —— PDF 渲染（v1）
//
// 合规：报告 PDF 首页显著免责声明；每张维度卡片底部固定合规文案。
// 字体解析与 CareerPlan/Interview PDF 同源候选；找不到中文字体诚实报错。
// 内容不写日志。
// ============================================================

import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import type { SelfAssessmentDimensionResult } from './self-assessment.types'

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
export class SelfAssessmentPdfService {
  private readonly logger = new Logger(SelfAssessmentPdfService.name)

  async render(meta: {
    date: string
    dimensions: SelfAssessmentDimensionResult[]
    summary: string | null
    appendixDisclaimer?: string | undefined
  }): Promise<{ buffer: Buffer; pageCount: number }> {
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
      throw new InternalServerErrorException({ error: { code: 'SELF_ASSESSMENT_PDF_FONT_NOT_FOUND', message: '服务器缺少中文字体，无法生成自我探索报告' } })
    }

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    // 封面 / 标题 + 显著免责声明
    doc.fontSize(18).fillColor('#111827').text('自我探索 · 倾向参考')
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280').text(`生成时间：${meta.date}  ｜  依据：本人作答（5 维度 × 5 题）`)
    doc.moveDown(0.2)
    doc.fontSize(9).fillColor('#9ca3af').text(
      meta.appendixDisclaimer
        ?? '本报告基于本人作答的倾向结果生成，仅作为自助参考。' +
        '不含临床 / 心理 / 人格诊断；不代任何招聘结果、能力证明或心理评估。' +
        '结果对本人可见，不向企业 / 合作机构 / 第三方推送。',
    )

    // 整体解读
    doc.moveDown(0.8)
    doc.fontSize(13).fillColor('#111827').text('一、整体解读')
    doc.moveDown(0.3)
    if (meta.summary) {
      doc.fontSize(10.5).fillColor('#374151').text(meta.summary, { lineGap: 3 })
    } else {
      doc.fontSize(10.5).fillColor('#9ca3af').text('本次整体解读未生成（未启用 AI 解读或受合规要求被拒）。')
    }

    // 维度分卡
    doc.moveDown(0.8)
    doc.fontSize(13).fillColor('#111827').text('二、维度倾向')
    doc.moveDown(0.3)
    for (const d of meta.dimensions) {
      doc.fontSize(11).fillColor('#1d4ed8').text(`${d.label}（强度 ${d.strength}/5）`)
      if (d.note) {
        doc.fontSize(10.5).fillColor('#374151').text(d.note, { lineGap: 3 })
      } else {
        doc.fontSize(10).fillColor('#9ca3af').text('本次维度解读未生成。')
      }
      doc.fontSize(9).fillColor('#9ca3af').text('本解读仅描述本次作答的倾向，不构成能力评价或职业推荐。', { lineGap: 4 })
    }

    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    this.logger.log(`self_assessment.pdf_ok bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }
}
