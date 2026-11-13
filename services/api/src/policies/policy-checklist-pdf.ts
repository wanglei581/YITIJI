import { ServiceUnavailableException } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { CJK_FONT_MISSING_USER_MESSAGE, registerCjkFont } from '../common/pdf/cjk-font'
import { checkPolicySourceLink } from './policy-source-link'
import { layoutChecklistColumns } from './policy-checklist-layout'

export { CHECKLIST_EMPTY, CHECKLIST_TRUNCATED } from './policy-checklist-layout'

export const CHECKLIST_FOOTER = '仅供参考，不具证明效力；办理要件和资格以发布机构和经办窗口为准，本机不代办'

export interface ChecklistPdfInput {
  title: string
  sourceName: string
  publishedDate: Date | null
  publishConfirmedAt: Date | null
  whoCanApply: string | null
  requiredMaterials: string | null
  whereToApply: string | null
  externalUrl: string | null
  org: { verifiedOfficialDomainsJson: string | null }
}

/** 页眉、二维码和页脚固定；三栏按内容分高度，整页放不下才截断。绝不自动换页。 */
export async function renderPolicyChecklist(policy: ChecklistPdfInput, now = new Date()) {
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true,
    info: { Title: '政策办事清单', CreationDate: now } })
  if (!registerCjkFont(doc)) {
    doc.end()
    throw new ServiceUnavailableException({ error: {
      code: 'POLICY_CHECKLIST_FONT_NOT_FOUND', message: CJK_FONT_MISSING_USER_MESSAGE,
    } })
  }
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  const width = 511
  const draw = (text: string, y: number, height: number, size = 11, x = 42, w = width) => {
    doc.fontSize(size).fillColor('#17212b')
    doc.text(text, x, y, { width: w, height, lineGap: 3 })
  }
  const columns = layoutChecklistColumns(doc, policy)
  draw('政策办事清单', 42, 38, 21)
  draw(policy.title, 82, 52, 16)
  draw(`发布机构：${policy.sourceName}`, 142, 32, 10)
  const date = policy.publishedDate ?? policy.publishConfirmedAt
  draw(`发布日期：${date ? chinaDate(date) : '发布机构没有提供'}`, 177, 20, 10)
  for (const column of columns) {
    doc.moveTo(42, column.y - 6).lineTo(553, column.y - 6).lineWidth(0.5).strokeColor('#c6ced5').stroke()
    draw(column.title, column.y, column.titleHeight, 13)
    draw(column.text, column.y + column.titleHeight + 4, column.contentHeight + 1, 11)
  }
  const source = checkPolicySourceLink(policy.externalUrl, policy.org.verifiedOfficialDomainsJson)
  if (source.status === 'verified') {
    const qr = await QRCode.toBuffer(source.url, { type: 'png', errorCorrectionLevel: 'M', margin: 4, width: 400 })
    doc.image(qr, 42, 617, { width: 100, height: 100 })
    draw(`扫码打开原文：${source.host}`, 630, 72, 10, 155, 398)
  } else {
    draw('发布机构没有提供可核对的原文链接', 635, 55, 10)
  }
  // 同一版本的清单会复用（见 policy-checklist.service.ts），这里写的是生成时间，不是这一次出纸的时间。
  draw(`清单生成时间：${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short',
  }).format(now)}`, 730, 20, 9)
  // 固定原文单独绘制，不经过截断函数。
  doc.fontSize(9).text(CHECKLIST_FOOTER, 42, 767, { width, height: 40, lineGap: 3 })
  const pageCount = doc.bufferedPageRange().count
  doc.end()
  const buffer = await done
  if (pageCount !== 1) throw new Error('POLICY_CHECKLIST_PAGE_OVERFLOW')
  return { buffer, pageCount }
}

function chinaDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
