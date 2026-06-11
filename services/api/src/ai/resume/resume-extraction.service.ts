import { Injectable, Logger } from '@nestjs/common'
import mammoth from 'mammoth'
import { FilesService } from '../../files/files.service'
import type { FilePurpose } from '../../files/file.types'
import { OcrService } from './ocr/ocr.service'
import { openPdfForRender } from './ocr/pdf-page-renderer'
import type {
  ResumeExtractionConfidence,
  ResumeExtractionErrorCode,
  ResumeExtractionInput,
  ResumeExtractionResult,
  ResumeTextSource,
} from './resume-extraction.types'

/**
 * unpdf 提供 CJS 构建（package.json exports.require → dist/index.cjs）。
 * services/api 为 commonjs + node10 resolution（见 files/file.types.ts ESM-interop 说明），
 * 不读 exports 的 types 字段，故用 require + 本地最小类型签名规避类型解析问题。
 * 运行期 require('unpdf') 命中 CJS 构建，纯 JS、无原生绑定（Node 26 安全）。
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

/** 允许做简历提取的文件用途白名单（防借道读任意文件）。 */
const RESUME_PURPOSES: readonly FilePurpose[] = ['resume_upload', 'resume_scan']

/** 文件大小上限（20MB）。 */
const MAX_FILE_BYTES = 20 * 1024 * 1024
/** 有效简历文字最小阈值（按去空白字符计），低于此视为提取失败 / 扫描件。 */
const MIN_TEXT_CHARS = 30
/** 传给下游分析前的文本上限（防超长 + 控成本）；截断只影响本次分析，不落库。 */
const MAX_TEXT_CHARS = 20000
/** 扫描版 PDF 最多渲染识别的页数（控费 + 控时延；简历通常 1–3 页）。 */
const OCR_PDF_MAX_PAGES = (() => {
  const n = Number(process.env['OCR_PDF_MAX_PAGES'])
  return Number.isInteger(n) && n > 0 && n <= 10 ? n : 3
})()
/** 渲染缩放（A4 在 scale=2 下约 1190×1684px，足够 OCR 且控制图片体积）。 */
const OCR_PDF_RENDER_SCALE = 2

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOC_MIME = 'application/msword'
const PDF_MIME = 'application/pdf'
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp']

type FileKind = 'docx' | 'doc' | 'pdf' | 'image' | 'unknown'

/**
 * 简历文件文字提取 service（Phase 1A）。
 *
 * 支持：DOCX 正文（mammoth）、文本型 PDF 文字层（unpdf）、图片 OCR（Provider 架构，
 * 默认 disabled 时诚实失败）。旧版 .doc / 扫描件 PDF / 空文件 / 文字过少均返回明确失败码，
 * 绝不伪造文本。原文与 buffer 不写日志、不落库。
 */
@Injectable()
export class ResumeExtractionService {
  private readonly logger = new Logger(ResumeExtractionService.name)

  constructor(
    private readonly files: FilesService,
    private readonly ocr: OcrService,
  ) {}

  async extractResumeText(input: ResumeExtractionInput): Promise<ResumeExtractionResult> {
    const startedAt = Date.now()
    const { fileId } = input

    // 1) 读取文件 buffer（含 purpose 白名单校验）
    let buffer: Buffer
    let mimeType: string
    let filename: string
    let purpose: FilePurpose
    try {
      const content = await this.files.readContent(fileId)
      buffer = content.buffer
      mimeType = content.mimeType
      filename = content.filename
      purpose = content.purpose
    } catch {
      return this.fail(fileId, 'FILE_NOT_FOUND', '文件已失效或无法读取，请重新上传', startedAt)
    }

    if (!RESUME_PURPOSES.includes(purpose)) {
      return this.fail(fileId, 'FILE_PURPOSE_REJECTED', '该文件不是简历文件，无法用于简历诊断', startedAt)
    }

    // 2) 基础校验
    if (!buffer || buffer.length === 0) {
      return this.fail(fileId, 'FILE_EMPTY', '文件为空，请重新上传', startedAt)
    }
    if (buffer.length > MAX_FILE_BYTES) {
      const limitMb = Math.floor(MAX_FILE_BYTES / 1024 / 1024)
      return this.fail(fileId, 'FILE_TOO_LARGE', `文件超过 ${limitMb}MB 上限，请压缩后重试`, startedAt)
    }

    // 3) 按类型分派
    const kind = this.resolveKind(mimeType, this.extOf(filename))
    switch (kind) {
      case 'docx':
        return this.extractDocx(fileId, buffer, startedAt)
      case 'pdf':
        return this.extractPdf(fileId, buffer, startedAt)
      case 'image':
        return this.extractImageOcr(fileId, buffer, mimeType, startedAt)
      case 'doc':
        return this.fail(
          fileId,
          'UNSUPPORTED_FILE_TYPE',
          '暂不支持旧版 .doc 格式，请另存为 PDF 或 DOCX 后重试',
          startedAt,
        )
      default:
        return this.fail(
          fileId,
          'UNSUPPORTED_FILE_TYPE',
          '暂不支持该文件格式，请上传 PDF 或 DOCX',
          startedAt,
        )
    }
  }

