import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { PDFDocument } from 'pdf-lib'
import { DocumentConversionService } from '../src/document-conversion/document-conversion.service'
import { DocumentConversionController } from '../src/document-conversion/document-conversion.controller'
import { setWordToPdfUploadAvailable } from '../src/document-conversion/document-conversion-capability-state'
import { validateUpload } from '../src/files/file-validation'
import type { ConversionEngineAdapter } from '../src/document-conversion/document-conversion.types'
import { ResumeExtractionService } from '../src/ai/resume/resume-extraction.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { signFileUrl } from '../src/files/signing'

const DOC_MIME = 'application/msword'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
process.env['FILE_SIGNING_SECRET'] ??= 'document-conversion-verify-secret-2026-09-06'
process.env['PAYMENT_SESSION_SECRET'] ??= 'document-conversion-payment-session-secret-2026-09-06'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

async function minimalPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([500, 700])
  page.drawText('Name Zhang San. Objective frontend engineer. Experience five years TypeScript React NestJS.', {
    x: 40,
    y: 640,
    size: 12,
  })
  return Buffer.from(await pdf.save())
}

class FakeAdapter implements ConversionEngineAdapter {
  readonly engine = 'soffice' as const
  active = 0
  maxActive = 0

  constructor(
    private readonly pdf: Buffer,
    private readonly delayMs = 0,
    private readonly fail = false,
  ) {}

  async probe(): Promise<{ available: boolean }> {
    return { available: true }
  }

  async convert(_inputPath: string, outputDir: string, signal: AbortSignal): Promise<string> {
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('ABORTED'))
        }, { once: true })
      })
      if (this.fail) throw new Error('FAKE_CONVERSION_FAILED')
      const output = join(outputDir, 'source.pdf')
      await writeFile(output, this.pdf)
      return output
    } finally {
      this.active -= 1
    }
  }
}

interface SourceRecord {
  id: string
  filename: string
  mimeType: string
  purpose: string
  sensitiveLevel: string
  uploaderId: string | null
  endUserId: string | null
  ownerType: string | null
  ownerId: string | null
  status: string
  deletedAt: Date | null
  expiresAt: Date | null
}

class FakeFiles {
  accessAllowed = true
  uploadedArgs: Record<string, unknown> | null = null

  constructor(private readonly source: SourceRecord, private readonly input: Buffer) {}

  async getAccessUrl(): Promise<unknown> {
    if (!this.accessAllowed) throw new BadRequestException('FILE_ACCESS_DENIED')
    return {}
  }

  async readContent(): Promise<{ buffer: Buffer; mimeType: string; filename: string; purpose: string }> {
    return { buffer: this.input, mimeType: this.source.mimeType, filename: this.source.filename, purpose: this.source.purpose }
  }

  async upload(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.uploadedArgs = args
    return {
      fileId: 'derived-pdf',
      filename: args.filename,
      sizeBytes: (args.buffer as Buffer).length,
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
      signedUrl: 'https://files.invalid/derived-pdf',
      signedUrlExpiresAt: '2099-01-01T12:00:00.000Z',
      fileExpiresAt: null,
    }
  }
}

function prismaFor(source: SourceRecord): object {
  return { fileObject: { findUnique: async () => source } }
}

function serviceWith(
  files: FakeFiles,
  source: SourceRecord,
  adapter: FakeAdapter | null,
  options: { concurrency?: number; timeoutMs?: number; maxOutputBytes?: number } = {},
  fontProbe: () => Promise<boolean> = async () => true,
): DocumentConversionService {
  return new DocumentConversionService(files as never, prismaFor(source) as never, adapter, fontProbe, options)
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('getResponse' in error)) return undefined
  const response = (error as { getResponse(): unknown }).getResponse()
  if (!response || typeof response !== 'object') return undefined
  return (response as { error?: { code?: string } }).error?.code
}

async function expectCode(work: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(work, (error) => errorCode(error) === code)
}

