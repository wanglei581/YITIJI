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
import { restoreMultipartUtf8Filename } from '../files/file-validation'
import { FilesService } from '../files/files.service'
import { defaultRetentionForUpload } from '../files/retention-policy'
import { generateObjectKey } from '../storage/object-key'
import { signFileUrl } from '../files/signing'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../common/redis/redis.service'
import type { Redis } from 'ioredis'
import { isWellFormedSceneToken, mintSceneToken, sceneIndexKey } from './upload-scene'
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
  /**
   * 小程序场景码。一体机把它交给 `/miniapp-code` 换二维码，用户扫码即进小程序。
   * 与 uploadToken 一样只在创建时返回一次（服务端只留哈希）。
   */
  sceneToken: string
}

/**
 * 场景码兑换结果。**不返回会话的 controlToken** —— 那是一体机侧的控制凭据，
 * 手机端拿不到也不该拿到；手机端只需要能把文件传上来。
 */
export interface UploadSessionSceneResolveResponse {
  sessionId: string
  purpose: FilePurpose
  mode: UploadSessionMode
  expiresAt: string
  /** 轮换出来的新上传令牌（旧的当场作废，先兑先得）。 */
  uploadToken: string
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
  /**
   * 可选：滚动升级期间，旧构建创建的会话没有这个字段。缺失时场景码兑换一律拒绝
   * （fail-closed），而不是当成「任何 scene 都对」。
   */
  sceneTokenHash?: string
  file: UploadSessionFileView | null
  uploadedAt: string | null
  confirmedAt: string | null
  expiresAt: string
  createdAt: string
  /** 会员确认的阶段。公开 status 在 obsolete 键删除前保持 uploaded。 */
  bind?: MemberBindIntent | null
}

type MemberBindPhase = 'intent' | 'copied' | 'db-applied' | 'done'

interface MemberBindIntent {
  phase: MemberBindPhase
  fileId: string
  endUserId: string
  userKey: string
  previousKey: string
  bucket: string | null
}

interface BindFileRow {
  id: string
  filename: string
  mimeType: string
  storageKey: string
  bucket: string | null
  purpose: string
  sensitiveLevel: string
  endUserId: string | null
  ownerType: string | null
  deletedAt: Date | null
  expiresAt: Date | null
  pendingStorageKey: string | null
  replacedStorageKey: string | null
  updatedAt: Date | null
}

