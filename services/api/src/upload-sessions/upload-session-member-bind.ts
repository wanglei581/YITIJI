import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import type { Redis } from 'ioredis'
import type { FilePurpose, FileSensitiveLevel } from '../files/file.types'
import { FilesService } from '../files/files.service'
import { defaultRetentionForUpload } from '../files/retention-policy'
import { signFileUrl } from '../files/signing'
import { generateObjectKey } from '../storage/object-key'
import {
  deleteAnonymousObjectThenTombstone,
  noteObjectDeleteFailure,
  releaseReplacedObject,
} from './upload-session-object-delete'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../common/redis/redis.service'
import type {
  UploadSessionChannel,
  UploadSessionMode,
  UploadSessionStatus,
} from './upload-sessions.dto'

export interface UploadSessionFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  fileExpiresAt: string | null
  fileUrl?: string | null
}

export interface UploadSessionConfirmResponse {
  sessionId: string
  status: 'confirmed'
  file: UploadSessionFileView
}

export interface StoredUploadSession {
  sessionId: string
  purpose: FilePurpose
  mode: UploadSessionMode
  channel: UploadSessionChannel
  status: UploadSessionStatus
  terminalId: string | null
  pendingEndUserId: string | null
  uploadTokenHash: string
  controlTokenHash: string
  sceneTokenHash?: string
  file: UploadSessionFileView | null
  uploadedAt: string | null
  confirmedAt: string | null
  expiresAt: string
  createdAt: string
  /** 每次成功写回 Redis 加一。清扫和取消必须带读到的值，避免旧快照盖住并发新状态。 */
  revision?: number
  bind?: MemberBindIntent | null
}

export type MemberBindPhase = 'intent' | 'copied' | 'db-applied' | 'done'

export interface MemberBindIntent {
  phase: MemberBindPhase
  fileId: string
  endUserId: string
  userKey: string
  previousKey: string
  bucket: string | null
}

