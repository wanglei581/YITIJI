/**
 * C5-4 退款域（沙箱，无 live 网关，无真实资金）。**canonical 退款入口**。
 *
 * 退款按订单域建模（不挂靠 PrintTask）；落 Refund 账本 + 状态机 paid → refunding → refunded。
 *
 * 硬约束（对齐用户定版 + compliance §8.4/§8.7）：
 * - `refundNo` 幂等键：同一 refundNo 重复请求返回既有退款记录，**绝不重复出款、绝不重复审计**。
 * - 只有 `paid` 单可退；unpaid/paying/closed/failed → 拒；refunding/refunded/partial_refunded → 拒（已退/退款中）。
 * - 退款执行渠道由 Order.paymentSource 决定：
 *   · `sandbox` → 调 SandboxPaymentProvider.refund（假通道，无外部资金）；
 *   · `offline` / `manual_confirmed` → **不调 provider**（人工/线下退款，系统只记录状态 + 审计）；
 *   · `free` / `voucher` → **不调 provider**（免费/权益单无资金），且**不恢复 BenefitGrant 额度**（本波只记状态 + 审计）。
 * - 全额退款为主；`partial_refunded` 与部分退款动作本波仅预留，不接。
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { PAYMENT_PROVIDER_TOKEN, PaymentProviderRegistry } from './payment-provider.factory'
import type { PaymentProvider } from './payment-provider.types'

type OrderRecord = NonNullable<Awaited<ReturnType<PrismaService['order']['findUnique']>>>
type RefundRecord = NonNullable<Awaited<ReturnType<PrismaService['refund']['findUnique']>>>

/** 退款执行需调 provider 的资金通道（本波只有 sandbox）。 */
const PROVIDER_REFUND_CHANNELS = new Set(['sandbox'])
/** 全部合法退款渠道（= 合法 paymentSource 集合）。 */
const REFUNDABLE_SOURCES = new Set(['sandbox', 'offline', 'manual_confirmed', 'free', 'voucher'])
/** 已退款/退款中态：拒绝重复退款（不同 refundNo 也拒，靠订单态兜底）。 */
const ALREADY_REFUND_STATES = new Set(['refunding', 'refunded', 'partial_refunded'])

export interface RefundResultView {
  refund: {
    refundNo: string
    amountCents: number
    status: string
    channel: string
    channelRefundNo: string | null
    reason: string | null
    createdAt: string
  }
  order: { orderNo: string; payStatus: string; refundedAmountCents: number; refundedAt: string | null }
  /** 幂等命中（重复 refundNo）时为 true —— 未重复出款/审计。 */
  idempotent: boolean
}

/** 判断是否为 refundNo 唯一约束冲突（Prisma P2002）。 */
function isRefundNoConflict(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } }
  if (err?.code !== 'P2002') return false
  const target = err.meta?.target
  if (typeof target === 'string') return target.includes('refundNo')
  if (Array.isArray(target)) return target.some((t) => String(t).includes('refundNo'))
  return true
}

