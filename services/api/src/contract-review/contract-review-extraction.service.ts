import { Inject, Injectable, Optional } from '@nestjs/common'
import mammoth from 'mammoth'
import type { FilesService } from '../files/files.service'
import type { OcrResult } from '../ai/resume/ocr/ocr-provider.interface'
import type { OcrService } from '../ai/resume/ocr/ocr.service'
import {
  openPdfForRender,
  type RenderedPdf,
} from '../ai/resume/ocr/pdf-page-renderer'
import { canonicalizePage } from './canonical-text'

interface PdfProxy {
  numPages: number
  destroy(): Promise<void>
}

interface PdfTextResult {
  totalPages: number
  text: string | string[]
}

interface UnpdfApi {
  getDocumentProxy(data: Uint8Array): Promise<PdfProxy>
  extractText(
    pdf: PdfProxy,
    options: { mergePages: false },
  ): Promise<PdfTextResult>
}

// services/api is CommonJS; unpdf's CJS export does not expose usable types under node10 resolution.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unpdf = require('unpdf') as UnpdfApi

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME = 'application/pdf'
const DOC_MIME = 'application/msword'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_PDF_PAGES = 50
const MAX_OCR_PAGES = 20
const OCR_RENDER_SCALE = 2

export const MIN_RELIABLE_TEXT_LAYER_CHARS = 30

export const CONTRACT_REVIEW_EXTRACTION_RUNTIME = Symbol(
  'CONTRACT_REVIEW_EXTRACTION_RUNTIME',
)

export type ContractReviewOcrConfidence = 'high' | 'medium' | 'low'
export type ContractReviewExtractionMode = 'text_layer' | 'ocr' | 'mixed'

export interface ContractReviewExtractedPage {
  pageNumber: number
  text: string
  source: 'text_layer' | 'ocr'
  ocrConfidence: ContractReviewOcrConfidence | null
}

export interface ContractReviewExtractionResult {
  mode: ContractReviewExtractionMode
  totalPages: number
  analyzedPages: number
  truncated: false
  ocrConfidence: ContractReviewOcrConfidence | null
  pages: ContractReviewExtractedPage[]
}

export interface ContractReviewExtractionInput {
  fileId: string
  endUserId: string | null
  onPageComplete?: (completedPages: number, totalPages: number) => void | Promise<void>
}

export interface ContractReviewExtractionRuntime {
  extractDocxRawText(input: { buffer: Buffer }): Promise<{ value?: string }>
  getDocumentProxy(data: Uint8Array): Promise<PdfProxy>
  extractPdfText(
    pdf: PdfProxy,
    options: { mergePages: false },
  ): Promise<PdfTextResult>
  openPdfForRender(buffer: Buffer): Promise<RenderedPdf>
}

const DEFAULT_RUNTIME: ContractReviewExtractionRuntime = {
  extractDocxRawText: (input) => mammoth.extractRawText(input),
  getDocumentProxy: (data) => unpdf.getDocumentProxy(data),
  extractPdfText: (pdf, options) => unpdf.extractText(pdf, options),
  openPdfForRender,
}

class ContractReviewExtractionError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ContractReviewExtractionError'
  }
}

function fail(code: string): ContractReviewExtractionError {
  return new ContractReviewExtractionError(code)
}

function knownOr(error: unknown, fallback: string): ContractReviewExtractionError {
  return error instanceof ContractReviewExtractionError ? error : fail(fallback)
}

/** Validate a declared PDF page count before unpdf allocates work for extractText. */
export function assertBornDigitalPdfPageLimit(pageCount: unknown): void {
  if (!Number.isSafeInteger(pageCount) || (pageCount as number) < 1) {
    throw fail('CONTRACT_PDF_INVALID')
  }
  if ((pageCount as number) > MAX_PDF_PAGES) {
    throw fail('CONTRACT_PAGE_LIMIT_EXCEEDED')
  }
}

