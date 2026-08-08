import mammoth from 'mammoth'
import { isSinglePageImage } from '../files/file-page-count.util'
import type { FilePurpose } from '../files/file.types'
import type { OcrService } from '../ai/resume/ocr/ocr.service'
import { openPdfForRender } from '../ai/resume/ocr/pdf-page-renderer'
import type { PiiFindingAction } from './materials.types'

/**
 * unpdf 提供 CJS 构建；services/api 是 commonjs + node10 resolution，
 * 不读 exports 的 types 字段，故用 require + 本地最小类型签名规避类型解析问题
 * （做法与 resume-extraction.service.ts 一致）。
 */
interface UnpdfApi {
  getDocumentProxy(data: Uint8Array): Promise<unknown>
  extractText(
    pdf: unknown,
    options?: { mergePages?: boolean },
  ): Promise<{ totalPages: number; text: string | string[] }>
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unpdf = require('unpdf') as UnpdfApi

/** pdfjs TextItem 的最小结构（本地类型，理由同上：不依赖 unpdf 的 types 解析）。 */
interface PdfTextItem {
  str?: string
  /** [a, b, c, d, e, f]；e/f 即该 item 基线左端点在 PDF 用户空间的 x/y，d 的绝对值即字号。 */
  transform?: number[]
  width?: number
  height?: number
  hasEOL?: boolean
}
interface PdfPageProxy {
  getViewport(opts: { scale: number }): { width: number; height: number }
  getTextContent(): Promise<{ items: PdfTextItem[] }>
  cleanup(): void
}
interface PdfDocumentProxy {
  numPages?: number
  getPage(pageNumber: number): Promise<PdfPageProxy>
  destroy?(): Promise<void>
}

/** DOCX（Office Open XML Word 文档）MIME（与 resume-extraction.service.ts 保持一致，本地各自定义，未共享常量）。 */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** 服务端落库前 snippet 掩码长度上限。 */
const MAX_SNIPPET_CHARS = 32

/** 这些用途天然高风险（简历/证件），必须真实扫描，不接受任何跳过提示。 */
export const HIGH_RISK_PII_PURPOSES: readonly FilePurpose[] = ['resume_upload', 'resume_scan', 'id_scan', 'cover_letter']
/** 低于此字符数视为"没有可用文字层"，判定为扫描件走 OCR（与 resume-extraction.service.ts 同一阈值概念）。 */
const MIN_TEXT_CHARS_FOR_BORN_DIGITAL = 30
/** 扫描版 PDF 最多渲染识别的页数（控费 + 控时延）。 */
const PII_SCAN_MAX_OCR_PAGES = (() => {
  const n = Number(process.env['PII_SCAN_MAX_OCR_PAGES'])
  return Number.isInteger(n) && n > 0 && n <= 10 ? n : 5
})()
/** OCR 渲染缩放（与 resume-extraction.service.ts 保持一致的清晰度/体积权衡）。 */
const PII_SCAN_OCR_RENDER_SCALE = 2
/**
 * born-digital 文字层抽取（unpdf.extractText）允许尝试的最大声明页数。
 *
 * unpdf.extractText() 内部对 pdf.numPages 做 Array.from + Promise.all，不设任何上限；
 * 本接口匿名可达，一份体积很小但声明超大页数的恶意 PDF 可借此让服务端做无界 CPU/内存工作。
 * 超过此阈值直接跳过文字层抽取（rawText 保持 ''），自动落入下面已有页数上限
 * （PII_SCAN_MAX_OCR_PAGES）的 OCR 渲染兜底路径。
 */
const MAX_BORN_DIGITAL_EXTRACT_PAGES = 50

/**
 * 命中片段在文字层 PDF 上的一个矩形（PDF 用户空间点 pt，原点左下角）。
 * pageWidth / pageHeight 一并带上，供前端按任意 DPI 换算预览叠加框、供服务端按同一坐标系画黑条。
 */
export type PiiBox = {
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  pageWidth: number
  pageHeight: number
}

/** 抽取出的单个文字 item（带位置）。仅 PDF 文字层路径有；OCR / DOCX / 图片路径为空。 */
export type PositionedTextItem = {
  str: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  hasEOL: boolean
}

export type ExtractedPage = {
  pageNumber: number | null
  text: string
  /** 与 text 对齐的位置信息；缺省表示该页没有可用坐标（OCR / DOCX / 图片）。 */
  items?: PositionedTextItem[]
  /** text 中第 i 个字符来自 items[itemIndexByChar[i]] 的第 charOffsetByChar[i] 个字符。 */
  itemIndexByChar?: number[]
  charOffsetByChar?: number[]
  pageWidth?: number
  pageHeight?: number
}

export type PiiFindingDraft = {
  type: string
  label: string
  pageNumber: number | null
  snippet: string | null
  confidence: number
  action: PiiFindingAction
  /** 该值在文档中全部出现位置的矩形；空数组 = 拿不到坐标，不可遮挡。 */
  boxes: PiiBox[]
}

/**
 * 供 pii_redact 使用的、带原文值的命中项（**只在内存里存在，绝不落库**）。
 * 落库走 PiiFindingDraft（snippet 已掩码、只留坐标）。
 */
export type PiiFindingWithValue = PiiFindingDraft & { value: string }

/**
 * 为 pii_scan 提取可用于正则匹配的文本内容。
 *
 * - PDF：优先走 unpdf 文字层（born-digital，零 OCR 成本）；抽不到有效文字（扫描件/图片型 PDF）
 *   才逐页渲染 + OCR。
 * - DOCX：走 mammoth 正文提取（与 resume-extraction.service.ts 同一模式）。
 * - 图片：直接 OCR。
 * - 其余格式（含旧版 .doc）：没有任何提取路径，诚实返回 unsupported_format。
 *
 * 三态返回，绝不把"没扫描"或"扫描失败"伪装成"扫描完成 0 命中"：
 * - outcome: 'ok' —— 成功提取到文本（可能为空字符串，交由正则匹配阶段判定有无命中）。
 * - outcome: 'degraded' —— 尝试提取但失败（解析异常 / OCR 失败 / 渲染异常）。
 * - outcome: 'unsupported_format' —— 该 MIME 完全没有提取路径。
 *
 * outcome: 'ok' 时额外带 truncated 标记：扫描版 PDF 逐页 OCR 渲染受 PII_SCAN_MAX_OCR_PAGES
 * 页数上限约束，若文档实际页数超过该上限，truncated=true（并附 scannedPages/totalPages），
 * 调用方不得把这种"只看过前 N 页"的结果当作"完整扫描、可放心报告 0 命中"。
 * DOCX、单页图片、born-digital 文字层三条路径读的是整份输入，永远 truncated=false。
 */
export async function extractTextForPiiScan(
  buffer: Buffer,
  mimeType: string,
  ocr: Pick<OcrService, 'recognize'>,
): Promise<{
  pages: ExtractedPage[]
  outcome: 'ok' | 'degraded' | 'unsupported_format'
  truncated: boolean
  /** 仅当 truncated=true 时有意义：实际完成 OCR 的页数 / 文档声明的总页数。 */
  scannedPages?: number
  totalPages?: number
}> {
  if (mimeType === 'application/pdf') {
    let bornDigitalPages: ExtractedPage[] = []
    let totalPages = 0
    let pdf: PdfDocumentProxy
    try {
      pdf = (await unpdf.getDocumentProxy(new Uint8Array(buffer))) as PdfDocumentProxy
    } catch {
      return { pages: [], outcome: 'degraded', truncated: false }
    }
    const declaredPageCount = pdf.numPages ?? 0
    try {
      if (declaredPageCount > 0 && declaredPageCount <= MAX_BORN_DIGITAL_EXTRACT_PAGES) {
        bornDigitalPages = await extractPositionedPages(pdf, declaredPageCount)
        totalPages = declaredPageCount
      } else {
        // 声明页数为 0（无法判断）或超过上限：跳过无界的逐页文字层抽取，
        // bornDigitalPages 保持空会自动走下面 OCR 渲染兜底路径（该路径自带页数上限）。
        totalPages = declaredPageCount
      }
    } catch {
      return { pages: [], outcome: 'degraded', truncated: false }
    } finally {
      await pdf.destroy?.().catch(() => undefined)
    }
    const bornDigitalChars = bornDigitalPages.reduce((sum, page) => sum + page.text.trim().length, 0)
    if (bornDigitalChars >= MIN_TEXT_CHARS_FOR_BORN_DIGITAL) {
      return { pages: bornDigitalPages, outcome: 'ok', truncated: false }
    }
    // 文字层为空/极少 → 扫描件，逐页渲染 + OCR
    const pagesToRender = Math.min(Math.max(totalPages, 1), PII_SCAN_MAX_OCR_PAGES)
    const pages: ExtractedPage[] = []
    try {
      const rendered = await openPdfForRender(buffer)
      try {
        for (let pageNo = 1; pageNo <= pagesToRender; pageNo += 1) {
          const img = await rendered.renderPage(pageNo, PII_SCAN_OCR_RENDER_SCALE)
          const ocrResult = await ocr.recognize({ buffer: img, mimeType: 'image/png' })
          if (!ocrResult.ok) return { pages: [], outcome: 'degraded', truncated: false }
          pages.push({ pageNumber: pageNo, text: ocrResult.text ?? '' })
        }
      } finally {
        await rendered.destroy().catch(() => undefined)
      }
    } catch {
      return { pages: [], outcome: 'degraded', truncated: false }
    }
    // totalPages 为声明/实际页数（born-digital 分支已从 extracted.totalPages 或 declaredPageCount
    // 取得）；若超过本次实际渲染 OCR 的页数，说明文档还有未被扫描到的页面，不能上报为完整扫描。
    const truncated = totalPages > pagesToRender
    return {
      pages,
      outcome: 'ok',
      truncated,
      ...(truncated ? { scannedPages: pagesToRender, totalPages } : {}),
    }
  }

  if (mimeType === DOCX_MIME) {
    try {
      const result = await mammoth.extractRawText({ buffer })
      return { pages: [{ pageNumber: null, text: result.value ?? '' }], outcome: 'ok', truncated: false }
    } catch {
      return { pages: [], outcome: 'degraded', truncated: false }
    }
  }

  if (isSinglePageImage(mimeType)) {
    const ocrResult = await ocr.recognize({ buffer, mimeType })
    if (!ocrResult.ok) return { pages: [], outcome: 'degraded', truncated: false }
    return { pages: [{ pageNumber: 1, text: ocrResult.text ?? '' }], outcome: 'ok', truncated: false }
  }

  // 没有任何提取路径的格式（如旧版 .doc）：诚实返回 unsupported_format，不冒充"扫描完成 0 命中"。
  return { pages: [], outcome: 'unsupported_format', truncated: false }
}

/**
 * 检测器表。顺序即命中项在结果里的分组顺序（与改动前逐段调用的顺序一致）。
 * pattern 是工厂函数：带 /g 的正则有 lastIndex 状态，共享实例会串页漏匹配。
 */
const PII_PATTERNS: Array<{ type: string; label: string; confidence: number; pattern: () => RegExp }> = [
  { type: 'phone', label: '手机号', confidence: 0.95, pattern: () => /(?:^|[^\d])((?:\+?86[- ]?)?1[3-9]\d{9})(?!\d)/g },
  { type: 'email', label: '邮箱', confidence: 0.93, pattern: () => /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi },
  {
    type: 'id_card',
    label: '身份证号',
    confidence: 0.9,
    pattern: () => /\b([1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])\b/g,
  },
  {
    type: 'address',
    label: '地址',
    confidence: 0.78,
    pattern: () => /([一-龥]{2,}(?:省|市|区|县|镇|街道|路|街|巷)[一-龥A-Za-z0-9\s-]{0,24}号?)/g,
  },
]

export function buildPiiFindingsFromPages(pages: ExtractedPage[]): PiiFindingDraft[] {
  // 剥掉 value：落库 / 出 API 的形态永远不含 PII 原文。
  return buildPiiFindingsWithValues(pages).map(({ value: _value, ...draft }) => draft)
}

/**
 * 与 buildPiiFindingsFromPages 同一套检测逻辑，但保留命中原文值。
 *
 * **只允许在单次请求的内存里使用**：pii_redact 需要原文做遮挡后复检
 * （判断"这个值是否还能从派生件里提取出来"）。绝不落库、绝不出 API、绝不写日志。
 *
 * 去重语义：同一 (type, value) 只产出一条命中项（用户只需为一个值做一次裁决），
 * 但其 boxes 合并该值在整份文档里的**全部**出现位置 —— 只盖第一处就是漏盖。
 */
export function buildPiiFindingsWithValues(pages: ExtractedPage[]): PiiFindingWithValue[] {
  const findings: PiiFindingWithValue[] = []
  const byKey = new Map<string, PiiFindingWithValue>()

  for (const { type, label, confidence, pattern } of PII_PATTERNS) {
    for (const page of pages) {
      const regex = pattern()
      let match: RegExpExecArray | null
      while ((match = regex.exec(page.text)) !== null) {
        const value = match[1]
        if (!value) continue
        // 手机号那条正则带 (?:^|[^\d]) 前导组，match.index 不等于捕获组起点。
        const valueStart = match.index + match[0].indexOf(value)
        const boxes = locateBoxes(page, valueStart, value.length)
        const key = `${type}:${value}`
        const existing = byKey.get(key)
        if (existing) {
          existing.boxes.push(...boxes)
          if (existing.pageNumber === null && page.pageNumber !== null) existing.pageNumber = page.pageNumber
          continue
        }
        const draft: PiiFindingWithValue = {
          type,
          label,
          pageNumber: page.pageNumber,
          snippet: maskPiiSnippet(type, value),
          confidence,
          action: 'pending' as const,
          boxes,
          value,
        }
        byKey.set(key, draft)
        findings.push(draft)
      }
    }
  }

  return findings
}

/**
 * 把 page.text 的字符区间 [start, start+length) 映射回一组 PDF 用户空间矩形。
 *
 * 一个命中值可能横跨多个 text item（PDF 生成器常因字距调整把一串数字拆开），
 * 所以返回数组：每个被命中覆盖到的 item 产出一个矩形。
 * 没有位置信息的页（OCR / DOCX / 图片）返回空数组 —— 调用方据此判定"不可遮挡"。
 */
function locateBoxes(page: ExtractedPage, start: number, length: number): PiiBox[] {
  const { items, itemIndexByChar, charOffsetByChar, pageWidth, pageHeight, pageNumber } = page
  if (!items || !itemIndexByChar || !charOffsetByChar) return []
  if (pageNumber === null || pageWidth === undefined || pageHeight === undefined) return []

  // 命中区间在每个 item 内覆盖到的字符下标范围。
  const spans = new Map<number, { from: number; to: number }>()
  for (let i = start; i < start + length; i += 1) {
    const itemIndex = itemIndexByChar[i]
    const charOffset = charOffsetByChar[i]
    if (itemIndex === undefined || itemIndex < 0 || charOffset === undefined || charOffset < 0) continue
    const span = spans.get(itemIndex)
    if (span) {
      span.from = Math.min(span.from, charOffset)
      span.to = Math.max(span.to, charOffset + 1)
    } else {
      spans.set(itemIndex, { from: charOffset, to: charOffset + 1 })
    }
  }

  const boxes: PiiBox[] = []
  for (const [itemIndex, span] of spans) {
    const item = items[itemIndex]
    if (!item) continue
    const rect = estimateSubstringRect(item, span.from, span.to)
    if (!rect) continue
    boxes.push({ pageNumber, ...rect, pageWidth, pageHeight })
  }
  return boxes
}

/** 黑条两侧最小留白（pt）。 */
const MIN_BOX_PAD_PT = 2
/** 黑条两侧留白占字号的比例。 */
const BOX_PAD_RATIO = 0.35
/** 基线下方留白占字号的比例（descender）。 */
const BOX_DESCENDER_RATIO = 0.3
/** 基线上方留白占字号的比例（ascender + 余量）。 */
const BOX_ASCENDER_RATIO = 1.05

/**
 * 估算 item.str 的 [from, to) 子串在 PDF 用户空间的矩形。
 *
 * getTextContent 只给整个 item 的 x/y/width/height，不给逐字宽度。按决策文档
 * （docs/product/pii-redaction-decision-2026-08.md §3.2）「宁可多盖不可漏盖」，
 * 这里用字符类别加权模型估算，而不是等宽比例：等宽比例对 "ID: 110101..." 这类
 * "窄前缀 + 数字段"会把黑条整体右移（实测偏右约 6pt），那是**漏盖方向**的误差；
 * 加权模型把误差压到 1–2pt 量级，再叠加两侧留白覆盖残差。
 *
 * 权重是字宽相对字号的粗略比例，最后按 item 已知总宽归一化，因此只需相对关系正确。
 */
function estimateSubstringRect(
  item: PositionedTextItem,
  from: number,
  to: number,
): { x: number; y: number; width: number; height: number } | null {
  const chars = [...item.str]
  if (chars.length === 0 || item.width <= 0) return null
  const clampedFrom = Math.max(0, Math.min(from, chars.length))
  const clampedTo = Math.max(clampedFrom, Math.min(to, chars.length))
  if (clampedTo <= clampedFrom) return null

  const weights = chars.map(charWidthWeight)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return null
  const scale = item.width / total
  const before = weights.slice(0, clampedFrom).reduce((sum, weight) => sum + weight, 0)
  const inside = weights.slice(clampedFrom, clampedTo).reduce((sum, weight) => sum + weight, 0)

  const fontSize = item.fontSize > 0 ? item.fontSize : item.height
  // 两侧留白：吸收加权模型的残余误差 + 字形自身的 side bearing。
  const padX = Math.max(MIN_BOX_PAD_PT, fontSize * BOX_PAD_RATIO)
  const padBelow = fontSize * BOX_DESCENDER_RATIO
  const padAbove = fontSize * BOX_ASCENDER_RATIO
  return {
    x: item.x + before * scale - padX,
    y: item.y - padBelow,
    width: inside * scale + padX * 2,
    height: padBelow + padAbove,
  }
}

/**
 * 字符宽度相对字号的粗略权重（只需相对关系正确，绝对值由 item.width 归一化）。
 * 数字 / 大写按等宽记（tabular figures 是排版惯例），窄标点单列，CJK 全角记 1。
 */
function charWidthWeight(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code > 0x2e80) return 1 // CJK / 全角标点
  if (/\s/.test(ch)) return 0.28
  if (/[.,:;'`|!ijlI[\]()]/.test(ch)) return 0.3
  if (/[A-Z0-9@#%&Wm]/.test(ch)) return 0.6
  return 0.52
}

/**
 * 逐页抽取带位置的文字层。
 *
 * page.text 的拼接方式与 unpdf.extractText 的 getPageText 完全一致
 * （`items.map(i => i.str + (i.hasEOL ? '\n' : '')).join('')`），随后按改动前
 * mergePages:true 的 `.replace(/\s+/g, ' ')` 做同样的空白折叠 —— 折叠时同步维护
 * 字符 → item 的映射，所以匹配语义与改动前一致，只是从"整份合并"变成"逐页"
 * （跨页拼出的命中本来就是噪声，逐页更准，且这样才有真实页码可用）。
 */
async function extractPositionedPages(pdf: PdfDocumentProxy, pageCount: number): Promise<ExtractedPage[]> {
  const pages: ExtractedPage[] = []
  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
    const page = await pdf.getPage(pageNo)
    try {
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items: PositionedTextItem[] = []
      let raw = ''
      const rawItemIndex: number[] = []
      const rawCharOffset: number[] = []
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue
        const transform = item.transform ?? []
        const positioned: PositionedTextItem = {
          str: item.str,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          width: item.width ?? 0,
          height: item.height ?? 0,
          fontSize: Math.hypot(transform[2] ?? 0, transform[3] ?? 0) || (item.height ?? 0),
          hasEOL: item.hasEOL === true,
        }
        const itemIndex = items.length
        items.push(positioned)
        const chars = [...item.str]
        for (let c = 0; c < chars.length; c += 1) {
          raw += chars[c]
          rawItemIndex.push(itemIndex)
          rawCharOffset.push(c)
        }
        if (positioned.hasEOL) {
          raw += '\n'
          rawItemIndex.push(-1)
          rawCharOffset.push(-1)
        }
      }
      const collapsed = collapseWhitespace(raw, rawItemIndex, rawCharOffset)
      pages.push({
        pageNumber: pageNo,
        text: collapsed.text,
        items,
        itemIndexByChar: collapsed.itemIndexByChar,
        charOffsetByChar: collapsed.charOffsetByChar,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      })
    } finally {
      page.cleanup()
    }
  }
  return pages
}

/** 把连续空白折叠成单个空格，同时把"字符 → item"的映射一起搬过去。 */
function collapseWhitespace(
  raw: string,
  itemIndex: number[],
  charOffset: number[],
): { text: string; itemIndexByChar: number[]; charOffsetByChar: number[] } {
  let text = ''
  const outItemIndex: number[] = []
  const outCharOffset: number[] = []
  let previousWasSpace = false
  const chars = [...raw]
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!
    if (/\s/.test(ch)) {
      if (previousWasSpace) continue
      previousWasSpace = true
      text += ' '
      outItemIndex.push(itemIndex[i] ?? -1)
      outCharOffset.push(charOffset[i] ?? -1)
      continue
    }
    previousWasSpace = false
    text += ch
    outItemIndex.push(itemIndex[i] ?? -1)
    outCharOffset.push(charOffset[i] ?? -1)
  }
  return { text, itemIndexByChar: outItemIndex, charOffsetByChar: outCharOffset }
}

/**
 * 服务端落库前掩码 PII 片段（M1）。
 *
 * DB 与 API 返回的 snippet 不再包含完整手机号 / 邮箱 / 身份证号 / 地址原文，
 * 仅保留供用户辨识类型的最小片段。前端 maskSnippet 作为二次防护，但不依赖前端。
 */
function maskPiiSnippet(type: string, raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  let masked: string
  if (type === 'phone') masked = maskPhone(value)
  else if (type === 'email') masked = maskEmail(value)
  else if (type === 'id_card') masked = maskIdCard(value)
  else if (type === 'address') masked = maskAddress(value)
  else masked = maskGeneric(value)
  return limitSnippet(masked)
}

function limitSnippet(value: string): string {
  return value.length > MAX_SNIPPET_CHARS ? value.slice(0, MAX_SNIPPET_CHARS) : value
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  const core = digits.length > 11 ? digits.slice(-11) : digits
  if (core.length < 7) return `${core.slice(0, 1)}****`
  return `${core.slice(0, 3)}****${core.slice(-4)}`
}

function maskEmail(value: string): string {
  const at = value.indexOf('@')
  if (at <= 0) return maskGeneric(value)
  const domain = value.slice(at + 1)
  return `${value.slice(0, 1)}***@${domain}`
}

function maskIdCard(value: string): string {
  const v = value.toUpperCase()
  if (v.length <= 6) return `${v.slice(0, 1)}****`
  return `${v.slice(0, 3)}****${v.slice(-2)}`
}

function maskAddress(value: string): string {
  // 保留到第一个行政级别字（省/市/区/县）为止，遮住后续街道、门牌等详细段。
  const match = value.match(/[省市区县]/)
  if (match && match.index !== undefined) return `${value.slice(0, match.index + 1)}****`
  return `${value.slice(0, 2)}****`
}

function maskGeneric(value: string): string {
  if (value.length <= 4) return `${value.slice(0, 1)}**`
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}
