import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { PDFDocument } from 'pdf-lib'
import { withBootTimeout } from '../common/boot/boot-readiness'
import { FilesService } from '../files/files.service'
import type { FilePurpose, FileSensitiveLevel } from '../files/file.types'
import { signFileUrl } from '../files/signing'
import { PrismaService } from '../prisma/prisma.service'
import { ConcurrencyLimiter } from './concurrency-limiter'
import { setWordToPdfUploadAvailable } from './document-conversion-capability-state'
import {
  ConversionTimeoutError,
  DOCUMENT_CONVERSION_ADAPTER,
  DOCUMENT_CONVERSION_FONT_PROBE,
  WORD_MIME_TYPES,
  type ConversionEngineAdapter,
  type ConversionRequester,
  type DocumentConversionCapabilities,
  type StoredConversionResult,
} from './document-conversion.types'

const execFileAsync = promisify(execFile)
const PDF_MIME = 'application/pdf' as const
const TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 15 * 1024 * 1024
const CONVERSION_WARNING = '由转换引擎生成，复杂版式可能有偏差，请预览核对'

export interface DocumentConversionRuntimeOptions {
  concurrency?: number
  timeoutMs?: number
  maxOutputBytes?: number
}

/** 启动期探测上限：引擎 / 字体探测超过此时限按不可用处理，不阻塞 API 启动。 */
const PROBE_TIMEOUT_MS = 8_000

@Injectable()
export class DocumentConversionService implements OnModuleInit {
  private readonly logger = new Logger(DocumentConversionService.name)
  private readonly limiter: ConcurrencyLimiter
  private capabilities: DocumentConversionCapabilities = {
    wordToPdf: false,
    engine: 'none',
    reason: '服务端未配置转换引擎',
    cjkFonts: false,
  }

  constructor(
    private readonly files: FilesService,
    private readonly prisma: PrismaService,
    @Optional() @Inject(DOCUMENT_CONVERSION_ADAPTER)
    private readonly adapter: ConversionEngineAdapter | null,
    @Optional() @Inject(DOCUMENT_CONVERSION_FONT_PROBE)
    private readonly fontProbe: (() => Promise<boolean>) | null,
    @Optional() private readonly runtimeOptions?: DocumentConversionRuntimeOptions,
  ) {
    this.limiter = new ConcurrencyLimiter(
      this.runtimeOptions?.concurrency ?? parseConcurrency(process.env['CONVERSION_MAX_CONCURRENCY']),
    )
  }

  async onModuleInit(): Promise<void> {
    // 启动期探测必须有界（verify:boot-resilience）：字体 / 引擎探测挂住不能拖住整个 API 启动，超时按「不可用」处理。
    const cjkFonts = await withBootTimeout(() => (this.fontProbe ?? probeCjkFonts)(), {
      subsystem: 'document-conversion',
      operation: 'probe-cjk-fonts',
      timeoutMs: PROBE_TIMEOUT_MS,
    }).catch(() => false)
    if (!this.adapter) {
      this.capabilities = {
        wordToPdf: false,
        engine: 'none',
        reason: '服务端未配置转换引擎',
        cjkFonts,
      }
      setWordToPdfUploadAvailable(false)
      this.logger.warn('document conversion disabled: no configured engine')
      return
    }

    const probe = await withBootTimeout(() => this.adapter!.probe(), {
      subsystem: 'document-conversion',
      operation: 'probe-engine',
      timeoutMs: PROBE_TIMEOUT_MS,
    }).catch(() => ({
      available: false,
      reason: '服务端转换引擎探测失败',
    }))
    const wordToPdf = probe.available && cjkFonts
    this.capabilities = {
      wordToPdf,
      engine: this.adapter.engine,
      ...(!wordToPdf
        ? { reason: probe.available ? '服务端未安装可用中文字体' : (probe.reason ?? '服务端转换引擎探测失败') }
        : {}),
      cjkFonts,
    }
    setWordToPdfUploadAvailable(wordToPdf)
    this.logger.log(
      `document conversion probe engine=${this.adapter.engine} wordToPdf=${wordToPdf} cjkFonts=${cjkFonts}`,
    )
  }

  getCapabilities(): DocumentConversionCapabilities {
    return { ...this.capabilities }
  }

  async convertOwnedFile(fileId: string, requester: ConversionRequester): Promise<StoredConversionResult> {
    await this.files.getAccessUrl(fileId, requester, 'inline')
    return this.convertStoredFile(fileId)
  }

  async convertForPrint(fileId: string): Promise<StoredConversionResult> {
    return this.convertStoredFile(fileId)
  }

