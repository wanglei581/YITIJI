import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import type {
  CompleteUploadResponse,
  FileAccessUrlResponse,
  FileMetadata,
  FileOwnerType,
  FilePurpose,
  FileSensitiveLevel,
  FileStatus,
  FileUploadResponse,
  SignedUrlResponse,
  FileCleanupResponse,
  UploadIntentResponse,
} from './file.types'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { UserRole } from '../common/decorators/roles.decorator'
import { FILE_DEFAULT_TTL_HOURS } from './file.types'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { StorageService } from '../storage/storage.service'
import { generateObjectKey, type FileOwnerType as ObjKeyOwnerType } from '../storage/object-key'
import {
  DEFAULT_SENSITIVE_BY_PURPOSE,
  PURPOSE_POLICY,
  validateUpload,
  isPurpose,
} from './file-validation'

/**
 * 文件请求者(下载 / 预览 / 删除鉴权用)。
 *   - user:  后台 User(admin / partner / kiosk),来自 User JWT。
 *   - member:C 端求职者(EndUser),来自 member token。
 */
export type FileRequester =
  | { kind: 'user'; userId: string; role: UserRole; orgId: string | null }
  | { kind: 'member'; endUserId: string }

/**
 * 文件服务:落库 + 对象存储(COS / 本地)写入 + 签名 + 软删 + 物理清理。
 *
 * 所有物理读写经 StorageService 路由到 COS 或本地后端,FilesService 不再直接
 * 触碰文件系统。鉴权 + 审计(管理员访问用户文件)在 service / controller 协作完成。
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ── 服务端代理上传(multipart;校验后的 buffer 经服务端推送到对象存储)──────

  async upload(args: {
    buffer: Buffer
    filename: string
    mimeType: string
    purpose: FilePurpose
    sensitiveLevel?: FileSensitiveLevel
    uploaderId: string | null
    endUserId?: string | null
    actorRole?: UserRole | null
    actorOrgId?: string | null
    createdBy?: string | null
  }): Promise<FileUploadResponse> {
    const validation = validateUpload({
      purpose: args.purpose,
      mimeType: args.mimeType,
      filename: args.filename,
      sizeBytes: args.buffer.length,
      mode: 'proxy',
    })
    if (!validation.ok) {
      throw new BadRequestException({ error: { code: validation.code, message: validation.message } })
    }

    const sensitiveLevel = this.resolveSensitiveLevel(args.purpose, args.sensitiveLevel)
    const expiresAt = this.computeExpiry(sensitiveLevel)
    const id = randomUUID().replace(/-/g, '')
    const owner = deriveOwner({
      endUserId: args.endUserId ?? null,
      role: args.actorRole ?? null,
      uploaderId: args.uploaderId,
      orgId: args.actorOrgId ?? null,
    })
    const objectKey = generateObjectKey({
      purpose: args.purpose,
      ownerType: owner.ownerType as ObjKeyOwnerType,
      ownerId: owner.ownerId,
      fileId: id,
      ext: validation.ext,
    })

    const put = await this.storage.putObject(objectKey, args.buffer, args.mimeType)

    const record = await this.prisma.fileObject.create({
      data: {
        id,
        storageKey: objectKey,
        bucket: this.storage.defaultBucket,
        region: this.storage.defaultRegion,
        filename: args.filename,
        mimeType: args.mimeType,
        sizeBytes: put.sizeBytes,
        sha256: put.sha256,
        uploaderId: args.uploaderId,
        endUserId: args.endUserId ?? null,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        purpose: args.purpose,
        sensitiveLevel,
        visibility: 'private',
        status: 'active',
        createdBy: args.createdBy ?? args.uploaderId ?? null,
        expiresAt,
      },
    })

    // 上传响应给 30 分钟签名 URL,覆盖"上传→预览→确认打印"整段触控窗口。
    const signed = this.storage.getDownloadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        ttlSeconds: this.storage.signTtlSeconds,
        disposition: 'inline',
      },
      record.bucket,
    )
    return {
      fileId: record.id,
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      sha256: record.sha256,
      signedUrl: signed.url,
      signedUrlExpiresAt: signed.expiresAt.toISOString(),
      fileExpiresAt: record.expiresAt.toISOString(),
    }
  }

  // ── 直传意图(COS 预签名 PUT;本地回 API 代理 PUT)────────────────────────

  async createUploadIntent(args: {
    body: { purpose: string; filename: string; mimeType: string; sizeBytes?: number; sensitiveLevel?: string; sha256?: string }
    uploaderId: string | null
    endUserId?: string | null
    actorRole?: UserRole | null
    actorOrgId?: string | null
    createdBy?: string | null
  }): Promise<UploadIntentResponse> {
    const { body } = args
    if (!isPurpose(body.purpose)) {
      throw new BadRequestException({ error: { code: 'FILE_PURPOSE_INVALID', message: `不支持的文件用途: ${body.purpose}` } })
    }
    const declaredSize = Number(body.sizeBytes ?? 1)
    const validation = validateUpload({
      purpose: body.purpose,
      mimeType: body.mimeType,
      filename: body.filename,
      sizeBytes: Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : 1,
      mode: 'intent',
    })
    if (!validation.ok) {
      throw new BadRequestException({ error: { code: validation.code, message: validation.message } })
    }

    const sensitiveLevel = this.resolveSensitiveLevel(
      body.purpose as FilePurpose,
      body.sensitiveLevel as FileSensitiveLevel | undefined,
    )
    const expiresAt = this.computeExpiry(sensitiveLevel)
    const id = randomUUID().replace(/-/g, '')
    const owner = deriveOwner({
      endUserId: args.endUserId ?? null,
      role: args.actorRole ?? null,
      uploaderId: args.uploaderId,
      orgId: args.actorOrgId ?? null,
    })
    const objectKey = generateObjectKey({
      purpose: body.purpose as FilePurpose,
      ownerType: owner.ownerType as ObjKeyOwnerType,
      ownerId: owner.ownerId,
      fileId: id,
      ext: validation.ext,
    })

    const record = await this.prisma.fileObject.create({
      data: {
        id,
        storageKey: objectKey,
        bucket: this.storage.defaultBucket,
        region: this.storage.defaultRegion,
        filename: body.filename,
        mimeType: body.mimeType,
        sizeBytes: 0,
        sha256: typeof body.sha256 === 'string' ? body.sha256 : '',
        uploaderId: args.uploaderId,
        endUserId: args.endUserId ?? null,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        purpose: body.purpose,
        sensitiveLevel,
        visibility: 'private',
        status: 'uploading',
        createdBy: args.createdBy ?? args.uploaderId ?? null,
        expiresAt,
      },
    })

    const upload = this.storage.getUploadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        contentType: record.mimeType,
        ttlSeconds: this.storage.signTtlSeconds,
      },
      record.bucket,
    )

    return {
      fileId: record.id,
      bucket: record.bucket,
      region: record.region,
      objectKey: record.storageKey,
      uploadUrl: upload.url,
      uploadMethod: upload.method,
      uploadHeaders: upload.headers,
      uploadUrlExpiresAt: upload.expiresAt.toISOString(),
      direct: upload.direct,
    }
  }

  /**
   * 客户端直传完成后确认。headObject 复核对象确实落地 + 实测大小,
   * 通过则 status→active。COS 端 sha256 无法就 buffer 计算,沿用意图阶段客户端值(可空)。
   */
  async completeUpload(fileId: string, requester: FileRequester): Promise<CompleteUploadResponse> {
    const record = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!record || record.deletedAt) {
      throw new NotFoundException({ error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' } })
    }
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({ error: { code: 'FILE_ACCESS_DENIED', message: '无权确认此文件' } })
    }

    const head = await this.storage.headObject(record.storageKey, record.bucket)
    if (!head) {
      throw new BadRequestException({ error: { code: 'FILE_NOT_UPLOADED', message: '对象未上传或上传未完成' } })
    }
    // 实测大小复核 purpose 上限(直传可能绕过意图阶段声明)。
    const policy = PURPOSE_POLICY[record.purpose as FilePurpose]
    if (policy && head.sizeBytes > policy.maxBytes) {
      // 超限对象立即物理删除 + 标记 quarantined,不让违规文件留存。
      await this.storage.deleteObject(record.storageKey, record.bucket).catch(() => undefined)
      await this.prisma.fileObject.update({ where: { id: fileId }, data: { status: 'quarantined' } })
      throw new BadRequestException({ error: { code: 'FILE_TOO_LARGE', message: '上传文件超出大小上限,已拒绝' } })
    }

    const updated = await this.prisma.fileObject.update({
      where: { id: fileId },
      data: { sizeBytes: head.sizeBytes, status: 'active' },
    })
    return {
      fileId: updated.id,
      status: updated.status as FileStatus,
      sizeBytes: updated.sizeBytes,
      sha256: updated.sha256,
      fileExpiresAt: updated.expiresAt.toISOString(),
    }
  }

  /** 本地后端直传:接收原始 buffer 写入,并复核大小/落地 active。 */
  async writeRawUpload(fileId: string, buffer: Buffer): Promise<void> {
    const record = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!record || record.deletedAt) {
      throw new NotFoundException({ error: { code: 'FILE_NOT_FOUND', message: '文件不存在' } })
    }
    const validation = validateUpload({
      purpose: record.purpose,
      mimeType: record.mimeType,
      filename: record.filename,
      sizeBytes: buffer.length,
      mode: 'intent',
    })
    if (!validation.ok) {
      throw new BadRequestException({ error: { code: validation.code, message: validation.message } })
    }
    const put = await this.storage.putObject(record.storageKey, buffer, record.mimeType, record.bucket)
    await this.prisma.fileObject.update({
      where: { id: fileId },
      data: { sizeBytes: put.sizeBytes, sha256: put.sha256, status: 'active' },
    })
  }

  // ── 下载 / 预览 短期 URL ──────────────────────────────────────────────────

  /**
   * 生成下载 / 预览 URL,带归属鉴权。
   * 返回 needsAdminAudit 表示"管理员访问了非本人的用户敏感文件",由 controller 落审计。
   */
  async getAccessUrl(
    fileId: string,
    requester: FileRequester,
    disposition: 'inline' | 'attachment',
  ): Promise<{ response: FileAccessUrlResponse; record: { purpose: string; ownerType: string | null }; needsAdminAudit: boolean }> {
    const record = await this.requireAlive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({ error: { code: 'FILE_ACCESS_DENIED', message: '无权访问此文件' } })
    }

    const signed = this.storage.getDownloadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        ttlSeconds: this.storage.signTtlSeconds,
        disposition,
      },
      record.bucket,
    )

    const isUserFile = record.ownerType === 'user' || Boolean(record.endUserId)
    const needsAdminAudit = requester.kind === 'user' && requester.role === 'admin' && isUserFile

    return {
      response: {
        fileId: record.id,
        url: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
        disposition,
      },
      record: { purpose: record.purpose, ownerType: record.ownerType },
      needsAdminAudit,
    }
  }

  /** 兼容旧端点 GET /files/:id/url:重发短期签名 URL(归属校验)。 */
  async getSignedUrl(fileId: string, user: AuthedUser): Promise<SignedUrlResponse> {
    const requester: FileRequester = { kind: 'user', userId: user.userId, role: user.role, orgId: user.orgId }
    const record = await this.requireAlive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({ error: { code: 'FILE_ACCESS_DENIED', message: '无权访问此文件' } })
    }
    const signed = this.storage.getDownloadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        ttlSeconds: this.storage.signTtlSeconds,
        disposition: 'inline',
      },
      record.bucket,
    )
    return {
      fileId: record.id,
      signedUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      purpose: record.purpose as FilePurpose,
    }
  }

  // ── 读取文件 buffer(/content 代理;签名校验由 controller 完成)────────────

  async readContent(
    fileId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string; purpose: FilePurpose }> {
    const record = await this.requireAlive(fileId)
    const buffer = await this.storage.getObject(record.storageKey, record.bucket)
    return {
      buffer,
      mimeType: record.mimeType,
      filename: record.filename,
      purpose: record.purpose as FilePurpose,
    }
  }

  // ── 列表(admin)─────────────────────────────────────────────────────────

  async list(args: { includeDeleted?: boolean; purpose?: string; limit?: number } = {}): Promise<FileMetadata[]> {
    const records = await this.prisma.fileObject.findMany({
      where: {
        ...(args.includeDeleted ? {} : { deletedAt: null }),
        ...(args.purpose ? { purpose: args.purpose } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(args.limit ?? 100, 500),
    })
    return records.map(toMetadata)
  }

  // ── 删除 ────────────────────────────────────────────────────────────────────

  /** 管理员强制删除(软删 + 物理删 COS / 本地对象)。 */
  async forceDelete(fileId: string, adminId: string, reason: string): Promise<FileMetadata> {
    return this._delete(fileId, `admin:${adminId}`, reason)
  }

  /**
   * 归属人删除(owner / 管理员)。软删数据库记录,并物理删除对象。
   * 合规:敏感文件删除即物理回收,不留持久公开物。
   */
  async ownerDelete(fileId: string, requester: FileRequester, reason: string): Promise<FileMetadata> {
    const record = await this.requireAlive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({ error: { code: 'FILE_ACCESS_DENIED', message: '无权删除此文件' } })
    }
    const deletedBy = requester.kind === 'member' ? `member:${requester.endUserId}` : requester.role === 'admin' ? `admin:${requester.userId}` : `user:${requester.userId}`
    return this._delete(fileId, deletedBy, reason)
  }

  private async _delete(fileId: string, deletedBy: string, reason: string): Promise<FileMetadata> {
    const record = await this.requireAlive(fileId)
    await this.storage.deleteObject(record.storageKey, record.bucket)
    const updated = await this.prisma.fileObject.update({
      where: { id: fileId },
      data: { deletedAt: new Date(), deletedBy, deleteReason: reason, status: 'deleted' },
    })
    this.logger.log(`File deleted by ${deletedBy}: ${fileId}`)
    return toMetadata(updated)
  }

  // ── cron / 手动:清理所有已过期文件 ─────────────────────────────────────

  async cleanupExpired(triggeredBy: 'manual' | 'cron'): Promise<FileCleanupResponse> {
    const now = new Date()
    const expired = await this.prisma.fileObject.findMany({
      where: { deletedAt: null, expiresAt: { lt: now } },
      select: { id: true, storageKey: true, bucket: true, purpose: true, sensitiveLevel: true },
    })

    const deletedIds: string[] = []
    const bySensitiveLevel: Record<string, number> = {}
    const byPurpose: Record<string, number> = {}
    for (const f of expired) {
      try {
        await this.storage.deleteObject(f.storageKey, f.bucket)
        await this.prisma.fileObject.update({
          where: { id: f.id },
          data: {
            deletedAt: now,
            deletedBy: 'auto',
            deleteReason: triggeredBy === 'manual' ? 'manual cleanup of expired' : 'cron cleanup of expired',
            status: 'deleted',
          },
        })
        deletedIds.push(f.id)
        bySensitiveLevel[f.sensitiveLevel] = (bySensitiveLevel[f.sensitiveLevel] ?? 0) + 1
        byPurpose[f.purpose] = (byPurpose[f.purpose] ?? 0) + 1
      } catch (err) {
        this.logger.warn(`Failed to cleanup file ${f.id}: ${(err as Error).message}`)
      }
    }
    if (deletedIds.length > 0) {
      this.logger.log(`Cleanup (${triggeredBy}): deleted ${deletedIds.length} expired files`)
    }

    if (triggeredBy === 'cron' && deletedIds.length > 0) {
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'file.cleanup_expired',
        targetType: 'file',
        targetId: null,
        payload: {
          triggeredBy,
          deletedCount: deletedIds.length,
          bySensitiveLevel,
          byPurpose,
          fileIdDigest: deletedIds.slice(0, 50),
        },
      })
    }

    return {
      deletedCount: deletedIds.length,
      deletedFileIds: deletedIds,
      triggeredBy,
      triggeredAt: now.toISOString(),
    }
  }

  // ── 内部 ────────────────────────────────────────────────────────────────────

  private resolveSensitiveLevel(purpose: FilePurpose, explicit?: FileSensitiveLevel): FileSensitiveLevel {
    return explicit ?? DEFAULT_SENSITIVE_BY_PURPOSE[purpose] ?? 'normal'
  }

  private computeExpiry(sensitiveLevel: FileSensitiveLevel): Date {
    const ttlHours = FILE_DEFAULT_TTL_HOURS[sensitiveLevel]
    return new Date(Date.now() + ttlHours * 60 * 60 * 1000)
  }

  private async requireAlive(fileId: string) {
    const record = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!record || record.deletedAt) {
      throw new NotFoundException({ error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' } })
    }
    return record
  }
}

