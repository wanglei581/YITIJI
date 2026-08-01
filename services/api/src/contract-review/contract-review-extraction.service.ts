import { Inject, Injectable, Optional } from '@nestjs/common'
import mammoth from 'mammoth'
import { TextDecoder } from 'node:util'
import { createInflateRaw } from 'node:zlib'
import { FilesService } from '../files/files.service'
import type { OcrResult } from '../ai/resume/ocr/ocr-provider.interface'
import { OcrService } from '../ai/resume/ocr/ocr.service'
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
const MAX_CANONICAL_PAGE_CODE_UNITS = 200_000
const MAX_CANONICAL_DOCUMENT_CODE_UNITS = 2_000_000
const MAX_DOCX_XML_UNCOMPRESSED_BYTES = 16 * 1024 * 1024
const MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const MAX_DOCX_ZIP_ENTRIES = 4096
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_MAX_COMMENT_BYTES = 0xffff
const ZIP64_EXTRA_FIELD_ID = 0x0001
const ZIP_UNICODE_PATH_EXTRA_FIELD_ID = 0x7075
const ZIP_ALLOWED_FLAGS = 0x080e

interface DocxZipEntry {
  filename: string
  filenameBytes: Buffer
  isDirectory: boolean
  flags: number
  method: 0 | 8
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  dataStart: number
  dataEnd: number
  isXmlOrRels: boolean
}

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

function assertCanonicalPageBudget(text: string): void {
  if (text.length > MAX_CANONICAL_PAGE_CODE_UNITS) {
    throw fail('CONTRACT_PAGE_TEXT_LIMIT_EXCEEDED')
  }
}

function assertCanonicalDocumentBudget(pages: readonly string[]): void {
  let total = 0
  for (const page of pages) {
    assertCanonicalPageBudget(page)
    total += page.length
    if (total > MAX_CANONICAL_DOCUMENT_CODE_UNITS) {
      throw fail('CONTRACT_DOCUMENT_TEXT_LIMIT_EXCEEDED')
    }
  }
}

function assertNoZip64Extra(buffer: Buffer, offset: number, length: number): void {
  const end = offset + length
  let cursor = offset
  while (cursor < end) {
    if (cursor + 4 > end) throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    const fieldId = buffer.readUInt16LE(cursor)
    const fieldLength = buffer.readUInt16LE(cursor + 2)
    cursor += 4
    if (
      cursor + fieldLength > end ||
      fieldId === ZIP64_EXTRA_FIELD_ID ||
      fieldId === ZIP_UNICODE_PATH_EXTRA_FIELD_ID
    ) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    cursor += fieldLength
  }
}

function decodeCanonicalZipPath(
  filenameBytes: Buffer,
  flags: number,
): { filename: string; isDirectory: boolean } {
  const usesUtf8 = (flags & 0x0800) !== 0
  if (!usesUtf8 && filenameBytes.some((byte) => byte > 0x7f)) {
    throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
  }
  const filename = usesUtf8
    ? new TextDecoder('utf-8', { fatal: true }).decode(filenameBytes)
    : filenameBytes.toString('ascii')
  const isDirectory = filename.endsWith('/')
  const canonicalPath = isDirectory ? filename.slice(0, -1) : filename
  const segments = canonicalPath.split('/')
  if (
    filenameBytes.length === 0 ||
    (usesUtf8 && !Buffer.from(filename, 'utf8').equals(filenameBytes)) ||
    canonicalPath === '' ||
    canonicalPath !== canonicalPath.normalize('NFC') ||
    filename.startsWith('/') ||
    /^[A-Za-z]:/u.test(filename) ||
    filename.includes(':') ||
    filename.includes('\\') ||
    /[\p{Cc}\p{Cf}]/u.test(filename) ||
    segments.some((segment) =>
      segment === '' || segment === '.' || segment === '..' ||
      segment.endsWith('.') || segment.endsWith(' ')
    )
  ) {
    throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
  }
  return { filename, isDirectory }
}

function canonicalZipPathKey(filename: string): string {
  return filename.replace(/\/$/u, '').normalize('NFKC').toLowerCase()
}

