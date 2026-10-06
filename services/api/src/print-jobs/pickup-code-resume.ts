import { BadRequestException, ConflictException } from '@nestjs/common'
import { signFileUrl } from '../files/signing'
import type { PrismaService } from '../prisma/prisma.service'
import { isPickupClaimWindowClosed } from './pickup-claim-window'
import {
  REPRINT_BLOCKED_CODE,
  REPRINT_BLOCKED_MESSAGE,
  latestHeartbeatAgentVersion,
  paidReprintBlockReason,
  type PaidReprintBlockReason,
} from './paid-reprint-eligibility'
import { isPrintableFileRecord } from './print-page-count.service'
import { lockPrintTaskRow } from '../terminals/print-status-attempt'
import {
  PICKUP_CODE_RESUME,
  PICKUP_RESUME_LIMIT_REACHED,
  PICKUP_RESUME_PARTIAL_OUTPUT,
  PICKUP_RESUME_PARTIAL_OUTPUT_MESSAGE,
  PICKUP_RESUME_UNCONFIRMED,
  PICKUP_RESUME_UNCONFIRMED_MESSAGE,
  SELF_SERVICE_REPRINT_LIMIT,
  SELF_SERVICE_REPRINT_LIMIT_MESSAGE,
  selfServiceReprintCount,
} from './self-service-reprint'

/** 与会员重试、管理员重试同一档：Agent 仍能在半小时内拉到文件。 */
const RESUME_FILE_URL_TTL_MS = 30 * 60 * 1000

type OrderRecord = NonNullable<Awaited<ReturnType<PrismaService['order']['findUnique']>>>

export type PickupResumeResult =
  | { action: 'replay' }
  | { action: 'resumed'; order: OrderRecord }

function conflict(code: string, message: string): never {
  throw new ConflictException({ error: { code, message } })
}

function throwResumeBlock(reason: PaidReprintBlockReason): never {
  if (reason === 'unconfirmed') conflict(PICKUP_RESUME_UNCONFIRMED, PICKUP_RESUME_UNCONFIRMED_MESSAGE)
  if (reason === 'partial_output') conflict(PICKUP_RESUME_PARTIAL_OUTPUT, PICKUP_RESUME_PARTIAL_OUTPUT_MESSAGE)
  conflict(REPRINT_BLOCKED_CODE[reason], REPRINT_BLOCKED_MESSAGE[reason])
}

const EXPIRED = {
  error: { code: 'PICKUP_CODE_EXPIRED', message: '到机码已过期，请在小程序重新下单' },
} as const

/**
 * 已放行且任务失败时，用同一个到机码把这一单拉回待打印。
 * 不是失败、或任务不在本机：交给原来的 10 分钟回放。
 * 不建任务、不改金额、不新建订单。
 */
export async function resumeReleasedFailure(
  prisma: PrismaService,
  order: OrderRecord,
  terminalId: string,
): Promise<PickupResumeResult> {
  if (order.terminalId !== terminalId || !order.printTaskId || order.pickupStatus !== 'used') {
    return { action: 'replay' }
  }
  const task = await prisma.printTask.findUnique({
    where: { id: order.printTaskId },
    select: { id: true, status: true, errorCode: true, terminalId: true, fileId: true },
  })
  if (!task || task.status !== 'failed' || task.terminalId !== terminalId) return { action: 'replay' }
  if (isPickupClaimWindowClosed(order)) throw new BadRequestException(EXPIRED)

  const file = task.fileId
    ? await prisma.fileObject.findUnique({
        where: { id: task.fileId },
        select: { status: true, deletedAt: true, expiresAt: true },
      })
    : null
  const agentVersion = await latestHeartbeatAgentVersion(prisma, task.terminalId)
  const reason = paidReprintBlockReason({
    status: task.status,
    errorCode: task.errorCode,
    hasOrder: true,
    payStatus: order.payStatus,
    file,
    terminalId: task.terminalId,
    agentVersion,
  })
  if (reason) throwResumeBlock(reason)
  const used = await selfServiceReprintCount(prisma, task.id)
  if (used >= SELF_SERVICE_REPRINT_LIMIT) {
    conflict(PICKUP_RESUME_LIMIT_REACHED, SELF_SERVICE_REPRINT_LIMIT_MESSAGE)
  }
  const fileId = task.fileId
  if (!fileId || !isPrintableFileRecord(file)) {
    throwResumeBlock('file_unavailable')
  }
  const { url: freshFileUrl } = signFileUrl(fileId, RESUME_FILE_URL_TTL_MS)

  await prisma.$transaction(async (tx) => {
    await lockPrintTaskRow(tx, task.id)
    const liveTask = await tx.printTask.findUnique({
      where: { id: task.id },
      select: { status: true, errorCode: true, terminalId: true, fileId: true },
    })
    const liveOrder = await tx.order.findUnique({ where: { id: order.id } })
    if (!liveTask || !liveOrder || liveTask.terminalId !== terminalId || liveOrder.printTaskId !== task.id) {
      return
    }
    if (liveTask.status !== 'failed') {
      conflict(REPRINT_BLOCKED_CODE.not_failed, REPRINT_BLOCKED_MESSAGE.not_failed)
    }
    if (isPickupClaimWindowClosed(liveOrder)) throw new BadRequestException(EXPIRED)
    const liveFile = liveTask.fileId
      ? await tx.fileObject.findUnique({
          where: { id: liveTask.fileId },
          select: { status: true, deletedAt: true, expiresAt: true },
        })
      : null
    const liveVersion = await latestHeartbeatAgentVersion(tx, liveTask.terminalId)
    const liveReason = paidReprintBlockReason({
      status: liveTask.status,
      errorCode: liveTask.errorCode,
      hasOrder: true,
      payStatus: liveOrder.payStatus,
      file: liveFile,
      terminalId: liveTask.terminalId,
      agentVersion: liveVersion,
    })
    if (liveReason) throwResumeBlock(liveReason)
    const liveUsed = await selfServiceReprintCount(tx, task.id)
    if (liveUsed >= SELF_SERVICE_REPRINT_LIMIT) {
      conflict(PICKUP_RESUME_LIMIT_REACHED, SELF_SERVICE_REPRINT_LIMIT_MESSAGE)
    }
    const updatedOrder = await tx.order.updateMany({
      where: {
        id: order.id,
        printTaskId: task.id,
        pickupStatus: 'used',
        taskStatus: 'failed',
        payStatus: 'paid',
      },
      data: { taskStatus: 'pending' },
    })
    if (updatedOrder.count !== 1) {
      conflict(REPRINT_BLOCKED_CODE.not_failed, '任务状态已变更，请刷新后重试')
    }
    const updated = await tx.printTask.updateMany({
      where: { id: task.id, status: 'failed', terminalId },
      data: {
        status: 'pending',
        claimedAt: null,
        claimExpiry: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        fileUrl: freshFileUrl,
      },
    })
    if (updated.count !== 1) {
      conflict(REPRINT_BLOCKED_CODE.not_failed, '任务状态已变更，请刷新后重试')
    }
    await tx.printTaskStatusLog.create({
      data: { taskId: task.id, fromStatus: 'failed', toStatus: 'pending', errorCode: PICKUP_CODE_RESUME },
    })
  })

  const fresh = await prisma.order.findUnique({ where: { id: order.id } })
  if (!fresh || fresh.printTaskId !== task.id || fresh.taskStatus !== 'pending') {
    return { action: 'replay' }
  }
  return { action: 'resumed', order: fresh }
}