export interface BindFileRow {
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

export interface StoredUploadSessionCleanup {
  sessionId: string
  expiresAt: string
  file: UploadSessionFileView | null
  status: 'expired'
  stagedObjectKey?: string | null
  stagedBucket?: string | null
  bind?: MemberBindIntent | null
  snapshot?: StoredUploadSession | null
}

export interface MemberBindHost {
  prisma: PrismaService
  files: FilesService
  redis: RedisService
  redisClient: Pick<Redis, 'zadd' | 'zrangebyscore' | 'zrem'>
  cleanupBatchLimit: number
  lockTtlSeconds: number
  expiryIndexKey: string
  confirmedFileUrlTtlMs: number
  signedUrlPurposes: ReadonlySet<FilePurpose>
  sessionRedisTtlSeconds: () => number
  uploadLockKey(sessionId: string): string
  sessionKey(sessionId: string): string
  commitSession(
    record: StoredUploadSession,
    lockKey: string,
    lockToken: string,
    expectedStatus: StoredUploadSession['status'],
    expectedFileId?: string | null,
    expectedPhase?: string | null,
    mirror?: boolean,
  ): Promise<'updated' | 'lost-lock' | 'expired' | 'conflict'>
  loadOptional(sessionId: string): Promise<StoredUploadSession | null>
  loadCleanupRecord(sessionId: string): Promise<StoredUploadSessionCleanup | null>
  removeFromExpiryIndex(sessionId: string): Promise<void>
  markExpired(record: StoredUploadSession, now?: number): StoredUploadSession
}

export async function driveMemberBind(
  host: MemberBindHost,
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
  let file = await reloadOrCompensate(host, stored.file.fileId, session, stored.bind?.userKey ?? null, stored.bind?.bucket ?? null)
  if (file.purpose === 'contract_upload' && !file.expiresAt) {
    throw new BadRequestException({
      error: { code: 'CONTRACT_FILE_EXPIRY_MISSING', message: '上传文件状态异常，请重新上传' },
    })
  }
  const userKey = session.bind?.userKey ?? file.pendingStorageKey ?? memberObjectKey(file, endUser)
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
      session = await casBind(host, session, lock, intent(), session.bind?.phase === 'intent' ? 'intent' : '')
      let published = finishIfPublished()
      if (published) return published
      await claimPendingKey(host, file, userKey)
      if (file.storageKey !== userKey) {
        await host.files.copyObjectToKey(file.storageKey, userKey, file.mimeType, bucket)
      }
      file = await reloadOrCompensate(host, file.id, session, userKey, bucket)
      phase = 'copied'
      previousKey = file.storageKey === userKey ? previousKey : file.storageKey
      session = await casBind(host, session, lock, intent(), 'intent')
      published = finishIfPublished()
      if (published) return published
    } else if (file.storageKey !== userKey) {
      await host.files.copyObjectToKey(file.storageKey, userKey, file.mimeType, bucket)
      file = await reloadOrCompensate(host, file.id, session, userKey, bucket)
    }
    if (!bound()) {
      previousKey = file.storageKey === userKey ? previousKey : file.storageKey
      phase = 'copied'
      await applyOwnership(host, file, intent())
      file = await reloadOrCompensate(host, file.id, session, userKey, bucket)
      if (!bound()) {
        throw new BadRequestException({
          error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
        })
      }
    }
  }

  file = await reloadOrCompensate(host, file.id, session, userKey, bucket)
  if (file.replacedStorageKey && file.replacedStorageKey !== file.storageKey) {
    previousKey = file.replacedStorageKey
    phase = 'db-applied'
    const expected = session.bind?.phase === 'db-applied' ? 'db-applied' : (session.bind?.phase ?? 'copied')
    session = await casBind(host, session, lock, intent(), expected)
    const published = finishIfPublished()
    if (published) return published
    try {
      await host.files.deleteObjectAtKey(file.replacedStorageKey, bucket)
    } catch (error) {
      await noteObjectDeleteFailure(host, file, error)
      throw error
    }
    await host.prisma.fileObject.updateMany({
      where: { id: file.id, storageKey: file.storageKey, replacedStorageKey: file.replacedStorageKey },
      data: { replacedStorageKey: null },
    })
    file = await reloadOrCompensate(host, file.id, session, userKey, bucket)
    if (file.replacedStorageKey) {
      throw new BadRequestException({
        error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
      })
    }
  } else if (session.bind?.phase !== 'db-applied' && session.bind?.phase !== 'done') {
    phase = 'db-applied'
    session = await casBind(host, session, lock, intent(), session.bind?.phase ?? 'copied')
    const published = finishIfPublished()
    if (published) return published
  }
  return publishConfirmed(host, session, lock, file)
}

export async function publishConfirmed(
  host: MemberBindHost,
  session: StoredUploadSession,
  lock: { lockKey: string; lockToken: string },
  file: BindFileRow,
): Promise<UploadSessionConfirmResponse> {
  if (session.status !== 'confirmed' && new Date(session.expiresAt).getTime() <= Date.now()) {
    throw expiredBindException()
  }
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
  if (host.signedUrlPurposes.has(session.purpose)) {
    const signed = signFileUrl(confirmedFile.fileId, host.confirmedFileUrlTtlMs)
    confirmedFile = { ...confirmedFile, fileUrl: signed.url }
  }
  const next: StoredUploadSession = {
    ...session,
    status: 'confirmed',
    file: confirmedFile,
    confirmedAt: new Date().toISOString(),
    bind: session.bind ? { ...session.bind, phase: 'done' } : null,
  }
  const committed = await host.commitSession(
    next,
    lock.lockKey,
    lock.lockToken,
    'uploaded',
    session.file.fileId,
    session.bind?.phase ?? null,
    true,
  )
  if (committed !== 'updated') {
    const current = await host.loadOptional(session.sessionId)
    if (current?.status === 'confirmed' && current.file) {
      await host.removeFromExpiryIndex(session.sessionId)
      return { sessionId: session.sessionId, status: 'confirmed', file: current.file }
    }
    throw new BadRequestException({
      error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
    })
  }
  await host.removeFromExpiryIndex(session.sessionId)
  return { sessionId: session.sessionId, status: 'confirmed', file: confirmedFile }
}