async function verifyRuntime(): Promise<void> {
  const pdf = await minimalPdf()
  const source: SourceRecord = {
    id: 'source-docx', filename: '我的简历.docx', mimeType: DOCX_MIME, purpose: 'print_doc',
    sensitiveLevel: 'normal', uploaderId: null, endUserId: 'member-1', ownerType: 'user', ownerId: 'member-1',
    status: 'active', deletedAt: null, expiresAt: null,
  }

  const disabledFiles = new FakeFiles(source, Buffer.from('docx'))
  const disabled = serviceWith(disabledFiles, source, null)
  await disabled.onModuleInit()
  assert.deepEqual(disabled.getCapabilities(), {
    wordToPdf: false, engine: 'none', reason: '服务端未配置转换引擎', cjkFonts: true,
  })
  await assert.rejects(() => disabled.convertOwnedFile(source.id, { kind: 'member', endUserId: 'member-1' }), ServiceUnavailableException)
  pass('capabilities disabled 时返回明确 reason，转换 fail-closed')

  const adapter = new FakeAdapter(pdf)
  const files = new FakeFiles(source, Buffer.from('docx'))
  const service = serviceWith(files, source, adapter)
  await service.onModuleInit()
  assert.deepEqual(service.getCapabilities(), { wordToPdf: true, engine: 'soffice', cjkFonts: true })
  const converted = await service.convertOwnedFile(source.id, { kind: 'member', endUserId: 'member-1' })
  assert.equal(converted.mimeType, 'application/pdf')
  assert.equal(converted.pageCount, 1)
  assert.equal(converted.engine, 'soffice')
  assert.match(converted.warnings.join('\n'), /复杂版式可能有偏差，请预览核对/u)
  assert.equal(files.uploadedArgs?.assetCategory, 'derived')
  assert.equal(files.uploadedArgs?.sourceFileId, source.id)
  assert.equal(files.uploadedArgs?.createdBy, 'document_conversion')
  assert.equal(files.uploadedArgs?.purpose, 'print_doc')
  pass('假引擎生成真实可解析 PDF，响应与派生 FileObject 契约完整')

  files.accessAllowed = false
  await assert.rejects(() => service.convertOwnedFile(source.id, { kind: 'member', endUserId: 'other' }))
  pass('转换端点先复用 files 归属校验，越权不进入转换')

  const unsupported = { ...source, mimeType: 'application/pdf', filename: 'resume.pdf' }
  const unsupportedService = serviceWith(new FakeFiles(unsupported, pdf), unsupported, new FakeAdapter(pdf))
  await unsupportedService.onModuleInit()
  await expectCode(() => unsupportedService.convertForPrint(unsupported.id), 'UNSUPPORTED_FILE_TYPE')
  pass('非 doc/docx 输入返回 UNSUPPORTED_FILE_TYPE')

  const timeoutService = serviceWith(new FakeFiles(source, Buffer.from('doc')), source, new FakeAdapter(pdf, 100), { timeoutMs: 10 })
  await timeoutService.onModuleInit()
  await expectCode(() => timeoutService.convertForPrint(source.id), 'CONVERSION_TIMEOUT')
  pass('超时映射为 CONVERSION_TIMEOUT')

  const failedService = serviceWith(new FakeFiles(source, Buffer.from('doc')), source, new FakeAdapter(pdf, 0, true))
  await failedService.onModuleInit()
  await expectCode(() => failedService.convertForPrint(source.id), 'CONVERSION_FAILED')
  pass('引擎失败映射为 CONVERSION_FAILED')

  const largeService = serviceWith(new FakeFiles(source, Buffer.from('doc')), source, new FakeAdapter(pdf), { maxOutputBytes: 16 })
  await largeService.onModuleInit()
  await expectCode(() => largeService.convertForPrint(source.id), 'CONVERSION_FAILED')
  pass('输出上限 fail-closed，不落超限 PDF')

  const concurrentAdapter = new FakeAdapter(pdf, 35)
  const concurrentService = serviceWith(new FakeFiles(source, Buffer.from('doc')), source, concurrentAdapter, { concurrency: 2 })
  await concurrentService.onModuleInit()
  await Promise.all(Array.from({ length: 5 }, () => concurrentService.convertBufferToPdf(Buffer.from('doc'), 'resume.doc')))
  assert.equal(concurrentAdapter.maxActive, 2)
  pass('并发上限 2 被真实排队执行')

  const resumeFiles = {
    readContentForEndUser: async () => ({
      buffer: Buffer.from('legacy-doc'),
      mimeType: DOC_MIME,
      filename: 'resume.doc',
      purpose: 'resume_upload',
    }),
  }
  const extraction = new ResumeExtractionService(
    resumeFiles as never,
    { activeProviderName: 'disabled' } as never,
    service,
  )
  const extracted = await extraction.extractResumeText({ fileId: 'legacy-doc', endUserId: null })
  assert.equal(extracted.ok, true)
  assert.equal(extracted.textSource, 'pdf_text')
  assert.match(extracted.text ?? '', /frontend engineer/u)
  pass('.doc 简历真实经过转换 PDF 后由 unpdf 抽取文字')

  setWordToPdfUploadAvailable(false)
  assert.equal(validateUpload({ purpose: 'print_doc', mimeType: DOC_MIME, filename: 'resume.doc', sizeBytes: 100, mode: 'intent' }).ok, false)
  setWordToPdfUploadAvailable(true)
  assert.equal(validateUpload({ purpose: 'print_doc', mimeType: DOC_MIME, filename: 'resume.doc', sizeBytes: 100, mode: 'intent' }).ok, true)
  assert.equal(validateUpload({ purpose: 'print_doc', mimeType: DOCX_MIME, filename: 'resume.docx', sizeBytes: 100, mode: 'intent' }).ok, true)
  setWordToPdfUploadAvailable(false)
  pass('print_doc 只在 capabilities 为真时接收 doc/docx')

  const controller = new DocumentConversionController(service, null as never, null as never, null as never, null as never)
  assert.equal(controller.capabilities().data.engine, 'soffice')
  pass('GET capabilities 控制器输出契约')

  const requestedFileId = 'word-source'
  const derivedFileId = 'word-derived-pdf'
  let printTaskData: Record<string, unknown> | null = null
  let pageCountUrl = ''
  const printPrisma = {
    fileObject: {
      findUnique: async ({ where }: { where: { id: string } }) => where.id === requestedFileId
        ? { purpose: 'print_doc', sha256: 'b'.repeat(64), mimeType: DOCX_MIME, filename: 'source.docx', assetCategory: 'original' }
        : null,
    },
    fairMaterialPrintBridge: { findFirst: async () => null },
    documentProcessTask: { findFirst: async () => null },
    piiFinding: { count: async () => 0 },
    terminal: {
      findFirst: async () => ({ id: 'terminal-1', enabled: true, lifecycleStatus: 'active' }),
    },
    $transaction: async (work: (tx: Record<string, unknown>) => Promise<unknown>) => work({
      terminal: { updateMany: async () => ({ count: 1 }) },
      printTask: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          printTaskData = data
          return { id: String(data.id), status: 'pending', createdAt: new Date('2000-01-01T12:00:00.000Z') }
        },
      },
      order: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'order-1', orderNo: data.orderNo, amountCents: data.amountCents,
        }),
      },
    }),
  }
  const printService = new PrintJobsService(
    printPrisma as never,
    { write: async () => undefined } as never,
    {
      resolveBillablePages: async (url: string) => {
        pageCountUrl = url
        return { billablePages: 1, billingPageSource: 'pdf' }
      },
    } as never,
    {
      quotePrint: async () => ({
        amountCents: 100,
        billablePages: 1,
        billingPageSource: 'pdf',
        lines: [{ serviceKey: 'print_bw_page', unitCents: 100, quantity: 1, subtotalCents: 100 }],
      }),
    } as never,
    { markPaid: async () => undefined } as never,
    { assertUserTaskAllowed: async () => undefined, assertPrintParamsAllowed: async () => undefined } as never,
    {
      convertForPrint: async () => ({
        fileId: derivedFileId,
        filename: 'source.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
        pageCount: 1,
        signedUrl: 'https://files.invalid/derived',
        expiresAt: '2099-01-01T12:30:00.000Z',
        printFileUrl: signFileUrl(derivedFileId).url,
        engine: 'soffice',
        warnings: [],
        sha256: 'c'.repeat(64),
      }),
    } as never,
  )
  await printService.create(
    {
      fileUrl: signFileUrl(requestedFileId).url,
      fileName: 'source.docx',
      params: {
        copies: 1, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4',
        orientation: 'auto', quality: 'standard', scale: 'fit', pagesPerSheet: 1,
      },
    },
    { terminalId: 'terminal-1' },
  )
  const persisted = printTaskData as Record<string, unknown> | null
  assert.ok(persisted)
  assert.equal(persisted.fileId, derivedFileId)
  assert.equal(persisted.fileMd5, 'c'.repeat(64))
  assert.match(String(persisted.fileUrl), new RegExp(`/files/${derivedFileId}/content`))
  assert.match(pageCountUrl, new RegExp(`/files/${derivedFileId}/content`))
  assert.match(String(persisted.paramsJson), /source\.pdf/u)
  pass('Word 打印建单的页数、fileId、签名 URL、哈希和文件名全部指向派生 PDF')
}

