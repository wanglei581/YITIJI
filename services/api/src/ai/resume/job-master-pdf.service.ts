import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import type { JobMasterPayload } from './llm-job-master.service'

// ============================================================
// 岗位决策参考报告 PDF（岗位大师 M1）：五区块专属版式
// （岗位与本人概要 / 适配度双栏 / 薪资参考 / 路径三节点 / 风险与建议 + 页脚免责）。
// 字体解析与 Resume/CareerPlan PDF 同源候选；找不到中文字体诚实报错。内容不写日志。
//
// 合规：适配度只呈现三档参考等级文案（无百分比）；薪资只透传来源方文本；
// 风险定性三档；页脚固定「数据来源 + 生成时间 + 仅供求职参考，不构成录用或薪酬承诺」。
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

const FIT_LABEL: Record<JobMasterPayload['fit']['level'], string> = {
  reference_high: '较高（参考）',
  reference_medium: '中等（参考）',
  reference_low: '较低（参考）',
}
const RISK_LABEL: Record<JobMasterPayload['risks'][number]['level'], string> = {
  low: '较低',
  medium: '需注意',
  high: '需谨慎',
}

export interface JobMasterReportData {
  job: { title: string; company: string | null }
  salary: { sourceText: string | null; note: string }
  payload: JobMasterPayload
}

@Injectable()
export class JobMasterPdfService {
  private readonly logger = new Logger(JobMasterPdfService.name)