/** Page-local text-layer reliability gate; whitespace does not count as content. */
export function hasReliableTextLayer(text: unknown): boolean {
  return typeof text === 'string' && text.replace(/\s+/gu, '').length >= MIN_RELIABLE_TEXT_LAYER_CHARS
}

function isNonEmptyCanonicalText(text: string): boolean {
  return text.replace(/\s+/gu, '').length > 0
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index < 0 ? '' : filename.slice(index).toLowerCase()
}

type SupportedKind = 'pdf' | 'docx' | 'image'

function resolveSupportedKind(mimeType: unknown, filename: unknown): SupportedKind | null {
  if (typeof mimeType !== 'string' || typeof filename !== 'string') return null
  const mime = mimeType.toLowerCase()
  const extension = extensionOf(filename)
  if (mime === PDF_MIME && extension === '.pdf') return 'pdf'
  if (mime === DOCX_MIME && extension === '.docx') return 'docx'
  if (mime === 'image/jpeg' && (extension === '.jpg' || extension === '.jpeg')) return 'image'
  if (mime === 'image/png' && extension === '.png') return 'image'
  if (mime === 'image/webp' && extension === '.webp') return 'image'
  if (mime === DOC_MIME || extension === '.doc') return null
  return null
}

@Injectable()
export class ContractReviewExtractionService {
  private readonly runtime: ContractReviewExtractionRuntime

  constructor(
    private readonly files: FilesService,
    private readonly ocr: OcrService,
    @Optional()
    @Inject(CONTRACT_REVIEW_EXTRACTION_RUNTIME)
    runtime?: ContractReviewExtractionRuntime,
  ) {
    this.runtime = runtime ?? DEFAULT_RUNTIME
  }

  async extract(input: ContractReviewExtractionInput): Promise<ContractReviewExtractionResult> {
    this.assertInput(input)
    let content: Awaited<ReturnType<FilesService['readContentForEndUser']>>
    try {
      content = await this.files.readContentForEndUser(input.fileId, input.endUserId)
    } catch {
      throw fail('CONTRACT_SOURCE_FILE_UNAVAILABLE')
    }

    if (content.purpose !== 'contract_upload') throw fail('CONTRACT_FILE_PURPOSE_REJECTED')
    if (!Buffer.isBuffer(content.buffer) || content.buffer.length === 0) {
      throw fail('CONTRACT_FILE_EMPTY')
    }
    if (content.buffer.length > MAX_FILE_BYTES) throw fail('CONTRACT_FILE_TOO_LARGE')

    const kind = resolveSupportedKind(content.mimeType, content.filename)
    if (kind === null) throw fail('CONTRACT_UNSUPPORTED_FILE_TYPE')
    if (kind === 'docx') return this.extractDocx(content.buffer, input.onPageComplete)
    if (kind === 'image') {
      return this.extractImage(content.buffer, content.mimeType, input.onPageComplete)
    }
    return this.extractPdf(content.buffer, input.onPageComplete)
  }

  private assertInput(input: ContractReviewExtractionInput): void {
    const validOwner = input?.endUserId === null || (
      typeof input?.endUserId === 'string' && input.endUserId.length > 0
    )
    const validProgress = input?.onPageComplete === undefined || typeof input.onPageComplete === 'function'
    if (!input || typeof input.fileId !== 'string' || input.fileId.length === 0 || !validOwner || !validProgress) {
      throw fail('CONTRACT_EXTRACTION_INPUT_INVALID')
    }
  }

  private async extractDocx(
    buffer: Buffer,
    onPageComplete?: ContractReviewExtractionInput['onPageComplete'],
  ): Promise<ContractReviewExtractionResult> {
    let value: unknown
    try {
      value = (await this.runtime.extractDocxRawText({ buffer })).value
    } catch {
      throw fail('CONTRACT_DOCX_EXTRACTION_FAILED')
    }
    if (typeof value !== 'string') throw fail('CONTRACT_DOCX_EXTRACTION_FAILED')
    const text = canonicalizePage(value)
    if (!isNonEmptyCanonicalText(text)) throw fail('CONTRACT_TEXT_EMPTY')
    await this.reportProgress(onPageComplete, 1, 1)
    return this.completeResult('text_layer', [this.textLayerPage(1, text)], null)
  }

