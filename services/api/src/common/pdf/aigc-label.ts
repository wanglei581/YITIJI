// GB 45438 附录 E 的文件元数据标识。位置按 TC260 文本文件实践指南 §6.3，
// 放 PDF Document Information Dictionary 的 /AIGC（next-tasks 2026-09-26 第 4 条）。
// 值是 JSON 字符串，不是分开的 Info 键。

import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib'

export const AIGC_VISIBLE_HEADER = 'AI 生成，仅供参考'
export const AIGC_VISIBLE_FOOTER = '含人工智能辅助生成内容'

/**
 * 简历导出的页脚显式标识开关（RESUME_EXPORT_VISIBLE_LABEL）。
 * 默认关：与合入前行为一致（简历正文不印可见标识），上线时按产品负责人拍板打开。
 * 标识办法第四条要求导出文件默认带显式标识，推荐的上线配置是 true。
 */
export function resumeVisibleLabelEnabled(): boolean {
  return process.env['RESUME_EXPORT_VISIBLE_LABEL'] === 'true'
}

/**
 * 用户申请「不带显式标识」的开关（RESUME_EXPORT_UNLABELED_OPTION），默认关。
 * 只在页脚标识开启时才有意义；打开前须律师确认协议条款（标识办法第九条）。
 */
export function resumeUnlabeledOptionEnabled(): boolean {
  return resumeVisibleLabelEnabled() && process.env['RESUME_EXPORT_UNLABELED_OPTION'] === 'true'
}

/**
 * 这一份简历导出要不要印显式标识：页脚标识开关已开、不是原样草稿（草稿不是 AI 产物），
 * 且用户没有经「不带标识」开关申请去掉。PDF、DOCX、TXT/MD 与打印副本共用这一个判定。
 * unlabeled 须是控制器已按准入规则放行后的结果（见 resume-unlabeled-export.ts），不是请求原值。
 */
export function resumeExportShowsVisibleLabel(input: { draft?: boolean; unlabeled?: boolean }): boolean {
  if (!resumeVisibleLabelEnabled() || input.draft === true) return false
  return !(resumeUnlabeledOptionEnabled() && input.unlabeled === true)
}

export const AIGC_DEFAULT_PRODUCER = '职易达'

export const AIGC_RULE_SCORE_NOTICE = '这部分按规则计算，不是 AI 生成'

export interface AigcLabelFields {
  // GB 45438-2025 附录 E c)2：Label 类型为字符串。value1 取 1，序列化是 "1" 不是整数 1。
  // TC260《文件元数据隐式标识 文本文件》§6.3 的 PDF 示例同样写成 "Label":"value1"。
  Label: '1'
  ContentProducer: string
  ProduceID: string
  ReservedCode1: ''
  ContentPropagator: string
  PropagateID: string
  ReservedCode2: ''
}

/** 空串和纯空白不能当内容编号：随机 UUID 也无法回到生成记录。 */
export function requireAigcProduceId(produceId: string): string {
  const id = produceId.trim()
  if (id.length === 0) {
    throw new Error('AIGC ProduceID 不能为空')
  }
  return id
}

/** 未设置环境变量时用产品名。正式值填公司名称还是统一社会信用代码，待法务给定。 */
export function aigcContentProducer(): string {
  const raw = process.env['AIGC_CONTENT_PRODUCER']
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed.length > 0 ? trimmed : AIGC_DEFAULT_PRODUCER
}

/** 首次写入：传播方与生产方相同，两个预留码为空。ProduceID 是任务号或已分配的文件编号，空串直接拒绝。 */
export function buildAigcLabelJson(produceId: string): string {
  const producer = aigcContentProducer()
  const id = requireAigcProduceId(produceId)
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
    if (typeof value.ProduceID !== 'string' || value.ProduceID.trim().length === 0) return null
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

/** 每页页脚显式标识。只在 AI 简历导出且用户未申请去标识时调用。 */
export function stampAigcPageFooter(
  doc: PDFKit.PDFDocument,
  text: string = AIGC_VISIBLE_FOOTER,
): void {
  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index)
    const savedX = doc.x
    const savedY = doc.y
    doc.save()
    const left = doc.page.margins.left
    const right = doc.page.margins.right
    const previousBottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.font('cjk').fontSize(8).fillColor('#64748b')
    doc.text(text, left, doc.page.height - 30, {
      width: doc.page.width - left - right,
      align: 'center',
      lineBreak: false,
    })
    doc.page.margins.bottom = previousBottom
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
 * 把 AI 解读页拷到简历后面。简历原有 Title 等 Info 保留。
 * 追加页本身是 AI 解读，所以 AIGC.Label 置 "1"，并把 AIGenerated 同步成 true。
 * 草稿简历原来是 AIGenerated=false；只写 Label 会和 Info 矛盾。
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
  infoDict(merged).set(PDFName.of('AIGenerated'), PDFHexString.fromText('true'))
  return { buffer: Buffer.from(await merged.save({ useObjectStreams: false })), pageCount }
}
