import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import PDFDocument from 'pdfkit'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import type { IdPhotoLayoutResponse, IdPhotoLayoutSource, IdPhotoSpec, IdPhotoSpecId } from './id-photo.types'
import { ID_PHOTO_SPECS } from './id-photo.types'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { RedisService } from '../common/redis/redis.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import { signFileUrl, verifyFileSignature, signIdPhotoDeleteToken, verifyIdPhotoDeleteToken } from '../files/signing'
import { countPdfPages } from '../files/file-page-count.util'
import { readImageDimensions } from '../print-conversion/image-dimensions.util'

const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_BYTES = 15 * 1024 * 1024
const OUTPUT_URL_TTL_MS = 30 * 60 * 1000
const FALLBACK_DELETE_TOKEN_TTL_MS = 60 * 60 * 1000
const IDEMPOTENCY_LOCK_TTL_SECONDS = 120
// 设计 §4.10：completed 缓存 TTL 与输出文件 1h TTL 对齐（不照搬格式转换的 10 分钟）。
const IDEMPOTENCY_RESULT_TTL_SECONDS = 3600
const GENERATION_SLOT_KEYS = ['id-photo:gen-slot:0', 'id-photo:gen-slot:1'] as const
const GENERATION_SLOT_TTL_SECONDS = 120
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png'])

// 设计 §4.10：用户(登录态)/ IP / terminalId 三维分别限流，各 3 次/分钟。
// 沿用 member-auth.service.ts 的既有 Redis 计数模式(incrWithTtl：首次自增即设 TTL，
// 窗口内后续自增只计数不重置)，不依赖单一 @Throttle 装饰器(那只按 IP 粗粒度限流)。
const LAYOUT_RATE_LIMIT_MAX = 3
const LAYOUT_RATE_LIMIT_WINDOW_SECONDS = 60

// A4 整版排版常量（设计 §三）
const PAGE_W_MM = 210
const PAGE_H_MM = 297
const MARGIN_MM = 10
const GAP_MM = 4
const MM_TO_PT = 72 / 25.4

/** 整版行列数（纯函数，供 verify 直接断言）。 */
export function computeGrid(spec: IdPhotoSpec): { cols: number; rows: number; count: number } {
  const cols = Math.floor((PAGE_W_MM - 2 * MARGIN_MM + GAP_MM) / (spec.widthMm + GAP_MM))
  const rows = Math.floor((PAGE_H_MM - 2 * MARGIN_MM + GAP_MM) / (spec.heightMm + GAP_MM))
  return { cols, rows, count: cols * rows }
}

interface IdemState {
  status: 'in_progress' | 'completed'
  fingerprint: string
  fileId?: string
  fileMd5?: string
  sizeBytes?: number
  pages?: number
  layoutCount?: number
  specId?: IdPhotoSpecId
}

@Injectable()
export class IdPhotoService {
  private readonly logger = new Logger(IdPhotoService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
    private readonly capabilities: TerminalCapabilitiesService,
  ) {}

  async generateLayout(args: {
    source: IdPhotoLayoutSource
    specId: string
    terminalId: string
    endUserId: string | null
    idempotencyKey?: string | null
    ip?: string | null
  }): Promise<IdPhotoLayoutResponse> {
    const spec = ID_PHOTO_SPECS.find((s) => s.specId === args.specId)
    if (!spec) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_SPEC_UNKNOWN', message: '不支持的证件照规格' } })
    }

    const terminalDbId = await this.resolveTerminalDbId(args.terminalId)

    // 设计 §4.10：三维频控须在能力门禁 / 幂等 / 并发槽之前拦下，
    // 防止重复请求把负载一路推到真正昂贵的 doGenerate（storage 读 + pdfkit + 上传 + 审计）之前。
    await this.checkLayoutRateLimit(args.endUserId, args.ip ?? null, terminalDbId)

    await this.capabilities.assertUserTaskAllowed(terminalDbId, 'id_photo')

    // 设计 §4.10：fingerprint 含 sourceFileId + specId + terminalId（身份已编入 idemKey）
    const fingerprint = createHash('sha256')
      .update(`${args.source.fileId}|${spec.specId}|${args.terminalId}`)
      .digest('hex')
    const idemKey = args.idempotencyKey
      ? `id-photo:idem:${args.endUserId ?? 'guest'}:${args.idempotencyKey}`
      : null

