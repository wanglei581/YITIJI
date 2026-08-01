import 'reflect-metadata'

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createDeflateRaw, deflateRawSync } from 'node:zlib'
import { OcrService } from '../../ai/resume/ocr/ocr.service'
import { FilesService } from '../../files/files.service'
import {
  ContractReviewExtractionService,
  hasReliableTextLayer,
  type ContractReviewExtractionRuntime,
  type ContractReviewExtractionResult,
} from '../contract-review-extraction.service'

const PDF = Buffer.from('%PDF test')
const IMAGE = Buffer.from('image')
const RELIABLE = '合同正文'.repeat(8)

interface TestZipEntry {
  name: string
  filenameBytes?: Buffer
  content?: Buffer
  method?: number
  flags?: number
  centralExtra?: Buffer
  localExtra?: Buffer
  declaredUncompressedSize?: number
  compressedData?: Buffer
}

function makeDocxArchive(
  entries: TestZipEntry[] = [
    { name: 'word/document.xml', content: Buffer.from('<w:document/>'), method: 8 },
  ],
): Buffer {
  const localEntries: Buffer[] = []
  const centralEntries: Buffer[] = []
  let localOffset = 0
  for (const entry of entries) {
    const filename = entry.filenameBytes ?? Buffer.from(entry.name, 'utf8')
    const content = entry.content ?? Buffer.from('x')
    const method = entry.method ?? 0
    const flags = entry.flags ?? 0
    const compressed = entry.compressedData ?? (method === 8 ? deflateRawSync(content) : content)
    const declaredSize = entry.declaredUncompressedSize ?? content.length
    const localExtra = entry.localExtra ?? Buffer.alloc(0)
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(flags, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(declaredSize, 22)
    localHeader.writeUInt16LE(filename.length, 26)
    localHeader.writeUInt16LE(localExtra.length, 28)
    const localEntry = Buffer.concat([localHeader, filename, localExtra, compressed])
    localEntries.push(localEntry)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(flags, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(declaredSize, 24)
    centralHeader.writeUInt16LE(filename.length, 28)
    centralHeader.writeUInt16LE(centralExtra.length, 30)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralEntries.push(Buffer.concat([centralHeader, filename, centralExtra]))
    localOffset += localEntry.length
  }

  const localData = Buffer.concat(localEntries)
  const centralDirectory = Buffer.concat(centralEntries)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(localData.length, 16)
  return Buffer.concat([localData, centralDirectory, eocd])
}

async function makeDeflateBomb(outputBytes: number): Promise<Buffer> {
  const deflater = createDeflateRaw({ level: 9 })
  const chunks: Buffer[] = []
  deflater.on('data', (chunk: Buffer) => chunks.push(chunk))
  const block = Buffer.alloc(64 * 1024)
  let remaining = outputBytes
  while (remaining > 0) {
    const chunk = remaining >= block.length ? block : block.subarray(0, remaining)
    if (!deflater.write(chunk)) await once(deflater, 'drain')
    remaining -= chunk.length
  }
  deflater.end()
  await once(deflater, 'end')
  return Buffer.concat(chunks)
}

interface HarnessOptions {
  buffer?: Buffer
  filename?: string
  mimeType?: string
  purpose?: string
  readError?: Error
  activeProviderName?: string
  ocr?: (input: { buffer: Buffer; mimeType: string }) => Promise<{
    ok: boolean
    text?: string
    confidence?: 'high' | 'medium' | 'low'
    errorCode?: 'OCR_NOT_CONFIGURED' | 'OCR_FAILED'
    errorMessage?: string
  }>
  runtime?: Partial<ContractReviewExtractionRuntime>
}

function harness(options: HarnessOptions = {}) {
  const calls = {
    reads: [] as Array<[string, string | null]>,
    extractOptions: [] as Array<{ mergePages?: boolean } | undefined>,
    events: [] as string[],
    renders: [] as number[],
    ocr: 0,
    proxyDestroy: 0,
    rendererDestroy: 0,
  }
  const files = {
    readContentForEndUser: async (fileId: string, endUserId: string | null) => {
      calls.reads.push([fileId, endUserId])
      if (options.readError) throw options.readError
      return {
        buffer: options.buffer ?? PDF,
        filename: options.filename ?? 'contract.pdf',
        mimeType: options.mimeType ?? 'application/pdf',
        purpose: options.purpose ?? 'contract_upload',
      }
    },
  }
  const ocr = {
    activeProviderName: options.activeProviderName ?? 'baidu',
    recognize: async (input: { buffer: Buffer; mimeType: string }) => {
      calls.ocr += 1
      return options.ocr?.(input) ?? { ok: true, text: '识别合同正文', confidence: 'high' as const }
    },
  }
  const proxy = {
    numPages: 1,
    destroy: async () => {
      calls.proxyDestroy += 1
      calls.events.push('proxy.destroy')
    },
  }
  const renderer = {
    totalPages: 1,
    renderPage: async (pageNumber: number) => {
      calls.renders.push(pageNumber)
      calls.events.push(`render.${pageNumber}`)
      return Buffer.from(`page-${pageNumber}`)
    },
    destroy: async () => {
      calls.rendererDestroy += 1
      calls.events.push('renderer.destroy')
    },
  }
  const runtime: ContractReviewExtractionRuntime = {
    extractDocxRawText: async () => ({ value: 'DOCX 合同正文' }),
    getDocumentProxy: async () => proxy,
    extractPdfText: async (_pdf, extractOptions) => {
      calls.extractOptions.push(extractOptions)
      return { totalPages: proxy.numPages, text: [RELIABLE] }
    },
    openPdfForRender: async () => {
      calls.events.push('renderer.open')
      return renderer
    },
    ...options.runtime,
  }
  return {
    calls,
    proxy,
    renderer,
    service: new ContractReviewExtractionService(files as never, ocr as never, runtime),
  }
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<Error> {
  let captured: Error | undefined
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, code)
    captured = error
    return true
  })
  return captured as Error
}