export async function casBind(
  host: MemberBindHost,
  session: StoredUploadSession,
  lock: { lockKey: string; lockToken: string },
  bind: MemberBindIntent,
  expectedPhase: string,
): Promise<StoredUploadSession> {
  const next: StoredUploadSession = { ...session, status: 'uploaded', bind, confirmedAt: null }
  const committed = await host.commitSession(
    next,
    lock.lockKey,
    lock.lockToken,
    'uploaded',
    session.file?.fileId ?? bind.fileId,
    expectedPhase,
    true,
  )
  if (committed === 'updated') return next
  const current = await host.loadOptional(session.sessionId)
  if (current?.status === 'confirmed' && current.file) return current
  if (current?.status === 'uploaded' && current.bind?.phase === bind.phase && current.bind.fileId === bind.fileId) {
    return current
  }
  throw new BadRequestException({
    error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
  })
}

export async function claimPendingKey(
  host: MemberBindHost,
  file: BindFileRow,
  userKey: string,
): Promise<void> {
  if (file.pendingStorageKey === userKey || file.storageKey === userKey) return
  const claimed = await host.prisma.fileObject.updateMany({
    where: { id: file.id, storageKey: file.storageKey, deletedAt: null, pendingStorageKey: null },
    data: { pendingStorageKey: userKey },
  })
  if (claimed.count === 1) return
  const current = await loadBindFile(host, file.id)
  if (current?.pendingStorageKey === userKey) return
  if (current?.ownerType === 'user' && current.storageKey === userKey) return
  throw new BadRequestException({
    error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
  })
}

