import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { existsSync } from 'node:fs'
import PDFDocument from 'pdfkit'
import type { ContractReviewFinding, ContractReviewResult } from './contract-review.types'

interface FontCandidate { path: string; family?: string }

const PRIORITY_LABEL: Record<ContractReviewFinding['priority'], string> = {
  priority_check: '优先核对',
  attention: '需要留意',
  insufficient_info: '信息不足',
}

function fontCandidates(): FontCandidate[] {
  const envPath = process.env['RESUME_PDF_FONT_PATH']?.trim()
  const candidates: FontCandidate[] = envPath ? [{ path: envPath }] : []
  if (process.platform === 'win32') {
    const winDir = process.env['WINDIR'] ?? 'C:\\Windows'
    candidates.push(
      { path: `${winDir}\\Fonts\\msyh.ttc`, family: 'Microsoft YaHei' },
      { path: `${winDir}\\Fonts\\simsun.ttc`, family: 'SimSun' },
    )
  } else if (process.platform === 'darwin') {
    candidates.push(
      { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' },
      { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'HiraginoSansGB-W3' },
      { path: '/System/Library/Fonts/STHeiti Light.ttc', family: 'STHeitiSC-Light' },
    )
  } else {
    candidates.push(
      { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
      { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
    )
  }
  return candidates
}

@Injectable()
export class ContractReviewReportPdfService {
  async render(args: {
    taskId: string
    result: ContractReviewResult
    generatedAt: Date
  }): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 56, bottom: 72, left: 56, right: 56 },
      info: {
        Title: 'AI 签约风险提示',
        Author: '青序 AI 求职服务',
        Subject: 'AI 生成的合同条款风险提示，仅供本人求职准备参考',
        CreationDate: args.generatedAt,
      },
    })
    this.requireChineseFont(doc)
    const metadata = doc.info as Record<string, string | Date>
    metadata['AIGenerated'] = 'true'
    metadata['ServiceProviderCode'] = 'zyd-contract-v1'
    metadata['ContentId'] = args.taskId
    metadata['GeneratedAt'] = args.generatedAt.toISOString()
    metadata['RulePackVersion'] = args.result.rulePackVersion
    metadata['DisclaimerVersion'] = args.result.disclaimerVersion

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.once('end', () => resolve(Buffer.concat(chunks)))
      doc.once('error', reject)
    })

    doc.fontSize(20).fillColor('#0f172a').text('AI 签约风险提示')
    doc.moveDown(0.35)
    doc.fontSize(9.5).fillColor('#475569').text(
      `生成时间：${args.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC  ｜  AI 生成`,
    )
    doc.moveDown(0.5)
    this.notice(doc)

    this.section(doc, '风险概览')
    doc.fontSize(10.5).fillColor('#334155').text(
      `优先核对 ${args.result.priorityCheckCount} 项  ｜  需要留意 ${args.result.attentionCount} 项  ｜  信息不足 ${args.result.insufficientInfoCount} 项`,
      { lineGap: 3 },
    )
    doc.fontSize(9.5).fillColor('#64748b').text(
      `审查范围：${args.result.coverage === 'complete' ? '已覆盖全部可识别页面' : '仅覆盖部分页面'}；OCR 可信度：${ocrLabel(args.result.ocrConfidence)}`,
      { lineGap: 3 },
    )
    doc.fontSize(8.5).fillColor('#94a3b8').text(
      `规则版本：${safeText(args.result.rulePackVersion, 80)} ｜ 免责声明版本：${safeText(args.result.disclaimerVersion, 80)}`,
      { lineGap: 3 },
    )

    if (args.result.findings.length === 0) {
      this.section(doc, '核对事项')
      doc.fontSize(10.5).fillColor('#334155').text(
        '本次未识别到需要单独列出的事项。该结果不代表合同不存在风险，签署前仍请逐条核对主体、期限、薪酬、工作地点、解除条件等关键内容。',
        { lineGap: 4 },
      )
    } else {
      args.result.findings.forEach((finding, index) => this.finding(doc, finding, index + 1))
    }

    this.section(doc, '使用说明')
    doc.fontSize(9.5).fillColor('#475569').text(
      '本报告只呈现系统识别到的核对线索，不替代律师、劳动监察部门或其他专业机构的意见，也不对合同效力、争议结果或录用结果作出承诺。请以合同原文和有权机构意见为准。',
      { lineGap: 4 },
    )

    const pageRange = doc.bufferedPageRange()
    for (let index = 0; index < pageRange.count; index += 1) {
      doc.switchToPage(pageRange.start + index)
      doc.save()
      const bottomMargin = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      doc.font('cjk').fontSize(8).fillColor('#64748b')
      doc.text(
        `AI 生成，仅作风险提示，不构成正式法律意见    ${index + 1}/${pageRange.count}`,
        56,
        doc.page.height - 42,
        { width: doc.page.width - 112, align: 'center', lineBreak: false },
      )
      doc.page.margins.bottom = bottomMargin
      doc.restore()
    }
    const pageCount = pageRange.count
    doc.end()
    try {
      return { buffer: await done, pageCount }
    } catch {
      throw reportRenderFailed()
    }
  }

  private requireChineseFont(doc: InstanceType<typeof PDFDocument>): void {
    const available = fontCandidates().some((candidate) => {
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
    if (!available) {
      doc.end()
      throw new InternalServerErrorException({
        error: {
          code: 'CONTRACT_REVIEW_REPORT_FONT_NOT_FOUND',
          message: '服务器缺少中文字体，无法生成合同风险提示报告',
        },
      })
    }
  }

  private notice(doc: InstanceType<typeof PDFDocument>): void {
    const x = doc.x
    const y = doc.y
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
    doc.save().roundedRect(x, y, width, 54, 7).fill('#eff6ff').restore()
    doc.fontSize(9.5).fillColor('#1e3a8a').text(
      '重要提示：本报告由 AI 辅助生成，仅供本人识别需要进一步核对的条款，不构成法律意见。涉及重大权益或争议时，请咨询专业人士。',
      x + 12,
      y + 11,
      { width: width - 24, lineGap: 3 },
    )
    doc.y = y + 58
  }

  private section(doc: InstanceType<typeof PDFDocument>, title: string): void {
    doc.moveDown(0.8).fontSize(13).fillColor('#0f172a').text(title).moveDown(0.3)
  }

  private finding(
    doc: InstanceType<typeof PDFDocument>,
    finding: ContractReviewFinding,
    index: number,
  ): void {
    this.section(doc, `${index}. ${safeText(finding.title, 160)}（${PRIORITY_LABEL[finding.priority]}）`)
    const page = finding.evidence.pageNumber === null ? '页码待核对' : `第 ${finding.evidence.pageNumber} 页`
    doc.fontSize(9.5).fillColor('#64748b').text(`${page} ｜ ${safeText(finding.basisRef ?? '依据待核对', 240)}`)
    if (finding.evidence.excerpt.trim()) {
      doc.fontSize(9.5).fillColor('#475569').text(`原文线索：${safeText(finding.evidence.excerpt, 500)}`, { lineGap: 3 })
    }
    doc.fontSize(10).fillColor('#334155').text(`提示：${safeText(finding.explanation, 900)}`, { lineGap: 3 })
    doc.fontSize(10).fillColor('#1d4ed8').text(`建议核对：${safeText(finding.verificationQuestion, 500)}`, { lineGap: 3 })
    if (finding.uncertainty.trim()) {
      doc.fontSize(9.5).fillColor('#92400e').text(`不确定性：${safeText(finding.uncertainty, 500)}`, { lineGap: 3 })
    }
  }
}

function safeText(value: string, maxLength: number): string {
  let printable = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    const isBlockedControl = code <= 8 || code === 11 || code === 12 ||
      (code >= 14 && code <= 31) || code === 127
    printable += isBlockedControl ? ' ' : character
  }
  const normalized = printable.trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`
}

function ocrLabel(value: ContractReviewResult['ocrConfidence']): string {
  return value === 'high' ? '高' : value === 'medium' ? '中' : '低'
}

function reportRenderFailed(): InternalServerErrorException {
  return new InternalServerErrorException({
    error: { code: 'CONTRACT_REVIEW_REPORT_RENDER_FAILED', message: '合同风险提示报告生成失败，请稍后重试' },
  })
}