function pageTexts(result: ContractReviewExtractionResult): string[] {
  return result.pages.map((page) => page.text)
}

test('publishes concrete Nest constructor metadata for production DI', () => {
  const parameterTypes = Reflect.getMetadata(
    'design:paramtypes',
    ContractReviewExtractionService,
  ) as unknown[] | undefined

  assert.ok(parameterTypes)
  assert.equal(parameterTypes[0], FilesService)
  assert.equal(parameterTypes[1], OcrService)
})

test('text-layer reliability excludes Unicode whitespace, controls, formats and short headers', () => {
  assert.equal(hasReliableTextLayer(RELIABLE), true)
  assert.equal(hasReliableTextLayer(`${'甲'.repeat(15)}\n${'乙'.repeat(15)}`), false)
  assert.equal(hasReliableTextLayer(`${'短页眉'.repeat(5)}\n${'短页脚'.repeat(5)}`), false)
  assert.equal(
    hasReliableTextLayer(`${'甲'.repeat(10)}\n${'乙'.repeat(10)}\n${'丙'.repeat(10)}`),
    true,
  )
  assert.equal(hasReliableTextLayer('正文'.repeat(15)), true)
  assert.equal(hasReliableTextLayer('\u200b'.repeat(30)), false)
  assert.equal(hasReliableTextLayer('\u0000\u0001\u0002'.repeat(10)), false)
  assert.equal(hasReliableTextLayer('\u3000\n\t'.repeat(10)), false)
  assert.equal(hasReliableTextLayer('😀'.repeat(15)), false)
  assert.equal(hasReliableTextLayer('\u034f'.repeat(30)), false)
  assert.equal(hasReliableTextLayer('\ufe0f'.repeat(30)), false)
  assert.equal(hasReliableTextLayer('\u0301'.repeat(30)), false)
  assert.equal(hasReliableTextLayer('中文合同正文'.repeat(5)), true)
  assert.equal(hasReliableTextLayer('EmploymentContractTerms123'.repeat(2)), true)
  assert.equal(hasReliableTextLayer('劳动合同　第 1 页'), false)
})

