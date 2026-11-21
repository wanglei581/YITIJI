import type { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import { MINIAPP_CREDIT_PROVIDER } from './virtual-pay.contract'

export const VIRTUAL_PAY_CREDIT_REDEEMED_AUDIT_ACTION = 'virtual_pay.credit_redeemed'
export const VIRTUAL_PAY_CREDIT_RESTORED_AUDIT_ACTION = 'virtual_pay.credit_restored'

export interface MiniappCreditServiceOrderRow {
  id: string
  provider: string
  status: string
  serviceKey: string
  amountCents: number
}

/**
 * 失败/离场/关单/改免费时，把已关联到该一体机服务单的小程序权益原子退回 available。
 * 绝不调微信 Native 退款接口；重复调用幂等，不会重复恢复或抛错。
 */
export async function restoreMiniappCreditForServiceOrder(
  db: PrismaService,
  audit: AuditService,
  order: MiniappCreditServiceOrderRow,
  reason: string,
): Promise<'refunded' | 'skipped'> {
  if (order.provider !== MINIAPP_CREDIT_PROVIDER) return 'skipped'
  if (order.status === 'refunded') return 'refunded'
  if (order.status !== 'paid' && order.status !== 'consumed') return 'skipped'

  const now = new Date()
  const outcome = await db.$transaction(async (tx) => {
    const updatedOrder = await tx.serviceOrder.updateMany({
      where: {
        id: order.id,
        provider: MINIAPP_CREDIT_PROVIDER,
        status: { in: ['paid', 'consumed'] },
      },
      data: {
        status: 'refunded',
        refundReason: reason,
        refundedAt: now,
        nextRefundAt: null,
        refundLeaseUntil: null,
        refundChannelState: null,
        refundAnomaly: null,
      },
    })
    if (updatedOrder.count !== 1) {
      const fresh = await tx.serviceOrder.findUnique({
        where: { id: order.id },
        select: { status: true },
      })
      return { status: fresh?.status === 'refunded' ? ('refunded' as const) : ('skipped' as const), writeOutside: false, restoredCount: 0 }
    }
    const restored = await tx.memberServiceCredit.updateMany({
      where: { consumedServiceOrderId: order.id, status: 'consumed' },
      data: { status: 'available', consumedAt: null, consumedServiceOrderId: null },
    })
    if (typeof audit.writeRequired === 'function') {
      await audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: VIRTUAL_PAY_CREDIT_RESTORED_AUDIT_ACTION,
        targetType: 'service_order',
        targetId: order.id,
        payload: { reason, serviceKey: order.serviceKey, restoredCount: restored.count },
      })
      return { status: 'refunded' as const, writeOutside: false, restoredCount: restored.count }
    }
    return { status: 'refunded' as const, writeOutside: true, restoredCount: restored.count }
  })

  if (outcome.writeOutside) {
    await audit.write({
      actorId: null,
      actorRole: 'system',
      action: VIRTUAL_PAY_CREDIT_RESTORED_AUDIT_ACTION,
      targetType: 'service_order',
      targetId: order.id,
      payload: { reason, serviceKey: order.serviceKey, restoredCount: outcome.restoredCount },
    })
  }
  return outcome.status
}
