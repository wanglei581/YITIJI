import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isSerializationConflict } from '../common/prisma/serialization-conflict'
import { FilesService } from '../files/files.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import type { CreateScanTaskDto } from './dto/create-scan-task.dto'
import {
  assertScanDeliverOriginAllowed,
  normalizeScanDeliverOrigin,
  scanDeliverClaimPins,
} from './scan-device-protocol'
import {
  executeScanCreate,
  loadRecoverableRetryChild,
  previewScanRetryCreate,
  RetryCreateRaceError,
  scanRetryIdentityMatches,
  type ScanRetryIdentityRow,
} from './scan-task-create'
import {
  assertScanCaptureFresh,
  bindUploadedScanFile,
  openScanDelivery,
  recordMatchedScanUploadFailure,
  rejectDuplicateScanDelivery,
  startScanMatchedHeartbeat,
} from './scan-task-deliver'
import {
  cancelScanTask,
  commitScanDeliveryAck,
  presentScanDeliveryLease,
  readScanTaskStatus,
  scanTaskEffectiveStatus,
} from './scan-task-query'
import {
  assertScanTaskReadAccess,
  isScanRetryLineageConflict,
  isScanTaskActiveSessionConflict,
  SCAN_MATCHED_HEARTBEAT_INTERVAL_MS,
  SCAN_TYPE_INSTRUCTIONS,
  SCAN_TYPE_TO_PURPOSE,
  type ScanDeliveryLeaseView,
  type ScanRetryCreateResult,
  type ScanTaskStatusResult,
  type ScanType,
} from './scan-task-contracts'

export type {
  ScanDeliveryLeaseView,
  ScanTaskFileView,
  ScanTaskStatus,
  ScanTaskStatusResult,
  ScanType,
} from './scan-task-contracts'
export {
  SCAN_CONTENT_DEDUP_WINDOW_MS,
  SCAN_MAX_FUTURE_OBSERVATION_MS,
  SCAN_STALE_CAPTURE_TOLERANCE_MS,
  SCAN_TYPE_INSTRUCTIONS,
  SCAN_TYPE_TO_PURPOSE,
  SCAN_UNACKED_WAITING_GRACE_MS,
  timingSafeEqualHex,
} from './scan-task-contracts'

export const SCAN_RETRY_AUTHORITY_TTL_MS = 15 * 60 * 1000

