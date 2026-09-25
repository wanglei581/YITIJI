/**
 * 领任务时跳过已无法打印的文件：同一事务把「已付款且有实收」的订单标成待退款。
 *
 * 复用 refundReason=PAID_UNFULFILLED_PENDING_REFUND，不新增字段、不建 Refund、
 * 不调渠道、不把任务改回可领。重复领取只命中已有标记，不再写第二条审计。
 */
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import {
  markPaidUnfulfilledRefundRequired,
  PAID_UNFULFILLED_PENDING_REFUND_REASON,
  shouldSignalPaidUnfulfilledRefund,
} from '../payment/pending-refund-signal'

const PARK_LIMIT = 32

export const PAID_UNFULFILLED_FILE_AUDIT_ACTION = 'order.paid_unfulfilled_file_unavailable'

type FileSnapshot = {
  status?: string | null
  deletedAt?: Date | null
  expiresAt?: Date | null
} | null

export function unprintableFileReason(file: FileSnapshot, now: Date): 'missing' | 'deleted' | 'expired' | 'not_active' | null {
  if (!file) return 'missing'
  if (file.deletedAt) return 'deleted'
  if (file.expiresAt && file.expiresAt.getTime() <= now.getTime()) return 'expired'
  if (file.status !== 'active') return 'not_active'
  if (file.deletedAt !== null) return 'not_active'
  return null
}

const orderSelect = {
  id: true,
  payStatus: true,
  taskStatus: true,
  amountCents: true,
  discountCents: true,
  refundReason: true,
} as const

/**
 * 本终端上已付款、仍 pending、文件已不可印的任务。已标过待退款的不再选出。
 */
export async function parkPaidOrdersWithUnprintableFiles(
  tx: PrismaTransactionClient,
  terminalId: string,
  now: Date,
): Promise<number> {
  const tasks = await tx.printTask.findMany({
    where: {
      status: 'pending',
      terminalId,
      fileId: { not: null },
      order: {
        is: {
          payStatus: 'paid',
          taskStatus: 'pending',
          refundReason: null,
        },
      },
      OR: [
        { file: { is: null } },
        { file: { is: { status: { not: 'active' } } } },
        { file: { is: { deletedAt: { not: null } } } },
        { file: { is: { expiresAt: { lte: now } } } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: PARK_LIMIT,
    select: { id: true },
  })
  let marked = 0
  for (const task of tasks) {
    if (await parkOnePaidOrder(tx, task.id, now)) marked += 1
  }
  return marked
}

/** 事务内再次确认文件已不可印时调用。已标记则返回 false，不重复审计。 */
export async function parkOnePaidOrder(
  tx: PrismaTransactionClient,
  taskId: string,
  now: Date,
): Promise<boolean> {
  const task = await tx.printTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      fileId: true,
      file: { select: { status: true, deletedAt: true, expiresAt: true } },
    },
  })
  if (!task || task.status !== 'pending' || !task.fileId) return false
  const reason = unprintableFileReason(task.file, now)
  if (!reason) return false
  const order = await tx.order.findFirst({
    where: { printTaskId: task.id },
    select: orderSelect,
  })
  if (!order || order.payStatus !== 'paid' || order.taskStatus !== 'pending') return false
  if (order.refundReason === PAID_UNFULFILLED_PENDING_REFUND_REASON) return false
  if (!shouldSignalPaidUnfulfilledRefund(order)) return false
  const created = await markPaidUnfulfilledRefundRequired(tx, order)
  if (!created) return false
  await tx.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'system',
      action: PAID_UNFULFILLED_FILE_AUDIT_ACTION,
      targetType: 'order',
      targetId: order.id,
      payloadJson: JSON.stringify({
        taskId: task.id,
        fileReason: reason,
        refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON,
        autoRefund: false,
        autoRedispatch: false,
      }),
    },
  })
  return true
}
