import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import type { FilePurpose, FileSensitiveLevel, FileUploadResponse } from '../files/file.types'
import { FilesService } from '../files/files.service'
import { defaultRetentionForUpload } from '../files/retention-policy'
import { signFileUrl } from '../files/signing'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../common/redis/redis.service'
import type { Redis } from 'ioredis'
import type {
  UploadSessionChannel,
  UploadSessionMode,
  UploadSessionStatus,
} from './upload-sessions.dto'

export interface CreateUploadSessionInput {
  purpose: FilePurpose
  mode: UploadSessionMode
  channel: UploadSessionChannel
  terminalId?: string | null
  uploadUrl: string
  endUserId?: string | null
}

export interface UploadSessionCreateResponse {
  sessionId: string
  uploadUrl: string
  uploadToken: string
  controlToken: string
  expiresAt: string
}

export interface UploadSessionFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  fileExpiresAt: string | null
  /** resume_upload / print_doc / signature_image / contract_upload 在 confirm 时签发的短时 HMAC 内容 URL。 */
  fileUrl?: string | null
}

export interface UploadSessionStatusResponse {
  sessionId: string
  status: UploadSessionStatus
  purpose: FilePurpose
  mode: UploadSessionMode
  file: UploadSessionFileView | null
  requiresKioskConfirmation: boolean
  expiresAt: string
}

export interface UploadSessionConfirmResponse {
  sessionId: string
  status: 'confirmed'
  file: UploadSessionFileView
}

export interface UploadSessionCancelResponse {
  sessionId: string
  status: 'cancelled'
}

interface StoredUploadSession {
  sessionId: string
  purpose: FilePurpose
  mode: UploadSessionMode
  channel: UploadSessionChannel
  status: UploadSessionStatus
  terminalId: string | null
  pendingEndUserId: string | null
  uploadTokenHash: string
  controlTokenHash: string
  file: UploadSessionFileView | null
  uploadedAt: string | null
  confirmedAt: string | null
  expiresAt: string
  createdAt: string
}

interface StoredUploadSessionCleanup {
  sessionId: string
  expiresAt: string
  file: UploadSessionFileView | null
  status: 'expired'
}

const SESSION_TTL_SECONDS = 10 * 60
const SESSION_RETAIN_AFTER_EXPIRE_SECONDS = 60
// 主会话自然过期后，用无令牌的最小 cleanup record 保留回收重试窗口。
const CLEANUP_RECORD_TTL_SECONDS = 24 * 60 * 60
const UPLOAD_LOCK_TTL_SECONDS = 30
const CLEANUP_BATCH_LIMIT = 100
const MAX_SESSION_UPLOAD_BYTES = 10 * 1024 * 1024
/** confirm 签发的内容 URL 有效期，与 kiosk-upload 的 30 分钟 TTL 保持一致。 */
const CONFIRMED_FILE_URL_TTL_MS = 30 * 60 * 1000
const SESSION_PREFIX = 'upload_session:'
const UPLOAD_LOCK_PREFIX = 'upload_session_upload_lock:'
const UPLOAD_EXPIRY_INDEX_KEY = 'upload_session_expiry_index'
const UPLOAD_CLEANUP_PREFIX = 'upload_session_cleanup:'
const SUPPORTED_UPLOAD_SESSION_PURPOSES: ReadonlySet<FilePurpose> = new Set([
  'resume_upload',
  'print_doc',
  'signature_image',
  'contract_upload',
])
const SIGNED_URL_PURPOSES: ReadonlySet<FilePurpose> = new Set([
  'resume_upload',
  'print_doc',
  'signature_image',
  // 匿名合同审查创建需要 x-contract-review-source-file-proof = 短时 HMAC 内容 URL。
  // 这不是打印链接；TTL 与 kiosk-upload 同为 30 分钟。
  'contract_upload',
])

