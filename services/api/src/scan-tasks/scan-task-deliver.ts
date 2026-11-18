import { BadRequestException, ConflictException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import {
  assertScanDeliverAttachedRound,
  assertScanDeliverRoundMatches,
} from './scan-device-protocol'
import { verifyScanDeliveryLease, type ScanDeliveryLeasePayload } from './scan-lease'
import {
  SCAN_CONTENT_DEDUP_WINDOW_MS,
  SCAN_MAX_FUTURE_OBSERVATION_MS,
  SCAN_STALE_CAPTURE_TOLERANCE_MS,
  USER_FACING_SCAN_ERROR,
  scanDeliveredUploadErrorCode,
} from './scan-task-contracts'

interface DeliverFileArgs {
  terminalId: string
  scanTaskId: string
  deliveryLease: string
  buffer: Buffer
  filename: string
  mimeType: string
  candidateSnapshotAt?: unknown
  observedAt?: unknown
  deviceRound?: unknown
}

interface ScanLogger {
  log: (message: string) => void
  warn: (message: string) => void
}

interface ScanFileCleaner {
  systemDelete: (fileId: string, reason: string) => Promise<unknown>
}

/** 校验租约、观察时间和任务仍可投递，返回读到的快照。来源凭据由调用方接着判。 */
export async function openScanDelivery(prisma: PrismaService, args: DeliverFileArgs, now: Date) {
  if (!args.scanTaskId || typeof args.scanTaskId !== 'string' || !args.scanTaskId.trim()) {
    throw new BadRequestException({
      error: { code: 'SCAN_TASK_ID_MISSING', message: '缺少扫描任务ID(scanTaskId)' },
    })
  }
  const leasePayload = verifyScanDeliveryLease(
    args.deliveryLease,
    args.terminalId,
    args.scanTaskId,
    now.getTime()
  )
  const observedDate = parseObservedAt(args, now)
  const task = await prisma.scanTask.findUnique({
    where: { id: args.scanTaskId },
  })
  if (!task || task.terminalId !== args.terminalId) {
    throw new ConflictException({
      error: { code: 'NO_WAITING_SCAN_TASK', message: '指定的扫描任务不存在或不属于该终端' },
    })
  }
  if (task.status !== 'waiting') {
    throw new ConflictException({
      error: { code: 'SCAN_TASK_STATE_CHANGED', message: '扫描任务状态已改变，请重新发起扫描' },
    })
  }
  if (task.expiresAt.getTime() <= now.getTime()) {
    throw new ConflictException({
      error: { code: 'NO_WAITING_SCAN_TASK', message: '扫描任务已过期' },
    })
  }
  if (!task.deliveryAckedAt) {
    throw new ConflictException({
      error: { code: 'NO_WAITING_SCAN_TASK', message: '没有匹配的等待中扫描任务' },
    })
  }
  if (task.createdAt.getTime() !== leasePayload.taskCreatedAtEpoch) {
    throw new ConflictException({
      error: { code: 'SCAN_LEASE_INVALID', message: '扫描租约绑定的任务版本不一致' },
    })
  }
  assertScanDeliverRoundMatches(task, leasePayload.deviceRound)
  assertScanDeliverAttachedRound(task, leasePayload.deviceRound, args.deviceRound)
  return { task, leasePayload, observedDate }
}

function parseObservedAt(args: DeliverFileArgs, now: Date): Date {
  const rawObservedAt = args.candidateSnapshotAt ?? args.observedAt
  if (
    rawObservedAt === undefined ||
    rawObservedAt === null ||
    typeof rawObservedAt !== 'string' ||
    !rawObservedAt.trim()
  ) {
    throw new BadRequestException({
      error: { code: 'SCAN_OBSERVED_AT_INVALID', message: '缺少有效的文件观察时间(observedAt)' },
    })
  }
  const observedDate = new Date(rawObservedAt)
  if (!Number.isFinite(observedDate.getTime())) {
    throw new BadRequestException({
      error: { code: 'SCAN_OBSERVED_AT_INVALID', message: '文件观察时间(observedAt)格式无效' },
    })
  }
  if (observedDate.getTime() > now.getTime() + SCAN_MAX_FUTURE_OBSERVATION_MS) {
    throw new BadRequestException({
      error: {
        code: 'SCAN_OBSERVED_AT_INVALID',
        message: '文件观察时间(observedAt)超出合理未来范围',
      },
    })
  }
  return observedDate
}

/** 同一终端在去重窗口内已经投递过或尝试过同一份内容时拒绝，授权内的同内容重扫除外。 */
export async function rejectDuplicateScanDelivery(
  prisma: PrismaService,
  terminalId: string,
  contentHash: string,
  now: Date,
  authorizedIdenticalRetry: boolean
): Promise<void> {
  const recentlyDeliveredForTerminal = await prisma.scanTask.findMany({
    where: {
      terminalId,
      fileId: { not: null },
      updatedAt: { gt: new Date(now.getTime() - SCAN_CONTENT_DEDUP_WINDOW_MS) },
    },
    select: { fileId: true },
  })
  if (recentlyDeliveredForTerminal.length > 0) {
    const candidateFileIds = recentlyDeliveredForTerminal
      .map((row) => row.fileId)
      .filter((id): id is string => id !== null)
    const duplicate = await prisma.fileObject.findFirst({
      where: { id: { in: candidateFileIds }, sha256: contentHash },
      select: { id: true },
    })
    if (duplicate && !authorizedIdenticalRetry) {
      throw new ConflictException({
        error: {
          code: 'SCAN_FILE_ALREADY_DELIVERED',
          message: '该扫描文件此前已成功投递，请勿重复上传',
        },
      })
    }
  }
  const previouslyAttempted = await prisma.scanTask.findFirst({
    where: {
      terminalId,
      lastAttemptHash: contentHash,
      updatedAt: { gt: new Date(now.getTime() - SCAN_CONTENT_DEDUP_WINDOW_MS) },
    },
    select: { id: true },
  })
  if (previouslyAttempted && !authorizedIdenticalRetry) {
    throw new ConflictException({
      error: {
        code: 'SCAN_FILE_PREVIOUSLY_ATTEMPTED',
        message: '该扫描文件此前已尝试投递但未完成，请勿重复上传',
      },
    })
  }
}

export function assertScanCaptureFresh(
  observedDate: Date,
  leasePayload: ScanDeliveryLeasePayload,
  taskCreatedAt: Date
): void {
  if (
    observedDate.getTime() < leasePayload.notBeforeEpoch - SCAN_STALE_CAPTURE_TOLERANCE_MS ||
    observedDate.getTime() < taskCreatedAt.getTime() - SCAN_STALE_CAPTURE_TOLERANCE_MS
  ) {
    throw new ConflictException({
      error: {
        code: 'SCAN_FILE_STALE_CAPTURE',
        message: '扫描文件观察时间早于当前任务创建时间，可能属于先前的扫描会话，已拒绝绑定',
      },
    })
  }
}

/** matched 期间刷新 updatedAt。写入失败只记日志，不打断上传。 */
export function startScanMatchedHeartbeat(
  prisma: PrismaService,
  logger: ScanLogger,
  taskId: string,
  intervalMs: number
): NodeJS.Timeout {
  return setInterval(() => {
    prisma.scanTask
      .updateMany({ where: { id: taskId, status: 'matched' }, data: { updatedAt: new Date() } })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(
          `scan task ${taskId}: matched-state heartbeat tick failed (non-fatal, upload continues): ${message}`
        )
      })
  }, intervalMs)
}