export async function applyOwnership(
  host: MemberBindHost,
  file: BindFileRow,
  intent: MemberBindIntent,
): Promise<void> {
  const retention = defaultRetentionForUpload({
    purpose: file.purpose as FilePurpose,
    sensitiveLevel: file.sensitiveLevel as FileSensitiveLevel,
    ownerType: 'user',
    endUserId: intent.endUserId,
  })
  const isContract = file.purpose === 'contract_upload'
  const switched = await host.prisma.fileObject.updateMany({
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
  const current = await loadBindFile(host, file.id)
  if (current?.ownerType === 'user' && current.storageKey === intent.userKey && !current.deletedAt) return
  throw new BadRequestException({
    error: { code: 'UPLOAD_SESSION_NOT_READY', message: '手机端上传已失效，请重新上传' },
  })
}

export async function finishConfirmed(
  host: MemberBindHost,
  record: StoredUploadSession,
  _lock: { lockKey: string; lockToken: string },
): Promise<void> {
  const file = record.file ? await loadBindFile(host, record.file.fileId) : null
  if (file?.replacedStorageKey && file.replacedStorageKey !== file.storageKey) {
    try {
      await host.files.deleteObjectAtKey(file.replacedStorageKey, file.bucket)
    } catch (error) {
      await noteObjectDeleteFailure(host, file, error)
      throw error
    }
    await host.prisma.fileObject.updateMany({
      where: { id: file.id, replacedStorageKey: file.replacedStorageKey },
      data: { replacedStorageKey: null },
    })
  }
  await releaseCleanup(host, record.sessionId)
}

export async function abandonBoundAttempt(
  host: MemberBindHost,
  record: StoredUploadSession,
  lock: { lockKey: string; lockToken: string },
  reason: string,
): Promise<void> {
  const file = record.file ? await loadBindFile(host, record.file.fileId) : null
  const expired = record.status === 'cancelled'
    || record.status === 'expired'
    || new Date(record.expiresAt).getTime() <= Date.now()
  if (file && isLiveMember(file) && !expired && record.status !== 'confirmed') {
    await driveMemberBind(host, record, lock, record.bind?.endUserId ?? file.endUserId ?? '')
    return
  }
  if (file && isLiveMember(file)) await releaseReplacedObject(host, file)
  const nextStatus = record.status === 'cancelled' ? 'cancelled' : 'expired'
  await abandonAfterCommit(host, record, nextStatus, reason, lock)
}

export async function recoverStorageKeys(
  host: MemberBindHost,
  now: number,
): Promise<number> {
  const where = {
    OR: [
      { pendingStorageKey: { not: null } },
      { replacedStorageKey: { not: null } },
    ],
  }
  const total = await host.prisma.fileObject.count({ where })
  const pageCount = Math.ceil(total / host.cleanupBatchLimit)
  const page = pageCount > 0 ? Math.floor(now / 60_000) % pageCount : 0
  const rows = await host.prisma.fileObject.findMany({
    where,
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    skip: page * host.cleanupBatchLimit,
    take: host.cleanupBatchLimit,
  })
  let failed = 0
  const staleBefore = now - host.sessionRedisTtlSeconds() * 1000
  for (const row of rows) {
    try {
      await recoverOneStorageKey(host, row as BindFileRow, staleBefore)
    } catch {
      failed += 1
    }
  }
  return failed
}

export async function recoverOneStorageKey(
  host: MemberBindHost,
  row: BindFileRow,
  staleBefore: number,
): Promise<void> {
  if (row.replacedStorageKey && row.replacedStorageKey !== row.storageKey) {
    await host.files.deleteObjectAtKey(row.replacedStorageKey, row.bucket)
    await host.prisma.fileObject.updateMany({
      where: { id: row.id, replacedStorageKey: row.replacedStorageKey },
      data: { replacedStorageKey: null },
    })
    return
  }
  // 行已墓碑时，pendingStorageKey 是还没切成 storageKey 的复制件。
  // 删除失败必须留下指针；不得删除行当前指向的对象。
  if (row.deletedAt && row.pendingStorageKey && row.pendingStorageKey !== row.storageKey) {
    await host.files.deleteObjectAtKey(row.pendingStorageKey, row.bucket)
    await host.prisma.fileObject.updateMany({
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
    const claimed = await host.prisma.fileObject.updateMany({
      where: {
        id: row.id,
        pendingStorageKey: row.pendingStorageKey,
        storageKey: row.storageKey,
        deletedAt: null,
      },
      data: { pendingStorageKey: null, replacedStorageKey: row.pendingStorageKey },
    })
    if (claimed.count !== 1) return
    await host.files.deleteObjectAtKey(row.pendingStorageKey, row.bucket)
    await host.prisma.fileObject.updateMany({
      where: { id: row.id, replacedStorageKey: row.pendingStorageKey },
      data: { replacedStorageKey: null },
    })
  }
}

export function memberObjectKey(file: BindFileRow, endUserId: string): string {
  return generateObjectKey({
    purpose: file.purpose as FilePurpose,
    ownerType: 'user',
    ownerId: endUserId,
    fileId: file.id,
    ext: extFromFilenameOrKey(file.filename, file.storageKey),
  })
}

function extFromFilenameOrKey(filename: string, storageKey: string): string {
  const fromName = filename.includes('.') ? filename.split('.').pop() ?? '' : ''
  if (fromName) return fromName
  const fromKey = storageKey.includes('.') ? storageKey.split('.').pop() ?? '' : ''
  return fromKey
}

export function isLiveMember(file: Pick<BindFileRow, 'deletedAt' | 'ownerType' | 'endUserId'>): boolean {
  return !file.deletedAt && (file.ownerType === 'user' || Boolean(file.endUserId))
}

function expiredBindException(): BadRequestException {
  return new BadRequestException({
    error: { code: 'UPLOAD_SESSION_EXPIRED', message: '二维码已过期,请重新生成' },
  })
}

export async function loadBindFile(
  host: MemberBindHost,
  fileId: string,
): Promise<BindFileRow | null> {
  const row = await host.prisma.fileObject.findUnique({ where: { id: fileId } })
  return row as BindFileRow | null
}

export async function reloadOrCompensate(
  host: MemberBindHost,
  fileId: string,
  _session: StoredUploadSession,
  userKey: string | null,
  bucket: string | null,
): Promise<BindFileRow> {
  const current = await loadBindFile(host, fileId)
  if (!current || current.deletedAt) {
    if (userKey && current && current.storageKey !== userKey) {
      try {
        await host.files.deleteObjectAtKey(userKey, bucket)
      } catch (error) {
        await noteObjectDeleteFailure(host, { ...current, storageKey: userKey }, error)
        throw error
      }
    }
    throw new NotFoundException({
      error: { code: 'FILE_NOT_FOUND', message: '上传文件不存在或已被清理' },
    })
  }
  return current
}

export async function cleanupExpiredSessions(
  host: MemberBindHost,
  now = Date.now(),
): Promise<{ scanned: number; cleaned: number; skipped: number; failed: number }> {
  const sessionIds = await host.redisClient.zrangebyscore(
    host.expiryIndexKey,
    '-inf',
    now,
    'LIMIT',
    0,
    host.cleanupBatchLimit,
  )
  let cleaned = 0
  let skipped = 0
  let failed = 0
  for (const sessionId of sessionIds) {
    const lockKey = host.uploadLockKey(sessionId)
    const lockToken = randomUUID()
    const acquired = await host.redis.setNxEx(lockKey, lockToken, host.lockTtlSeconds)
    if (!acquired) {
      skipped += 1
      continue
    }
    const lock = { lockKey, lockToken }
    try {
      const outcome = await cleanupOne(host, sessionId, now, lock)
      if (outcome === 'cleaned') cleaned += 1
    } catch {
      failed += 1
      await host.redisClient.zadd(host.expiryIndexKey, now + 60_000, sessionId).catch(() => undefined)
    } finally {
      await host.redis.getAndDelIfEquals(lockKey, lockToken).catch(() => undefined)
    }
  }
  try {
    failed += await recoverStorageKeys(host, now)
  } catch {
    failed += 1
  }
  return { scanned: sessionIds.length, cleaned, skipped, failed }
}

async function cleanupOne(
  host: MemberBindHost,
  sessionId: string,
  now: number,
  lock: { lockKey: string; lockToken: string },
): Promise<'cleaned' | 'idle'> {
  let record = await host.loadOptional(sessionId)
  const persisted = await host.loadCleanupRecord(sessionId)
  if (
    !record
    && persisted?.snapshot
    && persisted.bind
    && persisted.bind.phase !== 'done'
    && new Date(persisted.expiresAt).getTime() > now
  ) {
    const restored = await host.redis.setNxEx(
      host.sessionKey(sessionId),
      JSON.stringify(persisted.snapshot),
      host.sessionRedisTtlSeconds(),
    )
    record = restored ? persisted.snapshot : await host.loadOptional(sessionId)
  }
  if (record?.status === 'confirmed') {
    await finishConfirmed(host, record, lock)
    return 'idle'
  }
  if (record?.bind && record.bind.phase !== 'done') {
    const file = record.file ? await loadBindFile(host, record.file.fileId) : null
    const expired = new Date(record.expiresAt).getTime() <= now
      || record.status === 'cancelled'
      || record.status === 'expired'
    if (file && isLiveMember(file) && !expired) {
      await driveMemberBind(host, record, lock, record.bind.endUserId)
      return 'cleaned'
    }
    const tombstoned = !file || file.deletedAt != null
    if (!expired && record.status === 'uploaded' && !tombstoned) {
      await driveMemberBind(host, record, lock, record.bind.endUserId)
      return 'cleaned'
    }
    await abandonBoundAttempt(
      host,
      record,
      lock,
      record.status === 'cancelled' ? 'upload session cancelled' : 'upload session expired',
    )
    return 'cleaned'
  }
  if (record && (record.status === 'cancelled' || record.status === 'expired')) {
    if (record.file) await deleteRetainedFile(host, record, 'upload session expired', lock)
    await releaseCleanup(host, sessionId)
    return 'cleaned'
  }
  const cleanup = record ?? persisted
  if (!cleanup || new Date(cleanup.expiresAt).getTime() > now) return 'idle'
  if (record && host.markExpired(record, now).status !== 'expired') return 'idle'
  if (!record) {
    if (cleanup.file) await cleanupAbandonedFile(host, cleanup, 'upload session expired')
    await releaseCleanup(host, sessionId)
    return 'cleaned'
  }
  const committed = await abandonAfterCommit(host, record, 'expired', 'upload session expired', lock)
  if (committed !== 'updated') {
    const current = await host.loadOptional(sessionId)
    if (current?.status === 'confirmed') await finishConfirmed(host, current, lock)
    return 'idle'
  }
  return 'cleaned'
}

async function cleanupAbandonedFile(
  host: MemberBindHost,
  record: Pick<StoredUploadSession, 'file' | 'status'>,
  reason: string,
): Promise<void> {
  if (!record.file || record.status === 'confirmed') return
  const file = await host.prisma.fileObject.findUnique({
    where: { id: record.file.fileId },
    select: { endUserId: true, ownerType: true },
  })
  if (file?.endUserId || file?.ownerType === 'user') return
  await deleteAnonymousObjectThenTombstone(host, record.file.fileId, reason)
}

export async function finishExpired(
  host: MemberBindHost,
  stored: StoredUploadSession,
  reason: string,
  lock: { lockKey: string; lockToken: string },
): Promise<void> {
  if (stored.bind && stored.bind.phase !== 'done') {
    await abandonBoundAttempt(host, stored, lock, reason)
    return
  }
  await abandonAfterCommit(host, stored, 'expired', reason, lock)
}

export async function abandonAfterCommit(
  host: MemberBindHost,
  stored: StoredUploadSession,
  nextStatus: 'cancelled' | 'expired',
  reason: string,
  lock: { lockKey: string; lockToken: string },
): Promise<'updated' | 'lost-lock' | 'expired' | 'conflict'> {
  const fileId = stored.file?.fileId ?? null
  const next: StoredUploadSession = { ...stored, status: nextStatus }
  const committed = await host.commitSession(
    next,
    lock.lockKey,
    lock.lockToken,
    stored.status,
    fileId,
  )
  if (committed !== 'updated') return committed
  await deleteRetainedFile(host, next, reason, lock)
  try {
    await releaseCleanup(host, stored.sessionId)
  } catch (error) {
    // 主文件的删除结果已经分开记账。多余对象失败时留下错误类型，索引仍在，下一轮再删。
    const row = fileId ? await loadBindFile(host, fileId) : null
    if (row && !row.deletedAt) await noteObjectDeleteFailure(host, row, error)
  }
  return 'updated'
}

function extraObjectKey(cleanup: StoredUploadSessionCleanup | null): string | null {
  if (!cleanup) return null
  if (cleanup.bind && cleanup.bind.phase !== 'done') {
    return cleanup.bind.phase === 'db-applied' ? cleanup.bind.previousKey : cleanup.bind.userKey
  }
  return cleanup.stagedObjectKey ?? null
}

export async function releaseCleanup(host: MemberBindHost, sessionId: string): Promise<void> {
  const cleanup = await host.loadCleanupRecord(sessionId)
  const extra = extraObjectKey(cleanup)
  if (extra) {
    const file = cleanup?.file ? await loadBindFile(host, cleanup.file.fileId) : null
    if (!file || file.storageKey !== extra) {
      await host.files.deleteObjectAtKey(extra, cleanup?.bind?.bucket ?? cleanup?.stagedBucket ?? null)
    }
  }
  await host.removeFromExpiryIndex(sessionId)
}

async function deleteRetainedFile(
  host: MemberBindHost,
  record: StoredUploadSession,
  reason: string,
  lock: { lockKey: string; lockToken: string },
): Promise<void> {
  if (!record.file) return
  await cleanupAbandonedFile(host, record, reason)
  await host.commitSession(
    { ...record, file: null },
    lock.lockKey,
    lock.lockToken,
    record.status,
    record.file.fileId,
  ).catch(() => undefined)
}