test('reads only through the end-user ownership boundary and emits ordered text-layer progress', async () => {
  const h = harness()
  const progress: Array<[number, number]> = []
  const result = await h.service.extract({
    fileId: 'file-1',
    endUserId: 'member-1',
    onPageComplete: async (completed, total) => { progress.push([completed, total]) },
  })

  assert.deepEqual(h.calls.reads, [['file-1', 'member-1']])
  assert.deepEqual(h.calls.extractOptions, [{ mergePages: false }])
  assert.equal(h.calls.proxyDestroy, 1)
  assert.deepEqual(progress, [[1, 1]])
  assert.deepEqual(result, {
    mode: 'text_layer', totalPages: 1, analyzedPages: 1, truncated: false,
    ocrConfidence: null,
    pages: [{ pageNumber: 1, text: RELIABLE, source: 'text_layer', ocrConfidence: null }],
  })
})

test('ownership, expiry and read failures have the same safe error shape', async () => {
  const denied = harness({ readError: new Error('member-2 owns this file') })
  const expired = harness({ readError: new Error('expired at 2026-08-01') })
  const deniedError = await expectCode(
    () => denied.service.extract({ fileId: 'secret-id', endUserId: 'member-1' }),
    'CONTRACT_SOURCE_FILE_UNAVAILABLE',
  )
  const expiredError = await expectCode(
    () => expired.service.extract({ fileId: 'secret-id', endUserId: 'member-1' }),
    'CONTRACT_SOURCE_FILE_UNAVAILABLE',
  )
  assert.equal(JSON.stringify(deniedError), JSON.stringify(expiredError))
})

test('rejects wrong purpose, empty, oversized, MIME/extension mismatch and legacy doc', async () => {
  const cases: Array<[HarnessOptions, string]> = [
    [{ purpose: 'resume_upload' }, 'CONTRACT_FILE_PURPOSE_REJECTED'],
    [{ buffer: Buffer.alloc(0) }, 'CONTRACT_FILE_EMPTY'],
    [{ buffer: Buffer.alloc(20 * 1024 * 1024 + 1) }, 'CONTRACT_FILE_TOO_LARGE'],
    [{ filename: 'contract.docx', mimeType: 'application/pdf' }, 'CONTRACT_UNSUPPORTED_FILE_TYPE'],
    [{ filename: 'contract.pdf', mimeType: 'application/octet-stream' }, 'CONTRACT_UNSUPPORTED_FILE_TYPE'],
    [{ filename: 'contract.doc', mimeType: 'application/msword' }, 'CONTRACT_UNSUPPORTED_FILE_TYPE'],
  ]
  for (const [options, code] of cases) {
    await expectCode(() => harness(options).service.extract({ fileId: 'f', endUserId: null }), code)
  }
})

test('extracts a DOCX as one canonical page and rejects parse failure or empty text', async () => {
  const docx = {
    buffer: makeDocxArchive(),
    filename: 'contract.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  const success = harness({
    ...docx,
    runtime: { extractDocxRawText: async () => ({ value: 'Café\r\n合同' }) },
  })
  const result = await success.service.extract({ fileId: 'docx', endUserId: null })
  assert.deepEqual(pageTexts(result), ['Café\n合同'])
  assert.equal(result.mode, 'text_layer')
  assert.equal(result.totalPages, 1)

  const broken = harness({ ...docx, runtime: { extractDocxRawText: async () => { throw new Error('zip details') } } })
  await expectCode(() => broken.service.extract({ fileId: 'docx', endUserId: null }), 'CONTRACT_DOCX_EXTRACTION_FAILED')
  const empty = harness({ ...docx, runtime: { extractDocxRawText: async () => ({ value: ' \r\n\t' }) } })
  await expectCode(() => empty.service.extract({ fileId: 'docx', endUserId: null }), 'CONTRACT_TEXT_EMPTY')
})