/**
 * 上传已经成功后，把仍是 matched 的任务改成 completed。
 * 期间被取消则补偿删除孤儿文件，再抛出状态已变化。
 */
export async function bindUploadedScanFile(
  prisma: PrismaService,
  files: ScanFileCleaner,
  logger: ScanLogger,
  taskId: string,
  fileId: string
): Promise<{ scanTaskId: string; fileId: string }> {
  const completed = await prisma.scanTask.updateMany({
    where: { id: taskId, status: 'matched' },
    data: { status: 'completed', fileId },
  })
  if (completed.count === 0) {
    try {
      await files.systemDelete(
        fileId,
        'ScanTask cancelled during upload, compensating orphaned file'
      )
      logger.log(
        `scan task ${taskId} was no longer 'matched' after upload completed (likely cancelled concurrently); orphaned file ${fileId} deleted via compensating systemDelete()`
      )
    } catch (cleanupError) {
      const cleanupMessage =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      logger.warn(
        `scan task ${taskId}: compensating systemDelete() failed for orphaned file ${fileId}: ${cleanupMessage}`
      )
    }
    throw new ConflictException({
      error: { code: 'SCAN_TASK_STATE_CHANGED', message: '扫描任务状态已变化，请重新发起扫描' },
    })
  }
  return { scanTaskId: taskId, fileId }
}

/** 上传失败时，仍是 matched 的任务落成 failed，并给出重扫授权窗口。 */
export async function recordMatchedScanUploadFailure(
  prisma: PrismaService,
  taskId: string,
  error: unknown,
  retryAuthorityTtlMs: number
): Promise<void> {
  const errorCode = scanDeliveredUploadErrorCode(error)
  await prisma.scanTask.updateMany({
    where: { id: taskId, status: 'matched' },
    data: {
      status: 'failed',
      errorCode,
      errorMessage: USER_FACING_SCAN_ERROR[errorCode],
      retryAuthorityExpiresAt: new Date(Date.now() + retryAuthorityTtlMs),
    },
  })
}
