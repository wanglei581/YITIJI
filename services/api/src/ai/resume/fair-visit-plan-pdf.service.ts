import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import type { FairVisitPlanPayload } from './llm-fair-visit-plan.service'

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
export class FairVisitPlanPdfService {
  private readonly logger = new Logger(FairVisitPlanPdfService.name)

  async render(
    meta: { date: string; fairName: string; sourceName: string; venue: string; sourceUrl: string },
    plan: FairVisitPlanPayload,
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
    const ok = fontCandidates().some((candidate) => {
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
    if (!ok) {
      doc.end()
      throw new InternalServerErrorException({ error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: '服务器缺少中文字体，无法生成准备单' } })
    }

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    const title = (text: string) => { doc.moveDown(0.8); doc.fontSize(13).fillColor('#111827').text(text); doc.moveDown(0.3) }
    const bullet = (text: string) => doc.fontSize(10.5).fillColor('#374151').text(`· ${text}`, { lineGap: 3 })

    doc.fontSize(18).fillColor('#111827').text('招聘会参会准备单')
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280').text(`生成时间：${meta.date} ｜ 活动：${meta.fairName} ｜ 来源：${meta.sourceName}`)
    doc.fontSize(10).fillColor('#6b7280').text(`地点：${meta.venue}`)
    doc.moveDown(0.2)
    doc.fontSize(9).fillColor('#9ca3af').text('本准备单仅供本人参会准备参考；活动预约、岗位办理和结果均以来源平台为准，本系统不接收简历。')
    doc.fontSize(9).fillColor('#9ca3af').text(`来源链接：${meta.sourceUrl}`)

    title('一、总览')
    doc.fontSize(10.5).fillColor('#374151').text(plan.summary, { lineGap: 3 })

    title('二、本场看点')
    plan.fairHighlights.forEach(bullet)

    title('三、现场优先了解企业')
    if (plan.priorityCompanies.length === 0) {
      bullet('本场企业信息有限，建议先查看活动资料和企业名册，再按现场展位逐一了解。')
    } else {
      plan.priorityCompanies.forEach((company, index) => {
        doc.fontSize(11).fillColor('#1d4ed8').text(`${index + 1}. ${company.companyName}`, { lineGap: 2 })
        doc.fontSize(10).fillColor('#374151').text(`   了解理由：${company.reason}`, { lineGap: 2 })
        if (company.sourceUrl) doc.fontSize(9).fillColor('#6b7280').text(`   来源链接：${company.sourceUrl}`, { lineGap: 3 })
      })
    }

    title('四、参会前准备清单')
    plan.preparationChecklist.forEach((item) => doc.fontSize(10.5).fillColor('#374151').text(`□ ${item}`, { lineGap: 4 }))

    title('五、现场可咨询问题')
    plan.questionsToAsk.forEach(bullet)

    title('六、现场提醒')
    plan.onsiteTips.forEach(bullet)

    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    this.logger.log(`fairvisit.pdf_ok bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }
}
