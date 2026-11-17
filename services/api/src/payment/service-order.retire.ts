import { Logger } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import { getEffectiveUserPrices } from './effective-user-prices'
import { resolvePaymentProviders, type PaymentProviderRegistry } from './payment-provider.factory'
import {
  SERVICE_REFUND_REASON_LATE_PAYMENT,
  SERVICE_REFUND_REASON_NOW_FREE,
  SERVICE_REFUND_REASON_PRICE_CHANGED,
  SERVICE_SWEEP_BATCH,
  isServiceOrderKey,
} from './service-order.policy'
import { executeServiceOrderRefund, markServiceOrderPaid, type RefundRedis } from './service-order.payment'

const logger = new Logger('ServiceOrderRetire')

export type PendingCloseReason = 'personal_charge_changed' | 'price_changed' | 'org_rebound'

type OrderRow = NonNullable<Awaited<ReturnType<PrismaService['serviceOrder']['findUnique']>>>

/**
 * 改价、改绑、改总开关成功之后调用。只关还没付款的服务单。
 * 渠道关不掉也不把设置改回去：库里先关掉，记下还要重试，清扫再去关。
 */
export async function retirePendingServiceOrders(
  db: PrismaService,
  input: { terminalId?: string; closeReason: PendingCloseReason },
): Promise<void> {
  let registry: PaymentProviderRegistry | null = null
  try {
    registry = resolvePaymentProviders()
  } catch (error) {
    logger.warn(`解析收款渠道失败，待付单先在库里关闭：${(error as Error).message}`)
  }
  const audit = new AuditService(db)
  let cursor: string | null = null
  for (;;) {
    const rows: OrderRow[] = await db.serviceOrder.findMany({
      where: {
        status: 'pending',
        ...(input.terminalId ? { terminalId: input.terminalId } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: SERVICE_SWEEP_BATCH,
    })
    if (rows.length === 0) return
    for (const row of rows) {
      try {
        await retireOne(db, registry, audit, null, row, input.closeReason)
      } catch (error) {
        logger.warn(`关闭待付单失败 ${row.id}：${(error as Error).message}`)
      }
    }
    const next: string | undefined = rows[rows.length - 1]?.id
    if (!next || rows.length < SERVICE_SWEEP_BATCH) return
    cursor = next
  }
}

/** 上一拍渠道没关成的单。关成了就清标记；渠道说已经付了就原路退。 */
export async function retryPendingChannelCloses(
  db: PrismaService,
  registry: PaymentProviderRegistry,
  audit: AuditService,
  redis: RefundRedis | null,
): Promise<void> {
  let cursor: string | null = null
  for (;;) {
    const rows: OrderRow[] = await db.serviceOrder.findMany({
      where: {
        status: 'closed',
        channelClosePending: true,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: SERVICE_SWEEP_BATCH,
    })
    if (rows.length === 0) return
    for (const row of rows) {
      try {
        await finishChannelClose(db, registry, audit, redis, row)
      } catch (error) {
        logger.warn(`重试关单失败 ${row.id}：${(error as Error).message}`)
      }
    }
    const next: string | undefined = rows[rows.length - 1]?.id
    if (!next || rows.length < SERVICE_SWEEP_BATCH) return
    cursor = next
  }
}

async function retireOne(
  db: PrismaService,
  registry: PaymentProviderRegistry | null,
  audit: AuditService,
  redis: RefundRedis | null,
  row: OrderRow,
  closeReason: PendingCloseReason,
): Promise<void> {
  const provider = registry?.get(row.provider)
  let channelClosePending = true
  if (provider?.closeExpiredQrPayment) {
    try {
      const closed = await provider.closeExpiredQrPayment({ attemptId: row.providerOrderNo, orderId: row.id })
      if (closed.status === 'paid' && closed.channelTxnNo && closed.amountCents === row.amountCents) {
        await acceptClosedQrPayment(db, registry, audit, redis, row, closed.channelTxnNo)
        return
      }
      if (closed.status === 'closed' || closed.status === 'failed') channelClosePending = false
    } catch (error) {
      logger.warn(`渠道关单失败 ${row.id}：${(error as Error).message}`)
      channelClosePending = true
    }
  }
  const marked = await db.serviceOrder.updateMany({
    where: { id: row.id, status: 'pending' },
    data: { status: 'closed', closeReason, channelClosePending },
  })
  if (marked.count === 1 && channelClosePending) {
    await audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'service_order.channel_close_failed',
      targetType: 'service_order',
      targetId: row.id,
      payload: { closeReason, provider: row.provider },
    })
  }
}

async function finishChannelClose(
  db: PrismaService,
  registry: PaymentProviderRegistry,
  audit: AuditService,
  redis: RefundRedis | null,
  row: OrderRow,
): Promise<void> {
  const provider = registry.get(row.provider)
  if (!provider?.closeExpiredQrPayment) return
  const closed = await provider.closeExpiredQrPayment({ attemptId: row.providerOrderNo, orderId: row.id })
  if (closed.status === 'paid' && closed.channelTxnNo && closed.amountCents === row.amountCents) {
    await markServiceOrderPaid(db, registry, audit, row, closed.channelTxnNo, row.prepayId ?? '', redis)
    return
  }
  if (closed.status !== 'closed' && closed.status !== 'failed') return
  await db.serviceOrder.updateMany({
    where: { id: row.id, status: 'closed', channelClosePending: true },
    data: { channelClosePending: false },
  })
}

/** 关码时渠道说钱已经到了。记成已付再退，不能把付过的单收成关闭。 */
async function acceptClosedQrPayment(
  db: PrismaService,
  registry: PaymentProviderRegistry | null,
  audit: AuditService,
  redis: RefundRedis | null,
  row: OrderRow,
  channelTxnNo: string,
): Promise<void> {
  if (!registry) return
  const marked = await db.serviceOrder.updateMany({
    where: { id: row.id, status: 'pending', channelTxnNo: null },
    data: { status: 'paid', paidAt: new Date(), channelTxnNo, paymentFailed: false },
  })
  if (marked.count !== 1) return
  await audit.write({
    actorId: null,
    actorRole: 'system',
    action: 'service_order.paid',
    targetType: 'service_order',
    targetId: row.id,
    payload: { amountCents: row.amountCents, serviceKey: row.serviceKey, provider: row.provider, late: true },
  })
  const prices = await getEffectiveUserPrices(db, row.terminalId)
  const effective = isServiceOrderKey(row.serviceKey) ? prices.prices[row.serviceKey].effectiveCents : 0
  const reason = effective === row.amountCents
    ? SERVICE_REFUND_REASON_LATE_PAYMENT
    : effective === 0
      ? SERVICE_REFUND_REASON_NOW_FREE
      : SERVICE_REFUND_REASON_PRICE_CHANGED
  await executeServiceOrderRefund(db, registry, audit, redis, row.id, reason)
}
