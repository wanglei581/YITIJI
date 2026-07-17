import { createHash, randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { MemberDataExportRedisService } from '../common/redis/member-data-export-redis.service'
import { RedisService } from '../common/redis/redis.service'
import { FilesService } from '../files/files.service'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import type { MemberExportReconcileJobData } from './member-privacy.queue'

const DEFAULT_BATCH_LIMIT = 50
const MAX_BATCH_LIMIT = 100
const REQUEST_LOCK_TTL_SECONDS = 60
const STALE_REQUEST_MS = 15 * 60 * 1_000
const ORPHAN_GRACE_MS = 15 * 60 * 1_000

type ReconcileOutcome = 'completed' | 'expired' | 'failed' | 'stale' | 'noop'

interface ReconcilePage {
  processed: number
  nextCursor: string | null
  expiredClaims: number
  orphanFiles: number
}

@Injectable()
export class MemberDataExportReconcilerService {
  private readonly logger = new Logger(MemberDataExportReconcilerService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: RedisService,
    private readonly capabilities: MemberDataExportRedisService,
    private readonly files: FilesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async reconcile(data: MemberExportReconcileJobData): Promise<ReconcileOutcome | ReconcilePage> {
    if (!data || !['delivery_finished', 'periodic_sweep', 'admin_retry'].includes(data.reason)) {
      throw new Error('MEMBER_EXPORT_RECONCILE_JOB_INVALID')
    }
    if (data.requestId) {
      return this.reconcileRequest(data.requestId, data.executionVersion, data.reason === 'delivery_finished')
    }
    if (data.reason !== 'periodic_sweep') throw new Error('MEMBER_EXPORT_RECONCILE_REQUEST_REQUIRED')
    return this.sweep()
  }

  async reconcileRequest(
    requestId: string,
    executionVersion?: number,
    deliveryFinished = false,
  ): Promise<ReconcileOutcome> {
    assertIdentifier(requestId)
    if (executionVersion !== undefined && (!Number.isSafeInteger(executionVersion) || executionVersion < 0)) {
      throw new Error('MEMBER_EXPORT_RECONCILE_VERSION_INVALID')
    }
    const lockKey = `member:export:reconcile-lock:${digest(requestId)}`
    const lockValue = randomUUID()
    if (!await this.locks.setNxEx(lockKey, lockValue, REQUEST_LOCK_TTL_SECONDS)) return 'noop'
    try {
      if (deliveryFinished) await this.persistDeliveryEvidence(requestId, executionVersion)
      return await this.reconcileRequestLocked(requestId, executionVersion)
    } finally {
      await this.locks.getAndDelIfEquals(lockKey, lockValue).catch((error: unknown) => {
        this.logger.warn(`Member export request lock release failed code=EXPORT_LOCK_RELEASE_FAILED errorType=${safeErrorType(error)}`)
      })
    }
  }

  async sweep(args: { limit?: number; cursor?: string } = {}): Promise<ReconcilePage> {
    const limit = batchLimit(args.limit)
    if (args.cursor) assertIdentifier(args.cursor)
    const now = new Date()
    const staleBefore = new Date(now.getTime() - STALE_REQUEST_MS)
    const rows = await this.prisma.userDataRequest.findMany({
      where: {
        requestType: 'export',
        OR: [
          { status: 'handling', executionStep: 'download_cleanup_pending' },
          { status: 'failed', failureCode: 'EXPORT_CLEANUP_FAILED' },
          { status: 'ready', exportExpiresAt: { lte: now } },
          { status: 'pending', workerJobId: null, requestedAt: { lte: staleBefore } },
          { status: 'handling', OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: staleBefore } }] },
        ],
      },
      select: { id: true, executionVersion: true },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })
    const page = rows.slice(0, limit)
    for (const row of page) await this.reconcileRequest(row.id, row.executionVersion)
    const expiredClaims = await this.capabilities.cleanupExpiredClaims(Math.floor(now.getTime() / 1_000), limit)
    const orphans = await this.cleanupOrphanFiles({ limit })
    return {
      processed: page.length,
      nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null,
      expiredClaims,
      orphanFiles: orphans.deleted,
    }
  }

  async cleanupOrphanFiles(args: { limit?: number; cursor?: string } = {}): Promise<{
    scanned: number
    deleted: number
    nextCursor: string | null
  }> {
    const limit = batchLimit(args.limit)
    if (args.cursor) assertIdentifier(args.cursor)
    const rows = await this.prisma.fileObject.findMany({
      where: {
        purpose: 'member_data_export',
        deletedAt: null,
        createdAt: { lte: new Date(Date.now() - ORPHAN_GRACE_MS) },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })
    const page = rows.slice(0, limit)
    let deleted = 0
    for (const file of page) {
      const lockKey = `member:export:orphan-lock:${digest(file.id)}`
      const lockValue = randomUUID()
      if (!await this.locks.setNxEx(lockKey, lockValue, REQUEST_LOCK_TTL_SECONDS)) continue
      try {
        const referenced = await this.prisma.userDataRequest.findFirst({
          where: { exportFileId: file.id },
          select: { id: true },
        })
        if (referenced) continue
        try {
          await this.files.systemDelete(file.id, 'member_data_export_orphan_reconciled')
          if (await this.isFilePhysicallyGone(file.id)) deleted += 1
        } catch (error) {
          if (await this.isFilePhysicallyGone(file.id).catch(() => false)) deleted += 1
          else this.logger.warn(`Member export orphan cleanup failed code=EXPORT_ORPHAN_CLEANUP_FAILED errorType=${safeErrorType(error)}`)
        }
      } finally {
        await this.locks.getAndDelIfEquals(lockKey, lockValue).catch(() => undefined)
      }
    }
    return {
      scanned: page.length,
      deleted,
      nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null,
    }
  }

  private async reconcileRequestLocked(requestId: string, executionVersion?: number): Promise<ReconcileOutcome> {
    const row = await this.prisma.userDataRequest.findUnique({ where: { id: requestId } })
    if (!row || row.requestType !== 'export') return 'noop'
    if (executionVersion !== undefined && row.executionVersion !== executionVersion) return 'stale'
    const now = new Date()
    if (row.status === 'failed' && row.executionStep === 'orphan_cleanup_pending' && row.exportFileId) {
      return this.cleanupBoundOrphan({ ...row, exportFileId: row.exportFileId })
    }
    const cleanupPending = row.executionStep === 'download_cleanup_pending'
      || row.executionStep === 'download_cleanup_failed'
      || row.failureCode === 'EXPORT_CLEANUP_FAILED' && row.exportFileId !== null
    if (cleanupPending) {
      const terminal = row.downloadConsumedAt ? 'completed' : row.exportExpiresAt && row.exportExpiresAt <= now ? 'expired' : null
      return terminal ? this.cleanupAndFinalize(row, terminal) : 'noop'
    }
    if (row.status === 'ready' && row.exportExpiresAt && row.exportExpiresAt <= now) {
      return this.cleanupAndFinalize(row, 'expired')
    }
    const staleBefore = new Date(now.getTime() - STALE_REQUEST_MS)
    if (row.status === 'pending' && row.workerJobId === null && row.requestedAt <= staleBefore) {
      await this.markFailed(row, 'QUEUE_ENQUEUE_FAILED', 'queue_enqueue_failed')
      return 'failed'
    }
    if (row.status === 'handling' && (!row.lastAttemptAt || row.lastAttemptAt <= staleBefore)) {
      await this.markFailed(row, 'EXPORT_EXECUTION_STALE', 'export_generation_failed')
      return 'failed'
    }
    return 'noop'
  }

  private async persistDeliveryEvidence(requestId: string, executionVersion?: number): Promise<void> {
    if (executionVersion === undefined) throw new Error('MEMBER_EXPORT_RECONCILE_VERSION_REQUIRED')
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.userDataRequest.findUnique({
        where: { id: requestId },
        select: {
          endUserId: true,
          requestType: true,
          status: true,
          executionVersion: true,
          exportFileId: true,
          exportExpiresAt: true,
          downloadConsumedAt: true,
        },
      })
      if (!row || row.requestType !== 'export' || row.executionVersion !== executionVersion) return
      if (row.downloadConsumedAt || row.status !== 'ready' || !row.exportFileId
        || !row.exportExpiresAt || row.exportExpiresAt.getTime() <= Date.now()) return
      const consumedAt = new Date()
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: 'member_data_export.delivery_reconciled',
        targetType: 'user_data_request',
        targetId: requestId,
        payload: { executionVersion },
      })
      const cas = await tx.userDataRequest.updateMany({
        where: {
          id: requestId,
          endUserId: row.endUserId,
          requestType: 'export',
          status: 'ready',
          executionVersion,
          exportFileId: row.exportFileId,
          downloadConsumedAt: null,
          exportExpiresAt: { gt: consumedAt },
        },
        data: {
          status: 'handling',
          executionStep: 'download_cleanup_pending',
          downloadConsumedAt: consumedAt,
          lastAttemptAt: consumedAt,
          failureCode: null,
          failureMessage: null,
          auditRef,
        },
      })
      if (cas.count !== 1) throw new Error('MEMBER_EXPORT_DELIVERY_RECONCILE_CAS_CONFLICT')
    })
  }

  private async cleanupBoundOrphan(row: {
    id: string
    endUserId: string
    status: string
    executionVersion: number
    exportFileId: string
  }): Promise<ReconcileOutcome> {
    if (!await this.deleteAndVerify(row.exportFileId, row.endUserId).catch(() => false)) {
      await this.markFailed(row, 'EXPORT_CLEANUP_FAILED', 'orphan_cleanup_pending')
      return 'failed'
    }
    await this.prisma.$transaction(async (tx) => {
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: 'member_data_export.orphan_cleaned',
        targetType: 'user_data_request',
        targetId: row.id,
        payload: { executionVersion: row.executionVersion },
      })
      const cas = await tx.userDataRequest.updateMany({
        where: {
          id: row.id,
          requestType: 'export',
          status: row.status,
          executionVersion: row.executionVersion,
          executionStep: 'orphan_cleanup_pending',
          exportFileId: row.exportFileId,
        },
        data: {
          status: 'failed',
          executionStep: null,
          exportFileId: null,
          exportExpiresAt: null,
          failureCode: 'EXPORT_ARTIFACT_MISSING',
          failureMessage: 'export artifact missing',
          lastAttemptAt: new Date(),
          auditRef,
        },
      })
      if (cas.count !== 1) throw new Error('MEMBER_EXPORT_ORPHAN_RESET_CAS_CONFLICT')
    })
    return 'failed'
  }

  private async cleanupAndFinalize(
    row: {
      id: string
      endUserId: string
      status: string
      executionVersion: number
      executionStep: string | null
      exportFileId: string | null
      activeKey: string | null
    },
    terminal: 'completed' | 'expired',
  ): Promise<ReconcileOutcome> {
    try {
      await this.capabilities.revokeCapabilitiesByRequest(digest(row.id))
      if (!row.exportFileId || !await this.deleteAndVerify(row.exportFileId, row.endUserId)) {
        await this.markCleanupFailed(row)
        return 'failed'
      }
      await this.finalize(row, terminal)
      return terminal
    } catch (error) {
      try {
        await this.markCleanupFailed(row)
      } catch (auditError) {
        this.logger.error(`Member export cleanup audit failed code=EXPORT_REQUIRED_AUDIT_FAILED errorType=${safeErrorType(auditError)}`)
        throw auditError
      }
      this.logger.warn(`Member export cleanup failed code=EXPORT_CLEANUP_FAILED errorType=${safeErrorType(error)}`)
      return 'failed'
    }
  }

  private async deleteAndVerify(fileId: string, endUserId: string): Promise<boolean> {
    const before = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!before || before.purpose !== 'member_data_export' || before.endUserId !== endUserId) return false
    if (!before.deletedAt) {
      try {
        await this.files.systemDelete(fileId, 'member_data_export_reconciled')
      } catch {
        // Evidence is re-read below; NotFound is only idempotent with both DB and storage proof.
      }
    }
    return this.isFilePhysicallyGone(fileId)
  }

  private async isFilePhysicallyGone(fileId: string): Promise<boolean> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!file?.deletedAt || file.purpose !== 'member_data_export') return false
    return (await this.storage.headObject(file.storageKey, file.bucket)) === null
  }

  private async finalize(
    row: { id: string; status: string; executionVersion: number; executionStep: string | null; exportFileId: string | null },
    terminal: 'completed' | 'expired',
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: `member_data_export.${terminal}`,
        targetType: 'user_data_request',
        targetId: row.id,
        payload: { executionVersion: row.executionVersion },
      })
      const cas = await tx.userDataRequest.updateMany({
        where: {
          id: row.id,
          requestType: 'export',
          status: row.status,
          executionVersion: row.executionVersion,
          executionStep: row.executionStep,
          exportFileId: row.exportFileId,
        },
        data: {
          status: terminal,
          executionStep: terminal,
          activeKey: null,
          handledAt: new Date(),
          handledBy: 'system',
          failureCode: null,
          failureMessage: null,
          auditRef,
        },
      })
      if (cas.count !== 1) throw new Error('MEMBER_EXPORT_RECONCILE_CAS_CONFLICT')
    })
  }

  private async markCleanupFailed(row: { id: string; status: string; executionVersion: number }): Promise<void> {
    await this.markFailed(row, 'EXPORT_CLEANUP_FAILED', 'download_cleanup_failed')
  }

  private async markFailed(
    row: { id: string; status: string; executionVersion: number },
    failureCode: string,
    executionStep: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: 'member_data_export.failed',
        targetType: 'user_data_request',
        targetId: row.id,
        payload: { executionVersion: row.executionVersion, failureCode },
      })
      const cas = await tx.userDataRequest.updateMany({
        where: { id: row.id, requestType: 'export', status: row.status, executionVersion: row.executionVersion },
        data: {
          status: 'failed',
          executionStep,
          failureCode,
          failureMessage: safeFailureMessage(failureCode),
          lastAttemptAt: new Date(),
          auditRef,
        },
      })
      if (cas.count !== 1) throw new Error('MEMBER_EXPORT_RECONCILE_CAS_CONFLICT')
    })
  }
}

function batchLimit(value?: number): number {
  if (value === undefined) return DEFAULT_BATCH_LIMIT
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('MEMBER_EXPORT_RECONCILE_LIMIT_INVALID')
  return Math.min(value, MAX_BATCH_LIMIT)
}

function assertIdentifier(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('MEMBER_EXPORT_RECONCILE_ID_INVALID')
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeFailureMessage(code: string): string {
  if (code === 'QUEUE_ENQUEUE_FAILED') return 'queue enqueue failed'
  if (code === 'EXPORT_EXECUTION_STALE') return 'export execution lease expired'
  return 'export artifact cleanup failed'
}

function safeErrorType(error: unknown): string {
  const value = error instanceof Error ? error.name : typeof error
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) ? value : 'UnknownError'
}