  async convertBufferToPdf(
    buffer: Buffer,
    filename: string,
  ): Promise<{ buffer: Buffer; pageCount: number; engine: 'soffice' | 'gotenberg'; warnings: string[] }> {
    this.assertAvailable()
    const adapter = this.adapter!
    return this.limiter.run(async () => {
      const dir = await mkdtemp(join(tmpdir(), 'document-conversion-'))
      const inputPath = join(dir, `source${safeWordExtension(filename)}`)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.runtimeOptions?.timeoutMs ?? TIMEOUT_MS)
      try {
        await writeFile(inputPath, buffer, { mode: 0o600 })
        let outputPath: string
        try {
          outputPath = await adapter.convert(inputPath, dir, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) throw new ConversionTimeoutError()
          throw error
        }
        const pdf = await readFile(outputPath)
        const maxOutputBytes = this.runtimeOptions?.maxOutputBytes ?? MAX_OUTPUT_BYTES
        if (pdf.length <= 0 || pdf.length > maxOutputBytes) {
          throw new Error(pdf.length > maxOutputBytes ? 'CONVERSION_OUTPUT_TOO_LARGE' : 'CONVERSION_OUTPUT_EMPTY')
        }
        const parsed = await PDFDocument.load(pdf, { ignoreEncryption: false })
        const pageCount = parsed.getPageCount()
        if (pageCount < 1) throw new Error('CONVERSION_OUTPUT_NO_PAGES')
        return { buffer: pdf, pageCount, engine: adapter.engine, warnings: [CONVERSION_WARNING] }
      } finally {
        clearTimeout(timer)
        await rm(dir, { recursive: true, force: true })
      }
    })
  }

  private async convertStoredFile(fileId: string): Promise<StoredConversionResult> {
    const source = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        purpose: true,
        sensitiveLevel: true,
        uploaderId: true,
        endUserId: true,
        ownerType: true,
        ownerId: true,
        status: true,
        deletedAt: true,
        expiresAt: true,
      },
    })
    if (!source || source.status !== 'active' || source.deletedAt || (source.expiresAt && source.expiresAt <= new Date())) {
      throw new BadRequestException({ error: { code: 'UNSUPPORTED_FILE_TYPE', message: '文件不可转换或已失效' } })
    }
    if (!WORD_MIME_TYPES.includes(source.mimeType as (typeof WORD_MIME_TYPES)[number])) {
      throw new BadRequestException({ error: { code: 'UNSUPPORTED_FILE_TYPE', message: '仅支持 Word 文档转换为 PDF' } })
    }
    this.assertAvailable()

    const content = await this.files.readContent(fileId)
    let converted: Awaited<ReturnType<DocumentConversionService['convertBufferToPdf']>>
    try {
      converted = await this.convertBufferToPdf(content.buffer, source.filename)
    } catch (error) {
      throw this.toHttpError(error)
    }
    const filename = replaceWordExtension(source.filename)
    const role = source.ownerType === 'admin' || source.ownerType === 'partner' ? source.ownerType : null
    const uploaded = await this.files.upload({
      buffer: converted.buffer,
      filename,
      mimeType: PDF_MIME,
      purpose: source.purpose as FilePurpose,
      sensitiveLevel: source.sensitiveLevel as FileSensitiveLevel,
      uploaderId: source.uploaderId,
      endUserId: source.endUserId,
      assetCategory: 'derived',
      sourceFileId: source.id,
      actorRole: role,
      actorOrgId: role === 'partner' ? source.ownerId : null,
      createdBy: 'document_conversion',
      validationMode: 'intent',
    })
    return {
      fileId: uploaded.fileId,
      filename,
      mimeType: PDF_MIME,
      sizeBytes: uploaded.sizeBytes,
      pageCount: converted.pageCount,
      signedUrl: uploaded.signedUrl,
      expiresAt: uploaded.signedUrlExpiresAt,
      printFileUrl: signFileUrl(uploaded.fileId).url,
      engine: converted.engine,
      warnings: converted.warnings,
      sha256: uploaded.sha256,
    }
  }

  private assertAvailable(): void {
    if (!this.capabilities.wordToPdf || !this.adapter) {
      throw new ServiceUnavailableException({
        error: {
          code: 'CONVERSION_UNAVAILABLE',
          message: this.capabilities.reason ?? '服务端未配置转换引擎',
        },
      })
    }
  }

  private toHttpError(error: unknown): HttpException {
    if (error instanceof HttpException) return error
    if (error instanceof ConversionTimeoutError) {
      return new HttpException(
        { error: { code: 'CONVERSION_TIMEOUT', message: '文档转换超时，请稍后重试' } },
        HttpStatus.GATEWAY_TIMEOUT,
      )
    }
    this.logger.warn(`document conversion failed: ${error instanceof Error ? error.name : typeof error}`)
    return new HttpException(
      { error: { code: 'CONVERSION_FAILED', message: '文档转换失败，请检查文件后重试' } },
      HttpStatus.INTERNAL_SERVER_ERROR,
    )
  }
}

function parseConcurrency(raw: string | undefined): number {
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= 8 ? value : 2
}

function safeWordExtension(filename: string): '.doc' | '.docx' {
  return extname(filename).toLowerCase() === '.doc' ? '.doc' : '.docx'
}

function replaceWordExtension(filename: string): string {
  const base = filename.replace(/\.(docx?|DOCX?)$/u, '').trim() || 'document'
  return `${base}.pdf`
}

export async function probeCjkFonts(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('fc-list', [':lang=zh', 'family'], { timeout: 5_000, maxBuffer: 512 * 1024 })
    if (stdout.trim()) return true
  } catch {
    // macOS 通常没有 fc-list，继续探测系统已知字体路径。
  }
  const knownPaths = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf',
    '/System/Library/Fonts/PingFang.ttc',
  ]
  for (const path of knownPaths) {
    try {
      await access(path)
      return true
    } catch {
      // 尝试下一个已知路径。
    }
  }
  return false
}