/** 归属判定。member 只能访问 endUserId 匹配;User 按角色 / 上传者 / 机构。 */
export function canAccessFile(
  record: { uploaderId: string | null; endUserId: string | null; ownerType: string | null; ownerId: string | null },
  requester: FileRequester,
): boolean {
  if (requester.kind === 'member') {
    return Boolean(record.endUserId) && record.endUserId === requester.endUserId
  }
  // requester.kind === 'user'
  if (requester.role === 'admin') return true
  if (record.uploaderId && record.uploaderId === requester.userId) return true
  // 合作机构只能访问本机构(partner)文件,绝不能访问用户简历(ownerType='user')
  if (
    requester.role === 'partner' &&
    record.ownerType === 'partner' &&
    record.ownerId &&
    requester.orgId &&
    record.ownerId === requester.orgId
  ) {
    return true
  }
  return false
}

/** 由上传上下文推断 ownerType / ownerId。 */
export function deriveOwner(args: {
  endUserId: string | null
  role: UserRole | null
  uploaderId: string | null
  orgId: string | null
}): { ownerType: FileOwnerType; ownerId: string | null } {
  if (args.endUserId) return { ownerType: 'user', ownerId: args.endUserId }
  if (args.role === 'admin') return { ownerType: 'admin', ownerId: args.uploaderId }
  if (args.role === 'partner') return { ownerType: 'partner', ownerId: args.orgId }
  return { ownerType: 'system', ownerId: null }
}

function toMetadata(r: {
  id: string
  bucket: string
  region: string
  storageKey: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: string
  sensitiveLevel: string
  ownerType: string | null
  ownerId: string | null
  visibility: string
  status: string
  uploaderId: string | null
  endUserId: string | null
  createdBy: string | null
  expiresAt: Date
  deletedAt: Date | null
  deletedBy: string | null
  deleteReason: string | null
  createdAt: Date
}): FileMetadata {
  return {
    id: r.id,
    bucket: r.bucket,
    region: r.region,
    objectKey: r.storageKey,
    filename: r.filename,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    purpose: r.purpose as FilePurpose,
    sensitiveLevel: r.sensitiveLevel as FileSensitiveLevel,
    ownerType: r.ownerType as FileOwnerType | null,
    ownerId: r.ownerId,
    visibility: r.visibility as FileMetadata['visibility'],
    status: r.status as FileStatus,
    uploaderId: r.uploaderId,
    endUserId: r.endUserId,
    createdBy: r.createdBy,
    expiresAt: r.expiresAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    deletedBy: r.deletedBy,
    deleteReason: r.deleteReason,
    createdAt: r.createdAt.toISOString(),
  }
}
