import { ConflictException, HttpException, HttpStatus } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { PaymentProviderRegistry } from './payment-provider.factory'
import { executeServiceOrderRefund, type RefundRedis } from './service-order.payment'
import {
  displaceOrBlockOpenRef,
  isServiceOrderOpenRefConflict,
  serviceOrderRefOccupied,
} from './service-order.ref'
import { releaseInterviewSession } from './service-order.sweep'
import {
  SERVICE_ORDER_NAMES,
  SERVICE_REFUND_REASON_RETRY_EXPIRED,
  SERVICE_RETRY_WINDOW_MS,
  SERVICE_SWEEP_BATCH,
  classifyServiceOutcome,
  failureReasonFor,
  isServiceOrderKey,
  type ServiceOrderKey,
  type ServiceTripEvent,
} from './service-order.policy'

type OrderRow = NonNullable<Awaited<ReturnType<PrismaService['serviceOrder']['findUnique']>>>

export interface ServiceOrderSettleDeps {
  prisma: PrismaService
  registry: PaymentProviderRegistry
  audit: AuditService
  redis: RefundRedis | null
}

export async function markServiceOrderNotMade(
  deps: ServiceOrderSettleDeps,
  orderId: string,
  event: ServiceTripEvent,
): Promise<void> {
  const row = await deps.prisma.serviceOrder.findUnique({ where: { id: orderId } })
  if (!row || !isServiceOrderKey(row.serviceKey) || row.status !== 'consumed') return
  const outcome = classifyServiceOutcome(row.serviceKey, event)
  if (outcome === 'layout_only') return
  if (outcome === 'made') {
    await finishServiceOrder(deps.prisma, orderId)
    return
  }
  const session = await deps.prisma.kioskSession.findUnique({
    where: { terminalId_clientSessionId: { terminalId: row.terminalId, clientSessionId: row.kioskSessionId } },
    select: { endedAt: true },
  })
  if (!session?.endedAt && row.attemptsUsed < 2) {
    const updated = await deps.prisma.serviceOrder.updateMany({
      where: { id: row.id, status: 'consumed', attemptsUsed: row.attemptsUsed },
      data: {
        status: 'paid',
        failureReason: failureReasonFor(event),
        retryUntil: new Date(Date.now() + SERVICE_RETRY_WINDOW_MS),
        consumedAt: null,
        consumedRef: null,
      },
    })
    if (updated.count === 1) return
  }
  await executeServiceOrderRefund(
    deps.prisma, deps.registry, deps.audit, deps.redis, row.id, failureReasonFor(event),
  )
}

export async function finishServiceOrder(prisma: PrismaService, orderId: string): Promise<void> {
  await prisma.serviceOrder.updateMany({
    where: { id: orderId, status: 'consumed' },
    data: { failureReason: null, retryUntil: null, settledAt: new Date() },
  })
}

/** 同一任务上还有没结案的旧单时，能判没做成就退掉，判不了就留给认领回 409。 */
export async function yieldOpenServiceRef(
  deps: ServiceOrderSettleDeps,
  serviceKey: ServiceOrderKey,
  consumedRef: string,
  incomingOrderId: string,
  now: Date,
): Promise<void> {
  await displaceOrBlockOpenRef({
    prisma: deps.prisma,
    now,
    refund: (orderId, reason) => executeServiceOrderRefund(
      deps.prisma, deps.registry, deps.audit, deps.redis, orderId, reason,
    ),
    releaseInterview: (sessionId) => releaseInterviewSession(deps.prisma, sessionId),
  }, { serviceKey, consumedRef, incomingOrderId })
}

export async function claimServiceConsume(
  prisma: PrismaService,
  terminalId: string,
  kioskSessionId: string,
  serviceKey: ServiceOrderKey,
  serviceOrderId: string,
  consumedRef: string,
  now: Date,
): Promise<number> {
  try {
    const claimed = await prisma.serviceOrder.updateMany({
      where: {
        id: serviceOrderId,
        terminalId,
        kioskSessionId,
        serviceKey,
        status: 'paid',
        attemptsUsed: { lt: 2 },
        OR: [{ attemptsUsed: 0 }, { retryUntil: { gt: now } }],
      },
      data: {
        attemptsUsed: { increment: 1 },
        status: 'consumed',
        consumedAt: now,
        consumedRef,
        failureReason: null,
        retryUntil: null,
      },
    })
    return claimed.count
  } catch (error) {
    if (isServiceOrderOpenRefConflict(error)) return -1
    throw error
  }
}

