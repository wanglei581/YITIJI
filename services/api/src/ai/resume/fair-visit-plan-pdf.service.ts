import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import { applyAigcPdfMetadata } from '../../common/pdf/aigc-pdf-metadata'
import type { FairVisitPlanPayload } from './llm-fair-visit-plan.service'

/**
 * 回顾态的诚实声明。屏幕与纸面共用同一份文本常量 —— 这不是提示文案，
 * 是我们对用户的诚实声明：系统只有本机记录的动作，没有现场事实。
 * 由 verify:fair-visit-review 钉死，禁止以「优化文案」为由删除。
 */
export const REVIEW_DISCLOSURE =
  '本系统不记录你是否到场，也不记录你在现场取得的材料；以下内容仅基于本机记录的浏览与跳转行为，以及该场招聘会的公开信息。'

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

  /**
   * 纸是带走的：已结束场次印出来的标题和小节必须跟着语义变，
   * 否则纸上写着「出发前逐项核对」而活动早就结束了，比屏幕上说错更糟。
   *
   * 返回 sections（实际写进纸里的小节标题）供门禁断言纸面内容，
   * 免去解析压缩后的 PDF 流。
   */
  async render(
    meta: { date: string; fairName: string; sourceName: string; venue: string; sourceUrl: string },
    plan: FairVisitPlanPayload,
  ): Promise<{ buffer: Buffer; pageCount: number; sections: string[] }> {
    const isReview = plan.mode === 'review'
    const docTitle = isReview ? '招聘会参会回顾与后续跟进' : '招聘会参会准备单'
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
    // S0-4 / 风险 R4：AI 产物必须带文件级 AIGC 标识（本批次只加隐式 metadata，不加可见水印）
    applyAigcPdfMetadata(doc, {
      title: `AI ${docTitle}`,
      subject: isReview
        ? 'AI 生成的参会回顾与后续跟进参考，仅供求职者本人使用；招聘会仅为第三方或官方来源信息入口'
        : 'AI 生成的参会准备参考，仅供求职者本人现场准备使用；招聘会仅为第三方或官方来源信息入口',
      kind: 'fairvisit',
    })
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

    const sections: string[] = []
    const title = (text: string) => {
      sections.push(text)
      doc.moveDown(0.8); doc.fontSize(13).fillColor('#111827').text(text); doc.moveDown(0.3)
    }
    const bullet = (text: string) => doc.fontSize(10.5).fillColor('#374151').text(`· ${text}`, { lineGap: 3 })

    doc.fontSize(18).fillColor('#111827').text(docTitle)
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280').text(`生成时间：${meta.date} ｜ 活动：${meta.fairName} ｜ 来源：${meta.sourceName}`)
    doc.fontSize(10).fillColor('#6b7280').text(`地点：${meta.venue}`)
    doc.moveDown(0.2)
    doc.fontSize(9).fillColor('#9ca3af').text(
      isReview
        ? '本回顾仅供本人后续跟进参考；岗位办理和结果均以来源平台为准，本系统不接收简历。'
        : '本准备单仅供本人参会准备参考；活动预约、岗位办理和结果均以来源平台为准，本系统不接收简历。',
    )
    if (isReview) {
      // 与屏幕上同一句诚实声明：纸上也不能让人以为系统知道他去没去。
      doc.fontSize(9).fillColor('#9ca3af').text(REVIEW_DISCLOSURE)
    }
    doc.fontSize(9).fillColor('#9ca3af').text(`来源链接：${meta.sourceUrl}`)

    title('一、总览')
    doc.fontSize(10.5).fillColor('#374151').text(plan.summary, { lineGap: 3 })

    title(isReview ? '二、本场概况' : '二、本场看点')
    plan.fairHighlights.forEach(bullet)

    title(isReview ? '三、仍可继续跟进的企业' : '三、现场优先了解企业')
    if (plan.priorityCompanies.length === 0) {
      bullet(
        isReview
          ? '本场企业信息有限，建议前往来源平台查看该主办方发布的企业与在招岗位。'
          : '本场企业信息有限，建议先查看活动资料和企业名册，再按现场展位逐一了解。',
      )
    } else {
      plan.priorityCompanies.forEach((company, index) => {
        doc.fontSize(11).fillColor('#1d4ed8').text(`${index + 1}. ${company.companyName}`, { lineGap: 2 })
        doc.fontSize(10).fillColor('#374151').text(
          `   ${isReview ? '继续跟进理由' : '了解理由'}：${company.reason}`, { lineGap: 2 })
        if (company.sourceUrl) doc.fontSize(9).fillColor('#6b7280').text(`   来源链接：${company.sourceUrl}`, { lineGap: 3 })
      })
    }

    if (plan.mode === 'review') {
      title('四、后续可做的跟进动作')
      plan.followUpActions.forEach((item) => doc.fontSize(10.5).fillColor('#374151').text(`□ ${item}`, { lineGap: 4 }))

      title('五、下次同类活动可提前准备的问题')
      plan.nextTimeQuestions.forEach(bullet)
    } else {
      title('四、参会前准备清单')
      plan.preparationChecklist.forEach((item) => doc.fontSize(10.5).fillColor('#374151').text(`□ ${item}`, { lineGap: 4 }))

      title('五、现场可咨询问题')
      plan.questionsToAsk.forEach(bullet)

      title('六、现场提醒')
      plan.onsiteTips.forEach(bullet)
    }

    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    this.logger.log(`fairvisit.pdf_ok mode=${plan.mode} bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount, sections }
  }
}