  private async extractImage(
    buffer: Buffer,
    mimeType: string,
    onPageComplete?: ContractReviewExtractionInput['onPageComplete'],
  ): Promise<ContractReviewExtractionResult> {
    this.assertOcrConfigured()
    const recognized = await this.recognize(buffer, mimeType)
    const page = this.ocrPage(1, recognized)
    await this.reportProgress(onPageComplete, 1, 1)
    return this.completeResult('ocr', [page], page.ocrConfidence)
  }

  private async extractPdf(
    buffer: Buffer,
    onPageComplete?: ContractReviewExtractionInput['onPageComplete'],
  ): Promise<ContractReviewExtractionResult> {
    const extracted = await this.readPdfTextLayers(buffer)
    const missingIndexes = extracted.pages
      .map((text, index) => hasReliableTextLayer(text) ? -1 : index)
      .filter((index) => index >= 0)

    if (missingIndexes.length > MAX_OCR_PAGES) throw fail('CONTRACT_OCR_PAGE_LIMIT_EXCEEDED')
    if (missingIndexes.length === 0) {
      const pages: ContractReviewExtractedPage[] = []
      for (let index = 0; index < extracted.pages.length; index += 1) {
        pages.push(this.textLayerPage(index + 1, extracted.pages[index] as string))
        await this.reportProgress(onPageComplete, index + 1, extracted.totalPages)
      }
      return this.completeResult('text_layer', pages, null)
    }

    this.assertOcrConfigured()
    return this.ocrMissingPdfPages(buffer, extracted, missingIndexes, onPageComplete)
  }

  private async readPdfTextLayers(buffer: Buffer): Promise<{
    totalPages: number
    pages: string[]
  }> {
    let proxy: PdfProxy | undefined
    let primaryError: ContractReviewExtractionError | undefined
    let cleanupFailed = false
    let result: { totalPages: number; pages: string[] } | undefined
    try {
      proxy = await this.runtime.getDocumentProxy(new Uint8Array(buffer))
      if (!proxy || typeof proxy.destroy !== 'function') throw fail('CONTRACT_PDF_INVALID')
      assertBornDigitalPdfPageLimit(proxy.numPages)
      const extracted = await this.runtime.extractPdfText(proxy, { mergePages: false })
      if (
        extracted.totalPages !== proxy.numPages ||
        !Array.isArray(extracted.text) ||
        extracted.text.length !== proxy.numPages ||
        extracted.text.some((page) => typeof page !== 'string')
      ) {
        throw fail('CONTRACT_PDF_INTEGRITY_FAILED')
      }
      result = {
        totalPages: proxy.numPages,
        pages: extracted.text.map((page) => canonicalizePage(page)),
      }
    } catch (error) {
      primaryError = knownOr(error, 'CONTRACT_PDF_EXTRACTION_FAILED')
    } finally {
      if (proxy && typeof proxy.destroy === 'function') {
        try {
          await proxy.destroy()
        } catch {
          cleanupFailed = true
        }
      }
    }
    if (primaryError) throw primaryError
    if (cleanupFailed) throw fail('CONTRACT_PDF_RESOURCE_CLEANUP_FAILED')
    if (!result) throw fail('CONTRACT_PDF_EXTRACTION_FAILED')
    return result
  }