  async render(meta: { date: string }, data: JobMasterReportData): Promise<{ buffer: Buffer; pageCount: number }> {
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
      throw new InternalServerErrorException({ error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: '服务器缺少中文字体，无法生成决策报告' } })
    }

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    const { job, salary, payload } = data
    const title = (t: string) => { doc.moveDown(0.7); doc.fontSize(13).fillColor('#111827').text(t); doc.moveDown(0.25) }

    // 标题
    doc.fontSize(18).fillColor('#111827').text('岗位决策参考报告')
    doc.moveDown(0.3)
    doc.fontSize(11).fillColor('#374151').text(`目标岗位：${job.title}${job.company ? `（${job.company}）` : ''}`)

    // 一、岗位与本人概要
    title('一、概要')
    doc.fontSize(10.5).fillColor('#374151').text(payload.fit.summary, { lineGap: 3 })

    // 二、适配度双栏（已具备 / 建议补足）
    title('二、岗位适配度')
    doc.fontSize(11).fillColor('#1d4ed8').text(`参考匹配度：${FIT_LABEL[payload.fit.level]}`)
    doc.moveDown(0.2)
    doc.fontSize(10.5).fillColor('#065f46').text('已具备（✓）')
    payload.fit.matchedSkills.forEach((m) => {
      doc.fontSize(10).fillColor('#111827').text(`· ${m.skill}`, { lineGap: 1 })
      doc.fontSize(9).fillColor('#6b7280').text(`   依据：${m.evidence}`, { lineGap: 3 })
    })
    if (payload.fit.gapSkills.length > 0) {
      doc.moveDown(0.2)
      doc.fontSize(10.5).fillColor('#9a3412').text('建议补足（✗）')
      payload.fit.gapSkills.forEach((g) => {
        doc.fontSize(10).fillColor('#111827').text(`· ${g.skill}`, { lineGap: 1 })
        doc.fontSize(9).fillColor('#6b7280').text(`   建议：${g.suggestion}`, { lineGap: g.learningDirection || g.firstStep ? 1 : 3 })
        if (g.learningDirection) doc.fontSize(9).fillColor('#6b7280').text(`   方向：${g.learningDirection}`, { lineGap: 1 })
        if (g.firstStep) doc.fontSize(9).fillColor('#6b7280').text(`   第一步：${g.firstStep}`, { lineGap: 3 })
      })
    }
    // 关键词覆盖（M1.5，数据存在才渲染；只列命中/待补，不算比率）
    const kc = payload.fit.keywordCoverage
    if (kc && (kc.matched.length || kc.missing.length)) {
      doc.moveDown(0.2)
      doc.fontSize(10.5).fillColor('#111827').text('关键词覆盖')
      if (kc.matched.length) doc.fontSize(9).fillColor('#065f46').text(`   命中：${kc.matched.join('、')}`, { lineGap: 1 })
      if (kc.missing.length) doc.fontSize(9).fillColor('#9a3412').text(`   待补：${kc.missing.join('、')}`, { lineGap: 3 })
    }

    // 三、薪资参考（只透传来源方文本）
    title('三、薪资参考')
    doc.fontSize(10.5).fillColor('#374151').text(
      salary.sourceText ? `来源方提供：${salary.sourceText}` : '来源平台未提供薪资信息',
      { lineGap: 2 },
    )
    doc.fontSize(9).fillColor('#9ca3af').text(salary.note, { lineGap: 3 })

    // 四、晋升路径三节点
    title('四、晋升路径参考（当前 → 1-3年 → 3-5年）')
    const cp = payload.careerPath
    doc.fontSize(10.5).fillColor('#111827').text(`当前：${cp.current.title}`, { lineGap: 1 })
    doc.fontSize(9).fillColor('#6b7280').text(`   依据：${cp.current.evidence}`, { lineGap: 3 })
    doc.fontSize(10.5).fillColor('#111827').text(`1-3年：${cp.next.title}`, { lineGap: 1 })
    if (cp.next.skillsToBuild.length > 0) doc.fontSize(9).fillColor('#6b7280').text(`   待补技能：${cp.next.skillsToBuild.join('、')}`, { lineGap: 1 })
    doc.fontSize(9).fillColor('#6b7280').text(`   第一步：${cp.next.firstStep}`, { lineGap: cp.next.rationale ? 1 : 3 })
    if (cp.next.rationale) doc.fontSize(9).fillColor('#6b7280').text(`   依据：${cp.next.rationale}`, { lineGap: 3 })
    doc.fontSize(10.5).fillColor('#111827').text(`3-5年：${cp.target.title}`, { lineGap: 1 })
    if (cp.target.skillsToBuild.length > 0) doc.fontSize(9).fillColor('#6b7280').text(`   待补技能：${cp.target.skillsToBuild.join('、')}`, { lineGap: cp.target.rationale || cp.target.firstStep ? 1 : 3 })
    if (cp.target.rationale) doc.fontSize(9).fillColor('#6b7280').text(`   依据：${cp.target.rationale}`, { lineGap: cp.target.firstStep ? 1 : 3 })
    if (cp.target.firstStep) doc.fontSize(9).fillColor('#6b7280').text(`   第一步：${cp.target.firstStep}`, { lineGap: 3 })

    // 五、风险与建议
    title('五、风险与建议')
    if (payload.risks.length === 0) {
      doc.fontSize(10).fillColor('#6b7280').text('· 未发现明显硬性门槛风险；仍建议到来源平台核实岗位完整信息。', { lineGap: 3 })
    } else {
      payload.risks.forEach((r) => {
        doc.fontSize(10.5).fillColor('#111827').text(`· ${r.title}（${RISK_LABEL[r.level]}）`, { lineGap: 1 })
        doc.fontSize(9.5).fillColor('#374151').text(`   ${r.reason}`, { lineGap: 1 })
        doc.fontSize(9).fillColor('#6b7280').text(`   依据：${r.basis}`, { lineGap: 3 })
      })
    }

    // 六、面试准备（M1.5，数据存在才渲染）
    if (payload.interviewPrep?.length) {
      title('六、面试准备参考')
      payload.interviewPrep.forEach((it) => {
        doc.fontSize(10.5).fillColor('#111827').text(`· ${it.question}`, { lineGap: 1 })
        if (it.whyAsked) doc.fontSize(9).fillColor('#6b7280').text(`   为什么问：${it.whyAsked}`, { lineGap: 1 })
        doc.fontSize(9).fillColor('#6b7280').text(`   准备：${it.prepHint}`, { lineGap: 3 })
      })
    }

    // 七、简历改写要点（M1.5，数据存在才渲染）
    if (payload.resumeRewrite?.length) {
      title('七、简历改写要点')
      payload.resumeRewrite.forEach((it) =>
        doc.fontSize(10).fillColor('#374151').text(`· ${it.area}：${it.suggestion}`, { lineGap: 3 }))
    }

    // 页脚免责（固定）
    doc.moveDown(0.8)
    doc.fontSize(8.5).fillColor('#9ca3af').text(
      `数据来源：本人简历 + 第三方岗位信息${salary.sourceText ? ' + 来源方薪资' : ''} ｜ 生成时间：${meta.date}`,
      { lineGap: 2 },
    )
    doc.fontSize(8.5).fillColor('#9ca3af').text('结果仅供求职参考，不构成录用承诺或薪酬承诺；投递请前往岗位来源平台。')

    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    this.logger.log(`jobmaster.pdf_ok bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }
}