test('DOCX validates the complete ZIP structure and budgets before mammoth', async () => {
  let mammothCalls = 0
  const docx = {
    filename: 'contract.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  let directoryMammothCalls = 0
  const withDirectory = harness({
    ...docx,
    buffer: makeDocxArchive([
      { name: 'word/', content: Buffer.alloc(0), method: 0 },
      { name: 'word/document.xml', content: Buffer.from('doc'), method: 8 },
    ]),
    runtime: {
      extractDocxRawText: async () => {
        directoryMammothCalls += 1
        return { value: RELIABLE }
      },
    },
  })
  await withDirectory.service.extract({ fileId: 'docx', endUserId: null })
  assert.equal(directoryMammothCalls, 1)

  const malformed = harness({
    ...docx,
    buffer: Buffer.from('not-a-zip'),
    runtime: { extractDocxRawText: async () => { mammothCalls += 1; return { value: RELIABLE } } },
  })
  await expectCode(
    () => malformed.service.extract({ fileId: 'docx', endUserId: null }),
    'CONTRACT_DOCX_ARCHIVE_INVALID',
  )
  assert.equal(mammothCalls, 0)

  const zipBomb = harness({
    ...docx,
    buffer: makeDocxArchive([
      { name: 'word/document.xml', content: Buffer.from('doc') },
      { name: 'word/styles.xml', content: Buffer.from('style'), declaredUncompressedSize: 16 * 1024 * 1024 + 1 },
    ]),
    runtime: { extractDocxRawText: async () => { mammothCalls += 1; return { value: RELIABLE } } },
  })
  await expectCode(
    () => zipBomb.service.extract({ fileId: 'docx', endUserId: null }),
    'CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED',
  )
  assert.equal(mammothCalls, 0)

  const oversizedDeclaration = harness({
    ...docx,
    buffer: makeDocxArchive([
      { name: 'word/document.xml', content: Buffer.from('doc') },
      { name: 'word/media/blob.bin', content: Buffer.from('x'), declaredUncompressedSize: 64 * 1024 * 1024 },
    ]),
    runtime: { extractDocxRawText: async () => { mammothCalls += 1; return { value: RELIABLE } } },
  })
  await expectCode(
    () => oversizedDeclaration.service.extract({ fileId: 'docx', endUserId: null }),
    'CONTRACT_DOCX_ARCHIVE_SIZE_LIMIT_EXCEEDED',
  )
  assert.equal(mammothCalls, 0)

  const zip64Extra = Buffer.from([0x01, 0x00, 0x00, 0x00])
  const invalidArchives = [
    makeDocxArchive([{ name: 'x/../word/document.xml' }]),
    makeDocxArchive([{ name: 'word/document.xml', centralExtra: zip64Extra }]),
    makeDocxArchive([{ name: 'word/document.xml', method: 99 }]),
    makeDocxArchive([{ name: 'word/document.xml', flags: 0x0001 }]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      { name: 'word/document.xml' },
    ]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      { name: 'WORD/DOCUMENT.XML' },
    ]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      { name: 'invalid', filenameBytes: Buffer.from([0xff]), flags: 0x0800 },
    ]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      { name: 'word/样式.xml' },
    ]),
  ]
  for (const buffer of invalidArchives) {
    const invalid = harness({
      ...docx,
      buffer,
      runtime: { extractDocxRawText: async () => { mammothCalls += 1; return { value: RELIABLE } } },
    })
    await expectCode(
      () => invalid.service.extract({ fileId: 'docx', endUserId: null }),
      'CONTRACT_DOCX_ARCHIVE_INVALID',
    )
  }
  assert.equal(mammothCalls, 0)

  const compressedBomb = await makeDeflateBomb(64 * 1024 * 1024 + 1)
  const actualSizeBomb = harness({
    ...docx,
    buffer: makeDocxArchive([
      { name: 'word/document.xml', content: Buffer.from('doc'), method: 8 },
      {
        name: 'word/media/blob.bin',
        method: 8,
        compressedData: compressedBomb,
        declaredUncompressedSize: 1,
      },
    ]),
    runtime: { extractDocxRawText: async () => { mammothCalls += 1; return { value: RELIABLE } } },
  })
  await expectCode(
    () => actualSizeBomb.service.extract({ fileId: 'docx', endUserId: null }),
    'CONTRACT_DOCX_ARCHIVE_SIZE_LIMIT_EXCEEDED',
  )
  assert.equal(mammothCalls, 0)

  const oversizedOutput = harness({
    ...docx,
    buffer: makeDocxArchive(),
    runtime: { extractDocxRawText: async () => ({ value: '甲'.repeat(200_001) }) },
  })
  await expectCode(
    () => oversizedOutput.service.extract({ fileId: 'docx', endUserId: null }),
    'CONTRACT_PAGE_TEXT_LIMIT_EXCEEDED',
  )
})

