/**
 * 退款域（C5-4 定义，W-B 接 wechat/alipay 真实渠道原路退回）。**canonical 退款入口**。
 *
 * 退款按订单域建模（不挂靠 PrintTask）；落 Refund 账本 + 状态机 paid → refunding → refunded。
 *
 * 硬约束（对齐用户定版 + compliance §8.4/§8.7）：
 * - `refundNo` 幂等键：同一 refundNo 重复请求返回既有退款记录，**绝不重复出款、绝不重复审计**
 *   （渠道侧同样以 refundNo 作 out_refund_no / out_request_no 幂等，双层防重复出款）。
 * - 只有 `paid` 单可退；unpaid/paying/closed/failed → 拒；refunded/partial_refunded → 拒（已退）。
 * - 退款执行渠道由 Order.paymentSource 决定：
 *   · `sandbox` → SandboxPaymentProvider.refund（假通道，无外部资金）；
 *   · `wechat` / `alipay`（W-B）→ 真实渠道原路退回；发起前必须定位到该单的 success
 *     PaymentAttempt（out_trade_no），缺失 fail-closed 拒绝；wechat 受理中（processing）
 *     保持 Refund pending + 订单 refunding，重复调用经 queryRefund 收敛，**绝不假报已退款**；
 *   · `offline` / `manual_confirmed` → **不调 provider**（人工/线下退款，系统只记录状态 + 审计）；
 *   · `free` / `voucher` → **不调 provider**（免费/权益单无资金），且**不恢复 BenefitGrant 额度**。
 * - 全额退款为主；`partial_refunded` 与部分退款动作仅预留，不接。
 * - 渠道请求异常（网络/渠道错误）按失败回滚 paid 可重试；若渠道实际已受理，重试同
 *   refundNo 由渠道幂等兜住；极端不一致由 W-C 对账核销（审计留痕，诚实标注）。
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { PAYMENT_PROVIDER_TOKEN, PaymentProviderRegistry } from './payment-provider.factory'
import type { PaymentProvider, RefundExecuteInput, RefundExecuteResult } from './payment-provider.types'

type OrderRecord = NonNullable<Awaited<ReturnType<PrismaService['order']['findUnique']>>>
type RefundRecord = NonNullable<Awaited<ReturnType<PrismaService['refund']['findUnique']>>>

/** 退款执行需调 provider 的资金通道（W-B 起含真实渠道）。 */
const PROVIDER_REFUND_CHANNELS = new Set(['sandbox', 'wechat', 'alipay'])
/** 全部合法退款渠道（= 合法 paymentSource 集合）。 */
const REFUNDABLE_SOURCES = new Set(['sandbox', 'wechat', 'alipay', 'offline', 'manual_confirmed', 'free', 'voucher'])
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
    // W-B：真实渠道的 pending 记录（wechat 受理中）重复请求时向渠道查证收敛——
    // 成功补完成、明确失败回滚 paid 可重试、仍受理中/不可判原样返回；绝不重复出款。
    const existing = await this.prisma.refund.findUnique({ where: { refundNo } })
    if (existing) {
      if (existing.status === 'pending' && existing.channel !== 'sandbox' && PROVIDER_REFUND_CHANNELS.has(existing.channel)) {
        return this.convergePendingRefund(existing, opts.operatorId)
      }
      return this.toView(existing, await this.requireOrder(orderId), true)
    }

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

    // ④ 阶段二：执行退款。sandbox/wechat/alipay 调 provider；offline/manual_confirmed/free/voucher 不调。
    let channelRefundNo: string | null = null
    if (PROVIDER_REFUND_CHANNELS.has(channel)) {
      const provider = this.requireProvider(channel)
      const providerInput: RefundExecuteInput = { orderId: order.id, orderNo: order.orderNo, refundNo, amountCents }
      if (channel !== 'sandbox') {
        // 真实渠道（W-B）：必须定位到该单的 success 支付尝试（out_trade_no）才可原路退回；
        // 缺失即 fail-closed（wechat/alipay 入账单必有 success attempt，缺失=数据异常，人工介入）。
        const srcAttempt = await this.prisma.paymentAttempt.findFirst({
          where: { orderId: order.id, channel, status: 'success' },
          orderBy: { createdAt: 'desc' },
        })
        if (!srcAttempt) {
          await this.rollbackRefundFailure(refund.id, orderId, null)
          throw new BadRequestException('REFUND_SOURCE_ATTEMPT_MISSING')
        }
        providerInput.orderAmountCents = order.amountCents
        providerInput.outTradeNo = srcAttempt.id
        providerInput.channelTxnNo = srcAttempt.channelTxnNo
      }

      let res: RefundExecuteResult
      try {
        res = await provider.refund(providerInput)
      } catch (e) {
        // 渠道异常按失败回滚（订单回 paid 可重试；渠道侧同 refundNo 幂等兜住重复出款）。
        // 渠道原始错误只进审计，不透传给调用方。
        await this.rollbackRefundFailure(refund.id, orderId, null)
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'refund.channel_error',
          targetType: 'order',
          targetId: orderId,
          payload: { refundNo, channel, errorCode: ((e as Error).message ?? 'UNKNOWN').slice(0, 160) },
        })
        throw new BadRequestException('REFUND_CHANNEL_FAILED')
      }
      channelRefundNo = res.channelRefundNo

      if (res.status === 'failed') {
        await this.rollbackRefundFailure(refund.id, orderId, channelRefundNo)
        throw new BadRequestException('REFUND_CHANNEL_FAILED')
      }
      if (res.status === 'processing') {
        // wechat 异步受理中：保持 Refund pending + 订单 refunding，绝不假报已退款；
        // 后续重复调用同 refundNo 经 ① 的 queryRefund 收敛路径补完成/回滚。
        if (channelRefundNo) {
          await this.prisma.refund.update({ where: { id: refund.id }, data: { channelRefundNo } })
        }
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'refund.processing',
          targetType: 'order',
          targetId: orderId,
          payload: { refundNo, channel, channelRefundNo, operatorId: opts.operatorId ?? null },
        })
        const pendingRefund = await this.prisma.refund.findUnique({ where: { id: refund.id } })
        return this.toView(pendingRefund ?? refund, await this.requireOrder(orderId), false)
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

  /** 退款失败/异常统一回滚：Refund 置 failed、订单 refunding→paid（可重试）。 */
  private async rollbackRefundFailure(refundId: string, orderId: string, channelRefundNo: string | null): Promise<void> {
    await this.prisma.refund.update({ where: { id: refundId }, data: { status: 'failed', channelRefundNo } })
    await this.prisma.order.updateMany({ where: { id: orderId, payStatus: 'refunding' }, data: { payStatus: 'paid' } })
  }

  /**
   * W-B：真实渠道 pending 退款收敛（重复调用同 refundNo 时触发）。
   * 向渠道 queryRefund 查证：success → 补完成（同阶段⑤语义 + 单次 refund.created 审计）；
   * failed → 回滚 paid 可重试；processing/unknown/查证异常 → 原样返回，不动状态、不重复出款。
   */
  private async convergePendingRefund(refund: RefundRecord, operatorId?: string): Promise<RefundResultView> {
    const order = await this.requireOrder(refund.orderId)
    const provider = this.registry.get(refund.channel)
    if (!provider?.queryRefund) return this.toView(refund, order, true) // 无查证能力：不假报，原样返回

    const srcAttempt = await this.prisma.paymentAttempt.findFirst({
      where: { orderId: refund.orderId, channel: refund.channel, status: 'success' },
      orderBy: { createdAt: 'desc' },
    })
    const q = await provider
      .queryRefund({ refundNo: refund.refundNo, outTradeNo: srcAttempt?.id ?? null })
      .catch(() => null) // 查证网络异常：保持现状，下次再收敛
    if (!q || q.status === 'unknown' || q.status === 'processing') {
      return this.toView(refund, order, true)
    }
    if (q.status === 'failed') {
      await this.rollbackRefundFailure(refund.id, refund.orderId, q.channelRefundNo)
      throw new BadRequestException('REFUND_CHANNEL_FAILED')
    }

    // success：补完成（与主流程阶段⑤同语义；CAS 幂等，重复收敛不重复副作用/审计）。
    const finalChannelRefundNo = q.channelRefundNo ?? refund.channelRefundNo
    const completedOrder = await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id, status: 'pending' },
        data: { status: 'success', channelRefundNo: finalChannelRefundNo },
      })
      await tx.order.updateMany({
        where: { id: refund.orderId, payStatus: 'refunding' },
        data: {
          payStatus: 'refunded',
          refundedAt: new Date(),
          refundReason: refund.reason,
          refundedAmountCents: refund.amountCents,
        },
      })
      const o = await tx.order.findUnique({ where: { id: refund.orderId } })
      if (!o) throw new NotFoundException('ORDER_NOT_FOUND')
      if (o.payStatus !== 'refunded') throw new BadRequestException('ORDER_INVALID_TRANSITION')
      return o
    })

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'refund.created',
      targetType: 'order',
      targetId: refund.orderId,
      payload: {
        refundNo: refund.refundNo,
        channel: refund.channel,
        amountCents: refund.amountCents,
        paymentSource: completedOrder.paymentSource,
        channelRefundNo: finalChannelRefundNo,
        operatorId: operatorId ?? null,
        benefitRestored: false,
        convergedFromProcessing: true, // 由受理中收敛完成（对账时区分同步/异步路径）
      },
    })

    const freshRefund = await this.prisma.refund.findUnique({ where: { id: refund.id } })
    return this.toView(freshRefund ?? refund, completedOrder, false)
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
