import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import { applyAigcPdfMetadata } from '../common/pdf/aigc-pdf-metadata'
import { ADVISOR_DISCLAIMER, COMPARE_LIMITS, SLOT_DRAFT_BLANK_POLICY } from './advisor-skills'
import type { AdvisorArtifactPayload } from './advisor-artifact.types'

// ============================================================
// S3-3 · P26 顾问作业面产物 PDF。
//
// 设计页硬要求：「每条都带出处，打印时也会带上，让你自己能分辨哪条更可信」——
// 所以三种产物的打印版都必须逐条印出 E1/E2/E3 与出处说明，不能只印结论。
//
// 字体解析与既有 AI 产物 PDF 同源候选；找不到中文字体诚实报错（不静默出乱码 PDF）。
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

const VERDICT_LABEL: Record<string, string> = {
  covered: '你写到了',
  missing: '没写到',
  not_a_capability: '不是能力项',
}

@Injectable()
export class AdvisorPdfService {
  private readonly logger = new Logger(AdvisorPdfService.name)

  async render(
    meta: { date: string; providerLabel: string },
    payload: AdvisorArtifactPayload,
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
    applyAigcPdfMetadata(doc, {
      title: this.titleOf(payload),
      subject: `AI 顾问作业面产物，${ADVISOR_DISCLAIMER}；不代表投递、面试或录用结果，本机不代收简历、不做平台内投递。`,
      kind: 'advisor',
    })
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
      throw new InternalServerErrorException({
        error: { code: 'ADVISOR_PDF_FONT_NOT_FOUND', message: '服务器缺少中文字体，无法生成打印版' },
      })
    }

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    const title = (t: string) => { doc.moveDown(0.8); doc.fontSize(13).fillColor('#111827').text(t); doc.moveDown(0.3) }
    const body = (t: string) => doc.fontSize(10.5).fillColor('#374151').text(t, { lineGap: 3 })
    const note = (t: string) => doc.fontSize(9.5).fillColor('#6b7280').text(t, { lineGap: 4 })

    doc.fontSize(18).fillColor('#111827').text(this.titleOf(payload))
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280').text(`生成时间：${meta.date} ｜ 生成方式：${meta.providerLabel}`)
    doc.moveDown(0.2)
    doc.fontSize(9).fillColor('#9ca3af').text(
      `${ADVISOR_DISCLAIMER}。本机不代收简历、不做平台内投递，也不预测录用结果或承诺薪资；` +
      '每条结论后附出处等级（E1 你的材料与你说过的话 / E2 本机读到的来源事实 / E3 AI 判断），请自行分辨可信度。',
    )

    if (payload.kind === 'qa_pins') {
      title('你钉住的条目')
      if (payload.pins.length === 0) {
        body('（本次没有钉住任何条目）')
      }
      payload.pins.forEach((pin, i) => {
        doc.fontSize(10.5).fillColor('#111827').text(`${i + 1}. ${pin.content}`, { lineGap: 2 })
        note(`   出处：${pin.evidenceLevel}${pin.sourceNote ? ` · ${pin.sourceNote}` : ''}`)
      })
      title('对话保存口径')
      note('对话本身不保存；只有你主动钉住的条目会留下并带进后续步骤。')
    } else if (payload.kind === 'slot_draft') {
      title('成稿')
      body(payload.draft)
      title('留空的地方')
      note(`以下内容只有你自己知道，本机一律留空不替你编：${SLOT_DRAFT_BLANK_POLICY.join('、')}。`)
      if (payload.blanks.length > 0) {
        payload.blanks.forEach((b) => doc.fontSize(10.5).fillColor('#374151').text(`□ ${b}`, { lineGap: 4 }))
      } else {
        note('本稿没有标记出待补项，但仍请按实际情况核对后再使用。')
      }
      title('说明')
      note(payload.summary)
      title('你自己填的内容（成稿依据 · E1）')
      payload.basedOn.forEach((entry) => {
        doc.fontSize(10).fillColor('#111827').text(`· ${entry.prompt}`, { lineGap: 2 })
        note(`   ${entry.value}`)
      })
    } else {
      title('逐条比对结果')
      note('比的是「有没有写到」，不是「写得好不好」——后者需要行业经验，本机没有依据，所以不比。')
      doc.moveDown(0.2)
      payload.items.forEach((item, i) => {
        doc.fontSize(10.5).fillColor('#111827').text(`${i + 1}. [${VERDICT_LABEL[item.verdict] ?? item.verdict}] ${item.requirement}`, { lineGap: 2 })
        note(`   ${item.verdict === 'covered' ? `你的原文：「${item.evidence}」（E1）` : `${item.evidence}（E3）`}`)
      })
      if (payload.extras.length > 0) {
        title('你材料里有、但这条岗位没提的')
        payload.extras.forEach((e) => {
          doc.fontSize(10.5).fillColor('#374151').text(`· ${e.point}`, { lineGap: 2 })
          if (e.note) note(`   ${e.note}`)
        })
      }
      title('本机比不了的')
      COMPARE_LIMITS.forEach((limit) => {
        doc.fontSize(10.5).fillColor('#111827').text(`· ${limit.what}`, { lineGap: 2 })
        note(`   ${limit.why}`)
      })
      title('总览')
      note(payload.summary)
      doc.moveDown(0.2)
      note('「没写到」的条目如果你其实做过，那是材料漏写，不是你缺 —— 补上再重跑，结果会变。')
    }

    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    this.logger.log(`advisor.pdf_ok kind=${payload.kind} bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }

  private titleOf(payload: AdvisorArtifactPayload): string {
    if (payload.kind === 'qa_pins') return 'AI 顾问 · 钉住条目单'
    if (payload.kind === 'slot_draft') return 'AI 顾问 · 成稿'
    return 'AI 顾问 · 逐条比对表'
  }
}
