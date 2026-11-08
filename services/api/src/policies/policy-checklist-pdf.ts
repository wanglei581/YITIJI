import { ServiceUnavailableException } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { CJK_FONT_MISSING_USER_MESSAGE, registerCjkFont } from '../common/pdf/cjk-font'
import { checkPolicySourceLink } from './policy-source-link'

export const CHECKLIST_FOOTER = '仅供参考，不具证明效力；办理要件和资格以发布机构和经办窗口为准，本机不代办'
export const CHECKLIST_EMPTY = '发布机构没有提供这部分，请以原文为准'
export const CHECKLIST_TRUNCATED = '（内容较长，完整内容请扫码看原文或到经办窗口咨询）'

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

/** 固定区域排版，正文按实际字体量高截断，绝不靠缩小整页或自动换页。 */
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
  const draw = (text: string, y: number, height: number, size = 11, x = 42, w = width, suffix = '…') => {
    doc.fontSize(size).fillColor('#17212b')
    doc.text(fit(text, height, w, suffix), x, y, { width: w, height, lineGap: 3 })
  }
  const fit = (text: string, height: number, w: number, suffix: string): string => {
    const options = { width: w, lineGap: 3 }
    // 先限制输入规模，再量高；超长无换行字符串也不会挤进页脚。
    const chars = Array.from(text)
    if (chars.length <= 6000 && doc.heightOfString(text, options) <= height) return text
    let lo = 0; let hi = Math.min(chars.length, 6000)
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (doc.heightOfString(chars.slice(0, mid).join('') + suffix, options) <= height) lo = mid
      else hi = mid - 1
    }
    return chars.slice(0, lo).join('') + suffix
  }
  draw('政策办事清单', 42, 38, 21)
  draw(policy.title, 82, 52, 16)
  draw(`发布机构：${policy.sourceName}`, 142, 32, 10)
  const date = policy.publishedDate ?? policy.publishConfirmedAt
  draw(`发布日期：${date ? chinaDate(date) : '发布机构没有提供'}`, 177, 20, 10)
  const sections = [
    ['谁可以申请', policy.whoCanApply],
    ['要准备的材料', policy.requiredMaterials],
    ['去哪办', policy.whereToApply],
  ] as const
  sections.forEach(([title, content], i) => {
    const y = 213 + i * 133
    doc.moveTo(42, y - 5).lineTo(553, y - 5).lineWidth(0.5).strokeColor('#c6ced5').stroke()
    draw(title, y, 28, 13)
    const entries = content?.split(/\r\n|\r|\n/u).map((line) => line.trim()).filter(Boolean)
    draw(entries?.length ? entries.map((line) => `• ${line}`).join('\n') : CHECKLIST_EMPTY,
      y + 32, 90, 11, 42, width, CHECKLIST_TRUNCATED)
  })
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
