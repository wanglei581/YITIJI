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
import type { FilePurpose, FileUploadResponse } from '../files/file.types'
import { restoreMultipartUtf8Filename } from '../files/file-validation'
import { FilesService } from '../files/files.service'
import { signFileUrl } from '../files/signing'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../common/redis/redis.service'
import type { Redis } from 'ioredis'
import {
  abandonAfterCommit,
  cleanupExpiredSessions as sweepExpiredUploadSessions,
  driveMemberBind,
  expiredUploadSessionException,
  finishExpired,
  isLiveMember,
  loadBindFile,
  sessionRetainsMemberFile,
  type MemberBindHost,
  type StoredUploadSession,
  type StoredUploadSessionCleanup,
  type UploadSessionConfirmResponse,
  type UploadSessionFileView,
} from './upload-session-member-bind'
import { deleteAnonymousObjectThenTombstone } from './upload-session-object-delete'
import { isWellFormedSceneToken, mintSceneToken, sceneIndexKey } from './upload-scene'
import { clientDeclarationJson, type ClientDeclaration } from '../common/privacy/client-declaration'
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

export type { UploadSessionFileView, UploadSessionConfirmResponse, StoredUploadSession }

export interface UploadSessionStatusResponse {
  sessionId: string
  status: UploadSessionStatus
  purpose: FilePurpose
  mode: UploadSessionMode
  file: UploadSessionFileView | null
  requiresKioskConfirmation: boolean
  expiresAt: string
}

export interface UploadSessionCancelResponse {
  sessionId: string
  status: 'cancelled'
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
  private readonly memberBind: MemberBindHost

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => FilesService))
    private readonly files: FilesService,
  ) {
    this.redisClient = (redis as unknown as { client: Pick<Redis, 'zadd' | 'zrangebyscore' | 'zrem'> }).client
    this.memberBind = {
      prisma: this.prisma,
      files: this.files,
      redis: this.redis,
      redisClient: this.redisClient,
      cleanupBatchLimit: CLEANUP_BATCH_LIMIT,
      lockTtlSeconds: UPLOAD_LOCK_TTL_SECONDS,
      expiryIndexKey: UPLOAD_EXPIRY_INDEX_KEY,
      confirmedFileUrlTtlMs: CONFIRMED_FILE_URL_TTL_MS,
      signedUrlPurposes: SIGNED_URL_PURPOSES,
      sessionRedisTtlSeconds,
      uploadLockKey,
      sessionKey,
      commitSession: (record, lockKey, lockToken, expectedStatus, expectedFileId, expectedPhase, mirror) =>
        this.commitSession(record, lockKey, lockToken, expectedStatus, expectedFileId, expectedPhase, mirror),
      loadOptional: (sessionId) => this.loadOptional(sessionId),
      loadCleanupRecord: (sessionId) => this.loadCleanupRecord(sessionId),
      removeFromExpiryIndex: (sessionId) => this.removeFromExpiryIndex(sessionId),
      markExpired: (record, now) => this.markExpired(record, now),
    }
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
      revision: 0,
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
    clientDeclaration?: ClientDeclaration
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
      const latest: StoredUploadSession = { ...loaded, status: 'uploading', file: null }
      const started = await this.commitSession(
        latest,
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
        await deleteAnonymousObjectThenTombstone(
          this.memberBind,
          file.fileId,
          'upload session expired during upload',
        )
        if (marked === 'updated') await this.removeFromExpiryIndex(args.sessionId)
        throw expiredSessionException()
      }
      const committed = await this.commitSession(uploaded, lockKey, lockToken, 'uploading')
      if (committed !== 'updated') {
        await deleteAnonymousObjectThenTombstone(
          this.memberBind,
          file.fileId,
          'upload lock lost before commit',
        )
        if (committed === 'expired') throw expiredSessionException()
        if (committed === 'conflict') {
          throw new BadRequestException({
            error: { code: 'UPLOAD_SESSION_NOT_PENDING', message: '该二维码已使用,请重新生成' },
          })
        }
        throw uploadInProgressException()
      }
      await this.persistCleanupRecord(uploaded)
      if (args.clientDeclaration) {
        await this.prisma.auditLog.create({
          data: {
            actorId: null,
            actorRole: 'kiosk',
            action: 'file.upload',
            targetType: 'file',
            targetId: file.fileId,
            payloadJson: JSON.stringify({
              source: 'upload_session',
              clientDeclaration: JSON.parse(clientDeclarationJson(args.clientDeclaration) ?? '{}'),
            }),
          },
        }).catch(() => undefined)
      }
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
      if (stored.status === 'confirmed' && stored.file) {
        if (stored.mode === 'member' && (!endUserId || endUserId !== stored.pendingEndUserId)) {
          throw new ForbiddenException({
            error: { code: 'UPLOAD_SESSION_MEMBER_MISMATCH', message: '会员身份与上传会话不一致' },
          })
        }
        return { sessionId, status: 'confirmed', file: stored.file }
      }
      if (record.status === 'expired') {
        const retained = await sessionRetainsMemberFile(this.memberBind, stored)
        await finishExpired(this.memberBind, stored, 'upload session expired before confirm', lock)
        throw expiredSessionException(retained)
      }
      if (stored.mode === 'member' && stored.status === 'uploaded' && stored.file) {
        if (!endUserId || endUserId !== stored.pendingEndUserId) {
          throw new ForbiddenException({
            error: { code: 'UPLOAD_SESSION_MEMBER_MISMATCH', message: '会员身份与上传会话不一致' },
          })
        }
        return driveMemberBind(this.memberBind, stored, lock, endUserId)
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
      const record = this.markExpired(stored)
      if (record.status === 'expired') {
        const retained = await sessionRetainsMemberFile(this.memberBind, stored)
        await finishExpired(this.memberBind, stored, 'upload session expired before cancel', lock)
        throw expiredSessionException(retained)
      }
      const file = stored.file ? await loadBindFile(this.memberBind, stored.file.fileId) : null
      if (file && isLiveMember(file) && stored.bind && stored.bind.phase !== 'done') {
        await driveMemberBind(
          this.memberBind,
          stored,
          lock,
          file.endUserId ?? stored.bind?.endUserId ?? stored.pendingEndUserId ?? '',
        )
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_CONFIRMED', message: '已确认的上传会话不能取消' },
        })
      }
      const committed = await abandonAfterCommit(this.memberBind, stored, 'cancelled', 'upload session cancelled', lock)
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
  cleanupExpiredSessions(now = Date.now()): Promise<{ scanned: number; cleaned: number; skipped: number; failed: number }> {
    return sweepExpiredUploadSessions(this.memberBind, now)
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
    const expectedRevision = record.revision ?? 0
    record.revision = expectedRevision + 1
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
    const committed = await this.redis.compareAndSetSession(
      sessionKey(record.sessionId),
      lockKey,
      lockToken,
      JSON.stringify(record),
      expectedStatus,
      expectedFileId,
      expectedPhase,
      cleanup,
      expectedRevision,
    )
    if (committed !== 'updated') record.revision = expectedRevision
    return committed
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
    if (record.status === 'confirmed' || record.bind?.phase === 'done') return record
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

function expiredSessionException(memberFileRetained = false): BadRequestException {
  return expiredUploadSessionException(memberFileRetained)
}

function uploadInProgressException(): BadRequestException {
  return new BadRequestException({
    error: { code: 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS', message: '该二维码正在上传中,请稍候' },
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
