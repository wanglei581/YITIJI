import { ServiceUnavailableException } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import { CJK_FONT_MISSING_USER_MESSAGE, registerCjkFont } from '../common/pdf/cjk-font'

export const CHECKLIST_EMPTY = '发布机构没有提供这部分，请以原文为准'
export const CHECKLIST_TRUNCATED = '（内容较长，完整内容请扫码看原文或到经办窗口咨询）'

export const CHECKLIST_SECTION_DEFS = [
  ['whoCanApply', '谁可以申请'],
  ['requiredMaterials', '要准备的材料'],
  ['whereToApply', '去哪办'],
] as const

export type ChecklistSectionKey = (typeof CHECKLIST_SECTION_DEFS)[number][0]

const CONTENT_WIDTH = 511
const BODY_TOP = 208
const BODY_BOTTOM = 608
const LINE_GAP = 3
const CONTENT_SIZE = 11
const TITLE_SIZE = 13

export interface ChecklistFields {
  whoCanApply?: string | null
  requiredMaterials?: string | null
  whereToApply?: string | null
}

export interface ChecklistColumnLayout {
  key: ChecklistSectionKey
  title: string
  /** 实际印出的正文。放不下时已接上扫码提示。 */
  text: string
  truncated: boolean
  y: number
  titleHeight: number
  contentHeight: number
}

type PdfDoc = InstanceType<typeof PDFDocument>

function bulletText(content: string | null | undefined): string {
  const entries = content?.split(/\r\n|\r|\n/u).map((line) => line.trim()).filter(Boolean)
  return entries?.length ? entries.map((line) => `• ${line}`).join('\n') : CHECKLIST_EMPTY
}

function measure(doc: PdfDoc, text: string, size: number): number {
  doc.fontSize(size)
  const chars = Array.from(text)
  const sample = chars.length > 6000 ? chars.slice(0, 6000).join('') : text
  return doc.heightOfString(sample, { width: CONTENT_WIDTH, lineGap: LINE_GAP })
}

function fitText(doc: PdfDoc, text: string, height: number): string {
  doc.fontSize(CONTENT_SIZE)
  const options = { width: CONTENT_WIDTH, lineGap: LINE_GAP }
  const chars = Array.from(text)
  if (chars.length <= 6000 && doc.heightOfString(text, options) <= height) return text
  let lo = 0
  let hi = Math.min(chars.length, 6000)
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = chars.slice(0, mid).join('') + CHECKLIST_TRUNCATED
    if (doc.heightOfString(candidate, options) <= height) lo = mid
    else hi = mid - 1
  }
  return chars.slice(0, lo).join('') + CHECKLIST_TRUNCATED
}

/**
 * 三栏按内容分高度。短栏先占满自己的高度，剩下的给更长的栏。
 * 只有整页正文区放不下时，才截那些仍然超出的栏。
 */
function allocateHeights(naturals: number[], budget: number): number[] {
  const alloc = new Array<number>(naturals.length).fill(0)
  let active = naturals.map((_, index) => index)
  let remain = budget
  while (active.length > 0) {
    const demand = active.reduce((sum, index) => sum + naturals[index]!, 0)
    if (demand <= remain + 0.05) {
      for (const index of active) alloc[index] = naturals[index]!
      return alloc
    }
    const share = remain / active.length
    const fits = active.filter((index) => naturals[index]! <= share + 0.05)
    if (fits.length === 0) {
      for (const index of active) alloc[index] = remain * (naturals[index]! / demand)
      return alloc
    }
    for (const index of fits) {
      alloc[index] = naturals[index]!
      remain -= naturals[index]!
    }
    active = active.filter((index) => !fits.includes(index))
  }
  return alloc
}

function keepSuffixVisible(naturals: number[], alloc: number[], suffixHeight: number): number[] {
  const next = alloc.slice()
  for (let index = 0; index < next.length; index += 1) {
    if (naturals[index]! <= next[index]! + 0.05 || next[index]! >= suffixHeight) continue
    let donor = 0
    for (let other = 1; other < next.length; other += 1) {
      if (next[other]! > next[donor]!) donor = other
    }
    const spare = next[donor]! - suffixHeight
    if (spare <= 0 || donor === index) continue
    const take = Math.min(spare, suffixHeight - next[index]!)
    next[donor]! -= take
    next[index]! += take
  }
  return next
}

/** 与 PDF 绘制共用。调用前文档须已登记中文字体。 */
export function layoutChecklistColumns(doc: PdfDoc, fields: ChecklistFields): ChecklistColumnLayout[] {
  doc.fontSize(TITLE_SIZE)
  const titleHeight = doc.heightOfString('谁可以申请', { width: CONTENT_WIDTH, lineGap: LINE_GAP })
  const ruleGap = 6
  const afterTitle = 4
  const afterSection = 8
  const chrome = CHECKLIST_SECTION_DEFS.length * (ruleGap + titleHeight + afterTitle)
    + (CHECKLIST_SECTION_DEFS.length - 1) * afterSection
  const budget = Math.max(0, BODY_BOTTOM - BODY_TOP - chrome)
  const texts = CHECKLIST_SECTION_DEFS.map(([key]) => bulletText(fields[key]))
  const naturals = texts.map((text) => measure(doc, text, CONTENT_SIZE))
  const suffixHeight = measure(doc, CHECKLIST_TRUNCATED, CONTENT_SIZE)
  const heights = keepSuffixVisible(naturals, allocateHeights(naturals, budget), suffixHeight)
  let cursor = BODY_TOP
  return CHECKLIST_SECTION_DEFS.map(([key, title], index) => {
    const full = texts[index]!
    const natural = naturals[index]!
    const height = heights[index]!
    const truncated = natural > height + 0.05
    const text = truncated ? fitText(doc, full, height) : full
    const contentHeight = truncated ? height : natural
    const column: ChecklistColumnLayout = {
      key,
      title,
      text,
      truncated,
      y: cursor + ruleGap,
      titleHeight,
      contentHeight,
    }
    cursor += ruleGap + titleHeight + afterTitle + contentHeight + afterSection
    return column
  })
}

function finishDocument(doc: PdfDoc): Promise<void> {
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', reject)
    doc.on('data', () => undefined)
    doc.end()
  })
}

/** 录入页预估。和打印用的是同一个排版函数，不是另一套字数估算。 */
export async function assessPolicyChecklistFit(fields: ChecklistFields): Promise<{
  columns: Array<{ key: ChecklistSectionKey; truncated: boolean }>
}> {
  const doc = new PDFDocument({ size: 'A4', margin: 42 })
  if (!registerCjkFont(doc)) {
    doc.end()
    throw new ServiceUnavailableException({ error: {
      code: 'POLICY_CHECKLIST_FONT_NOT_FOUND', message: CJK_FONT_MISSING_USER_MESSAGE,
    } })
  }
  const columns = layoutChecklistColumns(doc, fields)
  await finishDocument(doc)
  return { columns: columns.map((column) => ({ key: column.key, truncated: column.truncated })) }
}