export const SCAN_TERMINAL_QUIET_PERIOD_SECONDS = Math.max(
  0,
  Number.isFinite(Number(process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS']))
    ? Math.floor(Number(process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS']))
    : 90
)
export const SCAN_TERMINAL_QUIET_PERIOD_MS = SCAN_TERMINAL_QUIET_PERIOD_SECONDS * 1000
export function scanTerminalQuietPeriodMs(): number {
  const raw = Number(process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'])
  const seconds = Number.isFinite(raw)
    ? Math.max(0, Math.floor(raw))
    : SCAN_TERMINAL_QUIET_PERIOD_SECONDS
  return seconds * 1000
}

const SCAN_RETRY_ELIGIBLE_STATUSES = ['failed', 'cancelled', 'expired'] as const

function isScanRetryTransactionConflict(e: unknown): boolean {
  return (
    (e instanceof Prisma.PrismaClientKnownRequestError && ['P1008', 'P2028'].includes(e.code)) ||
    isSerializationConflict(e)
  )
}

@Injectable()
export class ScanTasksService {
  private readonly logger = new Logger(ScanTasksService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly capabilities: TerminalCapabilitiesService
  ) {}

  async previewCreate(
    dto: CreateScanTaskDto,
    endUserId: string | null,
    retryControlToken?: string
  ): Promise<ScanRetryCreateResult> {
    return previewScanRetryCreate(this.prisma, dto, endUserId, retryControlToken, (args) =>
      this.recoverRetryChildIfPresent(args)
    )
  }

  async create(
    dto: CreateScanTaskDto,
    endUserId: string | null,
    retryControlToken?: string
  ): Promise<ScanRetryCreateResult> {
    return executeScanCreate(this.prisma, dto, endUserId, retryControlToken, {
      assertQuiet: async (terminalId) => {
        await this.assertTerminalQuietPeriod(terminalId)
      },
      assertUserTaskAllowed: (terminalId) =>
        this.capabilities.assertUserTaskAllowed(terminalId, 'scan'),
      assertScanDeviceAllowed: (terminalId) =>
        this.capabilities.assertScanDeviceAllowed(terminalId),
      assertRetryRequestShape: (retryOfScanTaskId, token) =>
        this.assertRetryRequestShape(retryOfScanTaskId, token),
      recover: (args) => this.recoverRetryChildIfPresent(args),
      throwRetryNotAuthorized: () => this.throwRetryNotAuthorized(),
      assertRetryIdentity: (row, userId, terminalId, scanType, token) =>
        this.assertRetryIdentity(row, userId, terminalId, scanType, token),
      bindChildControlToken: (prior) => {
        const childControlTokenHash = prior.controlTokenHash!
        return childControlTokenHash
      },
      eligibleStatuses: SCAN_RETRY_ELIGIBLE_STATUSES,
      onCreateError: (error, context) => this.finishCreateError(error, context),
    })
  }

  private assertRetryRequestShape(
    retryOfScanTaskId: string | undefined,
    retryControlToken: string | undefined
  ): void {
    if (!retryOfScanTaskId && retryControlToken) {
      throw new BadRequestException({
        error: { code: 'SCAN_RETRY_TASK_ID_MISSING', message: '重扫控制凭证缺少对应的原扫描任务' },
      })
    }
    if (retryOfScanTaskId && !retryControlToken) this.throwRetryNotAuthorized()
  }

  private async finishCreateError(
    e: unknown,
    ctx: {
      retryOfScanTaskId?: string
      retryControlToken?: string
      endUserId: string | null
      terminalId: string
      scanType: string
    }
  ): Promise<ScanRetryCreateResult | undefined> {
    if (
      ctx.retryOfScanTaskId &&
      ctx.retryControlToken &&
      (e instanceof RetryCreateRaceError ||
        isScanRetryLineageConflict(e) ||
        isScanRetryTransactionConflict(e))
    ) {
      const recovered = await this.recoverRetryChildIfPresent({
        retryOfScanTaskId: ctx.retryOfScanTaskId,
        retryControlToken: ctx.retryControlToken,
        endUserId: ctx.endUserId,
        terminalId: ctx.terminalId,
        scanType: ctx.scanType,
      })
      if (recovered) return recovered
      if (e instanceof RetryCreateRaceError) this.throwRetryNotAuthorized()
    }
    if (
      ctx.retryOfScanTaskId &&
      (isScanRetryLineageConflict(e) || isScanRetryTransactionConflict(e))
    ) {
      throw new ConflictException({
        error: {
          code: 'SCAN_RETRY_CONFLICT',
          message: isScanRetryLineageConflict(e)
            ? '重扫授权血缘已被占用，请重新发起扫描'
            : '重扫授权正在被处理，请重新发起扫描',
        },
      })
    }
    if (isScanTaskActiveSessionConflict(e)) {
      throw new ConflictException({
        error: {
          code: 'SCAN_TERMINAL_BUSY',
          message: '该终端当前有正在进行的扫描，请稍后重试或联系工作人员',
        },
      })
    }
    return undefined
  }

  private async recoverRetryChildIfPresent(args: {
    retryOfScanTaskId: string
    retryControlToken: string
    endUserId: string | null
    terminalId: string
    scanType: string
  }): Promise<ScanRetryCreateResult | null> {
    const child = await loadRecoverableRetryChild(this.prisma, args, {
      assertRetryIdentity: (prior) =>
        this.assertRetryIdentity(
          prior,
          args.endUserId,
          args.terminalId,
          args.scanType,
          args.retryControlToken
        ),
      throwRetryNotAuthorized: () => this.throwRetryNotAuthorized(),
      throwRetryChildNotRecoverable: () => this.throwRetryChildNotRecoverable(),
    })
    if (!child) return null
    return {
      scanTaskId: child.id,
      controlToken: args.retryControlToken,
      expiresAt: child.expiresAt.toISOString(),
      instructions: SCAN_TYPE_INSTRUCTIONS[args.scanType as ScanType],
    }
  }

  private throwRetryNotAuthorized(): never {
    throw new ForbiddenException({
      error: { code: 'SCAN_RETRY_NOT_AUTHORIZED', message: '重扫授权无效、已过期或已使用' },
    })
  }

  private throwRetryChildNotRecoverable(): never {
    throw new ConflictException({
      error: {
        code: 'SCAN_RETRY_CHILD_NOT_RECOVERABLE',
        message: '重扫任务已结束，无法恢复该次安全重扫',
      },
    })
  }

  async getStatus(
    scanTaskId: string,
    endUserId: string | null,
    controlToken: string | undefined
  ): Promise<ScanTaskStatusResult> {
    return readScanTaskStatus(
      this.prisma,
      { scanTaskId, endUserId, controlToken, retryAuthorityTtlMs: SCAN_RETRY_AUTHORITY_TTL_MS },
      {
        assertTaskReadAccess: assertScanTaskReadAccess,
        effectiveStatus: (status, expiresAt) => this.effectiveStatus(status, expiresAt),
      }
    )
  }

  async cancel(
    scanTaskId: string,
    endUserId: string | null,
    controlToken: string | undefined
  ): Promise<{
    scanTaskId: string
    status: 'cancelled'
    quietPeriodEndsAt: string
    serverNow: string
  }> {
    return cancelScanTask(this.prisma, {
      scanTaskId,
      endUserId,
      controlToken,
      retryAuthorityTtlMs: SCAN_RETRY_AUTHORITY_TTL_MS,
      quietPeriodMs: () => scanTerminalQuietPeriodMs(),
    })
  }

  async ack(
    scanTaskId: string,
    endUserId: string | null,
    controlToken: string | undefined,
    terminalRef: string
  ): Promise<{ scanTaskId: string; deliveryAckedAt: string }> {
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
      select: { id: true },
    })
    const task = await this.prisma.scanTask.findUnique({ where: { id: scanTaskId } })
    if (!task) {
      throw new NotFoundException({
        error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' },
      })
    }
    assertScanTaskReadAccess(task, endUserId, controlToken)
    if (!terminal || task.terminalId !== terminal.id) {
      throw new ForbiddenException({
        error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权确认该扫描任务' },
      })
    }
    await this.assertTerminalQuietPeriod(task.terminalId)
    const committed = await commitScanDeliveryAck(this.prisma, task)
    if (committed === 'not-allowed') {
      throw new ConflictException({
        error: { code: 'SCAN_TASK_ACK_NOT_ALLOWED', message: '当前扫描任务状态不允许确认投递' },
      })
    }
    return { scanTaskId: task.id, deliveryAckedAt: committed.deliveryAckedAt.toISOString() }
  }

  private startMatchedHeartbeat(
    taskId: string,
    intervalMs: number = SCAN_MATCHED_HEARTBEAT_INTERVAL_MS
  ): NodeJS.Timeout {
    return startScanMatchedHeartbeat(this.prisma, this.logger, taskId, intervalMs)
  }

  async getScanDeliveryLease(terminalId: string): Promise<ScanDeliveryLeaseView> {
    const now = new Date()
    const task = await this.prisma.scanTask.findFirst({
      where: {
        terminalId,
        status: 'waiting',
        expiresAt: { gt: now },
        deliveryAckedAt: { not: null },
      },
    })
    if (!task) {
      throw new ConflictException({
        error: { code: 'NO_WAITING_SCAN_TASK', message: '没有匹配的等待中扫描任务' },
      })
    }
    return presentScanDeliveryLease(task, terminalId, now)
  }

  async deliverScanFile(args: {
    terminalId: string
    scanTaskId: string
    deliveryLease: string
    buffer: Buffer
    filename: string
    mimeType: string
    candidateSnapshotAt?: unknown
    observedAt?: unknown
    origin?: unknown
    deviceRound?: unknown
  }): Promise<{ scanTaskId: string; fileId: string }> {
    const now = new Date()
    const opened = await openScanDelivery(this.prisma, args, now)
    const task = opened.task
    const deviceClearance = assertScanDeliverOriginAllowed(
      task,
      normalizeScanDeliverOrigin(args.origin),
      {
        buffer: args.buffer,
        mimeType: args.mimeType,
      }
    )
    const contentHash = createHash('sha256').update(args.buffer).digest('hex')
    let authorizedIdenticalRetry = false
    if (task.retryOfScanTaskId && task.retryContentHash === contentHash) {
      const prior = await this.prisma.scanTask.findUnique({ where: { id: task.retryOfScanTaskId } })
      authorizedIdenticalRetry = Boolean(
        prior &&
        SCAN_RETRY_ELIGIBLE_STATUSES.includes(
          prior.status as (typeof SCAN_RETRY_ELIGIBLE_STATUSES)[number]
        ) &&
        prior.fileId === null &&
        prior.retryConsumedAt &&
        prior.retryAuthorityExpiresAt &&
        prior.retryConsumedAt.getTime() <= prior.retryAuthorityExpiresAt.getTime() &&
        prior.retryConsumedByScanTaskId === task.id &&
        prior.lastAttemptHash === contentHash &&
        prior.endUserId === task.endUserId &&
        prior.terminalId === task.terminalId &&
        prior.scanType === task.scanType
      )
    }
    await rejectDuplicateScanDelivery(
      this.prisma,
      args.terminalId,
      contentHash,
      now,
      authorizedIdenticalRetry
    )
    assertScanCaptureFresh(opened.observedDate, opened.leasePayload, task.createdAt)
    // ATOMIC_SCAN_DELIVER_CAS_ACK_EXPIRY: re-pin ACK + expiry (and signed
    // task identity already in where) so mixed/raced state cannot go
    // waiting → matched after ACK/expiry eligibility changed.
    const claimed = await this.prisma.scanTask.updateMany({
      where: {
        id: task.id,
        terminalId: args.terminalId,
        status: 'waiting',
        deliveryAckedAt: { not: null },
        expiresAt: { gt: now },
        createdAt: task.createdAt,
        ...scanDeliverClaimPins(task),
      },
      data: {
        status: 'matched',
        matchedFileMtime: opened.observedDate,
        lastAttemptHash: contentHash,
      },
    })
    if (claimed.count === 0) {
      throw new ConflictException({
        error: { code: 'SCAN_TASK_STATE_CHANGED', message: '扫描任务状态已变化，请重新发起扫描' },
      })
    }
    const heartbeat = this.startMatchedHeartbeat(task.id)
    try {
      const purpose = SCAN_TYPE_TO_PURPOSE[task.scanType as ScanType]
      const uploadArgs = {
        buffer: args.buffer,
        filename: args.filename,
        mimeType: args.mimeType,
        purpose,
        uploaderId: null as string | null,
        endUserId: task.endUserId,
      }
      const uploaded = deviceClearance
        ? await this.files.uploadVerifiedDeviceScan({ ...uploadArgs, clearance: deviceClearance })
        : await this.files.upload(uploadArgs)
      return await bindUploadedScanFile(
        this.prisma,
        this.files,
        this.logger,
        task.id,
        uploaded.fileId
      )
    } catch (error) {
      await recordMatchedScanUploadFailure(this.prisma, task.id, error, SCAN_RETRY_AUTHORITY_TTL_MS)
      throw error
    } finally {
      clearInterval(heartbeat)
    }
  }

  private effectiveStatus(status: string, expiresAt: Date): string {
    return scanTaskEffectiveStatus(status, expiresAt)
  }

  private async assertTerminalQuietPeriod(terminalId: string): Promise<void> {
    const quietPeriodMs = scanTerminalQuietPeriodMs()
    if (quietPeriodMs <= 0) return
    const now = Date.now()
    const recent = await this.prisma.scanTask.findFirst({
      where: {
        terminalId,
        status: { in: ['cancelled', 'expired'] },
        updatedAt: { gt: new Date(now - quietPeriodMs) },
      },
      orderBy: { updatedAt: 'desc' },
      select: { status: true, updatedAt: true, expiresAt: true },
    })
    if (!recent) return
    if (recent.status !== 'cancelled' && recent.status !== 'expired') return
    const endedAt = recent.updatedAt.getTime()
    const remainingMs = endedAt + quietPeriodMs - now
    if (remainingMs <= 0) return
    const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000))
    throw new ConflictException({
      error: {
        code: 'SCAN_TERMINAL_QUIET_PERIOD',
        message: `上一位的扫描可能还在出纸，请等约 ${remainingSeconds} 秒再开始`,
        details: { remainingSeconds },
      },
    })
  }

  private assertRetryIdentity(
    prior: ScanRetryIdentityRow | null,
    endUserId: string | null,
    terminalId: string,
    scanType: string,
    retryControlToken: string | undefined
  ): void {
    if (!scanRetryIdentityMatches(prior, endUserId, terminalId, scanType, retryControlToken)) {
      this.throwRetryNotAuthorized()
    }
  }
}
