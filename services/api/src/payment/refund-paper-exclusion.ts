/**
 * 同一张单的退款和出纸只在这里判定。
 * 领取和开退款都要在自己的事务里调用，避免一边改已退、一边把任务领走。
 */
import { BadRequestException } from '@nestjs/common'
import type { DbKind } from '../prisma/create-client'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { PAID_UNFULFILLED_PENDING_REFUND_REASON } from './pending-refund-signal'
import { STALE_ATTEMPT_REFUND_REASON } from './print-no-paper-refund.constants'
import { wholeOrderPayableCents } from './refund-amount-hold'
import { refundMayStillBeAtChannel } from './refund-channel-acceptance'

type HoldDb = PrismaService | PrismaTransactionClient

const RELEASED_TASK_STATUSES = new Set(['claimed', 'printing', 'completed'])
const OPEN_REFUND_ROW_STATUSES = ['pending', 'failed', 'manual_review'] as const

/**
 * 领取查询里订单这一侧的退款条件。
 * null 必须单独写：SQL 里不等号不匹配 NULL，否则没写原因的已付款单会领不走。
 * 过期付款的退款，不论在办、失败还是已退成，都不挡住后来的新付款。
 */
export function claimOrderNotBlockedByRefundWhere() {
  return {
    OR: [
      { refundReason: null },
      { refundReason: { not: PAID_UNFULFILLED_PENDING_REFUND_REASON } },
    ],
    NOT: {
      refunds: {
        some: {
          OR: [
            {
              status: { in: [...OPEN_REFUND_ROW_STATUSES] },
              OR: [
                { reason: null },
                { reason: { not: STALE_ATTEMPT_REFUND_REASON } },
              ],
            },
            {
              // 成功行也要单独写 reason 为空。SQL 里「不等于过期原因」匹配不到 NULL。
              status: 'success',
              OR: [
                { reason: null },
                { reason: { not: STALE_ATTEMPT_REFUND_REASON } },
              ],
            },
          ],
        },
      },
    },
  }
}

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
  if (input.reason === STALE_ATTEMPT_REFUND_REASON) return false
  if ((OPEN_REFUND_ROW_STATUSES as readonly string[]).includes(input.status)) return true
  if (input.status !== 'success') return false
  if (input.payStatus === 'refunded') return true
  return input.payableCents > 0 && input.amountCents >= input.payableCents
}

function deny(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

/** 单行都没盖住应付时，非过期成功退款的合计仍可能盖住。过期付款不计入。 */
function summedSuccessBlock(
  rows: Array<{ id: string; status: string; reason: string | null; amountCents: number }>,
  payableCents: number,
): { id: string } | null {
  let sum = 0
  let firstId: string | null = null
  for (const row of rows) {
    if (row.status !== 'success' || row.reason === STALE_ATTEMPT_REFUND_REASON) continue
    sum += row.amountCents
    if (!firstId) firstId = row.id
  }
  if (firstId && payableCents > 0 && sum >= payableCents) return { id: firstId }
  return null
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
  if (rows.some((row) => refundBlocksPaper({
    status: row.status,
    reason: row.reason,
    amountCents: row.amountCents,
    payStatus: order.payStatus,
    payableCents,
  }, opts))) return true
  return summedSuccessBlock(rows, payableCents) !== null
}

/** 放行出纸前：在办、失败、待人工，或已经按实付退成的，都不许出纸。过期付款的退款，不论还在处理、失败还是已经退成，都不挡住后来的新付款。 */
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
  if (hit) return { id: hit.id }
  return summedSuccessBlock(rows, payableCents)
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

/** 事务内再看一次。先锁订单，再读退款合计。返回 true 表示这单不能领。 */
export async function rejectClaimForRefund(
  db: HoldDb,
  dbKind: DbKind,
  orderId: string,
  taskId: string,
): Promise<boolean> {
  await lockOrderRow(db, dbKind, orderId)
  if (!await findBlockingRefund(db, orderId)) return false
  await writeClaimBlock(db, orderId, taskId)
  return true
}

type VerifyRefundRow = {
  status: string
  reason: string | null
  channel: string
  refundNo: string
  channelRefundNo: string | null
}

/** 过期付款的退款不挡。处理中、已退成，以及渠道还没明确失败的，挡住核验。 */
function refundBlocksVerifiedOutcome(row: VerifyRefundRow): boolean {
  if (row.reason === STALE_ATTEMPT_REFUND_REASON) return false
  if (row.status === 'pending' || row.status === 'success') return true
  return refundMayStillBeAtChannel(row)
}

/** 渠道没受理过的待人工。核验已出纸时撤回，未出纸不动。 */
function withdrawOnVerifiedPaper(row: VerifyRefundRow): boolean {
  if (refundMayStillBeAtChannel(row)) return false
  if (row.status !== 'manual_review') return false
  return true
}

/** 已在退或已退成（原因是空也算）。过期付款的退款不挡住后来这一笔。渠道受理过、还没失败的待人工也挡住。 */
export async function orderRefundBlocksOutcome(
  db: HoldDb,
  orderId: string,
): Promise<boolean> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { payStatus: true, taskStatus: true },
  })
  if (!order || order.payStatus !== 'paid') return true
  if (order.taskStatus === 'claimed' || order.taskStatus === 'printing' || order.taskStatus === 'completed') {
    return true
  }
  const rows = await db.refund.findMany({
    where: { orderId },
    select: { status: true, reason: true, channel: true, refundNo: true, channelRefundNo: true },
  })
  return rows.some((row) => refundBlocksVerifiedOutcome(row))
}