test('rejects invalid PDF page counts before text extraction and destroys the proxy', async () => {
  for (const pageCount of [0, -1, Number.NaN, 1.5, 51]) {
    let extractCalls = 0
    let destroyCalls = 0
    const h = harness({ runtime: {
      getDocumentProxy: async () => ({
        numPages: pageCount,
        destroy: async () => { destroyCalls += 1 },
      }),
      extractPdfText: async () => { extractCalls += 1; return { totalPages: 1, text: [RELIABLE] } },
    } })
    await expectCode(
      () => h.service.extract({ fileId: 'pdf', endUserId: null }),
      pageCount === 51 ? 'CONTRACT_PAGE_LIMIT_EXCEEDED' : 'CONTRACT_PDF_INVALID',
    )
    assert.equal(extractCalls, 0)
    assert.equal(destroyCalls, 1)
  }
})

test('accepts a 50-page text PDF and reports every page only after completion', async () => {
  const pages = Array.from({ length: 50 }, (_, index) => `${index + 1}:${RELIABLE}`)
  const h = harness({ runtime: {
    getDocumentProxy: async () => ({ numPages: 50, destroy: async () => { h.calls.proxyDestroy += 1 } }),
    extractPdfText: async () => ({ totalPages: 50, text: pages }),
  } })
  const progress: number[] = []
  const result = await h.service.extract({
    fileId: 'pdf', endUserId: null,
    onPageComplete: async (completed) => { progress.push(completed) },
  })
  assert.equal(result.totalPages, 50)
  assert.deepEqual(progress, Array.from({ length: 50 }, (_, index) => index + 1))
})

test('PDF proxy parse/extract failures are safe and proxy cleanup preserves the original error', async () => {
  const parse = harness({ runtime: { getDocumentProxy: async () => { throw new Error('parser internals') } } })
  await expectCode(() => parse.service.extract({ fileId: 'pdf', endUserId: null }), 'CONTRACT_PDF_EXTRACTION_FAILED')

  let destroyed = 0
  const extract = harness({ runtime: {
    getDocumentProxy: async () => ({
      numPages: 1,
      destroy: async () => { destroyed += 1; throw new Error('cleanup') },
    }),
    extractPdfText: async () => { throw new Error('sensitive parser detail') },
  } })
  await expectCode(() => extract.service.extract({ fileId: 'pdf', endUserId: null }), 'CONTRACT_PDF_EXTRACTION_FAILED')
  assert.equal(destroyed, 1)

  const cleanup = harness({ runtime: {
    getDocumentProxy: async () => ({
      numPages: 1,
      destroy: async () => { throw new Error('cleanup details') },
    }),
  } })
  await expectCode(() => cleanup.service.extract({ fileId: 'pdf', endUserId: null }), 'CONTRACT_PDF_RESOURCE_CLEANUP_FAILED')
})