export async function serviceRefOccupiedError(
  prisma: PrismaService,
  serviceKey: ServiceOrderKey,
  consumedRef: string,
  incomingOrderId: string,
): Promise<HttpException> {
  const holder = await prisma.serviceOrder.findFirst({
    where: {
      serviceKey,
      consumedRef,
      id: { not: incomingOrderId },
      status: { in: ['pending', 'paid', 'consumed'] },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  return serviceOrderRefOccupied(holder?.id ?? incomingOrderId)
}

function orderInUse(consumedRef: string | null): HttpException {
  return new ConflictException({
    error: {
      code: 'SERVICE_ORDER_IN_USE',
      message: '这一次已经在进行',
      ...(consumedRef ? { consumedRef } : {}),
    },
  })
}

function paymentRequired(amountCents: number, serviceKey: ServiceOrderKey): HttpException {
  return new HttpException({
    error: {
      code: 'SERVICE_PAYMENT_REQUIRED',
      message: '这一次要先付款',
      amountCents,
      serviceKey,
      serviceName: SERVICE_ORDER_NAMES[serviceKey],
    },
  }, HttpStatus.PAYMENT_REQUIRED)
}

/** 认领这一趟。同一任务上的旧单先让开；扫描没做成可以当场退回再认领。 */
export async function consumePaidServiceOrder(
  deps: ServiceOrderSettleDeps,
  input: {
    terminalId: string
    kioskSessionId: string | null
    serviceKey: ServiceOrderKey
    serviceOrderId: string | null
    amountCents: number
    consumedRef: string
  },
  reclaim: (row: OrderRow) => Promise<boolean>,
): Promise<string> {
  const { terminalId, kioskSessionId, serviceKey, serviceOrderId, amountCents, consumedRef } = input
  if (!kioskSessionId || !serviceOrderId) throw paymentRequired(amountCents, serviceKey)
  const now = new Date()
  await yieldOpenServiceRef(deps, serviceKey, consumedRef, serviceOrderId, now)
  const claimed = await claimServiceConsume(deps.prisma, terminalId, kioskSessionId, serviceKey, serviceOrderId, consumedRef, now)
  if (claimed === 1) return serviceOrderId
  if (claimed < 0) {
    await yieldOpenServiceRef(deps, serviceKey, consumedRef, serviceOrderId, now)
    const again = await claimServiceConsume(deps.prisma, terminalId, kioskSessionId, serviceKey, serviceOrderId, consumedRef, now)
    if (again === 1) return serviceOrderId
    throw await serviceRefOccupiedError(deps.prisma, serviceKey, consumedRef, serviceOrderId)
  }
  const row = await deps.prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } })
  const sameTrip = Boolean(
    row && row.terminalId === terminalId && row.kioskSessionId === kioskSessionId && row.serviceKey === serviceKey,
  )
  if (sameTrip && row?.status === 'consumed' && serviceKey === 'scan') {
    const reclaimed = await reclaim(row)
    if (reclaimed) {
      await yieldOpenServiceRef(deps, serviceKey, consumedRef, serviceOrderId, now)
      const again = await claimServiceConsume(deps.prisma, terminalId, kioskSessionId, serviceKey, serviceOrderId, consumedRef, now)
      if (again === 1) return serviceOrderId
      if (again < 0) throw await serviceRefOccupiedError(deps.prisma, serviceKey, consumedRef, serviceOrderId)
    }
  }
  const fresh = sameTrip ? await deps.prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } }) : row
  if (fresh && fresh.terminalId === terminalId && fresh.kioskSessionId === kioskSessionId && fresh.serviceKey === serviceKey && fresh.status === 'consumed') {
    throw orderInUse(fresh.consumedRef)
  }
  if (row) await refundExpiredServiceRetry(deps, row, now)
  throw paymentRequired(amountCents, serviceKey)
}

export async function refundExpiredServiceRetry(
  deps: ServiceOrderSettleDeps,
  row: { id: string; status: string; attemptsUsed: number; retryUntil: Date | null },
  now: Date,
): Promise<void> {
  if (row.status === 'paid' && row.attemptsUsed >= 1 && row.retryUntil && row.retryUntil.getTime() <= now.getTime()) {
    await executeServiceOrderRefund(deps.prisma, deps.registry, deps.audit, deps.redis, row.id, SERVICE_REFUND_REASON_RETRY_EXPIRED)
  }
}

/** 超时未付关掉。渠道说已经付了就改成已付，不把付过的单关成没付钱。游标只往前走，渠道还没给结论的单留到下一拍。 */
export async function closeExpiredServiceOrders(deps: ServiceOrderSettleDeps, now: Date): Promise<void> {
  let cursor: string | null = null
  for (;;) {
    const rows: OrderRow[] = await deps.prisma.serviceOrder.findMany({
      where: {
        status: 'pending',
        expiresAt: { lt: now },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: SERVICE_SWEEP_BATCH,
    })
    if (rows.length === 0) return
    for (const row of rows) {
      const provider = deps.registry.get(row.provider)
      let leaveOpen = false
      if (provider?.closeExpiredQrPayment) {
        try {
          const closed = await provider.closeExpiredQrPayment({ attemptId: row.providerOrderNo, orderId: row.id })
          if (closed.status === 'paid') {
            if (closed.channelTxnNo && closed.amountCents === row.amountCents) {
              const marked = await deps.prisma.serviceOrder.updateMany({
                where: { id: row.id, status: 'pending' },
                data: { status: 'paid', paidAt: new Date(), channelTxnNo: closed.channelTxnNo, paymentFailed: false },
              })
              if (marked.count === 1) await auditPaid(deps.audit, row)
            }
            leaveOpen = true
          } else if (closed.status !== 'closed' && closed.status !== 'failed') {
            leaveOpen = true
          }
        } catch {
          // 关码失败仍按未付关闭。之后若迟到的成功通知进来，会按原路退回。
        }
      }
      if (!leaveOpen) {
        await deps.prisma.serviceOrder.updateMany({
          where: { id: row.id, status: 'pending', expiresAt: { lt: now } },
          data: { status: 'closed', closeReason: 'expired' },
        })
      }
    }
    const next: string | undefined = rows[rows.length - 1]?.id
    if (!next || next === cursor || rows.length < SERVICE_SWEEP_BATCH) return
    cursor = next
  }
}

async function auditPaid(
  audit: AuditService,
  row: Pick<OrderRow, 'id' | 'amountCents' | 'serviceKey' | 'provider'>,
): Promise<void> {
  await audit.write({
    actorId: null,
    actorRole: 'kiosk',
    action: 'service_order.paid',
    targetType: 'service_order',
    targetId: row.id,
    payload: { amountCents: row.amountCents, serviceKey: row.serviceKey, provider: row.provider },
  })
}