interface StoredUploadSessionCleanup {
  sessionId: string
  expiresAt: string
  file: UploadSessionFileView | null
  status: 'expired'
  /** 比较失败后未能删掉的复制对象。主会话键过期后仍靠这条记录回收。 */
  stagedObjectKey?: string | null
  stagedBucket?: string | null
  bind?: MemberBindIntent | null
  /** 主会话键消失后，用这份快照把未完成的确认做完。 */
  snapshot?: StoredUploadSession | null
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
    const sceneToken = mintSceneToken()
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
      sceneTokenHash: hashToken(sceneToken),
      file: null,
      uploadedAt: null,
      confirmedAt: null,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    }

    await this.redis.setEx(sessionKey(sessionId), sessionRedisTtlSeconds(), JSON.stringify(record))
    await this.redisClient.zadd(UPLOAD_EXPIRY_INDEX_KEY, expiresAt.getTime(), sessionId)
    // 场景码索引与会话同生命周期：会话过期后索引自然消失，不需要单独回收。
    await this.redis.setEx(sceneIndexKey(sceneToken), sessionRedisTtlSeconds(), sessionId)
    await this.persistCleanupRecord(record)
    return {
      sessionId,
      uploadToken,
      controlToken,
      sceneToken,
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

  /**
   * 场景码兑换：小程序扫码进来后，用 scene 换回可用的上传凭据。
   *
   * 兑换是**一次性**的，靠 Redis 的 GETDEL 原子完成 —— 两个人同时拿同一张码，
   * 只有一个能拿到 sessionId，另一个看到的是「二维码已失效」。用先 GET 再 DEL
   * 会有窗口期，两边都成功。
   *
   * 所有失败路径**返回同一个错误码**。区分「格式不对 / 没这张码 / 已过期 /
   * 已被用掉」对合法用户没有价值（补救动作都是「回一体机刷新二维码」），
   * 对探测者却是一台预言机。
   */
  async resolveScene(scene: string): Promise<UploadSessionSceneResolveResponse> {
    // 格式不对就不查 Redis：省一次往返，也不制造可测量的时间差。
    if (!isWellFormedSceneToken(scene)) throw sceneUnusableException()

    const indexKey = sceneIndexKey(scene)
    const sessionId = await this.redis.get(indexKey)
    if (!sessionId) throw sceneUnusableException()

    // 锁内重读后再轮换，避免用 pending 快照盖掉已经 uploaded 的收据。
    const lockKey = uploadLockKey(sessionId)
    const lockToken = randomUUID()
    if (!(await this.redis.setNxEx(lockKey, lockToken, UPLOAD_LOCK_TTL_SECONDS))) {
      throw sceneUnusableException()
    }
    try {
      const consumed = await this.redis.getDel(indexKey)
      if (consumed !== sessionId) throw sceneUnusableException()
      let record: StoredUploadSession
      try {
        record = this.markExpired(await this.load(sessionId))
      } catch (error) {
        if (error instanceof NotFoundException) throw sceneUnusableException()
        throw error
      }
      if (record.status !== 'pending') throw sceneUnusableException()
    // 纵深防御：索引命中还不够，会话记录里的哈希也必须对得上。
    // 旧构建创建的会话没有 sceneTokenHash —— 缺失即拒绝，不是「随便什么 scene 都行」。
    if (!record.sceneTokenHash || !safeEquals(record.sceneTokenHash, hashToken(scene))) {
      throw sceneUnusableException()
    }

    // 轮换上传令牌：服务端只留哈希，换不回创建时那把明文（见 upload-scene.ts ①②）。
    // 轮换的副作用正是我们想要的 —— 同一个会话的旧网页二维码当场作废。
    const uploadToken = randomBytes(32).toString('base64url')
      const committed = await this.commitSession(
        { ...record, uploadTokenHash: hashToken(uploadToken) },
        lockKey,
        lockToken,
        'pending',
      )
      if (committed !== 'updated') throw sceneUnusableException()

      return {
        sessionId: record.sessionId,
        purpose: record.purpose,
        mode: record.mode,
        expiresAt: record.expiresAt,
        uploadToken,
      }
    } finally {
      await this.redis.getAndDelIfEquals(lockKey, lockToken).catch(() => undefined)
    }
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

    const lockKey = uploadLockKey(args.sessionId)
    const lockToken = randomUUID()
    if (!(await this.redis.setNxEx(lockKey, lockToken, UPLOAD_LOCK_TTL_SECONDS))) {
      throw uploadInProgressException()
    }

    try {
      const loaded = this.markExpired(await this.load(args.sessionId))
      if (loaded.status === 'expired') throw expiredSessionException()
      // 上一轮在落成收据前中断时，记录会停在 uploading 且没有文件。那次没有收据，允许接着传。
      const resumable = loaded.status === 'uploading' && !loaded.file
      if (loaded.status !== 'pending' && !resumable) {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_NOT_PENDING', message: '该二维码已使用,请重新生成' },
        })
      }
      if (!safeEquals(loaded.uploadTokenHash, hashToken(args.uploadToken))) {
        throw new ForbiddenException({
          error: { code: 'UPLOAD_TOKEN_INVALID', message: '上传令牌无效' },
        })
      }
      const started = await this.commitSession(
        { ...loaded, status: 'uploading', file: null },
        lockKey,
        lockToken,
        loaded.status,
      )
      if (started !== 'updated') {
        if (started === 'expired') throw expiredSessionException()
        if (started === 'conflict') {
          throw new BadRequestException({
            error: { code: 'UPLOAD_SESSION_NOT_PENDING', message: '该二维码已使用,请重新生成' },
          })
        }
        throw uploadInProgressException()
      }
      const latest: StoredUploadSession = { ...loaded, status: 'uploading', file: null }

      let file: FileUploadResponse
      try {
        file = await this.files.upload({
          buffer: args.file.buffer,
          filename: restoreMultipartUtf8Filename(
            args.file.originalname || defaultUploadFilename(latest.purpose),
          ),
          mimeType: args.file.mimetype,
          purpose: latest.purpose,
          uploaderId: null,
          endUserId: null,
          createdBy: null,
        })
      } catch (error) {
        await this.commitSession(
          { ...latest, status: 'pending', file: null },
          lockKey,
          lockToken,
          'uploading',
        ).catch(() => undefined)
        throw error
      }

      const uploaded: StoredUploadSession = {
        ...latest,
        status: 'uploaded',
        file: toSessionFile(file),
        uploadedAt: new Date().toISOString(),
      }
      if (this.markExpired(uploaded).status === 'expired') {
        const marked = await this.commitSession(
          { ...latest, status: 'expired', file: null },
          lockKey,
          lockToken,
          'uploading',
        )
        await this.files.systemDelete(file.fileId, 'upload session expired during upload').catch(() => undefined)
        if (marked === 'updated') await this.removeFromExpiryIndex(args.sessionId)
        throw expiredSessionException()
      }
      const committed = await this.commitSession(uploaded, lockKey, lockToken, 'uploading')
      if (committed !== 'updated') {
        await this.files.systemDelete(file.fileId, 'upload lock lost before commit').catch(() => undefined)
        if (committed === 'expired') throw expiredSessionException()
        if (committed === 'conflict') {
          throw new BadRequestException({
            error: { code: 'UPLOAD_SESSION_NOT_PENDING', message: '该二维码已使用,请重新生成' },
          })
        }
        throw uploadInProgressException()
      }
      await this.persistCleanupRecord(uploaded)
      return this.toStatusResponse(uploaded)
    } finally {
      await this.redis.getAndDelIfEquals(lockKey, lockToken).catch(() => undefined)
    }
  }

  async confirm(
    sessionId: string,
    controlToken: string | undefined,
    endUserId?: string | null,
  ): Promise<UploadSessionConfirmResponse> {
    return this.withSessionLock(sessionId, async (lock) => {
      const stored = await this.load(sessionId)
      const record = this.markExpired(stored)
      this.assertControlToken(record, controlToken)
      if (stored.mode === 'member' && stored.status === 'uploaded' && stored.file && record.status !== 'expired') {
        if (!endUserId || endUserId !== stored.pendingEndUserId) {
          throw new ForbiddenException({
            error: { code: 'UPLOAD_SESSION_MEMBER_MISMATCH', message: '会员身份与上传会话不一致' },
          })
        }
        return this.driveMemberBind(stored, lock, endUserId)
      }
      if (record.status === 'expired') {
        await this.finishExpired(stored, 'upload session expired before confirm', lock)
        throw expiredSessionException()
      }
      if (stored.status !== 'uploaded' || !stored.file) {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端尚未上传文件' },
        })
      }
      let confirmedFile = stored.file
      if (SIGNED_URL_PURPOSES.has(stored.purpose)) {
        const signed = signFileUrl(confirmedFile.fileId, CONFIRMED_FILE_URL_TTL_MS)
        confirmedFile = { ...confirmedFile, fileUrl: signed.url }
      }
      const confirmed: StoredUploadSession = {
        ...stored,
        status: 'confirmed',
        file: confirmedFile,
        confirmedAt: new Date().toISOString(),
      }
      const committed = await this.commitSession(
        confirmed,
        lock.lockKey,
        lock.lockToken,
        'uploaded',
        stored.file.fileId,
      )
      if (committed !== 'updated') {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
        })
      }
      await this.removeFromExpiryIndex(sessionId)
      return { sessionId, status: 'confirmed', file: confirmedFile }
    })
  }

  async cancel(
    sessionId: string,
    controlToken: string | undefined,
  ): Promise<UploadSessionCancelResponse> {
    return this.withSessionLock(sessionId, async (lock) => {
      const stored = await this.load(sessionId)
      this.assertControlToken(this.markExpired(stored), controlToken)
      if (stored.status === 'confirmed') {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_CONFIRMED', message: '已确认的上传会话不能取消' },
        })
      }
      const file = stored.file ? await this.loadBindFile(stored.file.fileId) : null
      if (file && this.isLiveMember(file) && stored.bind && stored.bind.phase !== 'done') {
        await this.driveMemberBind(
          stored,
          lock,
          file.endUserId ?? stored.bind?.endUserId ?? stored.pendingEndUserId ?? '',
        )
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_CONFIRMED', message: '已确认的上传会话不能取消' },
        })
      }
      const record = this.markExpired(stored)
      if (record.status === 'expired') {
        await this.finishExpired(stored, 'upload session expired before cancel', lock)
        throw expiredSessionException()
      }
      if (file && !file.deletedAt && stored.bind) {
        const claimed = await this.prisma.fileObject.updateMany({
          where: { id: file.id, storageKey: file.storageKey, deletedAt: null },
          data: {
            deletedAt: new Date(),
            deletedBy: 'system',
            deleteReason: 'upload session cancelled',
            status: 'deleted',
          },
        })
        if (claimed.count === 0) {
          const current = await this.loadBindFile(file.id)
          if (current && this.isLiveMember(current)) {
            await this.driveMemberBind(stored, lock, current.endUserId ?? stored.pendingEndUserId ?? '')
            throw new BadRequestException({
              error: { code: 'UPLOAD_SESSION_CONFIRMED', message: '已确认的上传会话不能取消' },
            })
          }
        }
      }
      const committed = await this.abandonAfterCommit(stored, 'cancelled', 'upload session cancelled', lock)
      if (committed !== 'updated') {
        const current = await this.loadOptional(sessionId)
        if (current?.status === 'confirmed') {
          throw new BadRequestException({
            error: { code: 'UPLOAD_SESSION_CONFIRMED', message: '已确认的上传会话不能取消' },
          })
        }
        if (!current || this.markExpired(current).status === 'expired') throw expiredSessionException()
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_ACTION_IN_PROGRESS', message: '上传会话正在处理中，请稍候' },
        })
      }
      return { sessionId, status: 'cancelled' }
    })
  }

  /** 由既有 FilesCleanupTask 每分钟调用；Redis 不可用时由调用方降级为 warn。 */
  async cleanupExpiredSessions(now = Date.now()): Promise<{ scanned: number; cleaned: number; skipped: number; failed: number }> {
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
    let failed = 0
    for (const sessionId of sessionIds) {
      const lockKey = uploadLockKey(sessionId)
      const lockToken = randomUUID()
      const acquired = await this.redis.setNxEx(lockKey, lockToken, UPLOAD_LOCK_TTL_SECONDS)
      if (!acquired) {
        skipped += 1
        continue
      }
      const lock = { lockKey, lockToken }
      try {
        const outcome = await this.cleanupOne(sessionId, now, lock)
        if (outcome === 'cleaned') cleaned += 1
      } catch {
        failed += 1
        await this.redisClient.zadd(UPLOAD_EXPIRY_INDEX_KEY, now + 60_000, sessionId).catch(() => undefined)
      } finally {
        await this.redis.getAndDelIfEquals(lockKey, lockToken).catch(() => undefined)
      }
    }
    try {
      failed += await this.recoverStorageKeys(now)
    } catch {
      failed += 1
    }
    return { scanned: sessionIds.length, cleaned, skipped, failed }
  }

  private async cleanupOne(
    sessionId: string,
    now: number,
    lock: { lockKey: string; lockToken: string },
  ): Promise<'cleaned' | 'idle'> {
    let record = await this.loadOptional(sessionId)
    const persisted = await this.loadCleanupRecord(sessionId)
    if (
      !record
      && persisted?.snapshot
      && persisted.bind
      && persisted.bind.phase !== 'done'
      && new Date(persisted.expiresAt).getTime() > now
    ) {
      await this.redis.setEx(sessionKey(sessionId), sessionRedisTtlSeconds(), JSON.stringify(persisted.snapshot))
      record = await this.loadOptional(sessionId)
    }
    if (record?.status === 'confirmed') {
      await this.finishConfirmed(record, lock)
      return 'idle'
    }
    if (record?.bind && record.bind.phase !== 'done') {
      const file = record.file ? await this.loadBindFile(record.file.fileId) : null
      if (file && this.isLiveMember(file)) {
        await this.driveMemberBind(record, lock, record.bind.endUserId)
        return 'cleaned'
      }
      const expired = new Date(record.expiresAt).getTime() <= now
        || record.status === 'cancelled'
        || record.status === 'expired'
      if (!expired && record.status === 'uploaded') {
        await this.driveMemberBind(record, lock, record.bind.endUserId)
        return 'cleaned'
      }
      await this.abandonBoundAttempt(
        record,
        lock,
        record.status === 'cancelled' ? 'upload session cancelled' : 'upload session expired',
      )
      return 'cleaned'
    }
    if (record && (record.status === 'cancelled' || record.status === 'expired')) {
      if (record.file) await this.deleteRetainedFile(record, 'upload session expired', lock)
      await this.releaseCleanup(sessionId)
      return 'cleaned'
    }
    const cleanup = record ?? persisted
    if (!cleanup || new Date(cleanup.expiresAt).getTime() > now) return 'idle'
    if (record && this.markExpired(record, now).status !== 'expired') return 'idle'
    if (!record) {
      if (cleanup.file) await this.cleanupAbandonedFile(cleanup, 'upload session expired')
      await this.releaseCleanup(sessionId)
      return 'cleaned'
    }
    const committed = await this.abandonAfterCommit(record, 'expired', 'upload session expired', lock)
    if (committed !== 'updated') {
      const current = await this.loadOptional(sessionId)
      if (current?.status === 'confirmed') await this.finishConfirmed(current, lock)
      return 'idle'
    }
    return 'cleaned'
  }

  private async cleanupAbandonedFile(
    record: Pick<StoredUploadSession, 'file' | 'status'>,
    reason: string,
  ): Promise<void> {
    if (!record.file || record.status === 'confirmed') return
    const file = await this.prisma.fileObject.findUnique({
      where: { id: record.file.fileId },
      select: { endUserId: true, ownerType: true },
    })
    if (file?.endUserId || file?.ownerType === 'user') return
    await this.files.systemDelete(record.file.fileId, reason)
  }

  private async driveMemberBind(
    stored: StoredUploadSession,
    lock: { lockKey: string; lockToken: string },
    endUserId: string,
  ): Promise<UploadSessionConfirmResponse> {
    if (!stored.file) {
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端尚未上传文件' },
      })
    }
    const endUser = endUserId || stored.bind?.endUserId || stored.pendingEndUserId || ''
    if (!endUser || (stored.pendingEndUserId && endUser !== stored.pendingEndUserId)) {
      throw new ForbiddenException({
        error: { code: 'UPLOAD_SESSION_MEMBER_MISMATCH', message: '会员身份与上传会话不一致' },
      })
    }
    let session = stored
    let file = await this.reloadOrCompensate(stored.file.fileId, session, stored.bind?.userKey ?? null, stored.bind?.bucket ?? null)
    if (file.purpose === 'contract_upload' && !file.expiresAt) {
      throw new BadRequestException({
        error: { code: 'CONTRACT_FILE_EXPIRY_MISSING', message: '上传文件状态异常，请重新上传' },
      })
    }
    const userKey = session.bind?.userKey ?? file.pendingStorageKey ?? this.memberObjectKey(file, endUser)
    let previousKey = file.replacedStorageKey
      ?? session.bind?.previousKey
      ?? file.storageKey
    if (previousKey === userKey && file.storageKey !== userKey) previousKey = file.storageKey
    const bucket = file.bucket
    let phase: MemberBindPhase = session.bind?.phase ?? 'intent'
    const intent = (): MemberBindIntent => ({
      phase,
      fileId: file.id,
      endUserId: endUser,
      userKey,
      previousKey,
      bucket,
    })
    const bound = () => file.ownerType === 'user' && file.storageKey === userKey && !file.deletedAt
    const finishIfPublished = (): UploadSessionConfirmResponse | null => {
      if (session.status === 'confirmed' && session.file) {
        return { sessionId: session.sessionId, status: 'confirmed', file: session.file }
      }
      return null
    }

    if (!bound()) {
      if (!session.bind || phase === 'intent') {
        phase = 'intent'
        session = await this.casBind(session, lock, intent(), session.bind?.phase === 'intent' ? 'intent' : '')
        let published = finishIfPublished()
        if (published) return published
        await this.claimPendingKey(file, userKey)
        if (file.storageKey !== userKey) {
          await this.files.copyObjectToKey(file.storageKey, userKey, file.mimeType, bucket)
        }
        file = await this.reloadOrCompensate(file.id, session, userKey, bucket)
        phase = 'copied'
        previousKey = file.storageKey === userKey ? previousKey : file.storageKey
        session = await this.casBind(session, lock, intent(), 'intent')
        published = finishIfPublished()
        if (published) return published
      } else if (file.storageKey !== userKey) {
        await this.files.copyObjectToKey(file.storageKey, userKey, file.mimeType, bucket)
        file = await this.reloadOrCompensate(file.id, session, userKey, bucket)
      }
      if (!bound()) {
        previousKey = file.storageKey === userKey ? previousKey : file.storageKey
        phase = 'copied'
        await this.applyOwnership(file, intent())
        file = await this.reloadOrCompensate(file.id, session, userKey, bucket)
        if (!bound()) {
          throw new BadRequestException({
            error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
          })
        }
      }
    }

    file = await this.reloadOrCompensate(file.id, session, userKey, bucket)
    if (file.replacedStorageKey && file.replacedStorageKey !== file.storageKey) {
      previousKey = file.replacedStorageKey
      phase = 'db-applied'
      const expected = session.bind?.phase === 'db-applied' ? 'db-applied' : (session.bind?.phase ?? 'copied')
      session = await this.casBind(session, lock, intent(), expected)
      const published = finishIfPublished()
      if (published) return published
      await this.files.deleteObjectAtKey(file.replacedStorageKey, bucket)
      await this.prisma.fileObject.updateMany({
        where: { id: file.id, storageKey: file.storageKey, replacedStorageKey: file.replacedStorageKey },
        data: { replacedStorageKey: null },
      })
      file = await this.reloadOrCompensate(file.id, session, userKey, bucket)
      if (file.replacedStorageKey) {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
        })
      }
    } else if (session.bind?.phase !== 'db-applied' && session.bind?.phase !== 'done') {
      phase = 'db-applied'
      session = await this.casBind(session, lock, intent(), session.bind?.phase ?? 'copied')
      const published = finishIfPublished()
      if (published) return published
    }
    return this.publishConfirmed(session, lock, file)
  }

  private async publishConfirmed(
    session: StoredUploadSession,
    lock: { lockKey: string; lockToken: string },
    file: BindFileRow,
  ): Promise<UploadSessionConfirmResponse> {
    if (!session.file || file.deletedAt || (session.mode === 'member' && (file.ownerType !== 'user' || file.replacedStorageKey))) {
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
      })
    }
    if (session.bind && file.storageKey !== session.bind.userKey) {
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
      })
    }
    let confirmedFile: UploadSessionFileView = {
      ...session.file,
      fileExpiresAt: file.expiresAt ? file.expiresAt.toISOString() : session.file.fileExpiresAt,
    }
    if (SIGNED_URL_PURPOSES.has(session.purpose)) {
      const signed = signFileUrl(confirmedFile.fileId, CONFIRMED_FILE_URL_TTL_MS)
      confirmedFile = { ...confirmedFile, fileUrl: signed.url }
    }
    const next: StoredUploadSession = {
      ...session,
      status: 'confirmed',
      file: confirmedFile,
      confirmedAt: new Date().toISOString(),
      bind: session.bind ? { ...session.bind, phase: 'done' } : null,
    }
    const committed = await this.commitSession(
      next,
      lock.lockKey,
      lock.lockToken,
      'uploaded',
      session.file.fileId,
      session.bind?.phase ?? null,
      true,
    )
    if (committed !== 'updated') {
      const current = await this.loadOptional(session.sessionId)
      if (current?.status === 'confirmed' && current.file) {
        await this.removeFromExpiryIndex(session.sessionId)
        return { sessionId: session.sessionId, status: 'confirmed', file: current.file }
      }
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
      })
    }
    await this.removeFromExpiryIndex(session.sessionId)
    return { sessionId: session.sessionId, status: 'confirmed', file: confirmedFile }
  }

  private async casBind(
    session: StoredUploadSession,
    lock: { lockKey: string; lockToken: string },
    bind: MemberBindIntent,
    expectedPhase: string,
  ): Promise<StoredUploadSession> {
    const next: StoredUploadSession = { ...session, status: 'uploaded', bind, confirmedAt: null }
    const committed = await this.commitSession(
      next,
      lock.lockKey,
      lock.lockToken,
      'uploaded',
      session.file?.fileId ?? bind.fileId,
      expectedPhase,
      true,
    )
    if (committed === 'updated') return next
    const current = await this.loadOptional(session.sessionId)
    if (current?.status === 'confirmed' && current.file) return current
    if (current?.status === 'uploaded' && current.bind?.phase === bind.phase && current.bind.fileId === bind.fileId) {
      return current
    }
    throw new BadRequestException({
      error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
    })
  }

  private async claimPendingKey(file: BindFileRow, userKey: string): Promise<void> {
    if (file.pendingStorageKey === userKey || file.storageKey === userKey) return
    const claimed = await this.prisma.fileObject.updateMany({
      where: { id: file.id, storageKey: file.storageKey, deletedAt: null, pendingStorageKey: null },
      data: { pendingStorageKey: userKey },
    })
    if (claimed.count === 1) return
    const current = await this.loadBindFile(file.id)
    if (current?.pendingStorageKey === userKey) return
    if (current?.ownerType === 'user' && current.storageKey === userKey) return
    throw new BadRequestException({
      error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
    })
  }

  private async applyOwnership(file: BindFileRow, intent: MemberBindIntent): Promise<void> {
    const retention = defaultRetentionForUpload({
      purpose: file.purpose as FilePurpose,
      sensitiveLevel: file.sensitiveLevel as FileSensitiveLevel,
      ownerType: 'user',
      endUserId: intent.endUserId,
    })
    const isContract = file.purpose === 'contract_upload'
    const switched = await this.prisma.fileObject.updateMany({
      where: {
        id: file.id,
        storageKey: intent.previousKey,
        deletedAt: null,
        pendingStorageKey: intent.userKey,
      },
      data: {
        endUserId: intent.endUserId,
        ownerType: 'user',
        ownerId: intent.endUserId,
        storageKey: intent.userKey,
        pendingStorageKey: null,
        replacedStorageKey: intent.previousKey === intent.userKey ? null : intent.previousKey,
        expiresAt: isContract ? file.expiresAt : retention.expiresAt,
        retentionPolicy: retention.retentionPolicy,
        retentionSetBy: retention.retentionSetBy,
        retentionConsentAt: retention.retentionConsentAt,
        retentionConsentVersion: retention.retentionConsentVersion,
        ...(isContract
          ? {
              sensitiveLevel: 'highly_sensitive',
              visibility: 'private',
              retentionLockedReason: 'contract_review_session_only',
            }
          : {}),
      },
    })
    if (switched.count === 1) return
    const current = await this.loadBindFile(file.id)
    if (current?.ownerType === 'user' && current.storageKey === intent.userKey && !current.deletedAt) return
    throw new BadRequestException({
      error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
    })
  }

  private async finishConfirmed(
    record: StoredUploadSession,
    _lock: { lockKey: string; lockToken: string },
  ): Promise<void> {
    const file = record.file ? await this.loadBindFile(record.file.fileId) : null
    if (file?.replacedStorageKey && file.replacedStorageKey !== file.storageKey) {
      await this.files.deleteObjectAtKey(file.replacedStorageKey, file.bucket)
      await this.prisma.fileObject.updateMany({
        where: { id: file.id, replacedStorageKey: file.replacedStorageKey },
        data: { replacedStorageKey: null },
      })
    }
    await this.releaseCleanup(record.sessionId)
  }

  private async abandonBoundAttempt(
    record: StoredUploadSession,
    lock: { lockKey: string; lockToken: string },
    reason: string,
  ): Promise<void> {
    const file = record.file ? await this.loadBindFile(record.file.fileId) : null
    if (file && this.isLiveMember(file)) {
      await this.driveMemberBind(record, lock, record.bind?.endUserId ?? file.endUserId ?? '')
      return
    }
    if (file && !file.deletedAt && file.ownerType !== 'user') {
      const claimed = await this.prisma.fileObject.updateMany({
        where: { id: file.id, storageKey: file.storageKey, deletedAt: null },
        data: { deletedAt: new Date(), deletedBy: 'system', deleteReason: reason, status: 'deleted' },
      })
      if (claimed.count === 0) {
        const current = await this.loadBindFile(file.id)
        if (current && this.isLiveMember(current)) {
          await this.driveMemberBind(record, lock, record.bind?.endUserId ?? current.endUserId ?? '')
          return
        }
      }
    }
    const nextStatus = record.status === 'cancelled' ? 'cancelled' : 'expired'
    await this.abandonAfterCommit(record, nextStatus, reason, lock)
  }

  private async recoverStorageKeys(now: number): Promise<number> {
    const rows = await this.prisma.fileObject.findMany({
      where: {
        OR: [
          { pendingStorageKey: { not: null } },
          { replacedStorageKey: { not: null } },
        ],
      },
      take: CLEANUP_BATCH_LIMIT,
    })
    let failed = 0
    const staleBefore = now - sessionRedisTtlSeconds() * 1000
    for (const row of rows) {
      try {
        await this.recoverOneStorageKey(row as BindFileRow, staleBefore)
      } catch {
        failed += 1
      }
    }
    return failed
  }

  private async recoverOneStorageKey(row: BindFileRow, staleBefore: number): Promise<void> {
    if (row.replacedStorageKey && row.replacedStorageKey !== row.storageKey) {
      await this.files.deleteObjectAtKey(row.replacedStorageKey, row.bucket)
      await this.prisma.fileObject.updateMany({
        where: { id: row.id, replacedStorageKey: row.replacedStorageKey },
        data: { replacedStorageKey: null },
      })
      return
    }
    // 行已墓碑时，pendingStorageKey 是还没切成 storageKey 的复制件。
    // 删除失败必须留下指针；不得删除行当前指向的对象。
    if (row.deletedAt && row.pendingStorageKey && row.pendingStorageKey !== row.storageKey) {
      await this.files.deleteObjectAtKey(row.pendingStorageKey, row.bucket)
      await this.prisma.fileObject.updateMany({
        where: {
          id: row.id,
          pendingStorageKey: row.pendingStorageKey,
          storageKey: row.storageKey,
        },
        data: { pendingStorageKey: null },
      })
      return
    }
    if (
      row.pendingStorageKey
      && row.pendingStorageKey !== row.storageKey
      && row.ownerType !== 'user'
      && !row.deletedAt
      && row.updatedAt
      && row.updatedAt.getTime() < staleBefore
    ) {
      const claimed = await this.prisma.fileObject.updateMany({
        where: {
          id: row.id,
          pendingStorageKey: row.pendingStorageKey,
          storageKey: row.storageKey,
          deletedAt: null,
        },
        data: { pendingStorageKey: null, replacedStorageKey: row.pendingStorageKey },
      })
      if (claimed.count !== 1) return
      await this.files.deleteObjectAtKey(row.pendingStorageKey, row.bucket)
      await this.prisma.fileObject.updateMany({
        where: { id: row.id, replacedStorageKey: row.pendingStorageKey },
        data: { replacedStorageKey: null },
      })
    }
  }

  private memberObjectKey(file: BindFileRow, endUserId: string): string {
    return generateObjectKey({
      purpose: file.purpose as FilePurpose,
      ownerType: 'user',
      ownerId: endUserId,
      fileId: file.id,
      ext: extFromFilenameOrKey(file.filename, file.storageKey),
    })
  }

  private isLiveMember(file: Pick<BindFileRow, 'deletedAt' | 'ownerType' | 'endUserId'>): boolean {
    return !file.deletedAt && (file.ownerType === 'user' || Boolean(file.endUserId))
  }

  private async loadBindFile(fileId: string): Promise<BindFileRow | null> {
    const row = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    return row as BindFileRow | null
  }

  private async reloadOrCompensate(
    fileId: string,
    _session: StoredUploadSession,
    userKey: string | null,
    bucket: string | null,
  ): Promise<BindFileRow> {
    const current = await this.loadBindFile(fileId)
    if (!current || current.deletedAt) {
      if (userKey && current?.storageKey !== userKey) {
        await this.files.deleteObjectAtKey(userKey, bucket).catch(() => undefined)
      }
      throw new NotFoundException({
        error: { code: 'FILE_NOT_FOUND', message: '上传文件不存在或已被清理' },
      })
    }
    return current
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

  private async commitSession(
    record: StoredUploadSession,
    lockKey: string,
    lockToken: string,
    expectedStatus: StoredUploadSession['status'],
    expectedFileId: string | null = null,
    expectedPhase: string | null = null,
    mirror = false,
  ): Promise<'updated' | 'lost-lock' | 'expired' | 'conflict'> {
    const cleanup = mirror
      ? {
          key: cleanupKey(record.sessionId),
          value: JSON.stringify(this.cleanupPayload(record)),
          ttlSeconds: CLEANUP_RECORD_TTL_SECONDS,
          indexKey: UPLOAD_EXPIRY_INDEX_KEY,
          indexScore: record.bind && record.bind.phase !== 'done' ? Date.now() : new Date(record.expiresAt).getTime(),
          indexMember: record.sessionId,
        }
      : null
    return this.redis.compareAndSetSession(
      sessionKey(record.sessionId),
      lockKey,
      lockToken,
      JSON.stringify(record),
      expectedStatus,
      expectedFileId,
      expectedPhase,
      cleanup,
    )
  }

  private cleanupPayload(record: StoredUploadSession): StoredUploadSessionCleanup {
    const obsolete = !record.bind || record.bind.phase === 'done'
      ? null
      : record.bind.phase === 'db-applied'
        ? record.bind.previousKey
        : record.bind.userKey
    return {
      sessionId: record.sessionId,
      expiresAt: record.expiresAt,
      file: record.file,
      status: 'expired',
      bind: record.bind ?? null,
      snapshot: record,
      stagedObjectKey: obsolete,
      stagedBucket: record.bind?.bucket ?? null,
    }
  }

  private async persistCleanupRecord(record: StoredUploadSession): Promise<void> {
    await this.redis.setEx(
      cleanupKey(record.sessionId),
      CLEANUP_RECORD_TTL_SECONDS,
      JSON.stringify(this.cleanupPayload(record)),
    )
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

  private async finishExpired(
    stored: StoredUploadSession,
    reason: string,
    lock: { lockKey: string; lockToken: string },
  ): Promise<void> {
    if (stored.bind && stored.bind.phase !== 'done') {
      await this.abandonBoundAttempt(stored, lock, reason)
      return
    }
    await this.abandonAfterCommit(stored, 'expired', reason, lock)
  }

  /**
   * 先把终态写上并保留 fileId。对象删除失败时会话仍指向这份文件，下一轮清扫可以重试。
   * 删除成功后才拿掉指针和过期索引。多余对象删不掉时保留 cleanup 记录。
   */
  private async abandonAfterCommit(
    stored: StoredUploadSession,
    nextStatus: 'cancelled' | 'expired',
    reason: string,
    lock: { lockKey: string; lockToken: string },
  ): Promise<'updated' | 'lost-lock' | 'expired' | 'conflict'> {
    const fileId = stored.file?.fileId ?? null
    const committed = await this.commitSession(
      { ...stored, status: nextStatus },
      lock.lockKey,
      lock.lockToken,
      stored.status,
      fileId,
    )
    if (committed !== 'updated') return committed
    await this.deleteRetainedFile({ ...stored, status: nextStatus }, reason, lock)
    try {
      await this.releaseCleanup(stored.sessionId)
    } catch {
      // 主文件已经进入删除。多余对象的 key 还在 cleanup 记录上，下一轮再删。
    }
    return 'updated'
  }

  private extraObjectKey(cleanup: StoredUploadSessionCleanup | null): string | null {
    if (!cleanup) return null
    if (cleanup.bind && cleanup.bind.phase !== 'done') {
      return cleanup.bind.phase === 'db-applied' ? cleanup.bind.previousKey : cleanup.bind.userKey
    }
    return cleanup.stagedObjectKey ?? null
  }

  private async releaseCleanup(sessionId: string): Promise<void> {
    const cleanup = await this.loadCleanupRecord(sessionId)
    const extra = this.extraObjectKey(cleanup)
    if (extra) {
      const file = cleanup?.file ? await this.loadBindFile(cleanup.file.fileId) : null
      if (!file || file.storageKey !== extra) {
        await this.files.deleteObjectAtKey(extra, cleanup?.bind?.bucket ?? cleanup?.stagedBucket ?? null)
      }
    }
    await this.removeFromExpiryIndex(sessionId)
  }

  private async deleteRetainedFile(
    record: StoredUploadSession,
    reason: string,
    lock: { lockKey: string; lockToken: string },
  ): Promise<void> {
    if (!record.file) return
    await this.cleanupAbandonedFile(record, reason)
    await this.commitSession(
      { ...record, file: null },
      lock.lockKey,
      lock.lockToken,
      record.status,
      record.file.fileId,
    ).catch(() => undefined)
  }

  private async withSessionLock<T>(
    sessionId: string,
    action: (lock: { lockKey: string; lockToken: string }) => Promise<T>,
  ): Promise<T> {
    const lockKey = uploadLockKey(sessionId)
    const lockToken = randomUUID()
    const acquired = await this.redis.setNxEx(lockKey, lockToken, UPLOAD_LOCK_TTL_SECONDS)
    if (!acquired) {
      const current = await this.loadOptional(sessionId)
      if (!current || this.markExpired(current).status === 'expired') throw expiredSessionException()
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_ACTION_IN_PROGRESS', message: '上传会话正在处理中，请稍候' },
      })
    }
    try {
      return await action({ lockKey, lockToken })
    } finally {
      await this.redis.getAndDelIfEquals(lockKey, lockToken).catch(() => undefined)
    }
  }

  private markExpired(record: StoredUploadSession, now = Date.now()): StoredUploadSession {
    if (record.status === 'confirmed' || record.bind?.phase === 'db-applied' || record.bind?.phase === 'done') {
      return record
    }
    if (new Date(record.expiresAt).getTime() <= now) return { ...record, status: 'expired' }
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

/**
 * 场景码不可用的统一出口。刻意**不区分**原因：格式错、查不到、已过期、已被兑换，
 * 对合法用户的补救动作完全一样，对探测者却会变成一台预言机。
 */
function sceneUnusableException(): BadRequestException {
  return new BadRequestException({
    error: { code: 'UPLOAD_SCENE_UNUSABLE', message: '二维码已失效，请回到一体机重新生成' },
  })
}

function expiredSessionException(): BadRequestException {
  return new BadRequestException({
    error: { code: 'UPLOAD_SESSION_EXPIRED', message: '二维码已过期,请重新生成' },
  })
}

function uploadInProgressException(): BadRequestException {
  return new BadRequestException({
    error: { code: 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS', message: '该二维码正在上传中,请稍候' },
  })
}

function extFromFilenameOrKey(filename: string, storageKey: string): string {
  const fromName = filename.includes('.') ? filename.split('.').pop() ?? '' : ''
  if (fromName) return fromName
  const fromKey = storageKey.includes('.') ? storageKey.split('.').pop() ?? '' : ''
  return fromKey
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
