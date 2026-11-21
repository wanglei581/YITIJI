/**
 * 到机付款占用。
 *
 * 看价格不写订单终端号。订单本来就绑在别的机器上、并且还没有付款尝试时，仍按原口径拒绝，
 * 避免走错机器变成可枚举的成功响应。
 * 只有付款尝试还活着（created/pending 且没过期）才占住这台机器。
 * 用户放弃、尝试过期、渠道确认关单之后都放开。旧码之后若真扣到钱，按迟到付款原路退，不靠一直锁机器。
 */
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { readPaymentSessionClaims } from '../payment/payment-session-token'

type HoldDb = PrismaService | PrismaTransactionClient

const LIVE_ATTEMPT_STATUSES = ['created', 'pending'] as const

export async function hasLiveArrivalPayment(db: HoldDb, orderId: string, now = new Date()): Promise<boolean> {
  const row = await db.paymentAttempt.findFirst({
    where: {
      orderId,
      status: { in: [...LIVE_ATTEMPT_STATUSES] },
      expiresAt: { gt: now },
    },
    select: { id: true },
  })
  return row != null
}

/**
 * 没有还活着的付款尝试时，放开这台机器。
 * 过期、失败、渠道已关单（预支付标识还在）都算放开。一笔尝试都没有时不改终端号：
 * 那是下单时绑的机器，不是这次付款占的。已付款且金额大于 0 的单不放开。
 */
export async function releaseStaleArrivalHold(db: HoldDb, orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, terminalId: true, payStatus: true, amountCents: true, printTaskId: true },
  })
  if (!order?.terminalId || order.printTaskId) return
  if (order.payStatus === 'paid' && order.amountCents > 0) return
  if (order.payStatus !== 'unpaid' && order.payStatus !== 'paying') return
  if (await hasLiveArrivalPayment(db, order.id)) return
  const now = new Date()
  const stale = await db.paymentAttempt.findFirst({
    where: {
      orderId: order.id,
      OR: [
        { status: { in: ['expired', 'failed', 'success'] } },
        { status: { in: [...LIVE_ATTEMPT_STATUSES] }, expiresAt: { lt: now } },
      ],
    },
    select: { id: true },
  })
  if (!stale) return
  await db.paymentAttempt.updateMany({
    where: {
      orderId: order.id,
      status: { in: [...LIVE_ATTEMPT_STATUSES] },
      expiresAt: { lt: now },
    },
    data: { status: 'expired', failReason: '这次付款已过期' },
  })
  await db.order.updateMany({
    where: {
      id: order.id,
      terminalId: order.terminalId,
      printTaskId: null,
      payStatus: { in: ['unpaid', 'paying'] },
    },
    data: {
      terminalId: null,
      ...(order.payStatus === 'paying' ? { payStatus: 'unpaid' as const } : {}),
    },
  })
}

/**
 * 出码前把订单终端号写成这张付款票上的机器。
 * 票和订单对不上时不改订单，交给后面的付款校验拒绝。
 * 别的机器已经占着，或这单已经绑死在别的机器上，也不改。
 */
export async function bindArrivalPaymentTerminal(
  db: PrismaService,
  orderId: string,
  paymentSessionToken: string | undefined,
): Promise<void> {
  const read = readPaymentSessionClaims(paymentSessionToken)
  if (!read.ok || read.claims.orderId !== orderId) return
  const order = await db.order.findUnique({ where: { id: orderId } })
  if (!order || order.printTaskId) return
  if (order.payStatus !== 'unpaid' && order.payStatus !== 'paying') return
  if (order.amountCents !== read.claims.amountCents) return
  if (order.terminalId === read.claims.terminalId) return
  if (order.terminalId) return
  const attempt = await db.paymentAttempt.findFirst({
    where: { orderId, status: { in: [...LIVE_ATTEMPT_STATUSES] } },
    select: { id: true },
  })
  if (!attempt) return
  await db.order.updateMany({
    where: { id: orderId, terminalId: null, printTaskId: null, payStatus: { in: ['unpaid', 'paying'] } },
    data: { terminalId: read.claims.terminalId },
  })
}

/**
 * 用户返回或退出支付：过期还没成功的尝试并放开终端号。
 * 渠道已经受理的也放开。旧码之后若扣到钱，走迟到付款退款，不继续锁住这台机器。
 * 已经有成功尝试时不放开，避免把已经收到的钱所在的单从这台抹掉。
 */
export async function releaseArrivalPaymentHold(
  db: HoldDb,
  orderId: string,
  terminalId: string,
): Promise<'released' | 'kept'> {
  const order = await db.order.findUnique({ where: { id: orderId } })
  if (!order || order.terminalId !== terminalId || order.printTaskId) return 'kept'
  if (order.payStatus === 'paid' || order.payStatus === 'refunding' || order.payStatus === 'refunded') return 'kept'
  const collected = await db.paymentAttempt.findFirst({
    where: { orderId, status: 'success' },
    select: { id: true },
  })
  if (collected) return 'kept'
  await db.paymentAttempt.updateMany({
    where: { orderId, status: { in: [...LIVE_ATTEMPT_STATUSES] } },
    data: { status: 'expired', failReason: '用户返回，这次付款已取消' },
  })
  await db.order.updateMany({
    where: { id: orderId, terminalId, printTaskId: null, payStatus: { in: ['unpaid', 'paying'] } },
    data: { terminalId: null, payStatus: 'unpaid' },
  })
  return 'released'
}
