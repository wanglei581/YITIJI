import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import PDFDocument from 'pdfkit'
import { createHash } from 'crypto'
import type {
  ComposeSignatureOverlayResponse,
  ConvertImageSource,
  ConvertImagesResponse,
  OverlayPosition,
  OverlaySize,
  SignatureOverlaySignature,
  SignatureOverlayTarget,
} from './print-conversion.types'
import type { FilePurpose } from '../files/file.types'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { RedisService } from '../common/redis/redis.service'
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
const IDEMPOTENCY_LOCK_TTL_SECONDS = 120
const IDEMPOTENCY_RESULT_TTL_SECONDS = 600

const PAGE_WIDTH_PT = 595.28 // A4
const PAGE_HEIGHT_PT = 841.89

// ── 签名盖章 ──────────────────────────────────────────────────
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024
const MAX_SIGNATURE_PIXELS = 4_000_000
const ALLOWED_SIGNATURE_MIME_TYPES = new Set(['image/jpeg', 'image/png'])
/** 叠加大小预设：相对页面宽度的比例。 */
const OVERLAY_SIZE_RATIO: Record<OverlaySize, number> = { small: 0.15, medium: 0.25, large: 0.35 }
/** 页边安全边距（pt），避免签名紧贴纸张边缘。 */
const OVERLAY_MARGIN_PT = 24

interface ValidatedSource {
  buffer: Buffer
}

/** `print-conversion:idem:*` 缓存值的运行时校验后类型；解析失败或字段缺失一律当作"未命中缓存"处理。 */
interface IdempotencyState {
  status: 'in_progress' | 'completed'
  fingerprint: string
  fileId?: string
  fileMd5?: string
  sizeBytes?: number
  pages?: number
}

