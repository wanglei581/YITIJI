/**
 * C5-2 线上支付业务层（沙箱通道，无 live 网关）。
 *
 * 职责：出码（建 PaymentAttempt）、回调处理（验签 → 防重放 → 全字段匹配 → 金额一致 → 幂等入账）、
 * 支付状态查询（含惰性过期/关单）。渠道协议细节在 PaymentProvider；订单状态转移在 OrderStatusService。
 *
 * 安全底线（CLAUDE.md §12 口径）：
 * - 回调必须验签 + 时间窗 + nonce 防重放 + 金额一致性；处理幂等（同一渠道流水号只入账一次）。
 * - 回调只能把「已存在的 PaymentAttempt」打成 success —— attemptId/prepayId/orderId/channel/amountCents
 *   全字段匹配，缺一即拒；不存在的尝试/任意 closed 订单绝不可能被伪造回调打成 paid。
 * - paymentSource=sandbox 只经 OrderStatusService.markPaidOnline 写入；线下三路径不经过本服务。
 * - 支付状态只改支付域（Order.payStatus / PaymentAttempt），绝不改 PrintTask.status。
 * - 出码/轮询必须携带打印建单时服务端签发的短期 payment session token；orderId 不能单独授权。
 */
import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { ReplayGuard } from '../sync/replay-guard'
import { OrderStatusService, pickupCodeVisibleFor } from './order-status.service'
import { verifyPaymentSessionToken } from './payment-session-token'
import { PAYMENT_PROVIDER_TOKEN } from './payment-provider.factory'
import { buildPaymentCallbackPath, type PaymentCallbackEvent, type PaymentProvider } from './payment-provider.types'
import { SandboxPaymentProvider } from './providers/sandbox-payment.provider'
import type { PaymentAttemptStatus, PaymentChannel } from './payment.types'

type OrderRecord = NonNullable<Awaited<ReturnType<PrismaService['order']['findUnique']>>>
type AttemptRecord = NonNullable<Awaited<ReturnType<PrismaService['paymentAttempt']['findUnique']>>>

/** 动态码/支付尝试有效期（秒）。 */
const DEFAULT_QR_TTL_SECONDS = 300
/** 订单线上支付超时关单时限（秒），自首次出码起算。 */
const DEFAULT_ORDER_TTL_SECONDS = 900
/** 用户可见的失败安全文案 —— 渠道原始错误只进审计，绝不透传。 */
const SAFE_FAIL_TEXT = '支付未完成，请重新发起支付'

/** 验签/时间窗类失败 → 401；其余业务校验失败 → 400。 */
const UNAUTHORIZED_CALLBACK_CODES = new Set([
  'CALLBACK_HEADER_MISSING',
  'CALLBACK_TIMESTAMP_INVALID',
  'CALLBACK_TIMESTAMP_EXPIRED',
  'CALLBACK_NONCE_INVALID',
  'CALLBACK_SIGNATURE_INVALID',
])

function ttlSecondsFromEnv(key: string, fallback: number): number {
  const raw = Number(process.env[key])
  if (!Number.isFinite(raw) || raw < 30 || raw > 24 * 3600) return fallback
  return Math.floor(raw)
}

export interface PayAttemptView {
  attemptId: string
  orderId: string
  orderNo: string
  channel: string
  amountCents: number
  status: PaymentAttemptStatus
  qrCodeContent: string | null
  /** 本次动态码有效期（ISO 串）。 */
  expiresAt: string | null
  orderPayStatus: string
  /** 订单超时关单时间（ISO 串）。 */
  orderExpiresAt: string | null
}

export interface PayStatusView {
  orderId: string
  orderNo: string
  payStatus: string
  paymentSource: string | null
  payChannel: string | null
  amountCents: number
  paidAt: string | null
  /** 仅 paid 且按 pickupCodeVisibleFor 可见时返回。 */
  pickupCode: string | null
  attempt: {
    attemptId: string
    status: PaymentAttemptStatus
    qrCodeContent: string | null
    expiresAt: string | null
  } | null
}

