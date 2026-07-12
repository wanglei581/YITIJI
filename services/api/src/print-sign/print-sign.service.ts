import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { PDFDocument, PDFSignature, degrees } from 'pdf-lib'
import { createHash, randomBytes } from 'crypto'
import type { SignComposeResponse, SignInspectResponse, SignStampPlacement, SignStampSource } from './print-sign.types'
import { computeStampDrawParams, normalizeRotation } from './print-sign-geometry'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { RedisService } from '../common/redis/redis.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import { parseAndVerifySignedContentUrl, signFileUrl } from '../files/signing'
import { countPdfPages } from '../files/file-page-count.util'
import { sniffDeclaredMimeMismatch } from '../files/content-sniff'
import { readImageDimensions } from '../print-conversion/image-dimensions.util'
import type { FileSensitiveLevel } from '../files/file.types'

const MAX_DOC_BYTES = 15 * 1024 * 1024
const MAX_DOC_PAGES = 30
const MAX_STAMP_BYTES = 10 * 1024 * 1024
const MAX_STAMP_PIXELS = 25_000_000
const MAX_OUTPUT_BYTES = 15 * 1024 * 1024
const OUTPUT_URL_TTL_MS = 30 * 60 * 1000
const COMPOSE_TIMEOUT_MS = 10_000
const MAX_CONCURRENT_COMPOSE = 2
const IDEMPOTENCY_LOCK_TTL_SECONDS = 120
const IDEMPOTENCY_RESULT_TTL_SECONDS = 600
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,80}$/
const MEMBER_RATE_LIMIT_PER_MINUTE = 3

/** 授权确认文案版本：改 Kiosk 勾选文案时必须同步 bump，审计据此追溯用户当时看到的内容。 */
const AUTHORIZATION_NOTICE_VERSION = '2026-07-12.v1'

const DOC_PURPOSES_MEMBER = new Set(['print_doc', 'resume_upload', 'resume_scan', 'cover_letter'])
const DOC_PURPOSES_GUEST = new Set(['print_doc'])
const STAMP_MIMES = new Set(['image/jpeg', 'image/png'])
const SENSITIVE_ORDER: Record<FileSensitiveLevel, number> = { normal: 0, sensitive: 1, highly_sensitive: 2 }

class ComposeTimeoutError extends Error {}

interface IdempotencyState {
  status: 'in_progress' | 'completed'
  fingerprint: string
  ownerToken?: string
  fileId?: string
  fileMd5?: string
  sizeBytes?: number
  pages?: number
}