function parseDocxCentralDirectory(buffer: Buffer): DocxZipEntry[] {
  const minimumOffset = Math.max(0, buffer.length - ZIP_MAX_COMMENT_BYTES - 22)
  let eocdOffset = -1
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + 22 + commentLength === buffer.length) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4)
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6)
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const centralSize = buffer.readUInt32LE(eocdOffset + 12)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (
    diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries ||
    totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff ||
    centralOffset + centralSize !== eocdOffset
  ) {
    throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
  }
  if (totalEntries < 1 || totalEntries > MAX_DOCX_ZIP_ENTRIES) {
    throw fail('CONTRACT_DOCX_ARCHIVE_ENTRY_LIMIT_EXCEEDED')
  }

  const entries: DocxZipEntry[] = []
  const canonicalNames = new Set<string>()
  let cursor = centralOffset
  let declaredTotalBytes = 0
  let declaredXmlBytes = 0
  let documentXmlCount = 0
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocdOffset || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const filenameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const diskStart = buffer.readUInt16LE(cursor + 34)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const filenameStart = cursor + 46
    const extraStart = filenameStart + filenameLength
    const next = extraStart + extraLength + commentLength
    if (
      diskStart !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff || (flags & ~ZIP_ALLOWED_FLAGS) !== 0 ||
      (method !== 0 && method !== 8) || next > eocdOffset
    ) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    assertNoZip64Extra(buffer, extraStart, extraLength)
    const filenameBytes = Buffer.from(buffer.subarray(filenameStart, extraStart))
    const { filename, isDirectory } = decodeCanonicalZipPath(filenameBytes, flags)
    if (isDirectory && (method !== 0 || compressedSize !== 0 || uncompressedSize !== 0)) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    const canonicalName = canonicalZipPathKey(filename)
    if (canonicalNames.has(canonicalName)) throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    canonicalNames.add(canonicalName)

    const isXmlOrRels = !isDirectory && /\.(?:xml|rels)$/iu.test(filename)
    declaredTotalBytes += uncompressedSize
    if (isXmlOrRels) declaredXmlBytes += uncompressedSize
    if (declaredTotalBytes > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES) {
      throw fail('CONTRACT_DOCX_ARCHIVE_SIZE_LIMIT_EXCEEDED')
    }
    if (declaredXmlBytes > MAX_DOCX_XML_UNCOMPRESSED_BYTES) {
      throw fail('CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED')
    }
    if (filename === 'word/document.xml') documentXmlCount += 1
    entries.push({
      filename, filenameBytes, isDirectory, flags, method: method as 0 | 8,
      compressedSize, uncompressedSize, localHeaderOffset,
      dataStart: 0, dataEnd: 0, isXmlOrRels,
    })
    cursor = next
  }
  if (cursor !== eocdOffset || documentXmlCount !== 1) {
    throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
  }

  const filePaths = new Set(
    entries.filter((entry) => !entry.isDirectory).map((entry) => canonicalZipPathKey(entry.filename)),
  )
  for (const entry of entries) {
    const segments = canonicalZipPathKey(entry.filename).split('/')
    for (let length = 1; length < segments.length; length += 1) {
      if (filePaths.has(segments.slice(0, length).join('/'))) {
        throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
      }
    }
  }

  const withLocalRanges = entries.map((entry) => {
    const offset = entry.localHeaderOffset
    if (offset + 30 > centralOffset || buffer.readUInt32LE(offset) !== ZIP_LOCAL_FILE_SIGNATURE) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    const localFlags = buffer.readUInt16LE(offset + 6)
    const localMethod = buffer.readUInt16LE(offset + 8)
    const localCompressedSize = buffer.readUInt32LE(offset + 18)
    const localUncompressedSize = buffer.readUInt32LE(offset + 22)
    const filenameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const filenameStart = offset + 30
    const extraStart = filenameStart + filenameLength
    const dataStart = extraStart + extraLength
    const dataEnd = dataStart + entry.compressedSize
    const usesDataDescriptor = (entry.flags & 0x0008) !== 0
    if (
      localFlags !== entry.flags || localMethod !== entry.method || dataEnd > centralOffset ||
      !buffer.subarray(filenameStart, extraStart).equals(entry.filenameBytes) ||
      (!usesDataDescriptor && (
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize
      )) ||
      (usesDataDescriptor && (
        (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
        (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize)
      ))
    ) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    assertNoZip64Extra(buffer, extraStart, extraLength)
    return { ...entry, dataStart, dataEnd }
  })
  const orderedRanges = [...withLocalRanges].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset)
  for (let index = 1; index < orderedRanges.length; index += 1) {
    if ((orderedRanges[index - 1] as DocxZipEntry).dataEnd > (orderedRanges[index] as DocxZipEntry).localHeaderOffset) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
  }
  return withLocalRanges
}

async function countDeflatedEntryBytes(
  compressed: Buffer,
  entry: DocxZipEntry,
  priorTotalBytes: number,
  priorXmlBytes: number,
): Promise<{ entryBytes: number; totalBytes: number; xmlBytes: number }> {
  const inflater = createInflateRaw()
  let entryBytes = 0
  let totalBytes = priorTotalBytes
  let xmlBytes = priorXmlBytes
  try {
    inflater.end(compressed)
    for await (const chunk of inflater) {
      const chunkBytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
      entryBytes += chunkBytes
      totalBytes += chunkBytes
      if (entry.isXmlOrRels) xmlBytes += chunkBytes
      if (entryBytes > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES || totalBytes > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES) {
        throw fail('CONTRACT_DOCX_ARCHIVE_SIZE_LIMIT_EXCEEDED')
      }
      if (xmlBytes > MAX_DOCX_XML_UNCOMPRESSED_BYTES) {
        throw fail('CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED')
      }
    }
  } catch (error) {
    throw knownOr(error, 'CONTRACT_DOCX_ARCHIVE_INVALID')
  } finally {
    inflater.destroy()
  }
  return { entryBytes, totalBytes, xmlBytes }
}