/** 先锁订单行。拿到锁之后再用新语句读退款，避免和核验出纸看同一张旧快照。 */
export async function lockOrderRow(
  tx: PrismaTransactionClient,
  dbKind: DbKind,
  orderId: string,
): Promise<void> {
  if (dbKind === 'postgres') {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`
    return
  }
  await tx.order.updateMany({ where: { id: orderId }, data: { updatedAt: new Date() } })
}

export interface UnreleasedRefundMark {
  payStatus: 'refunded' | 'partial_refunded'
  refundedAmountCents: number
  refundReason: string | null
  refundedAt: Date | null
}

/**
 * 确认退成改支付状态的那一条更新。
 * PostgreSQL 在同一条语句里先锁订单、再锁打印任务：任务已领、正在打、已完成，
 * 或 printOutcome 已是 printed，这条更新就不命中。只写 printOutcome 的核验抢的是同一行。
 */
export async function markOrderIfPaperUnreleased(
  tx: PrismaTransactionClient,
  dbKind: DbKind,
  orderId: string,
  data: UnreleasedRefundMark,
): Promise<boolean> {
  if (dbKind === 'postgres') {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH locked_order AS MATERIALIZED (
        SELECT o."id", o."printTaskId"
        FROM "Order" o
        WHERE o."id" = ${orderId}
          AND o."payStatus" IN ('paid', 'refunding', 'partial_refunded')
          AND o."taskStatus" NOT IN ('claimed', 'printing', 'completed')
        FOR UPDATE
      ),
      locked_task AS MATERIALIZED (
        SELECT t."id"
        FROM "PrintTask" t
        JOIN locked_order o ON t."id" = o."printTaskId"
        WHERE t."status" NOT IN ('claimed', 'printing', 'completed')
          AND (t."printOutcome" IS NULL OR t."printOutcome" <> 'printed')
        FOR UPDATE
      )
      UPDATE "Order" o
      SET "payStatus" = ${data.payStatus},
          "refundedAmountCents" = ${data.refundedAmountCents},
          "refundReason" = ${data.refundReason},
          "refundedAt" = CASE
            WHEN ${data.payStatus} = 'refunded' THEN ${data.refundedAt}
            ELSE o."refundedAt"
          END,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM locked_order
      WHERE o."id" = locked_order."id"
        AND (
          locked_order."printTaskId" IS NULL
          OR EXISTS (SELECT 1 FROM locked_task)
        )
      RETURNING o."id"
    `
    return rows.length === 1
  }
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { printTaskId: true, payStatus: true, taskStatus: true },
  })
  if (!order) return false
  if (order.payStatus !== 'paid' && order.payStatus !== 'refunding' && order.payStatus !== 'partial_refunded') {
    return false
  }
  if (order.taskStatus === 'claimed' || order.taskStatus === 'printing' || order.taskStatus === 'completed') {
    return false
  }
  if (order.printTaskId) {
    const held = await tx.printTask.updateMany({
      where: {
        id: order.printTaskId,
        status: { notIn: ['claimed', 'printing', 'completed'] },
        OR: [
          { printOutcome: null },
          { printOutcome: { not: 'printed' } },
        ],
      },
      data: { updatedAt: new Date() },
    })
    if (held.count !== 1) return false
  }
  const marked = await tx.order.updateMany({
    where: {
      id: orderId,
      payStatus: { in: ['paid', 'refunding', 'partial_refunded'] },
      taskStatus: { notIn: ['claimed', 'printing', 'completed'] },
    },
    data: {
      payStatus: data.payStatus,
      refundedAmountCents: data.refundedAmountCents,
      refundReason: data.refundReason,
      ...(data.payStatus === 'refunded' && data.refundedAt ? { refundedAt: data.refundedAt } : {}),
    },
  })
  return marked.count === 1
}

