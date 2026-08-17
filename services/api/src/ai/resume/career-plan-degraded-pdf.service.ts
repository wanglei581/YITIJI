import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import { registerCjkFont } from './career-plan-pdf.service'
import {
  DEGRADED_SELF_CHECKLIST,
  DEGRADED_SELF_CHECKLIST_CAVEAT,
  describeSampleIssue,
  type DegradedCareerPlanContent,
} from './career-plan-degraded'

// ============================================================
// 职业规划「降级版式」PDF（S3-DEGRADE-PRINT）—— 第二套版式，与 career-plan-pdf.service.ts
// 的 AI 版式并列，不是它的分支。两套纸的内容来源完全不同，混在一个版式里迟早会印串。
//
// 这张纸上的每一段都必须能回答「这段是谁生成的」：
//   E1  用户自己填的  —— 自我探索 25 题的固定权重记分（纯函数，不经过模型）
//   通用 非个性化     —— ai-down 支线的三条通用自检项（人工写死的文案，不是判断）
//   E2  来源信息      —— 岗位要求计数（确定性聚合，**不得标 E3**）
//
// 刻意不写 AIGenerated=true：
//   `applyAigcPdfMetadata` 会把 AIGenerated 写成 'true'。这张纸里**一个字都不是模型生成的**，
//   标成 AI 产物和反过来把 AI 产物标成人工一样是失真的。所以这里写自己的诚实元数据，
//   显式标 AIGenerated='false'，并用独立的 ServiceProviderCode 便于事后区分两套产物。
// ============================================================

/** 与 AI 版式区分开的产物标识。 */
const DEGRADED_SERVICE_PROVIDER_CODE = 'zyd-careerplan-degraded-v1'

/**
 * 打印件标题。**必须**一眼看出是降级版 —— 用户拿走的是纸，
 * 页面上的降级提示不会跟着纸走，所以口径只能写在纸面上。
 */
export const DEGRADED_PDF_TITLE = '求职参考单（未含 AI 规划建议）'

/** 文件名同样带口径，避免在「我的文档」列表里和 AI 版混淆。 */
export const DEGRADED_PDF_FILENAME = '求职参考单（未含AI规划）.pdf'

@Injectable()
export class CareerPlanDegradedPdfService {
  private readonly logger = new Logger(CareerPlanDegradedPdfService.name)

  async render(content: DegradedCareerPlanContent): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
    this.applyHonestMetadata(doc)

    if (!registerCjkFont(doc)) {
      doc.end()
      throw new InternalServerErrorException({
        error: { code: 'RESUME_PDF_FONT_NOT_FOUND', message: '服务器缺少中文字体，无法生成参考单' },
      })
    }

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    const title = (t: string) => { doc.moveDown(0.8); doc.fontSize(13).fillColor('#111827').text(t); doc.moveDown(0.3) }
    const body = (t: string) => doc.fontSize(10.5).fillColor('#374151').text(t, { lineGap: 3 })
    const muted = (t: string) => doc.fontSize(9.5).fillColor('#6b7280').text(t, { lineGap: 3 })

    // ── 抬头：降级口径写在最显眼的位置 ────────────────────────────────────
    doc.fontSize(18).fillColor('#111827').text(DEGRADED_PDF_TITLE)
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280').text(`生成时间：${content.date}`)
    doc.moveDown(0.2)
    doc.fontSize(10).fillColor('#b45309').text(
      '本单不含 AI 规划建议。以下内容全部由本机确定性生成：你自己填写的记分、通用自检清单、'
      + '以及对本机在架岗位的要求计数。没有任何一段来自 AI 判断。',
      { lineGap: 3 },
    )

    title('本次为什么没有 AI 规划')
    body(content.reason.text)
    muted('AI 恢复后回到「职业规划建议」重新生成，可以拿到按你简历原文逐条对应的完整版本。')

    // ── 一、E1 用户自己填的 ───────────────────────────────────────────────
    title('一、你自己填的：自我探索记分（E1 · 本人作答）')
    if (content.selfAssessment.length > 0) {
      muted('记分方式是 25 道选择题的固定权重累加，纯计算、不经过模型，所以 AI 不可用时照常有效。')
      doc.moveDown(0.2)
      content.selfAssessment.forEach((d) => {
        doc.fontSize(10.5).fillColor('#111827').text(`· ${d.label}：${d.strength} / 5`, { lineGap: 3 })
      })
      doc.moveDown(0.2)
      muted('本次不含 AI 对这些维度的文字解读 —— 那部分依赖模型，这张纸上没有。')
    } else {
      body('本次没有可用的自我探索记分。')
      muted('这一项不依赖 AI：到「自我探索」答完 25 道选择题即可拿到记分，现在就能做。')
    }

    // ── 二、通用自检项（明确非个性化） ────────────────────────────────────
    title('二、通用求职自检（通用清单，不针对你的简历）')
    DEGRADED_SELF_CHECKLIST.forEach((item, i) => {
      doc.fontSize(10.5).fillColor('#374151').text(`${i + 1}. ${item}`, { lineGap: 3 })
    })
    doc.moveDown(0.2)
    muted(DEGRADED_SELF_CHECKLIST_CAVEAT)

