import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import type { ConvertImageSource, ConvertImagesResponse } from './print-conversion.types'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { signFileUrl, verifyFileSignature } from '../files/signing'
import { countPdfPages } from '../files/file-page-count.util'
import { readImageDimensions } from './image-dimensions.util'

const MAX_IMAGES = 20
const MAX_SINGLE_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_INPUT_BYTES = 40 * 1024 * 1024
const MAX_SINGLE_IMAGE_PIXELS = 25_000_000
const MAX_TOTAL_PIXELS = 200_000_000
const PROXY_MAX_OUTPUT_BYTES = 15 * 1024 * 1024
const OUTPUT_URL_TTL_MS = 30 * 60 * 1000
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png'])

const PAGE_WIDTH_PT = 595.28 // A4
const PAGE_HEIGHT_PT = 841.89

interface ValidatedSource {
  buffer: Buffer
}

@Injectable()
export class PrintConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  async convertImagesToPdf(args: {
    sources: ConvertImageSource[]
    endUserId: string | null
  }): Promise<ConvertImagesResponse> {
    const { sources, endUserId } = args

    if (sources.length < 1) {
      throw new BadRequestException({ error: { code: 'CONVERT_INPUT_INVALID', message: '请至少选择一张图片' } })
    }
    if (sources.length > MAX_IMAGES) {
      throw new BadRequestException({ error: { code: 'CONVERT_TOO_MANY_IMAGES', message: `最多支持 ${MAX_IMAGES} 张图片` } })
    }
    const uniqueIds = new Set(sources.map((s) => s.fileId))
    if (uniqueIds.size !== sources.length) {
      throw new BadRequestException({ error: { code: 'CONVERT_INPUT_INVALID', message: '图片列表存在重复项' } })
    }

    const validated: ValidatedSource[] = []
    let totalBytes = 0
    let totalPixels = 0

    // 顺序逐个校验 + 读取（禁止 Promise.all，避免瞬时内存峰值）。
    for (const source of sources) {
      const found = await this.prisma.fileObject.findUnique({ where: { id: source.fileId } })
      const notFound = () =>
        new NotFoundException({ error: { code: 'CONVERT_SOURCE_NOT_FOUND', message: '部分图片不存在或已失效' } })

      if (!found) throw notFound()

      const record = found
      const now = new Date()
      const baseOk =
        record.status === 'active' &&
        record.deletedAt === null &&
        (record.expiresAt === null || record.expiresAt > now) &&
        record.purpose === 'print_doc'
      if (!baseOk) throw notFound()

      const ownerOk = endUserId
        ? record.endUserId === endUserId && record.ownerType === 'user' && record.ownerId === endUserId
        : record.endUserId === null && record.ownerType === 'system' && record.ownerId === null
      if (!ownerOk) throw notFound()

      // 隐含前提（跨模块，非本文件可独立验证）：purpose='print_doc' 的 FileObject
      // 目前只经由 kiosk-upload / upload-sessions 的 confirm(print_doc) 创建，
      // 因而其对应的 fileAccessUrl 一定是本模块 signFileUrl() 签发的内部 HMAC 格式
      // （/files/:id/content?expires=&sig=），parseFileAccessUrl + verifyFileSignature
      // 才能校验通过。若未来出现第三条 print_doc 创建路径且不签发同格式 URL，
      // 游客侧转换会在此处开始诡异地 404（CONVERT_SOURCE_NOT_FOUND），且报错本身
      // 不会指出原因——新增创建路径时必须同步核实这个前提仍然成立。
      if (endUserId === null) {
        const capability = parseFileAccessUrl(source.fileAccessUrl)
        const capabilityOk =
          capability !== null &&
          capability.fileId === source.fileId &&
          verifyFileSignature(capability.fileId, capability.expires, capability.sig)
        if (!capabilityOk) throw notFound()
      }

      if (!ALLOWED_MIME_TYPES.has(record.mimeType)) {
        throw new BadRequestException({ error: { code: 'CONVERT_SOURCE_TYPE_UNSUPPORTED', message: '仅支持 JPG / PNG 图片' } })
      }
      if (record.sizeBytes > MAX_SINGLE_IMAGE_BYTES) {
        throw new BadRequestException({ error: { code: 'CONVERT_SOURCE_TOO_LARGE', message: '单张图片大小超出限制（10MB）' } })
      }
      totalBytes += record.sizeBytes
      if (totalBytes > MAX_TOTAL_INPUT_BYTES) {
        throw new BadRequestException({ error: { code: 'CONVERT_TOTAL_LIMIT_EXCEEDED', message: '图片总大小超出限制（40MB）' } })
      }

      const buffer = await this.storage.getObject(record.storageKey, record.bucket)

      const dims = readImageDimensions(buffer, record.mimeType)
      if (!dims) {
        throw new BadRequestException({ error: { code: 'CONVERT_IMAGE_DIMENSIONS_INVALID', message: '图片文件已损坏或格式不匹配' } })
      }
      const pixels = dims.width * dims.height
      if (pixels > MAX_SINGLE_IMAGE_PIXELS) {
        throw new BadRequestException({ error: { code: 'CONVERT_IMAGE_DIMENSIONS_INVALID', message: '单张图片像素超出限制' } })
      }
      totalPixels += pixels
      if (totalPixels > MAX_TOTAL_PIXELS) {
        throw new BadRequestException({ error: { code: 'CONVERT_TOTAL_LIMIT_EXCEEDED', message: '图片总像素超出限制' } })
      }

      validated.push({ buffer })
    }

    const outputBuffer = await this.mergeImagesToPdf(validated)

    const pageCount = countPdfPages(outputBuffer)
    if (pageCount !== validated.length) {
      throw new InternalServerErrorException({ error: { code: 'CONVERT_FAILED', message: 'PDF 生成校验失败，请重试' } })
    }
    if (outputBuffer.length > PROXY_MAX_OUTPUT_BYTES) {
      throw new BadRequestException({ error: { code: 'CONVERT_OUTPUT_TOO_LARGE', message: '生成的 PDF 超出大小限制，请减少图片数量' } })
    }

    const uploaded = await this.files.upload({
      buffer: outputBuffer,
      filename: `format-convert-${Date.now()}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: endUserId ?? undefined,
      assetCategory: 'derived',
      sourceFileId: null,
      createdBy: endUserId,
    })

    const printSigned = signFileUrl(uploaded.fileId, OUTPUT_URL_TTL_MS)

    await this.audit.write({
      actorId: endUserId,
      actorRole: endUserId ? 'member' : 'system',
      action: 'print_conversion.images_to_pdf',
      targetType: 'file',
      targetId: uploaded.fileId,
      payload: { sourceCount: sources.length, sourceFileIds: sources.map((s) => s.fileId) },
    })

    return {
      fileId: uploaded.fileId,
      printFileUrl: printSigned.url,
      fileMd5: uploaded.sha256,
      sizeBytes: uploaded.sizeBytes,
      pages: pageCount,
    }
  }

  private async mergeImagesToPdf(items: ValidatedSource[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ autoFirstPage: false })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', (err: Error) => reject(err))
      for (const item of items) {
        doc.addPage({ size: 'A4' })
        doc.image(item.buffer, 0, 0, { fit: [PAGE_WIDTH_PT, PAGE_HEIGHT_PT], align: 'center', valign: 'center' })
      }
      doc.end()
    })
  }
}

function parseFileAccessUrl(url: string): { fileId: string; expires: string; sig: string } | null {
  try {
    const parsed = new URL(url, 'http://internal.local')
    const match = parsed.pathname.match(/\/files\/([^/]+)\/content$/)
    const expires = parsed.searchParams.get('expires')
    const sig = parsed.searchParams.get('sig')
    if (!match || !expires || !sig) return null
    return { fileId: match[1]!, expires, sig }
  } catch {
    return null
  }
}
