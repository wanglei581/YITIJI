/**
 * 同一张单的退款和出纸只在这里判定。
 * 领取和开退款都要在自己的事务里调用，避免一边改已退、一边把任务领走。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { STALE_ATTEMPT_REFUND_REASON } from './print-no-paper-refund.constants'
import { wholeOrderPayableCents } from './refund-amount-hold'

type HoldDb = PrismaService | PrismaTransactionClient

const RELEASED_TASK_STATUSES = new Set(['claimed', 'printing', 'completed'])
const OPEN_REFUND_ROW_STATUSES = ['pending', 'failed', 'manual_review'] as const

export const PAPER_ALREADY_RELEASED_CODE = 'PAPER_ALREADY_RELEASED'
export const REFUND_ALREADY_OPEN_CODE = 'REFUND_ALREADY_OPEN'
export const PAPER_ALREADY_RELEASED_MESSAGE =
  '这单已经放行出纸或已经出纸，这一页不能退款。真要退，请走核对后仍退款。'
export const REFUND_ALREADY_OPEN_MESSAGE = '这单已经有退款在处理或已经退成，不能再开一笔。'
export const CLAIM_BLOCKED_BY_REFUND_REASON = '这单有退款在处理或已经退成，不能出纸。'
export const CLAIM_BLOCKED_BY_REFUND_AUDIT = 'print_task.claim_blocked_refund'

export function paperAlreadyReleased(input: {
  taskStatus: string | null
  orderTaskStatus: string | null
  printOutcome: string | null
}): boolean {
  if (input.printOutcome === 'printed') return true
  if (input.taskStatus != null && RELEASED_TASK_STATUSES.has(input.taskStatus)) return true
  if (input.orderTaskStatus === 'claimed' || input.orderTaskStatus === 'printing') return true
  return false
}

export function refundBlocksPaper(input: {
  status: string
  reason: string | null
  amountCents: number
  payStatus: string
  payableCents: number
}, opts?: { allowFailedHold?: boolean }): boolean {
  if (opts?.allowFailedHold && (input.status === 'failed' || input.status === 'manual_review')) return false
  if ((OPEN_REFUND_ROW_STATUSES as readonly string[]).includes(input.status)) return true
  if (input.status !== 'success') return false
  if (input.reason === STALE_ATTEMPT_REFUND_REASON) return false
  if (input.payStatus === 'refunded') return true
  return input.payableCents > 0 && input.amountCents >= input.payableCents
}

function deny(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

async function blockingRefund(
  db: HoldDb,
  orderId: string,
  exceptRefundNo: string | null,
  opts?: { allowFailedHold?: boolean },
): Promise<boolean> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { payStatus: true, amountCents: true, discountCents: true },
  })
  if (!order) return false
  const payableCents = wholeOrderPayableCents(order)
  const rows = await db.refund.findMany({
    where: {
      orderId,
      ...(exceptRefundNo ? { refundNo: { not: exceptRefundNo } } : {}),
    },
    select: { status: true, reason: true, amountCents: true },
  })
  return rows.some((row) => refundBlocksPaper({
    status: row.status,
    reason: row.reason,
    amountCents: row.amountCents,
    payStatus: order.payStatus,
    payableCents,
  }, opts))
}

/** 放行出纸前：在办、失败、待人工，或已经按实付退成的，都不许出纸。过期付款的成功退款不挡住后来的新付款。 */
export async function findBlockingRefund(db: HoldDb, orderId: string): Promise<{ id: string } | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { payStatus: true, amountCents: true, discountCents: true },
  })
  if (!order) return null
  const payableCents = wholeOrderPayableCents(order)
  const rows = await db.refund.findMany({
    where: { orderId },
    select: { id: true, status: true, reason: true, amountCents: true },
  })
  const hit = rows.find((row) => refundBlocksPaper({
    status: row.status,
    reason: row.reason,
    amountCents: row.amountCents,
    payStatus: order.payStatus,
    payableCents,
  }))
  return hit ? { id: hit.id } : null
}

export async function assertCanOpenRefund(
  db: HoldDb,
  orderId: string,
  opts: { refundNo: string; verifiedAfterPaper: boolean },
): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { taskStatus: true, printTaskId: true },
  })
  if (!order) throw new BadRequestException('ORDER_NOT_FOUND')
  const task = order.printTaskId
    ? await db.printTask.findUnique({
      where: { id: order.printTaskId },
      select: { status: true, printOutcome: true },
    })
    : null
  const released = paperAlreadyReleased({
    taskStatus: task?.status ?? null,
    orderTaskStatus: order.taskStatus,
    printOutcome: task?.printOutcome ?? null,
  })
  if (released && !opts.verifiedAfterPaper) {
    throw deny(PAPER_ALREADY_RELEASED_CODE, PAPER_ALREADY_RELEASED_MESSAGE)
  }
  if (!released && opts.verifiedAfterPaper) {
    throw deny('PAPER_NOT_RELEASED', '这单还没放行出纸，请用这一页的普通退款。')
  }
  if (await blockingRefund(db, orderId, opts.refundNo, { allowFailedHold: opts.verifiedAfterPaper })) {
    throw deny(REFUND_ALREADY_OPEN_CODE, REFUND_ALREADY_OPEN_MESSAGE)
  }
}

async function writeClaimBlock(db: HoldDb, orderId: string, taskId: string): Promise<void> {
  const recent = await db.auditLog.findFirst({
    where: {
      targetId: orderId,
      action: CLAIM_BLOCKED_BY_REFUND_AUDIT,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    select: { id: true },
  })
  if (recent) return
  await db.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'system',
      action: CLAIM_BLOCKED_BY_REFUND_AUDIT,
      targetType: 'order',
      targetId: orderId,
      payloadJson: JSON.stringify({ taskId, detail: CLAIM_BLOCKED_BY_REFUND_REASON }),
    },
  })
}

/** 领取请求看到被退款挡住的队头时写下原因。查询已经排除这些任务，这里只补原因，不把任务领走。 */
export async function recordBlockedClaimReason(db: PrismaService, terminalId: string): Promise<void> {
  const task = await db.printTask.findFirst({
    where: {
      status: 'pending',
      terminalId,
      order: { is: { payStatus: 'paid', taskStatus: 'pending' } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, order: { select: { id: true } } },
  })
  if (!task?.order) return
  if (!await findBlockingRefund(db, task.order.id)) return
  await writeClaimBlock(db, task.order.id, task.id)
}

/** 事务内再看一次。返回 true 表示这单不能领，调用方不要改任务状态。 */
export async function rejectClaimForRefund(db: HoldDb, orderId: string, taskId: string): Promise<boolean> {
  if (!await findBlockingRefund(db, orderId)) return false
  await writeClaimBlock(db, orderId, taskId)
  return true
}