test('rejects PDF extraction page-count and page-array mismatches', async () => {
  for (const extracted of [
    { totalPages: 2, text: [RELIABLE] },
    { totalPages: 1, text: [RELIABLE, RELIABLE] },
    { totalPages: 1, text: RELIABLE },
  ]) {
    const h = harness({ runtime: { extractPdfText: async () => extracted } })
    await expectCode(() => h.service.extract({ fileId: 'pdf', endUserId: null }), 'CONTRACT_PDF_INTEGRITY_FAILED')
    assert.equal(h.calls.proxyDestroy, 1)
  }
})

test('rejects sparse PDF page arrays even when length matches the declared page count', async () => {
  const sparse = new Array<string>(1)
  const h = harness({ runtime: { extractPdfText: async () => ({ totalPages: 1, text: sparse }) } })
  await expectCode(
    () => h.service.extract({ fileId: 'pdf', endUserId: null }),
    'CONTRACT_PDF_INTEGRITY_FAILED',
  )
  assert.equal(h.calls.proxyDestroy, 1)
})

test('PDF canonical output budgets reject oversized pages and documents', async () => {
  const oversizedPage = harness({ runtime: {
    extractPdfText: async () => ({ totalPages: 1, text: ['甲'.repeat(200_001)] }),
  } })
  await expectCode(
    () => oversizedPage.service.extract({ fileId: 'pdf', endUserId: null }),
    'CONTRACT_PAGE_TEXT_LIMIT_EXCEEDED',
  )

  const pages = Array.from({ length: 11 }, () => '甲'.repeat(200_000))
  const oversizedDocument = harness({ runtime: {
    getDocumentProxy: async () => ({ numPages: 11, destroy: async () => undefined }),
    extractPdfText: async () => ({ totalPages: 11, text: pages }),
  } })
  await expectCode(
    () => oversizedDocument.service.extract({ fileId: 'pdf', endUserId: null }),
    'CONTRACT_DOCUMENT_TEXT_LIMIT_EXCEEDED',
  )
})

test('pure scan accepts 20 pages and rejects 21 before opening renderer or calling OCR', async () => {
  const scanPages = (count: number) => Array.from({ length: count }, () => '')
  const renderCalls: number[] = []
  const progress: number[] = []
  const twenty = harness({ runtime: {
    getDocumentProxy: async () => ({ numPages: 20, destroy: async () => undefined }),
    extractPdfText: async () => ({ totalPages: 20, text: scanPages(20) }),
    openPdfForRender: async () => ({
      totalPages: 20,
      renderPage: async (page: number) => {
        renderCalls.push(page)
        return Buffer.from(`page-${page}`)
      },
      destroy: async () => undefined,
    }),
  } })
  const result = await twenty.service.extract({
    fileId: 'pdf',
    endUserId: null,
    onPageComplete: async (completed) => { progress.push(completed) },
  })
  assert.equal(result.mode, 'ocr')
  assert.equal(result.pages.length, 20)
  assert.deepEqual(renderCalls, Array.from({ length: 20 }, (_, index) => index + 1))
  assert.equal(twenty.calls.ocr, 20)
  assert.deepEqual(progress, Array.from({ length: 20 }, (_, index) => index + 1))

  let rendererCalls = 0
  const twentyOne = harness({ runtime: {
    getDocumentProxy: async () => ({ numPages: 21, destroy: async () => undefined }),
    extractPdfText: async () => ({ totalPages: 21, text: scanPages(21) }),
    openPdfForRender: async () => { rendererCalls += 1; throw new Error('must not open') },
  } })
  await expectCode(() => twentyOne.service.extract({ fileId: 'pdf', endUserId: null }), 'CONTRACT_OCR_PAGE_LIMIT_EXCEEDED')
  assert.equal(rendererCalls, 0)
  assert.equal(twentyOne.calls.ocr, 0)
})