    // ── 三、E2 岗位要求计数 ───────────────────────────────────────────────
    this.renderJobRequirementStats(doc, content, { title, body, muted })

    // ── 页脚口径 ──────────────────────────────────────────────────────────
    doc.moveDown(0.8)
    doc.fontSize(9).fillColor('#9ca3af').text(
      '本单仅供本人求职参考，不构成任何就业、薪资或录用承诺；上述计数只描述本机看到的岗位数量，'
      + '不代表市场需求、前景排名或推荐。投递请前往岗位来源平台。',
      { lineGap: 2 },
    )

    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    // 只记尺寸与页数，不记内容。
    this.logger.log(`careerplan.degraded_pdf_ok bytes=${buffer.length} pages=${pageCount}`)
    return { buffer, pageCount }
  }

  /**
   * E2 岗位要求计数。
   *
   * 三种情形都必须如实印出来，任何一种都不许留白或补一张看起来像统计结果的空表：
   *   a) 本机没接上计数能力          → 说没取到
   *   b) 取到了但整批样本量不足      → 印样本量与原因，不给分布
   *   c) 取到了且样本量够            → 印样本量 + 各维度分布（维度自身不足的仍不给分布）
   */
  private renderJobRequirementStats(
    doc: PDFKit.PDFDocument,
    content: DegradedCareerPlanContent,
    fmt: { title: (t: string) => void; body: (t: string) => void; muted: (t: string) => void },
  ): void {
    fmt.title('三、岗位要求计数（E2 · 来源信息，确定性聚合）')
    const stats = content.jobRequirementStats
    if (!stats) {
      fmt.body('本次未取到岗位要求计数。')
      fmt.muted('本机的岗位要求统计能力当前未启用，因此这一节没有数据可印 —— 不是数出来是 0。')
      return
    }

    const s = stats.sample
    fmt.muted(
      `统计口径：命中的在架岗位 ${s.matchedTotal} 条，其中本机读得到正文、计入分母的 ${s.countedTotal} 条；`
      + `只有标题、不计入的 ${s.titleOnlyTotal} 条；涉及来源机构 ${s.sourceOrgCount} 家。`
      + (s.latestSyncTime ? ` 最近一次同步：${s.latestSyncTime}。` : '')
      + (s.truncated ? ` 注意：本次超过单次统计上限 ${s.scanLimit} 条，以上数字只描述按同步时间倒序取到的前 ${s.scanLimit} 条。` : ''),
    )
    doc.moveDown(0.3)

    if (!s.sufficient) {
      fmt.body(`样本量不足，本次不给出要求分布（最低样本量 ${s.minSampleSize} 条）。`)
      fmt.muted(`原因：${describeSampleIssue(s.issue)}。样本量不够时给数字会让人误以为那是统计结论，所以这里不给。`)
      return
    }

    stats.dimensions.forEach((d) => {
      doc.moveDown(0.3)
      doc.fontSize(11).fillColor('#111827').text(`${d.label}（明确写了这一项的 ${d.statedCount} 条 / 计数样本 ${d.sampleSize} 条）`, { lineGap: 2 })
      if (!d.sufficient || d.items.length === 0) {
        doc.fontSize(10).fillColor('#6b7280').text(`   数据不足：明确写了这一项的岗位少于 ${d.minStatedCount} 条，不给分布。`, { lineGap: 3 })
        return
      }
      d.items.forEach((item) => {
        doc.fontSize(10).fillColor('#374151').text(`   · ${item.label}：${item.count} 条`, { lineGap: 2 })
      })
      doc.fontSize(9).fillColor('#9ca3af').text(`   ${d.note}`, { lineGap: 3 })
    })

    if (stats.boundaryNotes.length > 0) {
      doc.moveDown(0.3)
      stats.boundaryNotes.forEach((n) => doc.fontSize(9).fillColor('#9ca3af').text(`※ ${n}`, { lineGap: 2 }))
    }
    doc.moveDown(0.2)
    doc.fontSize(9).fillColor('#9ca3af').text(`统计口径版本：${stats.rulesVersion}`)
  }

  /**
   * 诚实元数据。刻意不复用 `applyAigcPdfMetadata` —— 那个 helper 固定写 AIGenerated='true'，
   * 而这份产物里没有任何模型生成的内容。键名沿用同一组，便于统一检索。
   */
  private applyHonestMetadata(doc: { info: PDFKit.DocumentInfo }): void {
    const generatedAt = new Date()
    const info = doc.info as unknown as Record<string, string | Date>
    info['Title'] = DEGRADED_PDF_TITLE
    info['Author'] = '青序 AI 求职服务'
    info['Subject'] = '本机确定性生成的求职参考单，不含 AI 规划建议；仅供求职者本人参考，不构成就业结果或薪资承诺'
    info['CreationDate'] = generatedAt
    info['AIGenerated'] = 'false'
    info['ServiceProviderCode'] = DEGRADED_SERVICE_PROVIDER_CODE
    info['GeneratedAt'] = generatedAt.toISOString()
  }
}