@Injectable()
export class UploadSessionsService {
  private readonly redisClient: Pick<Redis, 'zadd' | 'zrangebyscore' | 'zrem'>

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => FilesService))
    private readonly files: FilesService,
  ) {
    this.redisClient = (redis as unknown as { client: Pick<Redis, 'zadd' | 'zrangebyscore' | 'zrem'> }).client
  }

  async create(input: CreateUploadSessionInput): Promise<UploadSessionCreateResponse> {
    if (!SUPPORTED_UPLOAD_SESSION_PURPOSES.has(input.purpose)) {
      throw new BadRequestException({
        error: {
          code: 'UPLOAD_SESSION_PURPOSE_UNSUPPORTED',
          message: '当前用途不支持扫码上传会话',
        },
      })
    }
    if (input.mode === 'member' && !input.endUserId) {
      throw new UnauthorizedException({
        error: { code: 'MEMBER_AUTH_REQUIRED', message: '会员上传会话需要先在终端登录' },
      })
    }

    const sessionId = randomUUID().replace(/-/g, '')
    const uploadToken = randomBytes(32).toString('base64url')
    const controlToken = randomBytes(32).toString('base64url')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000)
    const record: StoredUploadSession = {
      sessionId,
      purpose: input.purpose,
      mode: input.mode,
      channel: input.channel,
      status: 'pending',
      terminalId: input.terminalId?.trim() || null,
      pendingEndUserId: input.mode === 'member' ? (input.endUserId ?? null) : null,
      uploadTokenHash: hashToken(uploadToken),
      controlTokenHash: hashToken(controlToken),
      file: null,
      uploadedAt: null,
      confirmedAt: null,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    }

    await this.redis.setEx(sessionKey(sessionId), sessionRedisTtlSeconds(), JSON.stringify(record))
    await this.redisClient.zadd(UPLOAD_EXPIRY_INDEX_KEY, expiresAt.getTime(), sessionId)
    await this.persistCleanupRecord(record)
    return {
      sessionId,
      uploadToken,
      controlToken,
      uploadUrl: input.uploadUrl,
      expiresAt: record.expiresAt,
    }
  }

  async getStatus(
    sessionId: string,
    controlToken: string | undefined
  ): Promise<UploadSessionStatusResponse> {
    const record = await this.load(sessionId)
    this.assertControlToken(record, controlToken)
    return this.toStatusResponse(this.markExpired(record))
  }

  async uploadFile(args: {
    sessionId: string
    uploadToken: string
    file: Express.Multer.File
  }): Promise<UploadSessionStatusResponse> {
    if (!args.file) {
      throw new BadRequestException({
        error: { code: 'FILE_REQUIRED', message: '请选择要上传的文件' },
      })
    }
    if (
      args.file.size > MAX_SESSION_UPLOAD_BYTES ||
      args.file.buffer.length > MAX_SESSION_UPLOAD_BYTES
    ) {
      throw new BadRequestException({
        error: { code: 'FILE_TOO_LARGE', message: '手机扫码上传文件不能超过 10MB' },
      })
    }

    const record = this.markExpired(await this.load(args.sessionId))
    if (record.status === 'expired') {
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_EXPIRED', message: '二维码已过期,请在终端重新生成' },
      })
    }
    if (record.status !== 'pending') {
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_NOT_PENDING', message: '该二维码已使用,请重新生成' },
      })
    }
    if (!safeEquals(record.uploadTokenHash, hashToken(args.uploadToken))) {
      throw new ForbiddenException({
        error: { code: 'UPLOAD_TOKEN_INVALID', message: '上传令牌无效' },
      })
    }

    const lockKey = uploadLockKey(args.sessionId)
    const lockAcquired = await this.redis.setNxEx(lockKey, randomUUID(), UPLOAD_LOCK_TTL_SECONDS)
    if (!lockAcquired) {
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS', message: '该二维码正在上传中,请稍候' },
      })
    }

    try {
      const latest = this.markExpired(await this.load(args.sessionId))
      if (latest.status === 'expired') {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_EXPIRED', message: '二维码已过期,请在终端重新生成' },
        })
      }
      if (latest.status !== 'pending') {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_NOT_PENDING', message: '该二维码已使用,请重新生成' },
        })
      }
      if (!safeEquals(latest.uploadTokenHash, hashToken(args.uploadToken))) {
        throw new ForbiddenException({
          error: { code: 'UPLOAD_TOKEN_INVALID', message: '上传令牌无效' },
        })
      }

      const uploading: StoredUploadSession = { ...latest, status: 'uploading' }
      await this.persist(uploading)

      let file: FileUploadResponse
      try {
        file = await this.files.upload({
          buffer: args.file.buffer,
          filename: args.file.originalname || defaultUploadFilename(latest.purpose),
          mimeType: args.file.mimetype,
          purpose: latest.purpose,
          uploaderId: null,
          endUserId: null,
          createdBy: null,
        })
      } catch (error) {
        await this.persist({ ...uploading, status: 'pending' }).catch(() => undefined)
        throw error
      }

      const uploaded: StoredUploadSession = {
        ...uploading,
        status: 'uploaded',
        file: toSessionFile(file),
        uploadedAt: new Date().toISOString(),
      }
      const finalRecord = this.markExpired(uploaded)
      if (finalRecord.status === 'expired') {
        await this.expireLocked(finalRecord, 'upload session expired during upload')
        throw expiredSessionException()
      }
      await this.persist(finalRecord)
      await this.persistCleanupRecord(finalRecord)
      return this.toStatusResponse(finalRecord)
    } finally {
      await this.redis.del(lockKey)
    }
  }

  async confirm(
    sessionId: string,
    controlToken: string | undefined,
    endUserId?: string | null
  ): Promise<UploadSessionConfirmResponse> {
    return this.withSessionLock(sessionId, async () => {
      const record = this.markExpired(await this.load(sessionId))
      this.assertControlToken(record, controlToken)
      if (record.status === 'expired') {
        await this.expireLocked(record, 'upload session expired before confirm')
        throw expiredSessionException()
      }
      if (record.status !== 'uploaded' || !record.file) {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端尚未上传文件' },
        })
      }
      let confirmedFile = record.file
      if (record.mode === 'member') {
        if (!endUserId || endUserId !== record.pendingEndUserId) {
          throw new ForbiddenException({
            error: { code: 'UPLOAD_SESSION_MEMBER_MISMATCH', message: '会员身份与上传会话不一致' },
          })
        }
        const boundFile = await this.bindMemberFile(record.file.fileId, endUserId)
        confirmedFile = {
          ...record.file,
          fileExpiresAt: boundFile.expiresAt ? boundFile.expiresAt.toISOString() : null,
        }
      }
      if (SIGNED_URL_PURPOSES.has(record.purpose)) {
        const signed = signFileUrl(confirmedFile.fileId, CONFIRMED_FILE_URL_TTL_MS)
        confirmedFile = { ...confirmedFile, fileUrl: signed.url }
      }

      const confirmed: StoredUploadSession = {
        ...record,
        status: 'confirmed',
        file: confirmedFile,
        confirmedAt: new Date().toISOString(),
      }
      await this.persist(confirmed)
      await this.removeFromExpiryIndex(sessionId)
      return { sessionId, status: 'confirmed', file: confirmedFile }
    })
  }

  async cancel(
    sessionId: string,
    controlToken: string | undefined
  ): Promise<UploadSessionCancelResponse> {
    return this.withSessionLock(sessionId, async () => {
      const record = this.markExpired(await this.load(sessionId))
      this.assertControlToken(record, controlToken)
      if (record.status === 'expired') {
        await this.expireLocked(record, 'upload session expired before cancel')
        throw expiredSessionException()
      }
      if (record.status === 'confirmed') {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_CONFIRMED', message: '已确认的上传会话不能取消' },
        })
      }
      await this.cleanupAbandonedFile(record, 'upload session cancelled')
      const cancelled: StoredUploadSession = { ...record, status: 'cancelled', file: null }
      await this.persist(cancelled)
      await this.removeFromExpiryIndex(sessionId)
      return { sessionId, status: 'cancelled' }
    })
  }

  /** 由既有 FilesCleanupTask 每分钟调用；Redis 不可用时由调用方降级为 warn。 */
  async cleanupExpiredSessions(now = Date.now()): Promise<{ scanned: number; cleaned: number; skipped: number }> {
    const sessionIds = await this.redisClient.zrangebyscore(
      UPLOAD_EXPIRY_INDEX_KEY,
      '-inf',
      now,
      'LIMIT',
      0,
      CLEANUP_BATCH_LIMIT,
    )
    let cleaned = 0
    let skipped = 0
    for (const sessionId of sessionIds) {
      const lockKey = uploadLockKey(sessionId)
      const acquired = await this.redis.setNxEx(lockKey, randomUUID(), UPLOAD_LOCK_TTL_SECONDS)
      if (!acquired) {
        skipped += 1
        continue
      }
      try {
        const record = await this.loadOptional(sessionId)
        if (record?.status === 'confirmed') {
          await this.removeFromExpiryIndex(sessionId)
          continue
        }
        const cleanup = record ?? await this.loadCleanupRecord(sessionId)
        if (!cleanup || new Date(cleanup.expiresAt).getTime() > now) continue
        if (record && this.markExpired(record, now).status !== 'expired') continue
        await this.cleanupAbandonedFile(cleanup, 'upload session expired')
        if (record) await this.persist({ ...record, status: 'expired', file: null })
        await this.removeFromExpiryIndex(sessionId)
        cleaned += 1
      } finally {
        await this.redis.del(lockKey)
      }
    }
    return { scanned: sessionIds.length, cleaned, skipped }
  }

  private async cleanupAbandonedFile(
    record: Pick<StoredUploadSession, 'file' | 'status'>,
    reason: string
  ): Promise<void> {
    if (!record.file || record.status === 'confirmed') return
    const file = await this.prisma.fileObject.findUnique({
      where: { id: record.file.fileId },
      select: { endUserId: true, ownerType: true },
    })
    if (file?.endUserId || file?.ownerType === 'user') return
    await this.files.systemDelete(record.file.fileId, reason)
  }

  private async bindMemberFile(
    fileId: string,
    endUserId: string
  ): Promise<{ expiresAt: Date | null }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!file || file.deletedAt) {
      throw new NotFoundException({
        error: { code: 'FILE_NOT_FOUND', message: '上传文件不存在或已被清理' },
      })
    }
    const isContractUpload = file.purpose === 'contract_upload'
    if (isContractUpload && !file.expiresAt) {
      throw new BadRequestException({
        error: { code: 'CONTRACT_FILE_EXPIRY_MISSING', message: '上传文件状态异常，请重新上传' },
      })
    }
    const retention = defaultRetentionForUpload({
      purpose: file.purpose as FilePurpose,
      sensitiveLevel: file.sensitiveLevel as FileSensitiveLevel,
      ownerType: 'user',
      endUserId,
    })
    const boundExpiry = isContractUpload ? file.expiresAt : retention.expiresAt
    return this.prisma.fileObject.update({
      where: { id: fileId },
      data: {
        endUserId,
        ownerType: 'user',
        ownerId: endUserId,
        expiresAt: boundExpiry,
        retentionPolicy: retention.retentionPolicy,
        retentionSetBy: retention.retentionSetBy,
        retentionConsentAt: retention.retentionConsentAt,
        retentionConsentVersion: retention.retentionConsentVersion,
        ...(isContractUpload
          ? {
              sensitiveLevel: 'highly_sensitive',
              visibility: 'private',
              retentionLockedReason: 'contract_review_session_only',
            }
          : {}),
      },
      select: { expiresAt: true },
    })
  }

  private async load(sessionId: string): Promise<StoredUploadSession> {
    const raw = await this.redis.get(sessionKey(sessionId))
    if (!raw) {
      throw new NotFoundException({
        error: { code: 'UPLOAD_SESSION_NOT_FOUND', message: '上传会话不存在或已过期' },
      })
    }
    return JSON.parse(raw) as StoredUploadSession
  }

  private async loadOptional(sessionId: string): Promise<StoredUploadSession | null> {
    const raw = await this.redis.get(sessionKey(sessionId))
    return raw ? JSON.parse(raw) as StoredUploadSession : null
  }

  private async persist(record: StoredUploadSession): Promise<void> {
    const ttl = await this.redis.ttl(sessionKey(record.sessionId))
    if (ttl <= 0) {
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_EXPIRED', message: '二维码已过期,请重新生成' },
      })
    }
    await this.redis.setExistingWithCurrentTtl(sessionKey(record.sessionId), JSON.stringify(record))
  }

  private async persistCleanupRecord(record: StoredUploadSession): Promise<void> {
    const cleanup: StoredUploadSessionCleanup = {
      sessionId: record.sessionId,
      expiresAt: record.expiresAt,
      file: record.file,
      status: 'expired',
    }
    await this.redis.setEx(cleanupKey(record.sessionId), CLEANUP_RECORD_TTL_SECONDS, JSON.stringify(cleanup))
  }

  private async loadCleanupRecord(sessionId: string): Promise<StoredUploadSessionCleanup | null> {
    const raw = await this.redis.get(cleanupKey(sessionId))
    return raw ? JSON.parse(raw) as StoredUploadSessionCleanup : null
  }

  private async removeFromExpiryIndex(sessionId: string): Promise<void> {
    await Promise.all([
      this.redisClient.zrem(UPLOAD_EXPIRY_INDEX_KEY, sessionId),
      this.redis.del(cleanupKey(sessionId)),
    ])
  }

  private async expireLocked(record: StoredUploadSession, reason: string): Promise<void> {
    await this.cleanupAbandonedFile(record, reason)
    await this.persist({ ...record, status: 'expired', file: null })
    await this.removeFromExpiryIndex(record.sessionId)
  }

  private async withSessionLock<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const lockKey = uploadLockKey(sessionId)
    const acquired = await this.redis.setNxEx(lockKey, randomUUID(), UPLOAD_LOCK_TTL_SECONDS)
    if (!acquired) {
      const current = await this.loadOptional(sessionId)
      if (!current || this.markExpired(current).status === 'expired') throw expiredSessionException()
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_ACTION_IN_PROGRESS', message: '上传会话正在处理中，请稍候' },
      })
    }
    try {
      return await action()
    } finally {
      await this.redis.del(lockKey)
    }
  }

  private markExpired(record: StoredUploadSession, now = Date.now()): StoredUploadSession {
    if (new Date(record.expiresAt).getTime() <= now && record.status !== 'confirmed') {
      return { ...record, status: 'expired' }
    }
    return record
  }

  private toStatusResponse(record: StoredUploadSession): UploadSessionStatusResponse {
    return {
      sessionId: record.sessionId,
      status: record.status,
      purpose: record.purpose,
      mode: record.mode,
      file: record.file,
      requiresKioskConfirmation: record.mode === 'member',
      expiresAt: record.expiresAt,
    }
  }

  private assertControlToken(record: StoredUploadSession, controlToken: string | undefined): void {
    if (!controlToken || !safeEquals(record.controlTokenHash, hashToken(controlToken))) {
      throw new ForbiddenException({
        error: { code: 'UPLOAD_SESSION_CONTROL_INVALID', message: '上传会话控制令牌无效' },
      })
    }
  }
}

function sessionKey(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`
}

function uploadLockKey(sessionId: string): string {
  return `${UPLOAD_LOCK_PREFIX}${sessionId}`
}

function cleanupKey(sessionId: string): string {
  return `${UPLOAD_CLEANUP_PREFIX}${sessionId}`
}

function expiredSessionException(): BadRequestException {
  return new BadRequestException({
    error: { code: 'UPLOAD_SESSION_EXPIRED', message: '二维码已过期,请重新生成' },
  })
}

function defaultUploadFilename(purpose: FilePurpose): string {
  if (purpose === 'print_doc') return 'document.pdf'
  if (purpose === 'contract_upload') return 'contract.pdf'
  return 'resume.pdf'
}

function sessionRedisTtlSeconds(): number {
  return SESSION_TTL_SECONDS + SESSION_RETAIN_AFTER_EXPIRE_SECONDS
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function toSessionFile(file: FileUploadResponse): UploadSessionFileView {
  return {
    fileId: file.fileId,
    filename: file.filename,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    sha256: file.sha256,
    fileExpiresAt: file.fileExpiresAt,
  }
}