test('mixed 50-page PDF OCRs only missing pages in original order and keeps worst confidence', async () => {
  const text = Array.from({ length: 50 }, (_, index) => index === 1 || index === 48 ? '' : `${index}:${RELIABLE}`)
  const confidences = ['medium', 'low'] as const
  const h = harness({
    ocr: async () => ({ ok: true, text: `OCR-${h.calls.ocr}`, confidence: confidences[h.calls.ocr - 1] }),
    runtime: {
      getDocumentProxy: async () => ({ numPages: 50, destroy: async () => { h.calls.events.push('proxy.destroy') } }),
      extractPdfText: async () => ({ totalPages: 50, text }),
      openPdfForRender: async () => ({
        totalPages: 50,
        renderPage: async (page) => { h.calls.renders.push(page); return Buffer.from(String(page)) },
        destroy: async () => { h.calls.rendererDestroy += 1 },
      }),
    },
  })
  const progress: number[] = []
  const result = await h.service.extract({
    fileId: 'pdf', endUserId: null,
    onPageComplete: async (completed) => { progress.push(completed) },
  })
  assert.equal(result.mode, 'mixed')
  assert.equal(result.ocrConfidence, 'low')
  assert.deepEqual(h.calls.renders, [2, 49])
  assert.deepEqual(result.pages.map((page) => page.pageNumber), Array.from({ length: 50 }, (_, index) => index + 1))
  assert.deepEqual(progress, Array.from({ length: 50 }, (_, index) => index + 1))
})

test('mixed PDF with 21 OCR pages rejects before renderer', async () => {
  let rendererCalls = 0
  const text = Array.from({ length: 50 }, (_, index) => index < 21 ? '' : RELIABLE)
  const h = harness({ runtime: {
    getDocumentProxy: async () => ({ numPages: 50, destroy: async () => undefined }),
    extractPdfText: async () => ({ totalPages: 50, text }),
    openPdfForRender: async () => { rendererCalls += 1; throw new Error('must not open') },
  } })
  await expectCode(() => h.service.extract({ fileId: 'pdf', endUserId: null }), 'CONTRACT_OCR_PAGE_LIMIT_EXCEEDED')
  assert.equal(rendererCalls, 0)
  assert.equal(h.calls.ocr, 0)
})

test('destroys proxy before opening renderer and validates renderer page count', async () => {
  const order: string[] = []
  const h = harness({ runtime: {
    getDocumentProxy: async () => ({
      numPages: 1,
      destroy: async () => {
        order.push('proxy.destroy.start')
        await Promise.resolve()
        order.push('proxy.destroy.complete')
      },
    }),
    extractPdfText: async () => ({ totalPages: 1, text: [''] }),
    openPdfForRender: async () => {
      order.push('renderer.open')
      return h.renderer
    },
  } })
  await h.service.extract({ fileId: 'pdf', endUserId: null })
  assert.deepEqual(order, ['proxy.destroy.start', 'proxy.destroy.complete', 'renderer.open'])

  const mismatch = harness({ runtime: {
    extractPdfText: async () => ({ totalPages: 1, text: [''] }),
    openPdfForRender: async () => ({ totalPages: 2, renderPage: async () => IMAGE, destroy: async () => undefined }),
  } })
  await expectCode(() => mismatch.service.extract({ fileId: 'pdf', endUserId: null }), 'CONTRACT_PDF_INTEGRITY_FAILED')
})

