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
  settledAt?: Date | null
  reportState?: string | null
}

export interface RestoreMiniappCreditOptions {
  /**
   * 模拟面试已开场（settledAt 非空）后报告失败/过期/离场退回：
   * 仅当 consumed 单的 reportState 精确匹配时才原子退回权益，与 commitPaidReportAtomic 互斥。
   */
  requireConsumedReportState?: 'retry' | null
}

/**
 * 失败/离场/关单/改免费时，把已关联到该一体机服务单的小程序权益原子退回 available。
 * 绝不调微信 Native 退款接口；重复调用幂等；
 * 常规路径要求 settledAt === null；模拟面试报告失败路径（显式传入 requireConsumedReportState）
 * 仅允许 serviceKey='mock_interview' 且 status='consumed' 且 reportState 精确匹配的单原子退回，
 * reportState='done' 或已完成非面试单严禁退回。
 */
export async function restoreMiniappCreditForServiceOrder(
  db: PrismaService,
  audit: AuditService,
  order: MiniappCreditServiceOrderRow,
  reason: string,
  opts?: RestoreMiniappCreditOptions,
): Promise<'refunded' | 'skipped'> {
  const reportMode = opts?.requireConsumedReportState !== undefined
  if (order.provider !== MINIAPP_CREDIT_PROVIDER) return 'skipped'
  if (order.status === 'refunded') return 'refunded'
  if (order.status === 'consumed' && order.reportState === 'done') return 'skipped'
  if (reportMode) {
    if (order.serviceKey !== 'mock_interview' || order.status !== 'consumed' || !order.settledAt) {
      return 'skipped'
    }
    if (order.reportState !== opts.requireConsumedReportState) return 'skipped'
  } else {
    if (order.settledAt) return 'skipped'
    if (order.status !== 'paid' && order.status !== 'consumed') return 'skipped'
  }

  const now = new Date()
  const orderWhere = reportMode
    ? {
        id: order.id,
        provider: MINIAPP_CREDIT_PROVIDER,
        serviceKey: 'mock_interview',
        status: 'consumed',
        settledAt: { not: null },
        reportState: opts.requireConsumedReportState,
      }
    : {
        id: order.id,
        provider: MINIAPP_CREDIT_PROVIDER,
        status: { in: ['paid', 'consumed'] },
        settledAt: null,
        OR: [{ reportState: null }, { reportState: { not: 'done' } }],
      }
  const outcome = await db.$transaction(async (tx) => {
    const updatedOrder = await tx.serviceOrder.updateMany({
      where: orderWhere,
      data: {
        status: 'refunded',
        refundReason: reason,
        refundedAt: now,
        retryUntil: null,
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
