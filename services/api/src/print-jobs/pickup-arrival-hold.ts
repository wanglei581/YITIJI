/**
 * 到机付款占用。
 *
 * 看价格不写订单终端号。订单本来就绑在别的机器上时，仍按原口径拒绝，避免走错机器变成可枚举的成功响应。
 * 只有这台机器已经开始付款（订单终端号是这台，并且还有未过期的付款尝试）才占住。
 * 尝试过期、明确失败、或还没交给渠道就取消，就放开终端号，换机器可以按那台的价重算。
 * 渠道已经受理（有预支付标识、二维码或流水号）的尝试不在这里放开，避免旧码还能扣的时候又出一笔。
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

/** 渠道还没受理的过期或失败尝试，不再占住终端号。已付款且金额大于 0 的单不放开。 */
export async function releaseStaleArrivalHold(db: HoldDb, orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, terminalId: true, payStatus: true, amountCents: true, printTaskId: true },
  })
  if (!order?.terminalId || order.printTaskId) return
  if (order.payStatus === 'paid' && order.amountCents > 0) return
  if (await hasLiveArrivalPayment(db, order.id)) return
  const now = new Date()
  const stale = await db.paymentAttempt.findFirst({
    where: {
      orderId: order.id,
      prepayId: null,
      qrCodeContent: null,
      channelTxnNo: null,
      OR: [
        { status: { in: ['expired', 'failed'] } },
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
      prepayId: null,
      qrCodeContent: null,
      channelTxnNo: null,
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
  await db.order.updateMany({
    where: { id: orderId, terminalId: null, printTaskId: null, payStatus: { in: ['unpaid', 'paying'] } },
    data: { terminalId: read.claims.terminalId },
  })
}

/** 用户在渠道受理前返回或取消：过期这次尝试并放开终端号。渠道已受理则保持占用直到尝试自己到期。 */
export async function releaseArrivalPaymentHold(
  db: HoldDb,
  orderId: string,
  terminalId: string,
): Promise<'released' | 'kept'> {
  const order = await db.order.findUnique({ where: { id: orderId } })
  if (!order || order.terminalId !== terminalId || order.printTaskId) return 'kept'
  if (order.payStatus === 'paid' || order.payStatus === 'refunding' || order.payStatus === 'refunded') return 'kept'
  const accepted = await db.paymentAttempt.findFirst({
    where: {
      orderId,
      status: { in: [...LIVE_ATTEMPT_STATUSES, 'expired'] },
      OR: [
        { prepayId: { not: null } },
        { qrCodeContent: { not: null } },
        { channelTxnNo: { not: null } },
      ],
    },
    select: { id: true },
  })
  if (accepted) return 'kept'
  await db.paymentAttempt.updateMany({
    where: {
      orderId,
      status: { in: [...LIVE_ATTEMPT_STATUSES] },
      prepayId: null,
      qrCodeContent: null,
      channelTxnNo: null,
    },
    data: { status: 'expired', failReason: '用户返回，这次付款已取消' },
  })
  await db.order.updateMany({
    where: { id: orderId, terminalId, printTaskId: null, payStatus: { in: ['unpaid', 'paying'] } },
    data: { terminalId: null, payStatus: 'unpaid' },
  })
  return 'released'
}
