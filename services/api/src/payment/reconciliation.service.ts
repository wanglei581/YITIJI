/**
 * 本地对账服务（W-C part2a）。
 *
 * 定位：**本地账本一致性核对**（Order / PaymentAttempt / Refund / AuditLog 交叉验证）。
 * 这是「渠道日账单 diff 为零」DoD 的本地半边 —— 先保证本地各账本自洽，
 * 渠道对账单拉取与 diff 属 part2b（依赖 live 环境/商户账单接口，另做）。
 *
 * 只读、无副作用：不改任何账本，只产出汇总 + 差异清单供 Admin 核查。
 *
 * 核对维度（每条差异带 orderId/orderNo + 明确 code，便于人工定位）：
 * - 资金净额汇总：paid 单应收合计、已退款合计、净额（= 应收 − 退款）。
 * - PAID_WITHOUT_SUCCESS_ATTEMPT：线上通道（wechat/alipay/sandbox）paid 单缺 success PaymentAttempt。
 * - REFUND_AMOUNT_MISMATCH：Order.refundedAmountCents 与该单 success Refund 之和不一致。
 * - ORDER_REFUNDED_WITHOUT_REFUND_ROW：payStatus=refunded 但无 success Refund 记录。
 * - REFUND_SUCCESS_ORDER_NOT_REFUNDED：存在 success Refund 但订单未处于 refunded。
 * - STUCK_REFUNDING：订单停留 refunding（退款受理中/半态），超龄需人工跟进（W-B 自动收敛前的人工兜底）。
 * - LATE_PAID / RECONCILED：迟到入账 / 主动查单入账专项清单（非错误，运营需知晓复核）。
 */
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/** 线上资金通道（有 PaymentAttempt 台账的入账来源）。 */
const ONLINE_CHANNELS = new Set(['sandbox', 'wechat', 'alipay'])
/** refunding 停留超此时长（毫秒）视为需人工跟进（默认 30 分钟）。 */
const STUCK_REFUNDING_MS = 30 * 60 * 1000

export interface ReconciliationDiscrepancy {
  code: string
  orderId: string
  orderNo: string
  detail: Record<string, unknown>
}

export interface ReconciliationReport {
  /** 对账窗口（ISO 串）；不传则全量。 */
  window: { from: string | null; to: string | null }
  summary: {
    paidOrderCount: number
    grossPaidCents: number
    refundedOrderCount: number
    refundedCents: number
    netCents: number
    refundingCount: number
    lateePaidCount: number
    reconciledCount: number
  }
  discrepancies: ReconciliationDiscrepancy[]
  /** 迟到入账 / reconcile 入账专项（非错误，复核用）。 */
  attention: { latePaid: ReconciliationDiscrepancy[]; reconciled: ReconciliationDiscrepancy[] }
}