async function assertDocxArchiveSafe(buffer: Buffer): Promise<void> {
  try {
    const entries = parseDocxCentralDirectory(buffer)
    let totalBytes = 0
    let xmlBytes = 0
    for (const entry of entries) {
      const compressed = buffer.subarray(entry.dataStart, entry.dataEnd)
      if (entry.method === 0) {
        const entryBytes = compressed.length
        totalBytes += entryBytes
        if (entry.isXmlOrRels) xmlBytes += entryBytes
        if (entryBytes > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES || totalBytes > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES) {
          throw fail('CONTRACT_DOCX_ARCHIVE_SIZE_LIMIT_EXCEEDED')
        }
        if (xmlBytes > MAX_DOCX_XML_UNCOMPRESSED_BYTES) {
          throw fail('CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED')
        }
        if (entryBytes !== entry.uncompressedSize) throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
        continue
      }
      const counted = await countDeflatedEntryBytes(compressed, entry, totalBytes, xmlBytes)
      if (counted.entryBytes !== entry.uncompressedSize) {
        throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
      }
      totalBytes = counted.totalBytes
      xmlBytes = counted.xmlBytes
    }
  } catch (error) {
    throw knownOr(error, 'CONTRACT_DOCX_ARCHIVE_INVALID')
  }
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

/** Page-local reliability gate; only Unicode letters and numbers count as semantic text. */
export function hasReliableTextLayer(text: unknown): boolean {
  if (typeof text !== 'string') return false
  const lineLengths = text
    .split(/\r\n|[\n\r\u2028\u2029]/u)
    .map((line) => Array.from(line.match(/[\p{L}\p{N}]/gu) ?? []).length)
  const totalVisibleCharacters = lineLengths.reduce((total, length) => total + length, 0)
  if (totalVisibleCharacters < MIN_RELIABLE_TEXT_LAYER_CHARS) return false
  return lineLengths.some((length) => length >= MIN_RELIABLE_TEXT_LAYER_CHARS) ||
    lineLengths.filter((length) => length >= 8).length >= 3
}

function isNonEmptyCanonicalText(text: string): boolean {
  return text.replace(/[\p{White_Space}\p{Cc}\p{Cf}]+/gu, '').length > 0
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
    await assertDocxArchiveSafe(buffer)
    let value: unknown
    try {
      value = (await this.runtime.extractDocxRawText({ buffer })).value
    } catch {
      throw fail('CONTRACT_DOCX_EXTRACTION_FAILED')
    }
    if (typeof value !== 'string') throw fail('CONTRACT_DOCX_EXTRACTION_FAILED')
    const text = canonicalizePage(value)
    if (!isNonEmptyCanonicalText(text)) throw fail('CONTRACT_TEXT_EMPTY')
    assertCanonicalDocumentBudget([text])
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
        extracted.text.length !== proxy.numPages
      ) {
        throw fail('CONTRACT_PDF_INTEGRITY_FAILED')
      }
      for (let index = 0; index < proxy.numPages; index += 1) {
        const hasOwn = (Object as ObjectConstructor & {
          hasOwn(value: object, property: PropertyKey): boolean
        }).hasOwn(extracted.text, index)
        if (!hasOwn || typeof extracted.text[index] !== 'string') {
          throw fail('CONTRACT_PDF_INTEGRITY_FAILED')
        }
      }
      const pages = extracted.text.map((page) => canonicalizePage(page))
      assertCanonicalDocumentBudget(pages)
      result = {
        totalPages: proxy.numPages,
        pages,
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
      let canonicalCodeUnits = 0
      for (let index = 0; index < extracted.totalPages; index += 1) {
        let page: ContractReviewExtractedPage
        if (missing.has(index)) {
          let image: Buffer
          try {
            image = await renderer.renderPage(index + 1, OCR_RENDER_SCALE)
          } catch {
            throw fail('OCR_FAILED')
          }
          const recognized = await this.recognize(image, 'image/png')
          page = this.ocrPage(index + 1, recognized)
          confidences.push(page.ocrConfidence as ContractReviewOcrConfidence)
        } else {
          page = this.textLayerPage(index + 1, extracted.pages[index] as string)
        }
        pages.push(page)
        canonicalCodeUnits += page.text.length
        if (canonicalCodeUnits > MAX_CANONICAL_DOCUMENT_CODE_UNITS) {
          throw fail('CONTRACT_DOCUMENT_TEXT_LIMIT_EXCEEDED')
        }
        if (index + 1 < extracted.totalPages) {
          await this.reportProgress(onPageComplete, index + 1, extracted.totalPages)
        }
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
    await this.reportProgress(onPageComplete, extracted.totalPages, extracted.totalPages)
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
    assertCanonicalPageBudget(text)
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
