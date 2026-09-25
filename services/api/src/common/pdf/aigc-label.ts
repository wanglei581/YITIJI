// GB 45438 附录 E 的文件元数据标识。位置按 TC260 文本文件实践指南 §6.3，
// 放 PDF Document Information Dictionary 的 /AIGC（next-tasks 2026-09-26 第 4 条）。
// 值是 JSON 字符串，不是分开的 Info 键。

import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib'

export const AIGC_VISIBLE_HEADER = 'AI 生成，仅供参考'

export const AIGC_DEFAULT_PRODUCER = '职易达'

export const AIGC_RULE_SCORE_NOTICE = '这部分按规则计算，不是 AI 生成'

export interface AigcLabelFields {
  Label: '1'
  ContentProducer: string
  ProduceID: string
  ReservedCode1: ''
  ContentPropagator: string
  PropagateID: string
  ReservedCode2: ''
}

/** 未设置环境变量时用产品名。正式值填公司名称还是统一社会信用代码，待法务给定。 */
export function aigcContentProducer(): string {
  const raw = process.env['AIGC_CONTENT_PRODUCER']
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed.length > 0 ? trimmed : AIGC_DEFAULT_PRODUCER
}

/** 首次写入：传播方与生产方相同，两个预留码为空。ProduceID 是任务号。 */
export function buildAigcLabelJson(produceId: string): string {
  const producer = aigcContentProducer()
  const id = produceId.trim()
  const fields: AigcLabelFields = {
    Label: '1',
    ContentProducer: producer,
    ProduceID: id,
    ReservedCode1: '',
    ContentPropagator: producer,
    PropagateID: id,
    ReservedCode2: '',
  }
  return JSON.stringify(fields)
}

export function parseAigcLabelJson(raw: string): AigcLabelFields | null {
  try {
    const value = JSON.parse(raw) as Partial<AigcLabelFields>
    if (value.Label !== '1') return null
    if (typeof value.ContentProducer !== 'string' || value.ContentProducer.trim().length === 0) return null
    if (typeof value.ProduceID !== 'string') return null
    if (value.ReservedCode1 !== '' || value.ReservedCode2 !== '') return null
    if (value.ContentPropagator !== value.ContentProducer) return null
    if (value.PropagateID !== value.ProduceID) return null
    return value as AigcLabelFields
  } catch {
    return null
  }
}

/** 每页页眉。调用前 PDFDocument 必须 bufferPages: true，且已注册 cjk 字体。 */
export function stampAigcPageHeader(
  doc: PDFKit.PDFDocument,
  text: string = AIGC_VISIBLE_HEADER,
): void {
  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index)
    const savedX = doc.x
    const savedY = doc.y
    doc.save()
    const left = doc.page.margins.left
    const right = doc.page.margins.right
    const previousTop = doc.page.margins.top
    doc.page.margins.top = 0
    doc.font('cjk').fontSize(8).fillColor('#64748b')
    doc.text(text, left, 22, {
      width: doc.page.width - left - right,
      align: 'center',
      lineBreak: false,
    })
    doc.page.margins.top = previousTop
    doc.restore()
    doc.x = savedX
    doc.y = savedY
  }
}

function infoDict(doc: PDFDocument): PDFDict {
  const existing = doc.context.lookup(doc.context.trailerInfo.Info)
  if (existing instanceof PDFDict) return existing
  const created = doc.context.obj({})
  doc.context.trailerInfo.Info = doc.context.register(created)
  return created
}

/** 只写 /AIGC，不动 Title、Author 等原有 Info。追加页是 AI 解读时 Label 为 "1"。 */
export function setPdfLibAigcLabel(doc: PDFDocument, produceId: string): void {
  infoDict(doc).set(PDFName.of('AIGC'), PDFHexString.fromText(buildAigcLabelJson(produceId)))
}

function decodeInfoValue(value: unknown): string {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  if (typeof value === 'string') return value
  return ''
}

export async function readPdfInfo(buffer: Buffer): Promise<Record<string, string>> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true })
  const existing = doc.context.lookup(doc.context.trailerInfo.Info)
  if (!(existing instanceof PDFDict)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of existing.entries()) {
    out[key.decodeText()] = decodeInfoValue(doc.context.lookup(value))
  }
  return out
}

/**
 * 把 AI 解读页拷到简历后面。简历原有 Info 保留；
 * 追加页本身是 AI 解读，所以 AIGC.Label 置 "1"。
 */
export async function appendAigcPages(
  resumePdf: Buffer,
  appendixPdf: Buffer,
  produceId: string,
): Promise<{ buffer: Buffer; pageCount: number }> {
  const merged = await PDFDocument.load(resumePdf, { ignoreEncryption: true })
  const appendix = await PDFDocument.load(appendixPdf, { ignoreEncryption: true })
  const copied = await merged.copyPages(appendix, appendix.getPageIndices())
  copied.forEach((page) => merged.addPage(page))
  const pageCount = merged.getPageCount()
  setPdfLibAigcLabel(merged, produceId)
  return { buffer: Buffer.from(await merged.save({ useObjectStreams: false })), pageCount }
}