const VERIFY_PAPER_WITHDRAW_REASON = '核验已出纸'

async function lockPaidUnreleasedOrder(
  tx: PrismaTransactionClient,
  dbKind: DbKind,
  orderId: string,
): Promise<boolean> {
  if (dbKind === 'postgres') {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT o."id"
      FROM "Order" o
      WHERE o."id" = ${orderId}
        AND o."payStatus" = 'paid'
        AND o."taskStatus" NOT IN ('claimed', 'printing', 'completed')
      FOR UPDATE
    `
    return rows.length === 1
  }
  const locked = await tx.order.updateMany({
    where: {
      id: orderId,
      payStatus: 'paid',
      taskStatus: { notIn: ['claimed', 'printing', 'completed'] },
    },
    data: { updatedAt: new Date() },
  })
  return locked.count === 1
}

/**
 * 核验出纸写 printOutcome。
 * 先只锁订单行，拿到锁后再读退款。同一条语句里的 NOT EXISTS 会用等锁前的快照。
 * 渠道没受理过的待人工，核验已出纸时在这个事务里撤回。
 */
export async function writePrintOutcomeIfRefundClear(
  tx: PrismaTransactionClient,
  dbKind: DbKind,
  input: { taskId: string; orderId: string; outcome: string; unconfirmedErrorCode: string },
): Promise<boolean> {
  const locked = await lockPaidUnreleasedOrder(tx, dbKind, input.orderId)
  if (!locked) return false
  const rows = await tx.refund.findMany({
    where: { orderId: input.orderId },
    select: { id: true, refundNo: true, status: true, reason: true, channel: true, channelRefundNo: true },
  })
  if (rows.some((row) => refundBlocksVerifiedOutcome(row))) return false
  if (input.outcome === 'printed') {
    for (const row of rows) {
      if (!withdrawOnVerifiedPaper(row)) continue
      const withdrawn = await tx.refund.updateMany({
        where: { id: row.id, status: 'manual_review' },
        data: { status: 'withdrawn', reason: VERIFY_PAPER_WITHDRAW_REASON },
      })
      if (withdrawn.count !== 1) return false
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'admin',
          action: 'refund.hold_resolved',
          targetType: 'order',
          targetId: input.orderId,
          payloadJson: JSON.stringify({
            refundNo: row.refundNo,
            detail: VERIFY_PAPER_WITHDRAW_REASON,
          }),
        },
      })
    }
  }
  const cas = await tx.printTask.updateMany({
    where: {
      id: input.taskId,
      status: 'failed',
      errorCode: input.unconfirmedErrorCode,
      printOutcome: null,
    },
    data: { printOutcome: input.outcome },
  })
  return cas.count === 1
}
