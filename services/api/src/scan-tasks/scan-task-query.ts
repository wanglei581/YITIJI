import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { signFileUrl } from '../files/signing'
import { buildScanDeliveryLease } from './scan-lease'
import {
  isScanDeviceTask,
  quietPeriodEndsAtIso,
  scanDeviceLeaseFields,
  scanDeviceStatusFields,
} from './scan-device-protocol'
import {
  SCAN_FILE_URL_TTL_MS,
  USER_FACING_SCAN_ERROR,
  timingSafeEqualHex,
  type ScanDeliveryLeaseView,
  type ScanTaskFileView,
  type ScanTaskStatus,
  type ScanTaskStatusResult,
  type ScanType,
} from './scan-task-contracts'

export function presentScanDeliveryLease(
  task: Parameters<typeof scanDeviceLeaseFields>[0] & {
    id: string
    createdAt: Date
    expiresAt: Date
    deviceRound: number
  },
  terminalId: string,
  now: Date
): ScanDeliveryLeaseView {
  return {
    ...buildScanDeliveryLease({
      terminalId,
      scanTaskId: task.id,
      taskCreatedAt: task.createdAt,
      taskExpiresAt: task.expiresAt,
      now,
      ...(isScanDeviceTask(task) ? { deviceRound: task.deviceRound } : {}),
    }),
    ...scanDeviceLeaseFields(task),
  }
}

export function scanTaskEffectiveStatus(status: string, expiresAt: Date): string {
  if ((status === 'waiting' || status === 'matched') && expiresAt.getTime() <= Date.now()) {
    return 'expired'
  }
  return status
}

interface ReadAccessTask {
  controlTokenHash: string | null
  endUserId: string | null
  status: string
  expiresAt: Date
  fileId: string | null
  lastAttemptHash: string | null
  errorCode: string | null
  scanType: string
}

/** 查询扫描会话。过期的 waiting/matched 用 CAS 落盘，失败时重读竞态胜者。 */
export async function readScanTaskStatus(
  prisma: PrismaService,
  input: {
    scanTaskId: string
    endUserId: string | null
    controlToken: string | undefined
    retryAuthorityTtlMs: number
  },
  hooks: {
    assertTaskReadAccess: (
      task: { controlTokenHash: string | null; endUserId: string | null },
      endUserId: string | null,
      controlToken: string | undefined
    ) => void
    effectiveStatus: (status: string, expiresAt: Date) => string
  }
): Promise<ScanTaskStatusResult> {
  let task = await prisma.scanTask.findUnique({ where: { id: input.scanTaskId } })
  if (!task) {
    throw new NotFoundException({
      error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' },
    })
  }
  hooks.assertTaskReadAccess(task, input.endUserId, input.controlToken)

  let effectiveStatus = hooks.effectiveStatus(task.status, task.expiresAt)
  if (effectiveStatus === 'expired' && (task.status === 'waiting' || task.status === 'matched')) {
    const retryAuthorityExpiresAt =
      task.status === 'matched' && task.lastAttemptHash
        ? new Date(Date.now() + input.retryAuthorityTtlMs)
        : null
    const expired = await prisma.scanTask.updateMany({
      where: { id: input.scanTaskId, status: task.status, lastAttemptHash: task.lastAttemptHash },
      data: { status: 'expired', retryAuthorityExpiresAt },
    })
    if (expired.count === 0) {
      const latest = await prisma.scanTask.findUnique({ where: { id: input.scanTaskId } })
      if (!latest) {
        throw new NotFoundException({
          error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' },
        })
      }
      hooks.assertTaskReadAccess(latest, input.endUserId, input.controlToken)
      task = latest
      effectiveStatus = hooks.effectiveStatus(task.status, task.expiresAt)
    }
  }

  const fileObject =
    task.status === 'completed' && task.fileId
      ? await prisma.fileObject.findUnique({ where: { id: task.fileId } })
      : null
  const contractFileUnavailable =
    task.scanType === 'contract' &&
    task.status === 'completed' &&
    (!fileObject ||
      Boolean(fileObject.deletedAt) ||
      !fileObject.expiresAt ||
      fileObject.expiresAt.getTime() <= Date.now())
  if (contractFileUnavailable) {
    effectiveStatus = 'expired'
  }

  let file: ScanTaskFileView | null = null
  if (effectiveStatus === 'completed' && fileObject && !fileObject.deletedAt) {
    const signed = signFileUrl(fileObject.id, SCAN_FILE_URL_TTL_MS)
    file = {
      fileId: fileObject.id,
      filename: fileObject.filename,
      sizeBytes: fileObject.sizeBytes,
      mimeType: fileObject.mimeType,
      sha256: fileObject.sha256,
      fileUrl: signed.url,
    }
  }

  return {
    scanTaskId: task.id,
    status: effectiveStatus as ScanTaskStatus,
    scanType: task.scanType as ScanType,
    file,
    errorCode: task.errorCode,
    errorMessage: task.errorCode
      ? (USER_FACING_SCAN_ERROR[task.errorCode] ?? '扫描处理失败，请重试')
      : null,
    expiresAt: task.expiresAt.toISOString(),
    ...scanDeviceStatusFields(task),
  }
}