  // ── 各格式提取 ────────────────────────────────────────────────────────────

  private async extractDocx(
    fileId: string,
    buffer: Buffer,
    startedAt: number,
  ): Promise<ResumeExtractionResult> {
    let raw: string
    try {
      const result = await mammoth.extractRawText({ buffer })
      raw = result.value ?? ''
    } catch {
      return this.fail(
        fileId,
        'UNSUPPORTED_FILE_TYPE',
        'DOCX 解析失败，请确认文件未损坏，或另存为 PDF 后重试',
        startedAt,
      )
    }
    return this.finalizeText(fileId, raw, 'docx', 'high', undefined, startedAt)
  }

  private async extractPdf(
    fileId: string,
    buffer: Buffer,
    startedAt: number,
  ): Promise<ResumeExtractionResult> {
    let rawText = ''
    let pageCount: number | undefined
    try {
      const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer))
      const extracted = await unpdf.extractText(pdf, { mergePages: true })
      pageCount = extracted.totalPages
      rawText = Array.isArray(extracted.text) ? extracted.text.join('\n') : (extracted.text ?? '')
    } catch {
      return this.fail(
        fileId,
        'UNSUPPORTED_FILE_TYPE',
        'PDF 解析失败，请确认文件未损坏后重试',
        startedAt,
      )
    }
    // 文字层为空 / 极少 → 扫描件：OCR 已配置则走受控页数渲染识别，否则明确失败（不编造）
    if (this.meaningfulLen(rawText) < MIN_TEXT_CHARS) {
      if (this.ocr.activeProviderName === 'disabled') {
        return this.fail(
          fileId,
          'PDF_TEXT_EMPTY',
          '检测到扫描件 / 图片型 PDF（无文字层），暂不支持自动识别，请上传带文字层的 PDF 或 DOCX',
          startedAt,
          pageCount,
        )
      }
      return this.extractScannedPdfOcr(fileId, buffer, pageCount ?? 0, startedAt)
    }
    return this.finalizeText(fileId, rawText, 'pdf_text', 'high', pageCount, startedAt)
  }

  /**
   * 扫描版 PDF → 受控页数渲染成图 → 逐页 OCR（Stage 3）。
   *
   * 限制与诚实性：
   * - 最多渲染 OCR_PDF_MAX_PAGES 页（默认 3），超出部分不识别并以 warning 告知，
   *   绝不假装识别了整份文件。
   * - 逐页串行调用（QPS 友好，provider 内另有并发闸）。任何一页 OCR 失败 → 整体
   *   明确失败（部分页结果不冒充完整简历）。
   * - 渲染图片只在内存中转交 OCR，不落盘、不写日志。
   * - 整体置信度取各页最低值；低置信度由 finalize 附加「请人工核对」提示。
   */
  private async extractScannedPdfOcr(
    fileId: string,
    buffer: Buffer,
    totalPages: number,
    startedAt: number,
  ): Promise<ResumeExtractionResult> {
    const pages = Math.min(Math.max(totalPages, 1), OCR_PDF_MAX_PAGES)
    const pageTexts: string[] = []
    const rank = { high: 2, medium: 1, low: 0 } as const
    let worst: ResumeExtractionConfidence = 'high'
    try {
      const rendered = await openPdfForRender(buffer)
      try {
        for (let pageNo = 1; pageNo <= pages; pageNo += 1) {
          const img = await rendered.renderPage(pageNo, OCR_PDF_RENDER_SCALE)
          const ocrResult = await this.ocr.recognize({ buffer: img, mimeType: 'image/png' })
          if (!ocrResult.ok) {
            const code: ResumeExtractionErrorCode =
              ocrResult.errorCode === 'OCR_NOT_CONFIGURED' ? 'OCR_NOT_CONFIGURED' : 'OCR_FAILED'
            return this.fail(
              fileId,
              code,
              ocrResult.errorMessage ?? '扫描件文字识别失败，请上传带文字层的 PDF 或 DOCX',
              startedAt,
              totalPages,
            )
          }
          pageTexts.push(ocrResult.text ?? '')
          const c = ocrResult.confidence ?? 'low'
          if (rank[c] < rank[worst]) worst = c
        }
      } finally {
        await rendered.destroy().catch(() => undefined)
      }
    } catch {
      return this.fail(
        fileId,
        'OCR_FAILED',
        '扫描件页面渲染失败，请确认文件未损坏，或上传带文字层的 PDF / DOCX',
        startedAt,
        totalPages,
      )
    }
    const extraWarnings: string[] = []
    if (totalPages > pages) {
      extraWarnings.push(`扫描件共 ${totalPages} 页，仅识别前 ${pages} 页用于诊断`)
    }
    return this.finalizeText(fileId, pageTexts.join('\n'), 'pdf_ocr', worst, totalPages, startedAt, extraWarnings)
  }

  private async extractImageOcr(
    fileId: string,
    buffer: Buffer,
    mimeType: string,
    startedAt: number,
  ): Promise<ResumeExtractionResult> {
    const ocrResult = await this.ocr.recognize({ buffer, mimeType })
    if (!ocrResult.ok) {
      const code: ResumeExtractionErrorCode =
        ocrResult.errorCode === 'OCR_NOT_CONFIGURED' ? 'OCR_NOT_CONFIGURED' : 'OCR_FAILED'
      const message =
        ocrResult.errorMessage ?? '图片简历文字识别失败，请上传带文字层的 PDF 或 DOCX'
      return this.fail(fileId, code, message, startedAt)
    }
    const confidence: ResumeExtractionConfidence = ocrResult.confidence ?? 'low'
    return this.finalizeText(fileId, ocrResult.text ?? '', 'image_ocr', confidence, undefined, startedAt)
  }

  // ── 通用收口 ──────────────────────────────────────────────────────────────

  private finalizeText(
    fileId: string,
    rawText: string,
    textSource: ResumeTextSource,
    confidence: ResumeExtractionConfidence,
    pageCount: number | undefined,
    startedAt: number,
    extraWarnings: string[] = [],
  ): ResumeExtractionResult {
    const cleaned = this.clean(rawText)
    if (this.meaningfulLen(cleaned) < MIN_TEXT_CHARS) {
      return this.fail(
        fileId,
        'TEXT_TOO_SHORT',
        '未能从文件中提取到有效简历文字，请确认文件内容完整',
        startedAt,
        pageCount,
      )
    }

    const warnings: string[] = [...extraWarnings]
    // OCR 路径低/中置信度：明确提示人工核对，不假装识别完全可靠（Stage 3 验收点）。
    if ((textSource === 'image_ocr' || textSource === 'pdf_ocr') && confidence !== 'high') {
      warnings.push('文字识别置信度有限，诊断结果仅供参考，请对照原件核对关键信息')
    }
    let text = cleaned
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS)
      warnings.push(`简历文本较长，已截断至 ${MAX_TEXT_CHARS} 字符用于后续分析`)
    }

    const charCount = text.length
    this.logMeta('extract.ok', { fileId, textSource, charCount, pageCount, ms: Date.now() - startedAt })
    return {
      ok: true,
      fileId,
      text,
      textSource,
      confidence,
      ...(pageCount !== undefined ? { pageCount } : {}),
      charCount,
      ...(warnings.length ? { warnings } : {}),
    }
  }

  private fail(
    fileId: string,
    errorCode: ResumeExtractionErrorCode,
    errorMessage: string,
    startedAt: number,
    pageCount?: number,
  ): ResumeExtractionResult {
    // 仅记元数据：fileId / 失败码 / 耗时。绝不记原文、buffer、文件名内容。
    this.logMeta('extract.fail', { fileId, errorCode, ms: Date.now() - startedAt })
    return {
      ok: false,
      fileId,
      errorCode,
      errorMessage,
      ...(pageCount !== undefined ? { pageCount } : {}),
    }
  }

  // ── 工具 ──────────────────────────────────────────────────────────────────

  private resolveKind(mimeType: string, ext: string): FileKind {
    const mt = (mimeType ?? '').toLowerCase()
    if (mt === DOCX_MIME || ext === '.docx') return 'docx'
    if (mt === DOC_MIME || ext === '.doc') return 'doc'
    if (mt === PDF_MIME || ext === '.pdf') return 'pdf'
    if (IMAGE_MIMES.includes(mt) || IMAGE_EXTS.includes(ext)) return 'image'
    return 'unknown'
  }

  private extOf(filename: string): string {
    const name = filename ?? ''
    const i = name.lastIndexOf('.')
    return i >= 0 ? name.slice(i).toLowerCase() : ''
  }

  /** 规整空白：压缩水平空白、收敛换行、trim（不破坏正文内容）。 */
  private clean(text: string): string {
    return (text ?? '')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /** 去掉所有空白后的字符数，用于「有效文字量」阈值判断。 */
  private meaningfulLen(text: string): number {
    return (text ?? '').replace(/\s+/g, '').length
  }

  private logMeta(event: string, meta: Record<string, unknown>): void {
    this.logger.log(`${event} ${JSON.stringify(meta)}`)
  }
}