  private async ocrMissingPdfPages(
    buffer: Buffer,
    extracted: { totalPages: number; pages: string[] },
    missingIndexes: number[],
    onPageComplete?: ContractReviewExtractionInput['onPageComplete'],
  ): Promise<ContractReviewExtractionResult> {
    let renderer: RenderedPdf | undefined
    let primaryError: ContractReviewExtractionError | undefined
    let cleanupFailed = false
    let result: ContractReviewExtractionResult | undefined
    try {
      renderer = await this.runtime.openPdfForRender(buffer)
      if (
        !renderer ||
        !Number.isSafeInteger(renderer.totalPages) ||
        renderer.totalPages !== extracted.totalPages
      ) {
        throw fail('CONTRACT_PDF_INTEGRITY_FAILED')
      }
      const missing = new Set(missingIndexes)
      const pages: ContractReviewExtractedPage[] = []
      const confidences: ContractReviewOcrConfidence[] = []
      for (let index = 0; index < extracted.totalPages; index += 1) {
        if (missing.has(index)) {
          let image: Buffer
          try {
            image = await renderer.renderPage(index + 1, OCR_RENDER_SCALE)
          } catch {
            throw fail('OCR_FAILED')
          }
          const recognized = await this.recognize(image, 'image/png')
          const page = this.ocrPage(index + 1, recognized)
          pages.push(page)
          confidences.push(page.ocrConfidence as ContractReviewOcrConfidence)
        } else {
          pages.push(this.textLayerPage(index + 1, extracted.pages[index] as string))
        }
        await this.reportProgress(onPageComplete, index + 1, extracted.totalPages)
      }
      const mode: ContractReviewExtractionMode = missingIndexes.length === extracted.totalPages ? 'ocr' : 'mixed'
      result = this.completeResult(mode, pages, this.worstConfidence(confidences))
    } catch (error) {
      primaryError = knownOr(error, 'OCR_FAILED')
    } finally {
      if (renderer) {
        try {
          await renderer.destroy()
        } catch {
          cleanupFailed = true
        }
      }
    }
    if (primaryError) throw primaryError
    if (cleanupFailed) throw fail('CONTRACT_PDF_RESOURCE_CLEANUP_FAILED')
    if (!result) throw fail('OCR_FAILED')
    return result
  }

  private assertOcrConfigured(): void {
    if (this.ocr.activeProviderName === 'disabled') throw fail('OCR_NOT_CONFIGURED')
  }

  private async recognize(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    let result: OcrResult
    try {
      result = await this.ocr.recognize({ buffer, mimeType })
    } catch {
      throw fail('OCR_FAILED')
    }
    if (!result.ok) {
      throw fail(result.errorCode === 'OCR_NOT_CONFIGURED' ? 'OCR_NOT_CONFIGURED' : 'OCR_FAILED')
    }
    if (typeof result.text !== 'string') throw fail('CONTRACT_TEXT_EMPTY')
    const text = canonicalizePage(result.text)
    if (!isNonEmptyCanonicalText(text)) throw fail('CONTRACT_TEXT_EMPTY')
    return { ok: true, text, confidence: result.confidence ?? 'low' }
  }

  private textLayerPage(pageNumber: number, text: string): ContractReviewExtractedPage {
    return { pageNumber, text, source: 'text_layer', ocrConfidence: null }
  }

  private ocrPage(pageNumber: number, result: OcrResult): ContractReviewExtractedPage {
    return {
      pageNumber,
      text: result.text as string,
      source: 'ocr',
      ocrConfidence: result.confidence ?? 'low',
    }
  }

  private worstConfidence(
    confidences: ContractReviewOcrConfidence[],
  ): ContractReviewOcrConfidence {
    const rank: Record<ContractReviewOcrConfidence, number> = { high: 2, medium: 1, low: 0 }
    return confidences.reduce((worst, current) => rank[current] < rank[worst] ? current : worst, 'high')
  }

  private async reportProgress(
    callback: ContractReviewExtractionInput['onPageComplete'],
    completedPages: number,
    totalPages: number,
  ): Promise<void> {
    if (!callback) return
    try {
      await callback(completedPages, totalPages)
    } catch {
      throw fail('CONTRACT_PROGRESS_UPDATE_FAILED')
    }
  }

  private completeResult(
    mode: ContractReviewExtractionMode,
    pages: ContractReviewExtractedPage[],
    ocrConfidence: ContractReviewOcrConfidence | null,
  ): ContractReviewExtractionResult {
    return {
      mode,
      totalPages: pages.length,
      analyzedPages: pages.length,
      truncated: false,
      ocrConfidence,
      pages,
    }
  }
}