type OrderRow = NonNullable<Awaited<ReturnType<PrismaService['order']['findFirst']>>>

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async report(params: { from?: string; to?: string; nowMs: number }): Promise<ReconciliationReport> {
    const fromDate = params.from ? new Date(params.from) : null
    const toDate = params.to ? new Date(params.to) : null
    const createdAt =
      fromDate || toDate ? { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } : undefined

    // 只取涉及资金/退款态的订单（unpaid/paying/closed 无资金流，排除以聚焦对账）。
    const orders = await this.prisma.order.findMany({
      where: {
        ...(createdAt ? { createdAt } : {}),
        payStatus: { in: ['paid', 'refunding', 'partial_refunded', 'refunded'] },
      },
      orderBy: { createdAt: 'asc' },
    })
    const orderIds = orders.map((o) => o.id)

    const [attempts, refunds, auditRows] = await Promise.all([
      this.prisma.paymentAttempt.findMany({ where: { orderId: { in: orderIds }, status: 'success' } }),
      this.prisma.refund.findMany({ where: { orderId: { in: orderIds } } }),
      this.prisma.auditLog.findMany({
        where: { targetType: 'order', targetId: { in: orderIds }, action: { in: ['order.mark_paid_online', 'payment.reconciled'] } },
      }),
    ])

    const successAttemptByOrder = new Map<string, number>()
    for (const a of attempts) successAttemptByOrder.set(a.orderId, (successAttemptByOrder.get(a.orderId) ?? 0) + 1)

    const successRefundSumByOrder = new Map<string, number>()
    for (const r of refunds) {
      if (r.status === 'success') {
        successRefundSumByOrder.set(r.orderId, (successRefundSumByOrder.get(r.orderId) ?? 0) + r.amountCents)
      }
    }

    // 审计标记：迟到入账（payload.late=true）/ reconcile 入账（action=payment.reconciled）。
    const lateOrderIds = new Set<string>()
    const reconciledOrderIds = new Set<string>()
    for (const row of auditRows) {
      if (!row.targetId) continue
      if (row.action === 'payment.reconciled') reconciledOrderIds.add(row.targetId)
      if (row.action === 'order.mark_paid_online') {
        try {
          const p = JSON.parse(row.payloadJson ?? '{}') as { late?: boolean }
          if (p.late === true) lateOrderIds.add(row.targetId)
        } catch {
          /* 忽略不可解析审计 */
        }
      }
    }

    const discrepancies: ReconciliationDiscrepancy[] = []
    const latePaid: ReconciliationDiscrepancy[] = []
    const reconciled: ReconciliationDiscrepancy[] = []
    let grossPaidCents = 0
    let paidOrderCount = 0
    let refundedCents = 0
    let refundedOrderCount = 0
    let refundingCount = 0

    const push = (list: ReconciliationDiscrepancy[], code: string, o: OrderRow, detail: Record<string, unknown>): void => {
      list.push({ code, orderId: o.id, orderNo: o.orderNo, detail })
    }

    for (const o of orders) {
      const netCaptured = Math.max(0, o.amountCents - o.discountCents) // 实收资金（抵扣不入资金流）
      const refundSum = successRefundSumByOrder.get(o.id) ?? 0

      if (o.payStatus === 'paid') {
        paidOrderCount += 1
        grossPaidCents += netCaptured
        // 线上通道 paid 单必须有 success 支付尝试（对账取原单/退款定位依据）。
        if (o.paymentSource && ONLINE_CHANNELS.has(o.paymentSource) && (successAttemptByOrder.get(o.id) ?? 0) === 0) {
          push(discrepancies, 'PAID_WITHOUT_SUCCESS_ATTEMPT', o, { paymentSource: o.paymentSource, amountCents: netCaptured })
        }
        // paid 单不应有 success 退款记录（退款成功必转 refunded）。
        if (refundSum > 0) {
          push(discrepancies, 'REFUND_SUCCESS_ORDER_NOT_REFUNDED', o, { refundSum, payStatus: o.payStatus })
        }
      } else if (o.payStatus === 'refunded') {
        refundedOrderCount += 1
        refundedCents += o.refundedAmountCents
        // 退款额账实一致：Order.refundedAmountCents == Σ success Refund。
        if (refundSum !== o.refundedAmountCents) {
          push(discrepancies, 'REFUND_AMOUNT_MISMATCH', o, { orderRefundedAmountCents: o.refundedAmountCents, successRefundSum: refundSum })
        }
        // refunded 必须有 success Refund 记录（除历史线下整单退款 refundedAmountCents=0 的旧单）。
        if (refundSum === 0 && o.refundedAmountCents > 0) {
          push(discrepancies, 'ORDER_REFUNDED_WITHOUT_REFUND_ROW', o, { refundedAmountCents: o.refundedAmountCents })
        }
      } else if (o.payStatus === 'refunding' || o.payStatus === 'partial_refunded') {
        refundingCount += 1
        const ageMs = params.nowMs - o.updatedAt.getTime()
        if (ageMs > STUCK_REFUNDING_MS) {
          push(discrepancies, 'STUCK_REFUNDING', o, { payStatus: o.payStatus, ageMinutes: Math.floor(ageMs / 60000) })
        }
      }

      if (lateOrderIds.has(o.id)) push(latePaid, 'LATE_PAID', o, { paymentSource: o.paymentSource, amountCents: netCaptured })
      if (reconciledOrderIds.has(o.id)) push(reconciled, 'RECONCILED', o, { paymentSource: o.paymentSource, amountCents: netCaptured })
    }

    return {
      window: { from: fromDate?.toISOString() ?? null, to: toDate?.toISOString() ?? null },
      summary: {
        paidOrderCount,
        grossPaidCents,
        refundedOrderCount,
        refundedCents,
        netCents: grossPaidCents - refundedCents,
        refundingCount,
        lateePaidCount: latePaid.length,
        reconciledCount: reconciled.length,
      },
      discrepancies,
      attention: { latePaid, reconciled },
    }
  }
}
