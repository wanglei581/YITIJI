import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import type { InterviewReportPayload } from './mock-interview-llm.service'

// ============================================================
// 模拟面试练习报告 PDF（2C）：服务端 pdfkit 真实渲染，进 FileObject + 打印链路。
// 跨平台中文字体解析与 ResumePdfService 同源（Windows/macOS/Linux 候选 + env 覆盖）；
// 找不到字体诚实报错，不输出乱码 PDF。报告内容不写日志。
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

const LEVEL_LABEL: Record<string, string> = {
  needs_work: '需要加强', pass: '基础达标', good: '表现良好', excellent: '表现突出',
}

@Injectable()
export class InterviewReportPdfService {
  private readonly logger = new Logger(InterviewReportPdfService.name)

  async render(meta: { position: string; industry: string; interviewerLabel: string; date: string }, report: InterviewReportPayload): Promise<{ buffer: Buffer; pageCount: number }> {
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
      throw new InternalServerErrorException({ error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: '服务器缺少中文字体，无法生成打印版报告' } })
    }

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    const title = (t: string) => { doc.moveDown(0.8); doc.fontSize(13).fillColor('#111827').text(t); doc.moveDown(0.3) }
    const bullet = (t: string) => doc.fontSize(10.5).fillColor('#374151').text(`· ${t}`, { lineGap: 3 })

    doc.fontSize(18).fillColor('#111827').text('模拟面试练习报告')
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280').text(`目标岗位：${meta.position} ｜ 行业：${meta.industry} ｜ 面试官：${meta.interviewerLabel} ｜ 练习时间：${meta.date}`)
    doc.moveDown(0.2)
    doc.fontSize(9).fillColor('#9ca3af').text('本报告仅供本人面试练习与准备参考，不代表任何招聘结果承诺，不参与企业筛选、面试邀约或录用决策。')

    title('一、综合表现概览')
    doc.fontSize(11).fillColor('#1d4ed8').text(`练习表现等级：${LEVEL_LABEL[report.overall.level] ?? report.overall.level}`)
    doc.fontSize(10.5).fillColor('#374151').text(report.overall.summary, { lineGap: 3 })

    const sections: Array<[string, string[]]> = [
      ['二、表达清晰度', report.expression],
      ['三、岗位匹配度参考', report.positionFit],
      ['四、经历可信度与细节', report.credibility],
      ['五、专业能力表现', report.professional],
      ['六、沟通与应变能力', report.adaptability],
      ['七、风险点与改进建议', report.risks],
    ]
    for (const [t, items] of sections) {
      title(t)
      items.forEach(bullet)
    }

    title('八、高频问题预测（建议继续准备）')
    report.predictedQuestions.forEach((q, i) => {
      doc.fontSize(10.5).fillColor('#111827').text(`${i + 1}. ${q.question}`, { lineGap: 2 })
      doc.fontSize(10).fillColor('#6b7280').text(`   考察点：${q.why}`, { lineGap: 2 })
      doc.fontSize(10).fillColor('#6b7280').text(`   回答思路：${q.approach}`, { lineGap: 4 })
    })

    title('九、STAR 回答建议')
    bullet(`S 情境：${report.starAdvice.s}`)
    bullet(`T 任务：${report.starAdvice.t}`)
    bullet(`A 行动：${report.starAdvice.a}`)
    bullet(`R 结果：${report.starAdvice.r}`)
    doc.fontSize(10).fillColor('#b45309').text(`提醒：${report.starAdvice.reminder}`, { lineGap: 3 })

    title('十、面试前准备清单')
    report.checklist.forEach((c) => doc.fontSize(10.5).fillColor('#374151').text(`□ ${c}`, { lineGap: 4 }))

    // pageCount 必须在 end() 之前读取（pdfkit 行为）
    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    this.logger.log(`interview.pdf_ok bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }
}