    if (idemKey) {
      const cached = await this.claimIdempotency(idemKey, args.source, args.endUserId, fingerprint, terminalDbId, spec)
      if (cached) return cached
    }

    // 设计 §4.10：全局并发 ≤2，Redis 槽位带 TTL，进程崩溃自动释放；抢不到直接拒绝。
    const slot = await this.acquireSlot()
    if (!slot) {
      if (idemKey) await this.redis.del(idemKey)
      throw new ConflictException({ error: { code: 'IDPHOTO_BUSY', message: '当前生成任务较多，请稍后重试' } })
    }

    try {
      const result = await this.doGenerate(args.source, args.endUserId, spec)
      if (idemKey) {
        await this.redis.setEx(
          idemKey,
          IDEMPOTENCY_RESULT_TTL_SECONDS,
          JSON.stringify({
            status: 'completed',
            fingerprint,
            fileId: result.fileId,
            fileMd5: result.fileMd5,
            sizeBytes: result.sizeBytes,
            pages: result.pages,
            layoutCount: result.layoutCount,
            specId: result.specId,
          }),
        )
      }
      return result
    } catch (err) {
      if (idemKey) await this.redis.del(idemKey)
      throw err
    } finally {
      await this.redis.del(slot)
    }
  }

  /** 设计 §4.9：手动删除端点。幂等在端点层实现（FilesService._delete 对已删文件会抛错）。 */
  async deleteSource(args: {
    fileId: string
    endUserId: string | null
    deleteToken?: string | null
  }): Promise<{ deleted: true }> {
    const notFound = () =>
      new NotFoundException({ error: { code: 'IDPHOTO_SOURCE_NOT_FOUND', message: '文件不存在或已删除' } })
    const record = await this.prisma.fileObject.findUnique({ where: { id: args.fileId } })
    if (!record || record.purpose !== 'id_scan') throw notFound()
    if (record.status === 'deleted' || record.deletedAt) return { deleted: true }

    if (args.endUserId) {
      if (record.endUserId !== args.endUserId || record.ownerType !== 'user') throw notFound()
      await this.files.ownerDelete(args.fileId, { kind: 'member', endUserId: args.endUserId }, 'id_photo manual delete')
    } else {
      const tokenOk = typeof args.deleteToken === 'string' && verifyIdPhotoDeleteToken(args.fileId, args.deleteToken)
      if (!tokenOk || record.endUserId !== null || record.ownerType !== 'system') throw notFound()
      await this.files.systemDelete(args.fileId, 'id_photo manual delete (guest)')
    }

    await this.audit.write({
      actorId: args.endUserId,
      actorRole: args.endUserId ? 'member' : 'system',
      action: 'id_photo.source_deleted',
      targetType: 'file',
      targetId: args.fileId,
      payload: { trigger: 'manual' },
    })
    return { deleted: true }
  }

  private async resolveTerminalDbId(terminalRef: string): Promise<string> {
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
      select: { id: true },
    })
    if (!terminal) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_INPUT_INVALID', message: '终端标识无效' } })
    }
    return terminal.id
  }

  /**
   * 设计 §4.10 三维频控：用户(登录态,游客跳过) / IP(不可得则跳过) / terminalId(恒定校验)，
   * 各自独立计数，任一维度在窗口内超过上限即拒绝。与 member-auth.service.ts 的多维频控
   * 同一模式：incrWithTtl 首次自增设 TTL，窗口内后续自增只计数，不重置窗口。
   * 顺序命中即抛错（不会把已超限维度之外的维度也计数进去），与既有 member-auth 实现行为一致。
   */
  private async checkLayoutRateLimit(userId: string | null, ip: string | null, terminalDbId: string): Promise<void> {
    const keys: string[] = []
    if (userId) keys.push(`id-photo:rl:user:${userId}`)
    if (ip) keys.push(`id-photo:rl:ip:${ip}`)
    keys.push(`id-photo:rl:terminal:${terminalDbId}`)

    for (const key of keys) {
      const count = await this.redis.incrWithTtl(key, LAYOUT_RATE_LIMIT_WINDOW_SECONDS)
      if (count > LAYOUT_RATE_LIMIT_MAX) {
        throw new HttpException(
          { error: { code: 'IDPHOTO_RATE_LIMITED', message: '操作过于频繁，请稍后再试' } },
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
    }
  }

  private async acquireSlot(): Promise<string | null> {
    for (const slot of GENERATION_SLOT_KEYS) {
      if (await this.redis.setNxEx(slot, '1', GENERATION_SLOT_TTL_SECONDS)) return slot
    }
    return null
  }

  /**
   * 幂等 claim（模式对齐 print-conversion.service.ts，三点强化见设计 §4.10）：
   * completed 命中前重做归属校验 + 终端能力门禁 + 输出文件存活检查；
   * 输出已失效则清缓存重新抢锁再走新流程。
   */
  private async claimIdempotency(
    idemKey: string,
    source: IdPhotoLayoutSource,
    endUserId: string | null,
    fingerprint: string,
    terminalDbId: string,
    spec: IdPhotoSpec,
  ): Promise<IdPhotoLayoutResponse | null> {
    const lockPayload = JSON.stringify({ status: 'in_progress', fingerprint })

    const claimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
    if (claimed) return null

    let state = parseIdemState(await this.redis.get(idemKey))
    if (!state) {
      const retryClaimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
      if (retryClaimed) return null
      state = parseIdemState(await this.redis.get(idemKey))
      if (!state) return null
    }

    if (state.fingerprint !== fingerprint) {
      throw new ConflictException({
        error: { code: 'IDPHOTO_IDEMPOTENCY_KEY_REUSED', message: '该请求标识已用于另一次生成，请更换标识重试' },
      })
    }
    if (state.status === 'in_progress') {
      throw new ConflictException({
        error: { code: 'IDPHOTO_GENERATION_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' },
      })
    }

    const sourceRecord = await this.verifySourceOwnership(source, endUserId)
    await this.capabilities.assertUserTaskAllowed(terminalDbId, 'id_photo')

    const output = await this.prisma.fileObject.findUnique({ where: { id: state.fileId! } })
    const now = new Date()
    const outputAlive =
      output !== null &&
      output.status === 'active' &&
      output.deletedAt === null &&
      (output.expiresAt === null || output.expiresAt > now)
    if (!outputAlive) {
      // 1h 文件 TTL 下"缓存指向已删文件"很容易发生：清缓存重新抢锁重新生成。
      await this.redis.del(idemKey)
      const reclaimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
      if (!reclaimed) {
        throw new ConflictException({
          error: { code: 'IDPHOTO_GENERATION_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' },
        })
      }
      return null
    }

    const printSigned = signFileUrl(state.fileId!, OUTPUT_URL_TTL_MS)
    const response: IdPhotoLayoutResponse = {
      fileId: state.fileId!,
      printFileUrl: printSigned.url,
      fileMd5: state.fileMd5!,
      sizeBytes: state.sizeBytes!,
      pages: state.pages!,
      specId: state.specId ?? spec.specId,
      layoutCount: state.layoutCount!,
    }
    this.attachGuestDeleteToken(response, source.fileId, endUserId, sourceRecord.expiresAt)
    return response
  }

  /** 归属校验：对齐 print-conversion.service.ts verifySourceOwnership，purpose 换成 id_scan。 */
  private async verifySourceOwnership(source: IdPhotoLayoutSource, endUserId: string | null) {
    const notFound = () =>
      new NotFoundException({ error: { code: 'IDPHOTO_SOURCE_NOT_FOUND', message: '照片不存在或已失效' } })
    const record = await this.prisma.fileObject.findUnique({ where: { id: source.fileId } })
    if (!record) throw notFound()

    const now = new Date()
    const baseOk =
      record.status === 'active' &&
      record.deletedAt === null &&
      (record.expiresAt === null || record.expiresAt > now) &&
      record.purpose === 'id_scan'
    if (!baseOk) throw notFound()

    const ownerOk = endUserId
      ? record.endUserId === endUserId && record.ownerType === 'user' && record.ownerId === endUserId
      : record.endUserId === null && record.ownerType === 'system' && record.ownerId === null
    if (!ownerOk) throw notFound()

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

  private async doGenerate(
    source: IdPhotoLayoutSource,
    endUserId: string | null,
    spec: IdPhotoSpec,
  ): Promise<IdPhotoLayoutResponse> {
    const record = await this.verifySourceOwnership(source, endUserId)

    if (!ALLOWED_MIME_TYPES.has(record.mimeType)) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_SOURCE_TYPE_UNSUPPORTED', message: '仅支持 JPG / PNG 图片' } })
    }
    if (record.sizeBytes > MAX_SOURCE_BYTES) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_SOURCE_TOO_LARGE', message: '图片大小超出限制（10MB）' } })
    }

    const buffer = await this.storage.getObject(record.storageKey, record.bucket)
    const dims = readImageDimensions(buffer, record.mimeType)
    if (!dims) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_INPUT_INVALID', message: '图片文件已损坏或格式不匹配' } })
    }
    // 设计 §4.4：服务端锚定——裁剪产物必须精确等于规格目标像素。
    if (dims.width !== spec.widthPx || dims.height !== spec.heightPx) {
      throw new BadRequestException({
        error: {
          code: 'IDPHOTO_DIMENSIONS_MISMATCH',
          message: `裁剪结果尺寸不符合规格要求（需 ${spec.widthPx}×${spec.heightPx}px）`,
        },
      })
    }

    const { pdf, layoutCount } = await this.buildLayoutPdf(buffer, spec)

    if (countPdfPages(pdf) !== 1) {
      throw new InternalServerErrorException({ error: { code: 'IDPHOTO_FAILED', message: 'PDF 生成校验失败，请重试' } })
    }
    if (pdf.length > MAX_OUTPUT_BYTES) {
      throw new InternalServerErrorException({ error: { code: 'IDPHOTO_FAILED', message: '生成的 PDF 超出大小限制' } })
    }

    const uploaded = await this.files.upload({
      buffer: pdf,
      filename: `id-photo-${spec.specId}-${Date.now()}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'id_photo_print',
      uploaderId: null,
      endUserId: endUserId ?? undefined,
      assetCategory: 'derived',
      sourceFileId: source.fileId,
      createdBy: endUserId,
    })

    // 设计 §4.5 审计强一致：高敏文件不允许"生成成功但无审计"——
    // AuditService.write 失败返回 null（fail-open 只对普通业务），此处显式检查并回滚输出。
    const auditId = await this.audit.write({
      actorId: endUserId,
      actorRole: endUserId ? 'member' : 'system',
      action: 'id_photo.layout_generated',
      targetType: 'file',
      targetId: uploaded.fileId,
      payload: { specId: spec.specId, sourceFileId: source.fileId, layoutCount },
    })
    if (!auditId) {
      await this.files.systemDelete(uploaded.fileId, 'id_photo layout audit write failed').catch((err: Error) => {
        this.logger.warn(`Rollback of ${uploaded.fileId} after audit-write failure also failed: ${err.message}`)
      })
      throw new InternalServerErrorException({ error: { code: 'IDPHOTO_FAILED', message: '生成失败，请重试' } })
    }

    const printSigned = signFileUrl(uploaded.fileId, OUTPUT_URL_TTL_MS)
    const response: IdPhotoLayoutResponse = {
      fileId: uploaded.fileId,
      printFileUrl: printSigned.url,
      fileMd5: uploaded.sha256,
      sizeBytes: uploaded.sizeBytes,
      pages: 1,
      specId: spec.specId,
      layoutCount,
    }
    this.attachGuestDeleteToken(response, source.fileId, endUserId, record.expiresAt)
    return response
  }

  /** 游客场景下发删除 action token，有效期覆盖源文件剩余生命周期（设计 §4.9）。 */
  private attachGuestDeleteToken(
    response: IdPhotoLayoutResponse,
    sourceFileId: string,
    endUserId: string | null,
    sourceExpiresAt: Date | null,
  ): void {
    if (endUserId) return
    const remainingMs = sourceExpiresAt ? sourceExpiresAt.getTime() - Date.now() : FALLBACK_DELETE_TOKEN_TTL_MS
    if (remainingMs <= 0) return
    response.sourceDeleteToken = signIdPhotoDeleteToken(sourceFileId, remainingMs).token
  }

  private async buildLayoutPdf(imageBuffer: Buffer, spec: IdPhotoSpec): Promise<{ pdf: Buffer; layoutCount: number }> {
    const grid = computeGrid(spec)
    if (grid.count < 1) {
      throw new InternalServerErrorException({ error: { code: 'IDPHOTO_FAILED', message: '排版计算失败' } })
    }
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0 })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), layoutCount: grid.count }))
      doc.on('error', (e: Error) => reject(e))

      const hasCjk = tryRegisterCjkFont(doc)

      const cellW = spec.widthMm * MM_TO_PT
      const cellH = spec.heightMm * MM_TO_PT
      const gap = GAP_MM * MM_TO_PT
      const usedW = grid.cols * cellW + (grid.cols - 1) * gap
      const usedH = grid.rows * cellH + (grid.rows - 1) * gap
      const originX = (PAGE_W_MM * MM_TO_PT - usedW) / 2
      const originY = (PAGE_H_MM * MM_TO_PT - usedH) / 2

      // 设计 §三：pdfkit 对 Buffer 不做缓存，直接每格传 buffer 会输出体积 = 单张 × 格数。
      // openImage 一次注册 XObject、多次放置引用（verify 有体积断言防回归）。
      const image = (doc as unknown as { openImage: (src: Buffer) => unknown }).openImage(imageBuffer)

      for (let r = 0; r < grid.rows; r += 1) {
        for (let c = 0; c < grid.cols; c += 1) {
          const x = originX + c * (cellW + gap)
          const y = originY + r * (cellH + gap)
          doc.image(image as never, x, y, { width: cellW, height: cellH })
          doc.rect(x, y, cellW, cellH).lineWidth(0.4).stroke('#bbbbbb')
        }
      }

      const dateStr = new Date().toISOString().slice(0, 10)
      const footer = hasCjk
        ? `证件照 ${spec.label} ${spec.widthMm}×${spec.heightMm}mm · ${dateStr} · 彩色激光打印`
        : `ID photo ${spec.widthMm}x${spec.heightMm}mm - ${dateStr} - Color Laser`
      doc
        .fontSize(8)
        .fillColor('#999999')
        .text(footer, 0, PAGE_H_MM * MM_TO_PT - 18, { align: 'center', width: PAGE_W_MM * MM_TO_PT })

      doc.end()
    })
  }
}

/** CJK 字体候选注册（复制 resume-pdf.service.ts fontCandidates 的降级模式；全失败则页脚退 ASCII）。 */
function tryRegisterCjkFont(doc: InstanceType<typeof PDFDocument>): boolean {
  const candidates: Array<{ path: string; family?: string }> = []
  const custom = process.env['PDF_CJK_FONT_PATH']
  if (custom) candidates.push({ path: custom, family: process.env['PDF_CJK_FONT_FAMILY'] || undefined })
  if (process.platform === 'win32') {
    const winDir = process.env['WINDIR'] || 'C:\\Windows'
    candidates.push(
      { path: `${winDir}\\Fonts\\msyh.ttc`, family: 'Microsoft YaHei' },
      { path: `${winDir}\\Fonts\\simhei.ttf` },
    )
  } else if (process.platform === 'darwin') {
    candidates.push({ path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' })
  } else {
    candidates.push(
      { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
      { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
    )
  }
  for (const c of candidates) {
    if (!existsSync(c.path)) continue
    try {
      if (c.family) doc.registerFont('cjk', c.path, c.family)
      else doc.registerFont('cjk', c.path)
      doc.font('cjk')
      return true
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return false
}

function parseIdemState(raw: string | null): IdemState | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const c = parsed as Record<string, unknown>
  if (c.status !== 'in_progress' && c.status !== 'completed') return null
  if (typeof c.fingerprint !== 'string') return null
  if (c.status === 'in_progress') return { status: 'in_progress', fingerprint: c.fingerprint }
  if (
    typeof c.fileId !== 'string' ||
    typeof c.fileMd5 !== 'string' ||
    typeof c.sizeBytes !== 'number' ||
    typeof c.pages !== 'number' ||
    typeof c.layoutCount !== 'number'
  ) {
    return null
  }
  return {
    status: 'completed',
    fingerprint: c.fingerprint,
    fileId: c.fileId,
    fileMd5: c.fileMd5,
    sizeBytes: c.sizeBytes,
    pages: c.pages,
    layoutCount: c.layoutCount,
    specId: typeof c.specId === 'string' ? (c.specId as IdPhotoSpecId) : undefined,
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
