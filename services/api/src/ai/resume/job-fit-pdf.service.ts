import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import type { JobFitPayload } from './llm-job-fit.service'

interface FontCandidate {
  path: string
  family?: string
}

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

type JobFitReportMeta = {
  date: string
  job: {
    id?: string
    title: string
    company: string | null
    sourceName: string | null
    sourceUrl: string | null
    externalId: string | null
  }
  decisionSupport: JobFitPayload['decisionSupport'] | undefined
}

/** 岗位匹配决策报告：仅复述已验证的岗位匹配参考，不新增招聘判断或承诺。 */
@Injectable()
export class JobFitPdfService {
  private readonly logger = new Logger(JobFitPdfService.name)

  async render(meta: JobFitReportMeta, payload: JobFitPayload): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
    const fontReady = fontCandidates().some((candidate) => {
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
      throw new InternalServerErrorException({
        error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: '服务器缺少中文字体，无法生成岗位匹配报告' },
      })
    }

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    const section = (text: string) => {
      doc.moveDown(0.8)
      doc.fontSize(13).fillColor('#111827').text(text)
      doc.moveDown(0.3)
    }
    const bullet = (text: string) => doc.fontSize(10.5).fillColor('#374151').text(`· ${text}`, { lineGap: 3 })

    doc.fontSize(18).fillColor('#111827').text('岗位匹配决策报告')
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280').text(`生成时间：${meta.date} ｜ 目标岗位：${meta.job.title}`)
    if (meta.job.company) doc.fontSize(10).fillColor('#6b7280').text(`企业：${meta.job.company}`)
    if (meta.job.sourceName) doc.fontSize(10).fillColor('#6b7280').text(`岗位来源：${meta.job.sourceName}`)
    doc.moveDown(0.2)
    doc.fontSize(9).fillColor('#9ca3af').text('本报告仅供本人参考，不构成任何就业、薪资或录用承诺；请仅基于本人真实经历准备材料，并以岗位来源平台信息为准。')

    section('一、匹配参考总览')
    doc.fontSize(10.5).fillColor('#374151').text(payload.summary, { lineGap: 3 })
    doc.fontSize(10).fillColor('#6b7280').text(`参考等级：${this.fitLevelLabel(payload.fitLevel)}`)

    section('二、已有匹配点（简历依据）')
    if (payload.matchPoints.length === 0) {
      bullet('当前记录未提供可展示的匹配点，请以本人简历与岗位来源信息为准。')
    } else {
      payload.matchPoints.forEach((item) => {
        doc.fontSize(10.5).fillColor('#111827').text(`· ${item.point}`, { lineGap: 2 })
        doc.fontSize(9.5).fillColor('#6b7280').text(`   简历依据：${item.evidence}`, { lineGap: 4 })
      })
    }

    section('三、待准备方向')
    if (payload.gapPoints.length === 0) {
      bullet('当前记录未提供具体差距项，建议在来源平台核对岗位要求后再准备。')
    } else {
      payload.gapPoints.forEach((item) => {
        doc.fontSize(10.5).fillColor('#111827').text(`· ${item.gap}`, { lineGap: 2 })
        doc.fontSize(9.5).fillColor('#6b7280').text(`   建议：${item.suggestion}`, { lineGap: 4 })
      })
    }

    section('四、定向优化建议')
    if (payload.targetedSuggestions.length === 0) {
      bullet('当前记录未提供定向建议，请只补充可由本人真实经历支持的内容。')
    } else {
      payload.targetedSuggestions.forEach(bullet)
    }

    section('五、岗位关键词参考')
    const coverage = meta.decisionSupport?.keywordCoverage
    if (!coverage) {
      doc.fontSize(10.5).fillColor('#6b7280').text('本次报告基于基础岗位匹配结果生成；该历史记录未包含 M1.5 关键词覆盖信息，因此不展示关键词清单。', { lineGap: 3 })
    } else {
      const matched = coverage.matched.length > 0 ? coverage.matched.join('、') : '未识别到可展示关键词'
      const missing = coverage.missing.length > 0 ? coverage.missing.join('、') : '未识别到待补充关键词'
      doc.fontSize(10.5).fillColor('#374151').text(`简历与岗位共同出现：${matched}`, { lineGap: 3 })
      doc.fontSize(10.5).fillColor('#374151').text(`岗位中出现、简历尚未体现：${missing}`, { lineGap: 3 })
    }

    if (meta.job.sourceUrl) {
      section('六、后续操作')
      doc.fontSize(10.5).fillColor('#374151').text('如需继续了解或提交材料，请前往岗位来源平台完成；本系统不接收简历。', { lineGap: 3 })
      doc.fontSize(9.5).fillColor('#6b7280').text(`来源链接：${meta.job.sourceUrl}`, { lineGap: 3 })
    }

    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    this.logger.log(`jobfit.pdf_ok bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }

  private fitLevelLabel(level: JobFitPayload['fitLevel']): string {
    if (level === 'reference_high') return '较高参考'
    if (level === 'reference_low') return '较低参考'
    return '中等参考'
  }
}