/** 取消仍在 waiting/matched 的会话，并给出静默期结束时刻。 */
export async function cancelScanTask(
  prisma: PrismaService,
  input: {
    scanTaskId: string
    endUserId: string | null
    controlToken: string | undefined
    retryAuthorityTtlMs: number
    quietPeriodMs: () => number
  }
): Promise<{
  scanTaskId: string
  status: 'cancelled'
  quietPeriodEndsAt: string
  serverNow: string
}> {
  const task = await prisma.scanTask.findUnique({ where: { id: input.scanTaskId } })
  if (!task) {
    throw new NotFoundException({
      error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' },
    })
  }
  if (
    !task.controlTokenHash ||
    !input.controlToken ||
    !timingSafeEqualHex(input.controlToken, task.controlTokenHash)
  ) {
    throw new ForbiddenException({
      error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权取消该扫描任务' },
    })
  }
  if (input.endUserId !== null && task.endUserId && task.endUserId !== input.endUserId) {
    throw new ForbiddenException({
      error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权取消该扫描任务' },
    })
  }
  if (task.status === 'completed') {
    throw new BadRequestException({
      error: { code: 'SCAN_TASK_ALREADY_COMPLETED', message: '任务已完成，无法取消' },
    })
  }
  if (task.status !== 'waiting' && task.status !== 'matched') {
    throw new ConflictException({
      error: {
        code: 'SCAN_TASK_CANCEL_CONFLICT',
        message: '任务状态已变化，取消失败，请刷新重试',
      },
    })
  }
  const retryAuthorityExpiresAt =
    task.status === 'matched' && task.lastAttemptHash
      ? new Date(Date.now() + input.retryAuthorityTtlMs)
      : null
  const cancelledAt = new Date()
  const cancelled = await prisma.scanTask.updateMany({
    where: {
      id: input.scanTaskId,
      status: task.status,
      lastAttemptHash: task.lastAttemptHash,
    },
    data: { status: 'cancelled', retryAuthorityExpiresAt, updatedAt: cancelledAt },
  })
  if (cancelled.count === 0) {
    const latest = await prisma.scanTask.findUnique({ where: { id: input.scanTaskId } })
    if (latest?.status === 'completed') {
      throw new BadRequestException({
        error: { code: 'SCAN_TASK_ALREADY_COMPLETED', message: '任务已完成，无法取消' },
      })
    }
    throw new ConflictException({
      error: {
        code: 'SCAN_TASK_CANCEL_CONFLICT',
        message: '任务状态已变化，取消失败，请刷新重试',
      },
    })
  }
  const quietPeriodMs = input.quietPeriodMs()
  return {
    scanTaskId: input.scanTaskId,
    status: 'cancelled',
    quietPeriodEndsAt: quietPeriodEndsAtIso(
      quietPeriodMs > 0 ? cancelledAt : null,
      cancelledAt,
      quietPeriodMs
    ),
    serverNow: cancelledAt.toISOString(),
  }
}

/**
 * 静默期已经在调用方核对之后，把 waiting/matched 且未确认的行写成已确认。
 * 已经确认过的原样返回；状态对不上返回 not-allowed。
 */
export async function commitScanDeliveryAck(
  prisma: PrismaService,
  task: ReadAccessTask & { id: string; deliveryAckedAt: Date | null }
): Promise<{ deliveryAckedAt: Date } | 'not-allowed'> {
  if (task.deliveryAckedAt) {
    return { deliveryAckedAt: task.deliveryAckedAt }
  }
  const now = new Date()
  if (
    (task.status !== 'waiting' && task.status !== 'matched') ||
    task.expiresAt.getTime() <= now.getTime()
  ) {
    return 'not-allowed'
  }
  const ackedAt = now
  const updated = await prisma.scanTask.updateMany({
    where: {
      id: task.id,
      status: { in: ['waiting', 'matched'] },
      deliveryAckedAt: null,
      expiresAt: { gt: ackedAt },
    },
    data: { deliveryAckedAt: ackedAt },
  })
  if (updated.count === 0) {
    const latest = await prisma.scanTask.findUnique({ where: { id: task.id } })
    if (latest?.deliveryAckedAt) {
      return { deliveryAckedAt: latest.deliveryAckedAt }
    }
    return 'not-allowed'
  }
  return { deliveryAckedAt: ackedAt }
}