@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly registry: PaymentProviderRegistry,
  ) {}

  /**
   * 全额退款。refundNo 缺省时按订单派生 `RFD-<orderNo>`（一单一退，天然幂等）。
   * 显式传不同 refundNo 时，订单态 CAS 仍防重复退款（已退 → ORDER_ALREADY_REFUNDED）。
   */
  async refund(
    orderId: string,
    opts: { refundNo?: string; reason: string; operatorId?: string },
  ): Promise<RefundResultView> {
    const reason = opts.reason?.trim()
    if (!reason) throw new BadRequestException('REFUND_REASON_REQUIRED')

    let order = await this.requireOrder(orderId)
    const refundNo = opts.refundNo?.trim() || `RFD-${order.orderNo}`

    // ① 幂等：同 refundNo 已存在 → 原样返回，绝不重复出款/审计。
    const existing = await this.prisma.refund.findUnique({ where: { refundNo } })
    if (existing) return this.toView(existing, await this.requireOrder(orderId), true)

    // ② 状态门：只有 paid 可退。
    if (order.payStatus !== 'paid') {
      if (ALREADY_REFUND_STATES.has(order.payStatus)) throw new BadRequestException('ORDER_ALREADY_REFUNDED')
      throw new BadRequestException('ORDER_NOT_REFUNDABLE') // unpaid / paying / closed / failed
    }

    const paymentSource = order.paymentSource ?? ''
    if (!REFUNDABLE_SOURCES.has(paymentSource)) throw new BadRequestException('REFUND_CHANNEL_UNSUPPORTED')
    const channel = paymentSource
    // 退款额 = 实付资金 = 应付 − 抵扣（免费/全额券单为 0，不动资金）。
    const amountCents = Math.max(0, order.amountCents - order.discountCents)

    // ③ 阶段一：CAS paid→refunding + 建 Refund(pending)。refundNo 唯一兜底并发幂等。
    let refund: RefundRecord
    try {
      refund = await this.prisma.$transaction(async (tx) => {
        const cas = await tx.order.updateMany({
          where: { id: orderId, payStatus: 'paid' },
          data: { payStatus: 'refunding' },
        })
        if (cas.count === 0) {
          const fresh = await tx.order.findUnique({ where: { id: orderId } })
          if (fresh && ALREADY_REFUND_STATES.has(fresh.payStatus)) throw new BadRequestException('ORDER_ALREADY_REFUNDED')
          throw new BadRequestException('ORDER_INVALID_TRANSITION')
        }
        return tx.refund.create({
          data: { orderId, refundNo, amountCents, status: 'pending', reason, channel, operatorId: opts.operatorId ?? null },
        })
      })
    } catch (e) {
      if (isRefundNoConflict(e)) {
        const ex = await this.prisma.refund.findUnique({ where: { refundNo } })
        if (ex) return this.toView(ex, await this.requireOrder(orderId), true)
      }
      throw e
    }

    // ④ 阶段二：执行退款。sandbox 调 provider；offline/manual_confirmed/free/voucher 不调 provider。
    let channelRefundNo: string | null = null
    if (PROVIDER_REFUND_CHANNELS.has(channel)) {
      const provider = this.requireProvider(channel)
      const res = await provider.refund({ orderId: order.id, orderNo: order.orderNo, refundNo, amountCents })
      channelRefundNo = res.channelRefundNo
      if (res.status !== 'success') {
        await this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'failed', channelRefundNo } })
        // 退款失败：订单回 paid（可重试），审计留痕。
        await this.prisma.order.updateMany({ where: { id: orderId, payStatus: 'refunding' }, data: { payStatus: 'paid' } })
        throw new BadRequestException('REFUND_CHANNEL_FAILED')
      }
    }

    // ⑤ 阶段三：CAS refunding→refunded + 回填 Refund success + refundedAmountCents。
    order = await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refund.id }, data: { status: 'success', channelRefundNo } })
      const cas = await tx.order.updateMany({
        where: { id: orderId, payStatus: 'refunding' },
        data: { payStatus: 'refunded', refundedAt: new Date(), refundReason: reason, refundedAmountCents: amountCents },
      })
      if (cas.count === 0) throw new BadRequestException('ORDER_INVALID_TRANSITION')
      const o = await tx.order.findUnique({ where: { id: orderId } })
      if (!o) throw new NotFoundException('ORDER_NOT_FOUND')
      return o
    })

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'refund.created',
      targetType: 'order',
      targetId: orderId,
      // benefitRestored=false：免费/权益单退款本波只记状态，绝不恢复 BenefitGrant 额度。
      payload: { refundNo, channel, amountCents, paymentSource, channelRefundNo, operatorId: opts.operatorId ?? null, benefitRestored: false },
    })

    const finalRefund = await this.prisma.refund.findUnique({ where: { id: refund.id } })
    return this.toView(finalRefund ?? refund, order, false)
  }

  private requireProvider(channel: string): PaymentProvider {
    const provider = this.registry.get(channel)
    if (!provider) throw new BadRequestException('ONLINE_PAYMENT_DISABLED')
    return provider
  }

  private async requireOrder(orderId: string): Promise<OrderRecord> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
    return order
  }

  private toView(refund: RefundRecord, order: OrderRecord, idempotent: boolean): RefundResultView {
    return {
      refund: {
        refundNo: refund.refundNo,
        amountCents: refund.amountCents,
        status: refund.status,
        channel: refund.channel,
        channelRefundNo: refund.channelRefundNo,
        reason: refund.reason,
        createdAt: refund.createdAt.toISOString(),
      },
      order: {
        orderNo: order.orderNo,
        payStatus: order.payStatus,
        refundedAmountCents: order.refundedAmountCents,
        refundedAt: order.refundedAt?.toISOString() ?? null,
      },
      idempotent,
    }
  }
}
