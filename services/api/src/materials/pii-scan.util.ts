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

export type PiiFindingDraft = {
  type: string
  label: string
  pageNumber: number | null
  snippet: string | null
  confidence: number
  action: PiiFindingAction
}

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
  pages: Array<{ pageNumber: number | null; text: string }>
  outcome: 'ok' | 'degraded' | 'unsupported_format'
  truncated: boolean
  /** 仅当 truncated=true 时有意义：实际完成 OCR 的页数 / 文档声明的总页数。 */
  scannedPages?: number
  totalPages?: number
}> {
  if (mimeType === 'application/pdf') {
    let rawText = ''
    let totalPages = 0
    let pdf: unknown
    try {
      pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer))
    } catch {
      return { pages: [], outcome: 'degraded', truncated: false }
    }
    const declaredPageCount = (pdf as { numPages?: number }).numPages ?? 0
    if (declaredPageCount > 0 && declaredPageCount <= MAX_BORN_DIGITAL_EXTRACT_PAGES) {
      try {
        const extracted = await unpdf.extractText(pdf, { mergePages: true })
        totalPages = extracted.totalPages
        rawText = Array.isArray(extracted.text) ? extracted.text.join('\n') : (extracted.text ?? '')
      } catch {
        return { pages: [], outcome: 'degraded', truncated: false }
      }
    } else {
      // 声明页数为 0（无法判断）或超过上限：跳过无界的 extractText，
      // rawText 保持 '' 会自动走下面 OCR 渲染兜底路径（该路径自带页数上限）。
      totalPages = declaredPageCount
    }
    if (rawText.trim().length >= MIN_TEXT_CHARS_FOR_BORN_DIGITAL) {
      return { pages: [{ pageNumber: null, text: rawText }], outcome: 'ok', truncated: false }
    }
    // 文字层为空/极少 → 扫描件，逐页渲染 + OCR
    const pagesToRender = Math.min(Math.max(totalPages, 1), PII_SCAN_MAX_OCR_PAGES)
    const pages: Array<{ pageNumber: number | null; text: string }> = []
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

export function buildPiiFindingsFromPages(pages: Array<{ pageNumber: number | null; text: string }>): PiiFindingDraft[] {
  const findings: PiiFindingDraft[] = []
  const seen = new Set<string>()

  const pushUnique = (type: string, rawValue: string, draft: PiiFindingDraft) => {
    const key = `${type}:${rawValue}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(draft)
    }
  }

  for (const { pageNumber, text } of pages) {
    collectMatches(text, /(?:^|[^\d])((?:\+?86[- ]?)?1[3-9]\d{9})(?!\d)/g, (value) => value).forEach((value) => {
      pushUnique('phone', value, {
        type: 'phone',
        label: '手机号',
        pageNumber,
        snippet: maskPiiSnippet('phone', value),
        confidence: 0.95,
        action: 'pending' as const,
      })
    })

    collectMatches(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, (value) => value).forEach((value) => {
      pushUnique('email', value, {
        type: 'email',
        label: '邮箱',
        pageNumber,
        snippet: maskPiiSnippet('email', value),
        confidence: 0.93,
        action: 'pending' as const,
      })
    })

    collectMatches(text, /\b([1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])\b/g, (value) => value).forEach((value) => {
      pushUnique('id_card', value, {
        type: 'id_card',
        label: '身份证号',
        pageNumber,
        snippet: maskPiiSnippet('id_card', value),
        confidence: 0.9,
        action: 'pending' as const,
      })
    })

    collectMatches(text, /([\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|街道|路|街|巷)[\u4e00-\u9fa5A-Za-z0-9\s-]{0,24}号?)/g, (value) => value).forEach((value) => {
      pushUnique('address', value, {
        type: 'address',
        label: '地址',
        pageNumber,
        snippet: maskPiiSnippet('address', value),
        confidence: 0.78,
        action: 'pending' as const,
      })
    })
  }

  return findings
}

function collectMatches<T>(text: string, regex: RegExp, toFinding: (value: string) => T): T[] {
  const findings: T[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const value = match[1]
    if (value) findings.push(toFinding(value))
  }
  return findings
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