@Injectable()
export class PrintConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
  ) {}

  async convertImagesToPdf(args: {
    sources: ConvertImageSource[]
    endUserId: string | null
    idempotencyKey?: string | null
  }): Promise<ConvertImagesResponse> {
    const { sources, endUserId, idempotencyKey } = args

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

    const idemKey = idempotencyKey ? this.idempotencyRedisKey(idempotencyKey, endUserId) : null
    const fingerprint = fingerprintSources(sources)

    if (idemKey) {
      const cached = await this.claimIdempotency(idemKey, sources, endUserId, fingerprint)
      if (cached) return cached
    }

    try {
      const result = await this.doConvert(sources, endUserId)
      if (idemKey) {
        await this.redis.setEx(
          idemKey,
          IDEMPOTENCY_RESULT_TTL_SECONDS,
          JSON.stringify({ status: 'completed', fingerprint, ...result }),
        )
      }
      return result
    } catch (err) {
      if (idemKey) await this.redis.del(idemKey)
      throw err
    }
  }

  private idempotencyRedisKey(idempotencyKey: string, endUserId: string | null): string {
    return `print-conversion:idem:${endUserId ?? 'guest'}:${idempotencyKey}`
  }

  /**
   * 返回非 null 表示命中已完成的历史结果（重新校验归属后重新签发新的 printFileUrl）；
   * 抛异常表示冲突；返回 null 表示可以继续新流程（本次调用已持有锁，或兜底放行）。
   */
  private async claimIdempotency(
    idemKey: string,
    sources: ConvertImageSource[],
    endUserId: string | null,
    fingerprint: string,
  ): Promise<ConvertImagesResponse | null> {
    const lockPayload = JSON.stringify({ status: 'in_progress', fingerprint })

    const claimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
    if (claimed) return null

    let state = await this.readIdempotencyState(idemKey)
    if (!state) {
      // 极端竞态：抢锁失败时 key 还在，但读取/解析时已过期或损坏。重新抢一次锁，
      // 避免这次请求在没有任何锁保护的情况下裸奔进 doConvert（否则并发请求会一起跑到这里）。
      const retryClaimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
      if (retryClaimed) return null
      state = await this.readIdempotencyState(idemKey)
      if (!state) return null // 依然拿不到有效状态：按可接受的兜底放行
    }

    if (state.fingerprint !== fingerprint) {
      throw new ConflictException({
        error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该请求标识已用于另一批图片，请更换标识重试' },
      })
    }
    if (state.status === 'in_progress') {
      throw new ConflictException({
        error: { code: 'CONVERSION_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' },
      })
    }

    // completed：命中缓存前必须重新校验"这次请求"确实有权访问这些图片——
    // 否则只要拿到同样的 idempotencyKey + fileId 列表就能白嫖别人那次转换结果的签名 URL，
    // 绕开本文件其余地方一直坚持的 capability 校验模型。校验不通过按 doConvert 同样方式抛错。
    for (const source of sources) {
      await this.verifySourceOwnership(source, endUserId, 'print_doc')
    }

    // completed：重新签发 URL，不重复生成。
    const printSigned = signFileUrl(state.fileId!, OUTPUT_URL_TTL_MS)
    return {
      fileId: state.fileId!,
      printFileUrl: printSigned.url,
      fileMd5: state.fileMd5!,
      sizeBytes: state.sizeBytes!,
      pages: state.pages!,
    }
  }

  private async readIdempotencyState(idemKey: string): Promise<IdempotencyState | null> {
    const raw = await this.redis.get(idemKey)
    if (!raw) return null
    return parseIdempotencyState(raw)
  }

  /**
   * 校验调用方对单个 source 确实拥有访问权限（存在性 + 状态 + 归属 + 游客 capability 签名）。
   * 只做只读校验、返回校验通过的 FileObject 记录，不下载文件字节、不做 mime/尺寸/像素校验——
   * 那些属于 doConvert 的转换前置检查，命中幂等缓存的只读路径不需要重复。
   *
   * expectedPurpose：调用方声明的期望 purpose（如 'print_doc' 或签名盖章的
   * 'signature_source'）。不匹配一律按"不存在"处理（404，不泄露真实 purpose）。
   */
  private async verifySourceOwnership(
    source: ConvertImageSource,
    endUserId: string | null,
    expectedPurpose: FilePurpose,
    notFoundCode: string = 'CONVERT_SOURCE_NOT_FOUND',
  ) {
    const found = await this.prisma.fileObject.findUnique({ where: { id: source.fileId } })
    const notFound = () =>
      new NotFoundException({ error: { code: notFoundCode, message: '部分文件不存在或已失效' } })

    if (!found) throw notFound()

    const record = found
    const now = new Date()
    const baseOk =
      record.status === 'active' &&
      record.deletedAt === null &&
      (record.expiresAt === null || record.expiresAt > now) &&
      record.purpose === expectedPurpose
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

    return record
  }

  private async doConvert(sources: ConvertImageSource[], endUserId: string | null): Promise<ConvertImagesResponse> {
    const validated: ValidatedSource[] = []
    let totalBytes = 0
    let totalPixels = 0

    // 顺序逐个校验 + 读取（禁止 Promise.all，避免瞬时内存峰值）。
    for (const source of sources) {
      const record = await this.verifySourceOwnership(source, endUserId, 'print_doc')

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

  /**
   * 签名盖章：目标文件（单张 JPG/PNG，v1 不支持多页 PDF）+ 签名/印章素材，
   * 合成一份单页可打印 PDF。产物走既有 print_doc 打印链路，不新建打印任务类型。
   */
  async composeSignatureOverlay(args: {
    target: SignatureOverlayTarget
    signature: SignatureOverlaySignature
    position: OverlayPosition
    size: OverlaySize
    endUserId: string | null
  }): Promise<ComposeSignatureOverlayResponse> {
    const { target, signature, position, size, endUserId } = args

    const targetRecord = await this.verifySourceOwnership(
      target,
      endUserId,
      'print_doc',
      'SIGN_OVERLAY_TARGET_NOT_FOUND',
    )
    if (!ALLOWED_MIME_TYPES.has(targetRecord.mimeType)) {
      throw new BadRequestException({
        error: { code: 'SIGN_OVERLAY_TARGET_TYPE_UNSUPPORTED', message: '目标文件仅支持 JPG / PNG 图片' },
      })
    }
    if (targetRecord.sizeBytes > MAX_SINGLE_IMAGE_BYTES) {
      throw new BadRequestException({
        error: { code: 'SIGN_OVERLAY_TARGET_TOO_LARGE', message: '目标文件大小超出限制（10MB）' },
      })
    }

    const signatureRecord = await this.verifySourceOwnership(
      signature,
      endUserId,
      'signature_source',
      'SIGN_OVERLAY_SIGNATURE_NOT_FOUND',
    )
    if (!ALLOWED_SIGNATURE_MIME_TYPES.has(signatureRecord.mimeType)) {
      throw new BadRequestException({
        error: { code: 'SIGN_OVERLAY_SIGNATURE_TYPE_UNSUPPORTED', message: '签名 / 印章素材仅支持 JPG / PNG 图片' },
      })
    }
    if (signatureRecord.sizeBytes > MAX_SIGNATURE_BYTES) {
      throw new BadRequestException({
        error: { code: 'SIGN_OVERLAY_SIGNATURE_TOO_LARGE', message: '签名 / 印章素材大小超出限制（2MB）' },
      })
    }

    const targetBuffer = await this.storage.getObject(targetRecord.storageKey, targetRecord.bucket)
    const targetDims = readImageDimensions(targetBuffer, targetRecord.mimeType)
    if (!targetDims) {
      throw new BadRequestException({
        error: { code: 'SIGN_OVERLAY_IMAGE_DIMENSIONS_INVALID', message: '目标文件已损坏或格式不匹配' },
      })
    }
    if (targetDims.width * targetDims.height > MAX_SINGLE_IMAGE_PIXELS) {
      throw new BadRequestException({
        error: { code: 'SIGN_OVERLAY_IMAGE_DIMENSIONS_INVALID', message: '目标文件像素超出限制' },
      })
    }

    const signatureBuffer = await this.storage.getObject(signatureRecord.storageKey, signatureRecord.bucket)
    const signatureDims = readImageDimensions(signatureBuffer, signatureRecord.mimeType)
    if (!signatureDims) {
      throw new BadRequestException({
        error: { code: 'SIGN_OVERLAY_IMAGE_DIMENSIONS_INVALID', message: '签名 / 印章素材已损坏或格式不匹配' },
      })
    }
    if (signatureDims.width * signatureDims.height > MAX_SIGNATURE_PIXELS) {
      throw new BadRequestException({
        error: { code: 'SIGN_OVERLAY_IMAGE_DIMENSIONS_INVALID', message: '签名 / 印章素材像素超出限制' },
      })
    }

    const outputBuffer = await this.mergeSignatureOverlay({
      targetBuffer,
      targetDims,
      signatureBuffer,
      signatureDims,
      position,
      size,
    })

    const pageCount = countPdfPages(outputBuffer)
    if (pageCount !== 1) {
      throw new InternalServerErrorException({ error: { code: 'SIGN_OVERLAY_FAILED', message: 'PDF 生成校验失败，请重试' } })
    }
    if (outputBuffer.length > PROXY_MAX_OUTPUT_BYTES) {
      throw new BadRequestException({ error: { code: 'SIGN_OVERLAY_FAILED', message: '生成的 PDF 超出大小限制' } })
    }

    const uploaded = await this.files.upload({
      buffer: outputBuffer,
      filename: `signature-overlay-${Date.now()}.pdf`,
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
      action: 'print_conversion.signature_overlay',
      targetType: 'file',
      targetId: uploaded.fileId,
      payload: { targetFileId: target.fileId, signatureFileId: signature.fileId, position, size },
    })

    return {
      fileId: uploaded.fileId,
      printFileUrl: printSigned.url,
      fileMd5: uploaded.sha256,
      sizeBytes: uploaded.sizeBytes,
      pages: pageCount,
    }
  }

  /**
   * 单页合成：目标图铺满 A4（与 mergeImagesToPdf 同款 fit+center 布局），
   * 签名图按预设锚点 + 相对目标渲染区域宽度的比例叠加在同一页，不追加新页。
   */
  private async mergeSignatureOverlay(args: {
    targetBuffer: Buffer
    targetDims: { width: number; height: number }
    signatureBuffer: Buffer
    signatureDims: { width: number; height: number }
    position: OverlayPosition
    size: OverlaySize
  }): Promise<Buffer> {
    const { targetBuffer, targetDims, signatureBuffer, signatureDims, position, size } = args

    // 目标图在 fit+center 布局下的实际渲染矩形（可能因宽高比不同而小于整页，产生留白）。
    const scale = Math.min(PAGE_WIDTH_PT / targetDims.width, PAGE_HEIGHT_PT / targetDims.height)
    const renderedW = targetDims.width * scale
    const renderedH = targetDims.height * scale
    const offsetX = (PAGE_WIDTH_PT - renderedW) / 2
    const offsetY = (PAGE_HEIGHT_PT - renderedH) / 2

    const sigWidth = Math.min(renderedW * OVERLAY_SIZE_RATIO[size], Math.max(renderedW - 2 * OVERLAY_MARGIN_PT, 1))
    const sigHeight = sigWidth * (signatureDims.height / signatureDims.width)

    let sigX: number
    let sigY: number
    switch (position) {
      case 'top-left':
        sigX = offsetX + OVERLAY_MARGIN_PT
        sigY = offsetY + OVERLAY_MARGIN_PT
        break
      case 'top-right':
        sigX = offsetX + renderedW - OVERLAY_MARGIN_PT - sigWidth
        sigY = offsetY + OVERLAY_MARGIN_PT
        break
      case 'bottom-left':
        sigX = offsetX + OVERLAY_MARGIN_PT
        sigY = offsetY + renderedH - OVERLAY_MARGIN_PT - sigHeight
        break
      case 'bottom-right':
        sigX = offsetX + renderedW - OVERLAY_MARGIN_PT - sigWidth
        sigY = offsetY + renderedH - OVERLAY_MARGIN_PT - sigHeight
        break
      case 'center':
      default:
        sigX = offsetX + (renderedW - sigWidth) / 2
        sigY = offsetY + (renderedH - sigHeight) / 2
        break
    }

    // 防御性夹紧：极端宽高比目标图 + 大档位可能让计算结果越出渲染区域。
    sigX = Math.min(Math.max(sigX, offsetX), offsetX + renderedW - sigWidth)
    sigY = Math.min(Math.max(sigY, offsetY), offsetY + renderedH - sigHeight)

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ autoFirstPage: false })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', (err: Error) => reject(err))
      doc.addPage({ size: 'A4' })
      doc.image(targetBuffer, 0, 0, { fit: [PAGE_WIDTH_PT, PAGE_HEIGHT_PT], align: 'center', valign: 'center' })
      doc.image(signatureBuffer, sigX, sigY, { width: sigWidth, height: sigHeight })
      doc.end()
    })
  }
}

function fingerprintSources(sources: ConvertImageSource[]): string {
  return createHash('sha256')
    .update(sources.map((s) => s.fileId).join('|'))
    .digest('hex')
}

/** 解析 + 最小形状校验幂等缓存值；解析失败或必需字段缺失一律返回 null（当作未命中缓存处理）。 */
function parseIdempotencyState(raw: string): IdempotencyState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Record<string, unknown>
  if (candidate.status !== 'in_progress' && candidate.status !== 'completed') return null
  if (typeof candidate.fingerprint !== 'string') return null
  if (candidate.status === 'in_progress') {
    return { status: 'in_progress', fingerprint: candidate.fingerprint }
  }
  if (
    typeof candidate.fileId !== 'string' ||
    typeof candidate.fileMd5 !== 'string' ||
    typeof candidate.sizeBytes !== 'number' ||
    typeof candidate.pages !== 'number'
  ) {
    return null
  }
  return {
    status: 'completed',
    fingerprint: candidate.fingerprint,
    fileId: candidate.fileId,
    fileMd5: candidate.fileMd5,
    sizeBytes: candidate.sizeBytes,
    pages: candidate.pages,
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