@Injectable()
export class OnlinePaymentService {
  /** 回调 nonce 防重放（5min 窗口，与 W3 Webhook 同一实现）。 */
  private readonly replay = new ReplayGuard()
  private readonly qrTtlSeconds = ttlSecondsFromEnv('PAYMENT_QR_TTL_SECONDS', DEFAULT_QR_TTL_SECONDS)
  private readonly orderTtlSeconds = ttlSecondsFromEnv('PAYMENT_ORDER_TTL_SECONDS', DEFAULT_ORDER_TTL_SECONDS)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orderStatus: OrderStatusService,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly provider: PaymentProvider | null,
  ) {}

  private requireProvider(): PaymentProvider {
    // 未配置线上支付时明确拒绝，绝不伪装可支付。
    if (!this.provider) throw new BadRequestException('ONLINE_PAYMENT_DISABLED')
    return this.provider
  }

  /** 出码：为付费订单创建（或复用未过期的）支付尝试，返回屏上动态码内容。 */
  async createPayAttempt(orderId: string, paymentSessionToken: string | undefined): Promise<PayAttemptView> {
    this.requirePaymentSessionHeader(paymentSessionToken)
    const provider = this.requireProvider()

    let order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
    this.requirePaymentSession(order, paymentSessionToken)
    // 免费单不出码：0 元单走 markPaid(free) 路径，绝不为其生成支付码。
    if (order.amountCents <= 0) throw new BadRequestException('PAY_NOT_REQUIRED')

    order = await this.applyLazyExpiry(order)
    if (order.payStatus === 'paid') throw new BadRequestException('ORDER_ALREADY_PAID')
    if (order.payStatus === 'closed') throw new BadRequestException('ORDER_CLOSED')
    if (order.payStatus !== 'unpaid' && order.payStatus !== 'paying') {
      throw new BadRequestException('ORDER_INVALID_TRANSITION') // refunded / failed
    }

    // 幂等出码：已有未过期的 pending 尝试直接复用，不重复建。
    const now = Date.now()
    const existing = await this.prisma.paymentAttempt.findFirst({
      where: { orderId: order.id, channel: provider.channel, status: 'pending', expiresAt: { gt: new Date(now) } },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return this.toAttemptView(existing, order)

    // 先建行（status=created，占位）再向渠道出码，最后回填 pending + 码内容；
    // 渠道出码失败时行保持 created 并随 expiresAt 惰性过期，不留下可支付的半成品。
    const attemptExpiresAt = new Date(now + this.qrTtlSeconds * 1000)
    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        channel: provider.channel,
        amountCents: order.amountCents, // 金额快照自服务端订单，绝不信任前端
        status: 'created',
        expiresAt: attemptExpiresAt,
      },
    })
    const qr = await provider.createQrPayment({
      orderId: order.id,
      orderNo: order.orderNo,
      attemptId: attempt.id,
      amountCents: order.amountCents,
    })
    const pendingAttempt = await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'pending', prepayId: qr.prepayId, qrCodeContent: qr.qrCodeContent },
    })

    // 订单进入 paying；首次出码时写入超时关单时间（已在 paying 则保持原 expiresAt）。
    await this.prisma.order.updateMany({
      where: { id: order.id, payStatus: 'unpaid' },
      data: { payStatus: 'paying', expiresAt: order.expiresAt ?? new Date(now + this.orderTtlSeconds * 1000) },
    })
    const freshOrder = await this.requireOrder(order.id)

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'payment.attempt_created',
      targetType: 'payment_attempt',
      targetId: attempt.id,
      payload: { orderId: order.id, orderNo: order.orderNo, channel: provider.channel, amountCents: order.amountCents },
    })

    return this.toAttemptView(pendingAttempt, freshOrder)
  }

  /** 支付状态查询（Kiosk 轮询用），含惰性过期/关单。 */
  async getPayStatus(orderId: string, paymentSessionToken: string | undefined): Promise<PayStatusView> {
    this.requirePaymentSessionHeader(paymentSessionToken)
    let order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
    this.requirePaymentSession(order, paymentSessionToken)
    order = await this.applyLazyExpiry(order)

    const latest = await this.prisma.paymentAttempt.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
    })
    const visible = pickupCodeVisibleFor({
      payStatus: order.payStatus,
      taskStatus: order.taskStatus,
      refundedAt: order.refundedAt,
    })
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      payStatus: order.payStatus,
      paymentSource: order.paymentSource,
      payChannel: order.payChannel,
      amountCents: order.amountCents,
      paidAt: order.paidAt?.toISOString() ?? null,
      pickupCode: visible ? order.pickupCode : null,
      attempt: latest
        ? {
            attemptId: latest.id,
            status: latest.status as PaymentAttemptStatus,
            qrCodeContent: latest.qrCodeContent,
            expiresAt: latest.expiresAt?.toISOString() ?? null,
          }
        : null,
    }
  }

  /**
   * 渠道回调入口：验签 → nonce 防重放 → 全字段匹配 → 金额一致 → 幂等入账/失败落库。
   * 任何一步失败都拒绝并保持订单不动；重复合法回调幂等返回，不重复副作用。
   */
  async processCallback(
    channel: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: true; idempotent?: boolean }> {
    const provider = this.requireProvider()
    if (channel !== provider.channel) throw new BadRequestException('CALLBACK_CHANNEL_UNSUPPORTED')
    if (!rawBody || rawBody.length === 0) throw new BadRequestException('CALLBACK_RAW_BODY_MISSING')

    const path = buildPaymentCallbackPath(channel)
    const verified = await provider.verifyAndParseCallback({ channel, path, rawBody, headers })
    if (!verified.ok) {
      if (UNAUTHORIZED_CALLBACK_CODES.has(verified.code)) throw new UnauthorizedException(verified.code)
      throw new BadRequestException(verified.code)
    }
    const event = verified.event

    // nonce 防重放：验签通过后才登记（未签名垃圾请求不得污染 nonce 池）。
    if (!this.replay.register(event.nonce, `payment:${channel}`, event.timestampMs)) {
      throw new UnauthorizedException('CALLBACK_REPLAY')
    }

    // 全字段匹配（硬约束）：回调只能命中「已存在的 PaymentAttempt」，
    // attemptId / channel / prepayId / orderId / amountCents 缺一不可。
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: event.attemptId },
      include: { order: true },
    })
    if (!attempt) throw new BadRequestException('CALLBACK_ATTEMPT_NOT_FOUND')
    if (attempt.channel !== channel) throw new BadRequestException('CALLBACK_FIELD_MISMATCH')
    if (!attempt.prepayId || attempt.prepayId !== event.prepayId) throw new BadRequestException('CALLBACK_FIELD_MISMATCH')
    if (attempt.orderId !== event.orderId) throw new BadRequestException('CALLBACK_FIELD_MISMATCH')
    // 金额一致性双重比对：回调金额 = 尝试快照 = 订单应付，防篡改。
    if (attempt.amountCents !== event.amountCents) throw new BadRequestException('CALLBACK_AMOUNT_MISMATCH')
    const order = attempt.order
    if (order.amountCents !== event.amountCents) throw new BadRequestException('CALLBACK_AMOUNT_MISMATCH')

    if (event.result === 'success') return this.handleSuccess(channel as PaymentChannel, attempt, order, event)
    return this.handleFailure(channel, attempt, order, event)
  }

  /**
   * 沙箱模拟支付（仅开发/联调）：按库内 attempt 真实数据构造签名合法的回调，
   * 走与真实回调完全相同的验签/匹配/入账路径。生产环境不存在此能力。
   */
  async simulateSandboxCallback(input: { attemptId: string; result: 'success' | 'failed' }): Promise<{ ok: true; idempotent?: boolean }> {
    if (process.env['NODE_ENV'] === 'production') throw new NotFoundException()
    const provider = this.requireProvider()
    if (!(provider instanceof SandboxPaymentProvider)) throw new BadRequestException('SANDBOX_ONLY')

    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { id: input.attemptId } })
    if (!attempt) throw new NotFoundException('PAYMENT_ATTEMPT_NOT_FOUND')
    if (!attempt.prepayId) throw new BadRequestException('PAYMENT_ATTEMPT_NOT_READY')

    const path = buildPaymentCallbackPath(provider.channel)
    const callback = provider.buildSimulatedCallback({
      path,
      attemptId: attempt.id,
      prepayId: attempt.prepayId,
      orderId: attempt.orderId,
      amountCents: attempt.amountCents,
      result: input.result,
      channelTxnNo: attempt.channelTxnNo ?? `sbx_txn_${randomBytes(8).toString('hex')}`,
      failReason: input.result === 'failed' ? 'sandbox_simulated_failure' : undefined,
    })
    return this.processCallback(provider.channel, callback.rawBody, callback.headers)
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private async handleSuccess(
    channel: PaymentChannel,
    attempt: AttemptRecord,
    order: OrderRecord,
    event: PaymentCallbackEvent,
  ): Promise<{ ok: true; idempotent?: boolean }> {
    const channelTxnNo = event.channelTxnNo as string // provider 已保证 success 必带
    // 幂等：同一尝试 + 同一渠道流水号的重复成功回调，不重复副作用。
    if (attempt.status === 'success') {
      if (attempt.channelTxnNo === channelTxnNo) return { ok: true, idempotent: true }
      throw new BadRequestException('CALLBACK_TXN_CONFLICT')
    }

    // 迟到回调判定：订单已关单 / 尝试已过期 / 订单超时时刻已过 —— 仍入账（钱已付，诚实入账优先），
    // 审计 payload 带 late 标记；C5-4 前不自动退款，对账凭此追踪。
    const now = Date.now()
    const late =
      order.payStatus === 'closed' ||
      attempt.status === 'expired' ||
      Boolean(order.expiresAt && order.expiresAt.getTime() < now)

    // 先订单入账（CAS 幂等，唯一允许写 paymentSource=sandbox 的路径），再回填尝试；
    // 若回填前崩溃，渠道重试回调会再次幂等走到这里补齐。
    await this.orderStatus.markPaidOnline(order.id, { channel, attemptId: attempt.id, channelTxnNo, late })

    let res: { count: number }
    try {
      res = await this.prisma.paymentAttempt.updateMany({
        where: { id: attempt.id, status: { in: ['created', 'pending', 'expired'] } },
        data: { status: 'success', channelTxnNo, failReason: null },
      })
    } catch (e) {
      // (channel, channelTxnNo) 唯一索引兜底：同一渠道流水号绝不入账两条。
      if ((e as { code?: string })?.code === 'P2002') throw new BadRequestException('CALLBACK_TXN_ALREADY_USED')
      throw e
    }
    if (res.count === 0) {
      const fresh = await this.prisma.paymentAttempt.findUnique({ where: { id: attempt.id } })
      if (fresh?.status === 'success' && fresh.channelTxnNo === channelTxnNo) return { ok: true, idempotent: true }
      throw new BadRequestException('CALLBACK_STATE_CONFLICT')
    }
    return { ok: true }
  }

  private async handleFailure(
    channel: string,
    attempt: AttemptRecord,
    order: OrderRecord,
    event: PaymentCallbackEvent,
  ): Promise<{ ok: true; idempotent?: boolean }> {
    // 成功后到达的失败回调绝不回退已入账状态。
    if (attempt.status === 'success') throw new BadRequestException('CALLBACK_STATE_CONFLICT')
    if (attempt.status === 'failed') return { ok: true, idempotent: true }

    await this.prisma.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { in: ['created', 'pending', 'expired'] } },
      // 用户只见安全文案；渠道原始错误只进审计 payload。
      data: { status: 'failed', failReason: SAFE_FAIL_TEXT },
    })

    // 无其它可用尝试时订单回 unpaid，允许重新出码（订单超时关单仍由 expiresAt 惰性判定）。
    const now = new Date()
    const stillPending = await this.prisma.paymentAttempt.count({
      where: { orderId: order.id, status: 'pending', expiresAt: { gt: now }, id: { not: attempt.id } },
    })
    if (stillPending === 0) {
      await this.prisma.order.updateMany({ where: { id: order.id, payStatus: 'paying' }, data: { payStatus: 'unpaid' } })
    }

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'payment.attempt_failed',
      targetType: 'payment_attempt',
      targetId: attempt.id,
      payload: { orderId: order.id, channel, reasonRaw: event.failReasonRaw ?? null },
    })
    return { ok: true }
  }

  /**
   * 惰性过期（不引入后台任务）：
   * 1) 过期的 created/pending 尝试 → expired；
   * 2) 订单超时（expiresAt 已过且仍 unpaid/paying）→ closed；
   * 3) paying 但已无未过期 pending 尝试 → 回 unpaid（可重新出码）。
   */
  private async applyLazyExpiry(order: OrderRecord): Promise<OrderRecord> {
    const now = new Date()
    await this.prisma.paymentAttempt.updateMany({
      where: { orderId: order.id, status: { in: ['created', 'pending'] }, expiresAt: { lt: now } },
      data: { status: 'expired' },
    })

    if ((order.payStatus === 'unpaid' || order.payStatus === 'paying') && order.expiresAt && order.expiresAt < now) {
      await this.prisma.order.updateMany({
        where: { id: order.id, payStatus: { in: ['unpaid', 'paying'] } },
        data: { payStatus: 'closed' },
      })
      return this.requireOrder(order.id)
    }

    if (order.payStatus === 'paying') {
      const alive = await this.prisma.paymentAttempt.count({
        where: { orderId: order.id, status: 'pending', expiresAt: { gt: now } },
      })
      if (alive === 0) {
        await this.prisma.order.updateMany({ where: { id: order.id, payStatus: 'paying' }, data: { payStatus: 'unpaid' } })
        return this.requireOrder(order.id)
      }
    }
    return order
  }

  private async requireOrder(orderId: string): Promise<OrderRecord> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
    return order
  }

  private requirePaymentSession(order: OrderRecord, paymentSessionToken: string | undefined): void {
    const result = verifyPaymentSessionToken(paymentSessionToken, {
      orderId:     order.id,
      orderNo:     order.orderNo,
      terminalId:  order.terminalId,
      amountCents: order.amountCents,
      printTaskId: order.printTaskId,
    })
    if (!result.ok) throw new UnauthorizedException(result.code)
  }

  private requirePaymentSessionHeader(paymentSessionToken: string | undefined): void {
    if (!paymentSessionToken?.trim()) throw new UnauthorizedException('PAYMENT_SESSION_REQUIRED')
  }

  private toAttemptView(attempt: AttemptRecord, order: OrderRecord): PayAttemptView {
    return {
      attemptId: attempt.id,
      orderId: order.id,
      orderNo: order.orderNo,
      channel: attempt.channel,
      amountCents: attempt.amountCents,
      status: attempt.status as PaymentAttemptStatus,
      qrCodeContent: attempt.qrCodeContent,
      expiresAt: attempt.expiresAt?.toISOString() ?? null,
      orderPayStatus: order.payStatus,
      orderExpiresAt: order.expiresAt?.toISOString() ?? null,
    }
  }
}