async function verifyStaticContractMutations(): Promise<void> {
  const serviceSource = await readFile('src/document-conversion/document-conversion.service.ts', 'utf8')
  const controllerSource = await readFile('src/document-conversion/document-conversion.controller.ts', 'utf8')
  const printSource = await readFile('src/print-jobs/print-jobs.service.ts', 'utf8')
  const validationSource = await readFile('src/files/file-validation.ts', 'utf8')

  const assertions: Array<{ name: string; source: string; needle: string }> = [
    { name: 'conversion route', source: controllerSource, needle: "@Post('files/:id/convert')" },
    { name: 'capabilities route', source: controllerSource, needle: "@Get('document-conversion/capabilities')" },
    { name: '60 second timeout', source: serviceSource, needle: 'const TIMEOUT_MS = 60_000' },
    { name: '15MB output cap', source: serviceSource, needle: 'const MAX_OUTPUT_BYTES = 15 * 1024 * 1024' },
    { name: 'derived lineage', source: serviceSource, needle: "createdBy: 'document_conversion'" },
    { name: 'print converts before task', source: printSource, needle: 'convertForPrint(requestedFileId)' },
    { name: 'print conditional upload', source: validationSource, needle: 'isWordToPdfUploadAvailable()' },
  ]
  for (const item of assertions) {
    assert.ok(item.source.includes(item.needle), `${item.name} missing`)
    const mutated = item.source.replace(item.needle, `MUTATED_${item.name}`)
    assert.notEqual(mutated, item.source, `${item.name} mutation did not alter source`)
    assert.equal(mutated.includes(item.needle), false, `${item.name} mutation was not detected`)
  }
  pass(`${assertions.length} 条静态契约断言逐条变异均转红`)
}

async function maybeVerifyRealSoffice(): Promise<void> {
  const soffice = process.env['SOFFICE_PATH']?.trim()
  if (!soffice) {
    console.log('  SKIPPED real soffice integration: SOFFICE_PATH 未设置，本机未验证真实转换')
    return
  }
  console.log(`  SKIPPED real soffice integration: 需部署机按清单使用真实 doc/docx fixture 执行 (${soffice})`)
}

async function main(): Promise<void> {
  console.log('\n=== 文档转换契约验证 ===')
  await verifyRuntime()
  await verifyStaticContractMutations()
  await maybeVerifyRealSoffice()
  console.log('\nDOCUMENT_CONVERSION_VERIFY_OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