@Injectable()
export class PrintSignService {
  // 单实例并发合成上限（解析型 DoS 防线之一；超时是另一道，见 withTimeout）
  private inFlight = 0
  private readonly queue: Array<() => void> = []

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
    private readonly capabilities: TerminalCapabilitiesService,
  ) {}

  async inspect(args: { terminalId: string; document: SignStampSource; endUserId: string | null }): Promise<SignInspectResponse> {
    await this.capabilities.assertUserTaskAllowed(args.terminalId, 'signature_stamp')
    const record = await this.verifyDocumentSource(args.document, args.endUserId)
    const buffer = await this.storage.getObject(record.storageKey, record.bucket)
    try {
      const { pageCount } = await withTimeout(() => this.loadAndValidatePdf(buffer), COMPOSE_TIMEOUT_MS)
      return { pages: pageCount }
    } catch (err) {
      if (err instanceof ComposeTimeoutError) {
        throw new InternalServerErrorException({ error: { code: 'SIGN_FAILED', message: '文件处理超时，请换用更简单的文件重试' } })
      }
      throw err
    }
  }

  async compose(args: {
    terminalId: string
    document: SignStampSource
    stamp: SignStampSource
    placement: SignStampPlacement
    authorizationConfirmed: boolean
    endUserId: string | null
    idempotencyKey?: string | null
    requestId?: string | null
  }): Promise<SignComposeResponse> {
    const { endUserId, idempotencyKey } = args

    // DTO @Equals(true) 已在管道层拦截；service 层再防御一次（verify 脚本直调 service）
    if (args.authorizationConfirmed !== true) {
      throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请先确认签名/印章图片使用授权' } })
    }
    if (idempotencyKey != null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: 'Idempotency-Key 格式不合法' } })
    }

    await this.capabilities.assertUserTaskAllowed(args.terminalId, 'signature_stamp')

    // 会员维度频控（IP 维度由 @Throttle 承担；一体机共享出口 IP，两维并用）
    if (endUserId) {
      const count = await this.redis.incrWithTtl(`print-sign:rate:${endUserId}`, 60)
      if (count > MEMBER_RATE_LIMIT_PER_MINUTE) {
        throw new ConflictException({ error: { code: 'SIGN_IN_PROGRESS', message: '操作太频繁，请一分钟后再试' } })
      }
    }

    const idemKey = idempotencyKey ? `print-sign:idem:${endUserId ?? 'guest'}:${idempotencyKey}` : null
    const fingerprint = fingerprintRequest(args.document, args.stamp, args.placement)
    const ownerToken = randomBytes(16).toString('hex')

    if (idemKey) {
      const cached = await this.claimIdempotency(idemKey, args, fingerprint, ownerToken)
      if (cached) return cached
    }

    try {
      const result = await this.doCompose(args)
      if (idemKey) {
        await this.redis.setEx(
          idemKey,
          IDEMPOTENCY_RESULT_TTL_SECONDS,
          JSON.stringify({ status: 'completed', fingerprint, ...result }),
        )
      }
      return result
    } catch (err) {
      // owner-token compare-and-delete：只释放"自己那把"锁，不误删 120s 后他人接管的新锁/新结果
      if (idemKey) {
        await this.redis.getAndDelIfEquals(idemKey, JSON.stringify({ status: 'in_progress', fingerprint, ownerToken }))
      }
      throw err
    }
  }

  /** 返回非 null = 命中已完成结果（已重验源归属 + 输出存活）；抛异常 = 冲突；null = 本次持锁继续。 */
  private async claimIdempotency(
    idemKey: string,
    args: { document: SignStampSource; stamp: SignStampSource; endUserId: string | null },
    fingerprint: string,
    ownerToken: string,
  ): Promise<SignComposeResponse | null> {
    const lockPayload = JSON.stringify({ status: 'in_progress', fingerprint, ownerToken })

    const claimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
    if (claimed) return null

    let state = await this.readIdempotencyState(idemKey)
    if (!state) {
      const retryClaimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
      if (retryClaimed) return null
      state = await this.readIdempotencyState(idemKey)
      if (!state) return null
    }

    if (state.fingerprint !== fingerprint) {
      throw new ConflictException({
        error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该请求标识已用于另一次签章参数，请更换标识重试' },
      })
    }
    if (state.status === 'in_progress') {
      throw new ConflictException({ error: { code: 'SIGN_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' } })
    }

    // completed：重验"这次请求"对双源文件的访问权（防拿同 key+fileId 白嫖他人结果）
    await this.verifyDocumentSource(args.document, args.endUserId)
    await this.verifyStampSource(args.stamp, args.endUserId)

    // 输出存活校验：输出可能已被删除/清理 —— 直接重签会返回必 404 的 URL
    const output = await this.prisma.fileObject.findUnique({ where: { id: state.fileId! } })
    const now = new Date()
    const outputAlive =
      output !== null &&
      output.status === 'active' &&
      output.deletedAt === null &&
      (output.expiresAt === null || output.expiresAt > now)
    if (!outputAlive) {
      await this.redis.del(idemKey)
      const reclaimed = await this.redis.setNxEx(
        idemKey,
        JSON.stringify({ status: 'in_progress', fingerprint, ownerToken }),
        IDEMPOTENCY_LOCK_TTL_SECONDS,
      )
      if (!reclaimed) {
        throw new ConflictException({ error: { code: 'SIGN_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' } })
      }
      return null // 输出已失效：按新请求重新生成
    }

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

  /** 归属校验（与 print-conversion.verifySourceOwnership 同模型），外加 document 的类型/白名单校验。 */
  private async verifyDocumentSource(source: SignStampSource, endUserId: string | null) {
    const record = await this.verifyOwnership(source, endUserId)
    const purposeOk = (endUserId ? DOC_PURPOSES_MEMBER : DOC_PURPOSES_GUEST).has(record.purpose)
    if (record.mimeType !== 'application/pdf' || !purposeOk) {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_TYPE_UNSUPPORTED', message: '仅支持本人的 PDF 文档' } })
    }
    if (record.sizeBytes > MAX_DOC_BYTES) {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_TOO_LARGE', message: '文档大小超出限制（15MB）' } })
    }
    return record
  }

  private async verifyStampSource(source: SignStampSource, endUserId: string | null) {
    const record = await this.verifyOwnership(source, endUserId)
    if (!STAMP_MIMES.has(record.mimeType) || record.purpose !== 'signature_image') {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_TYPE_UNSUPPORTED', message: '签名/印章图片仅支持 JPG / PNG' } })
    }
    if (record.sizeBytes > MAX_STAMP_BYTES) {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_TOO_LARGE', message: '图片大小超出限制（10MB）' } })
    }
    return record
  }

  private async verifyOwnership(source: SignStampSource, endUserId: string | null) {
    const found = await this.prisma.fileObject.findUnique({ where: { id: source.fileId } })
    const notFound = () =>
      new NotFoundException({ error: { code: 'SIGN_SOURCE_NOT_FOUND', message: '文件不存在或已失效' } })
    if (!found) throw notFound()

    const now = new Date()
    const baseOk =
      found.status === 'active' && found.deletedAt === null && (found.expiresAt === null || found.expiresAt > now)
    if (!baseOk) throw notFound()

    const ownerOk = endUserId
      ? found.endUserId === endUserId && found.ownerType === 'user' && found.ownerId === endUserId
      : found.endUserId === null && found.ownerType === 'system' && found.ownerId === null
    if (!ownerOk) throw notFound()

    if (endUserId === null) {
      const capability = parseAndVerifySignedContentUrl(source.fileAccessUrl)
      if (!capability || capability.fileId !== source.fileId) throw notFound()
    }
    return found
  }

  private async doCompose(args: {
    terminalId: string
    document: SignStampSource
    stamp: SignStampSource
    placement: SignStampPlacement
    endUserId: string | null
    requestId?: string | null
  }): Promise<SignComposeResponse> {
    const { endUserId, placement } = args
    const docRecord = await this.verifyDocumentSource(args.document, endUserId)
    const stampRecord = await this.verifyStampSource(args.stamp, endUserId)

    // 顺序读取（禁止 Promise.all，同 print-conversion）
    const docBuffer = await this.storage.getObject(docRecord.storageKey, docRecord.bucket)
    if (!sniffDeclaredMimeMismatch(docBuffer, 'application/pdf').ok) {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_UNSUPPORTED', message: '文档内容与 PDF 格式不符' } })
    }
    const stampBuffer = await this.storage.getObject(stampRecord.storageKey, stampRecord.bucket)
    if (!sniffDeclaredMimeMismatch(stampBuffer, stampRecord.mimeType).ok) {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_UNSUPPORTED', message: '图片内容与声明格式不符' } })
    }
    const dims = readImageDimensions(stampBuffer, stampRecord.mimeType)
    if (!dims || dims.width <= 0 || dims.height <= 0) {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_UNSUPPORTED', message: '图片已损坏或无法解析' } })
    }
    if (dims.width * dims.height > MAX_STAMP_PIXELS) {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_TOO_LARGE', message: '图片像素超出限制' } })
    }

    await this.acquireComposeSlot()
    let outputBuffer: Buffer
    let pageCount: number
    try {
      const composed = await withTimeout(
        () => this.overlayStamp(docBuffer, stampBuffer, stampRecord.mimeType, dims, placement),
        COMPOSE_TIMEOUT_MS,
      )
      outputBuffer = composed.outputBuffer
      pageCount = composed.pageCount
    } catch (err) {
      if (err instanceof ComposeTimeoutError) {
        throw new InternalServerErrorException({ error: { code: 'SIGN_FAILED', message: '文件处理超时，请换用更简单的文件重试' } })
      }
      throw err
    } finally {
      this.releaseComposeSlot()
    }

    // 输出双保险：叠图不增删页 + 现有打印计费器（明文 /Type /Page 扫描）必须能数出同样页数。
    // useObjectStreams:false 回退会在这里立刻炸掉（countPdfPages 返回 null ≠ pageCount）。
    if (countPdfPages(outputBuffer) !== pageCount) {
      throw new InternalServerErrorException({ error: { code: 'SIGN_FAILED', message: '合成校验失败，请重试' } })
    }
    if (outputBuffer.length > MAX_OUTPUT_BYTES) {
      throw new BadRequestException({ error: { code: 'SIGN_OUTPUT_TOO_LARGE', message: '合成后的 PDF 超出大小限制' } })
    }

    const outLevel = maxSensitiveLevel(docRecord.sensitiveLevel as FileSensitiveLevel, 'sensitive')
    const uploaded = await this.files.upload({
      buffer: outputBuffer,
      filename: `${sanitizeBaseName(docRecord.filename)}-签章合成.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      sensitiveLevel: outLevel,
      uploaderId: null,
      endUserId: endUserId ?? undefined,
      assetCategory: 'derived',
      sourceFileId: args.document.fileId,
      createdBy: endUserId,
    })

    const printSigned = signFileUrl(uploaded.fileId, OUTPUT_URL_TTL_MS)

    await this.audit.write({
      actorId: endUserId,
      actorRole: endUserId ? 'member' : 'system',
      action: 'print_sign.compose',
      targetType: 'file',
      targetId: uploaded.fileId,
      payload: {
        terminalId: args.terminalId,
        requestId: args.requestId ?? null,
        documentFileId: args.document.fileId,
        stampFileId: args.stamp.fileId,
        placement,
        authorizationConfirmed: true,
        authorizationNoticeVersion: AUTHORIZATION_NOTICE_VERSION,
      },
    })

    return {
      fileId: uploaded.fileId,
      printFileUrl: printSigned.url,
      fileMd5: uploaded.sha256,
      sizeBytes: uploaded.sizeBytes,
      pages: pageCount,
    }
  }

  /** pdf-lib 加载校验 + 叠图 + 保存。加载失败（加密/损坏）→ SIGN_DOC_UNSUPPORTED。 */
  private async loadAndValidatePdf(buffer: Buffer): Promise<{ doc: PDFDocument; pageCount: number }> {
    let doc: PDFDocument
    try {
      doc = await PDFDocument.load(buffer) // 不传 ignoreEncryption：加密文档明确拒绝
    } catch {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_UNSUPPORTED', message: '文档已加密、损坏或格式不受支持' } })
    }
    if (hasDigitalSignatureField(doc)) {
      throw new BadRequestException({
        error: {
          code: 'SIGN_DOC_HAS_DIGITAL_SIGNATURE',
          message: '该文件含数字签名，叠加图片会使原签名失效，本功能不处理此类文件',
        },
      })
    }
    const pageCount = doc.getPageCount()
    if (pageCount < 1 || pageCount > MAX_DOC_PAGES) {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_TOO_MANY_PAGES', message: `仅支持 1–${MAX_DOC_PAGES} 页的文档` } })
    }
    return { doc, pageCount }
  }

  private async overlayStamp(
    docBuffer: Buffer,
    stampBuffer: Buffer,
    stampMime: string,
    dims: { width: number; height: number },
    placement: SignStampPlacement,
  ): Promise<{ outputBuffer: Buffer; pageCount: number }> {
    const { doc, pageCount } = await this.loadAndValidatePdf(docBuffer)
    if (placement.page < 1 || placement.page > pageCount) {
      throw new BadRequestException({ error: { code: 'SIGN_PLACEMENT_INVALID', message: '页码超出文档范围' } })
    }

    let image
    try {
      image = stampMime === 'image/png' ? await doc.embedPng(stampBuffer) : await doc.embedJpg(stampBuffer)
    } catch {
      // CMYK JPEG 等 pdf-lib 不支持的编码变体：fail-closed
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_UNSUPPORTED', message: '该图片编码暂不支持，请转存为普通 PNG/JPG 后重试' } })
    }

    const page = doc.getPage(placement.page - 1)
    const crop = page.getCropBox()
    const rotation = normalizeRotation(page.getRotation().angle)
    const draw = computeStampDrawParams({
      cropX: crop.x,
      cropY: crop.y,
      cropWidth: crop.width,
      cropHeight: crop.height,
      rotation,
      imageWidth: dims.width,
      imageHeight: dims.height,
      position: placement.position,
      size: placement.size,
    })
    page.drawImage(image, {
      x: draw.x,
      y: draw.y,
      width: draw.width,
      height: draw.height,
      rotate: degrees(draw.rotateDegrees),
    })

    // useObjectStreams:false 是硬性要求（打印计费器只数明文 /Type /Page）—— 勿"优化"
    const saved = await doc.save({ useObjectStreams: false })
    return { outputBuffer: Buffer.from(saved), pageCount }
  }

  private async acquireComposeSlot(): Promise<void> {
    if (this.inFlight < MAX_CONCURRENT_COMPOSE) {
      this.inFlight += 1
      return
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.inFlight += 1
  }

  private releaseComposeSlot(): void {
    this.inFlight -= 1
    const next = this.queue.shift()
    if (next) next()
  }
}

function fingerprintRequest(document: SignStampSource, stamp: SignStampSource, placement: SignStampPlacement): string {
  return createHash('sha256')
    .update([document.fileId, stamp.fileId, placement.page, placement.position, placement.size].join('|'))
    .digest('hex')
}

function maxSensitiveLevel(a: FileSensitiveLevel, b: FileSensitiveLevel): FileSensitiveLevel {
  return SENSITIVE_ORDER[a] >= SENSITIVE_ORDER[b] ? a : b
}

/** 文件名净化：去扩展名/路径分隔/控制字符，截断，空则回退。 */
function sanitizeBaseName(filename: string): string {
  const base = filename.replace(/\.[Pp][Dd][Ff]$/, '')
  const cleaned = base.replace(/[\\/ -]/g, '').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'document'
}

/**
 * 检测 AcroForm 数字签名域。pdf-lib 的 getForm() 对无 AcroForm 的文档会创建空表单
 * （无害：我们本来就要 save），字段枚举异常一律按"未检测到"处理 —— 冷门形态由
 * 免责声明兜底（设计 §八）。
 */
function hasDigitalSignatureField(doc: PDFDocument): boolean {
  try {
    return doc.getForm().getFields().some((field) => field instanceof PDFSignature)
  } catch {
    return false
  }
}

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
    return {
      status: 'in_progress',
      fingerprint: candidate.fingerprint,
      ownerToken: typeof candidate.ownerToken === 'string' ? candidate.ownerToken : undefined,
    }
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

async function withTimeout<T>(work: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ComposeTimeoutError()), ms)
  })
  try {
    return await Promise.race([work(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