test('OCR disabled/failure/empty, render and progress failures reject the whole document and clean renderer', async () => {
  const variants: Array<[HarnessOptions, string]> = [
    [{ activeProviderName: 'disabled' }, 'OCR_NOT_CONFIGURED'],
    [{ ocr: async () => ({ ok: false, errorCode: 'OCR_FAILED', errorMessage: 'provider secret' }) }, 'OCR_FAILED'],
    [{ ocr: async () => ({ ok: true, text: ' \r\n', confidence: 'high' }) }, 'CONTRACT_TEXT_EMPTY'],
    [{ runtime: { openPdfForRender: async () => ({
      totalPages: 1, renderPage: async () => { throw new Error('render internals') },
      destroy: async () => undefined,
    }) } }, 'OCR_FAILED'],
  ]
  for (const [options, code] of variants) {
    const h = harness({ ...options, runtime: {
      extractPdfText: async () => ({ totalPages: 1, text: [''] }),
      ...options.runtime,
    } })
    await expectCode(() => h.service.extract({ fileId: 'pdf', endUserId: null }), code)
  }

  const progress = harness({ runtime: { extractPdfText: async () => ({ totalPages: 1, text: [''] }) } })
  await expectCode(() => progress.service.extract({
    fileId: 'pdf', endUserId: null,
    onPageComplete: async () => { throw new Error('db details') },
  }), 'CONTRACT_PROGRESS_UPDATE_FAILED')
  assert.equal(progress.calls.rendererDestroy, 1)
})

test('renderer destroy failure does not mask an OCR failure', async () => {
  const h = harness({
    ocr: async () => ({ ok: false, errorCode: 'OCR_FAILED', errorMessage: 'private provider response' }),
    runtime: {
      extractPdfText: async () => ({ totalPages: 1, text: [''] }),
      openPdfForRender: async () => ({
        totalPages: 1,
        renderPage: async () => IMAGE,
        destroy: async () => { throw new Error('destroy failed') },
      }),
    },
  })
  await expectCode(() => h.service.extract({ fileId: 'pdf', endUserId: null }), 'OCR_FAILED')

  const cleanupProgress: number[] = []
  const cleanup = harness({ runtime: {
    extractPdfText: async () => ({ totalPages: 1, text: [''] }),
    openPdfForRender: async () => ({
      totalPages: 1,
      renderPage: async () => IMAGE,
      destroy: async () => { throw new Error('destroy failed') },
    }),
  } })
  await expectCode(() => cleanup.service.extract({
    fileId: 'pdf',
    endUserId: null,
    onPageComplete: async (completed) => { cleanupProgress.push(completed) },
  }), 'CONTRACT_PDF_RESOURCE_CLEANUP_FAILED')
  assert.deepEqual(cleanupProgress, [], '100% must not be reported before renderer cleanup succeeds')
})

test('extracts a supported image as one OCR page and rejects MIME/extension mismatch', async () => {
  const image = harness({ buffer: IMAGE, filename: 'contract.PNG', mimeType: 'image/png' })
  const progress: Array<[number, number]> = []
  const result = await image.service.extract({
    fileId: 'image', endUserId: 'member-1',
    onPageComplete: async (done, total) => { progress.push([done, total]) },
  })
  assert.equal(result.mode, 'ocr')
  assert.equal(result.totalPages, 1)
  assert.equal(result.ocrConfidence, 'high')
  assert.deepEqual(progress, [[1, 1]])

  const mismatch = harness({ buffer: IMAGE, filename: 'contract.jpg', mimeType: 'image/png' })
  await expectCode(() => mismatch.service.extract({ fileId: 'image', endUserId: null }), 'CONTRACT_UNSUPPORTED_FILE_TYPE')
})

test('extracts WebP and enforces the OCR canonical page budget', async () => {
  const webp = harness({ buffer: IMAGE, filename: 'contract.webp', mimeType: 'image/webp' })
  const result = await webp.service.extract({ fileId: 'webp', endUserId: null })
  assert.equal(result.mode, 'ocr')
  assert.equal(result.pages[0]?.text, '识别合同正文')

  const oversized = harness({
    buffer: IMAGE,
    filename: 'contract.webp',
    mimeType: 'image/webp',
    ocr: async () => ({ ok: true, text: '甲'.repeat(200_001), confidence: 'high' }),
  })
  await expectCode(
    () => oversized.service.extract({ fileId: 'webp', endUserId: null }),
    'CONTRACT_PAGE_TEXT_LIMIT_EXCEEDED',
  )
})
