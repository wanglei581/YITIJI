/**
 * 线上支付业务层（C5-2 沙箱底座；C5-6 扩 wechat / alipay 真实渠道 + 主动查单兜底）。
 *
 * 职责：出码（建 PaymentAttempt，多通道选择）、回调处理（验签 → 防重放 → 全字段匹配 →
 * 金额一致 → 幂等入账）、支付状态查询（含惰性过期/关单）、reconcile 主动查单兜底。
 * 渠道协议细节在 PaymentProvider；订单状态转移在 OrderStatusService。
 *
 * 安全底线（CLAUDE.md §12 口径）：
 * - 回调必须验签 + 时间窗 + nonce 防重放 + 金额一致性；处理幂等（同一渠道流水号只入账一次）。
 * - 回调只能把「已存在的 PaymentAttempt」打成 success —— attemptId/prepayId/orderId/channel/amountCents
 *   全字段匹配，缺一即拒；不存在的尝试/任意 closed 订单绝不可能被伪造回调打成 paid。
 * - paymentSource ∈ {sandbox, wechat, alipay} 只经 OrderStatusService.markPaidOnline 写入
 *   （回调成功 / reconcile 渠道账本确认两条路径，均复用同一幂等入账）；线下三路径不经过本服务。
 * - 支付状态只改支付域（Order.payStatus / PaymentAttempt），绝不改 PrintTask.status。
 * - 出码/轮询/查单必须携带打印建单时服务端签发的短期 payment session token；orderId 不能单独授权。
 */
import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { ReplayGuard } from '../sync/replay-guard'
import { OrderStatusService, pickupCodeVisibleFor } from './order-status.service'
import { verifyPaymentSessionToken } from './payment-session-token'
import { PAYMENT_PROVIDER_TOKEN, PaymentProviderRegistry } from './payment-provider.factory'
import {
  buildPaymentCallbackPath,
  type CallbackAck,
  type PaymentCallbackEvent,
  type PaymentProvider,
} from './payment-provider.types'
import { SandboxPaymentProvider } from './providers/sandbox-payment.provider'
import { ONLINE_PAYMENT_CHANNELS, type PaymentAttemptStatus, type PaymentChannel } from './payment.types'

type OrderRecord = NonNullable<Awaited<ReturnType<PrismaService['order']['findUnique']>>>
type AttemptRecord = NonNullable<Awaited<ReturnType<PrismaService['paymentAttempt']['findUnique']>>>

/** 动态码/支付尝试有效期（秒）。 */
const DEFAULT_QR_TTL_SECONDS = 300
/** 订单线上支付超时关单时限（秒），自首次出码起算。 */
const DEFAULT_ORDER_TTL_SECONDS = 900
/** 用户可见的失败安全文案 —— 渠道原始错误只进审计，绝不透传。 */
const SAFE_FAIL_TEXT = '支付未完成，请重新发起支付'

/** 验签/时间窗/解密类失败 → 401；其余业务校验失败 → 400。 */
const UNAUTHORIZED_CALLBACK_CODES = new Set([
  'CALLBACK_HEADER_MISSING',
  'CALLBACK_TIMESTAMP_INVALID',
  'CALLBACK_TIMESTAMP_EXPIRED',
  'CALLBACK_NONCE_INVALID',
  'CALLBACK_SIGNATURE_INVALID',
  'CALLBACK_SERIAL_MISMATCH', // wechat：回调声明的验签材料不命中配置公钥 ID
  'CALLBACK_RESOURCE_DECRYPT_FAILED', // wechat：APIv3 密钥解不开 resource（密钥不符/报文被改）
  'CALLBACK_MERCHANT_MISMATCH', // 跨商户/跨应用报文错投
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
    /** 本次尝试的支付通道（Kiosk 据此渲染通道态与品牌文案）。 */
    channel: string
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

  /** reconcile 主动查单的最小间隔（毫秒）：防止持会话 token 的客户端高频打渠道查单 API。 */
  private static readonly RECONCILE_MIN_INTERVAL_MS = 3000
  private readonly reconcileLastAt = new Map<string, number>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orderStatus: OrderStatusService,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly registry: PaymentProviderRegistry,
  ) {}

  /** 当前已启用通道（Kiosk 收银页据此渲染通道选择；无任何密钥信息）。 */
  availableChannels(): PaymentChannel[] {
    return this.registry.channels()
  }

  /**
   * 解析本次出码使用的通道：显式指定必须已启用；未指定时单通道直接用、
   * 多通道要求显式选择（绝不替用户默认选真实资金通道）。
   */
  private requireChannel(channel: string | undefined): PaymentProvider {
    if (this.registry.size === 0) throw new BadRequestException('ONLINE_PAYMENT_DISABLED')
    if (channel !== undefined) {
      if (!(ONLINE_PAYMENT_CHANNELS as readonly string[]).includes(channel)) {
        throw new BadRequestException('PAY_CHANNEL_INVALID')
      }
      const provider = this.registry.get(channel)
      if (!provider) throw new BadRequestException('PAY_CHANNEL_NOT_ENABLED')
      return provider
    }
    const channels = this.registry.channels()
    const only = channels.length === 1 ? channels[0] : undefined
    if (!only) throw new BadRequestException('PAY_CHANNEL_REQUIRED')
    const provider = this.registry.get(only)
    if (!provider) throw new BadRequestException('ONLINE_PAYMENT_DISABLED')
    return provider
  }

  /** 出码：为付费订单创建（或复用未过期的）支付尝试，返回屏上动态码内容。 */
  async createPayAttempt(
    orderId: string,
    paymentSessionToken: string | undefined,
    channel?: string,
  ): Promise<PayAttemptView> {
    this.requirePaymentSessionHeader(paymentSessionToken)
    const provider = this.requireChannel(channel)

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
            channel: latest.channel,
            status: latest.status as PaymentAttemptStatus,
            qrCodeContent: latest.qrCodeContent,
            expiresAt: latest.expiresAt?.toISOString() ?? null,
          }
        : null,
    }
  }

  /**
   * 主动查单兜底（C5-6）：回调丢失/延迟时按渠道账本核实，**复用与回调完全相同的幂等入账路径**。
   *
   * - 鉴权与轮询同口径（payment session token）；有最小间隔限流，防高频打渠道 API。
   * - 只信渠道账本：channel 返回 paid 且流水号/金额齐备、金额与服务端快照一致才入账；
   *   pending/closed/failed/unknown 一律不改支付状态（惰性过期仍由 applyLazyExpiry 处理）。
   * - sandbox 无外部账本（不实现 queryPayment）→ RECONCILE_UNSUPPORTED，不伪造能力。
   */
  async reconcilePayment(orderId: string, paymentSessionToken: string | undefined): Promise<PayStatusView> {
    this.requirePaymentSessionHeader(paymentSessionToken)
    let order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
    this.requirePaymentSession(order, paymentSessionToken)

    if (order.payStatus !== 'paid') {
      const now = Date.now()
      const last = this.reconcileLastAt.get(order.id) ?? 0
      if (now - last < OnlinePaymentService.RECONCILE_MIN_INTERVAL_MS) {
        throw new BadRequestException('RECONCILE_TOO_FREQUENT')
      }
      this.reconcileLastAt.set(order.id, now)
      // 有界清理：防 Map 无界增长（保留近 1000 单足够 Kiosk 场景）。
      if (this.reconcileLastAt.size > 1000) {
        const oldest = this.reconcileLastAt.keys().next().value
        if (oldest) this.reconcileLastAt.delete(oldest)
      }

      order = await this.applyLazyExpiry(order)
      // 已出码（prepayId 非空）的最近一次尝试才有渠道单可查；expired 也查（迟到支付兜底）。
      const attempt = await this.prisma.paymentAttempt.findFirst({
        where: { orderId: order.id, prepayId: { not: null }, status: { in: ['pending', 'expired', 'success'] } },
        orderBy: { createdAt: 'desc' },
      })
      if (attempt && attempt.status !== 'success') {
        const provider = this.registry.get(attempt.channel)
        if (!provider) throw new BadRequestException('PAY_CHANNEL_NOT_ENABLED')
        if (!provider.queryPayment) throw new BadRequestException('RECONCILE_UNSUPPORTED')

        const queried = await provider.queryPayment({ attemptId: attempt.id, orderId: order.id })
        if (queried.status === 'paid') {
          // 金额一致性双重比对（渠道账本 = 尝试快照 = 订单应付），任何不一致拒绝入账并可审计。
          if (
            queried.channelTxnNo &&
            queried.amountCents !== null &&
            queried.amountCents === attempt.amountCents &&
            queried.amountCents === order.amountCents
          ) {
            const late =
              order.payStatus === 'closed' ||
              attempt.status === 'expired' ||
              Boolean(order.expiresAt && order.expiresAt.getTime() < Date.now())
            await this.handleSuccess(attempt.channel as PaymentChannel, attempt, order, {
              channelTxnNo: queried.channelTxnNo,
            })
            await this.audit.write({
              actorId: null,
              actorRole: 'system',
              action: 'payment.reconciled',
              targetType: 'payment_attempt',
              targetId: attempt.id,
              payload: { orderId: order.id, channel: attempt.channel, channelTxnNo: queried.channelTxnNo, late },
            })
          } else {
            await this.audit.write({
              actorId: null,
              actorRole: 'system',
              action: 'payment.reconcile_amount_mismatch',
              targetType: 'payment_attempt',
              targetId: attempt.id,
              payload: {
                orderId: order.id,
                channel: attempt.channel,
                queriedAmountCents: queried.amountCents,
                expectedAmountCents: order.amountCents,
              },
            })
            throw new BadRequestException('RECONCILE_AMOUNT_MISMATCH')
          }
        }
        // pending / closed / failed / unknown：不改支付状态，返回当前真实状态。
      }
    }

    return this.getPayStatus(orderId, paymentSessionToken)
  }

  /**
   * 渠道回调入口：验签 → nonce 防重放 → 全字段匹配 → 金额一致 → 幂等入账/失败落库。
   * 任何一步失败都拒绝并保持订单不动；重复合法回调幂等返回，不重复副作用。
   */
  async processCallback(
    channel: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: true; idempotent?: boolean; ack: CallbackAck | null }> {
    if (this.registry.size === 0) throw new BadRequestException('ONLINE_PAYMENT_DISABLED')
    const provider = this.registry.get(channel)
    if (!provider) throw new BadRequestException('CALLBACK_CHANNEL_UNSUPPORTED')
    if (!rawBody || rawBody.length === 0) throw new BadRequestException('CALLBACK_RAW_BODY_MISSING')
    const ack = provider.callbackAck?.() ?? null

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

    // 中间态通知（如 alipay WAIT_BUYER_PAY）：验签合法但无需变更状态 —— 只 ack，不动订单/尝试。
    if (event.result === 'ignored') return { ok: true, idempotent: true, ack }

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

    if (event.result === 'success') {
      const res = await this.handleSuccess(channel as PaymentChannel, attempt, order, {
        channelTxnNo: event.channelTxnNo,
      })
      return { ...res, ack }
    }
    const res = await this.handleFailure(channel, attempt, order, event)
    return { ...res, ack }
  }

  /**
   * 沙箱模拟支付（仅开发/联调）：按库内 attempt 真实数据构造签名合法的回调，
   * 走与真实回调完全相同的验签/匹配/入账路径。生产环境不存在此能力。
   */
  async simulateSandboxCallback(input: {
    attemptId: string
    result: 'success' | 'failed'
  }): Promise<{ ok: true; idempotent?: boolean }> {
    if (process.env['NODE_ENV'] === 'production') throw new NotFoundException()
    const provider = this.registry.get('sandbox')
    if (!provider || !(provider instanceof SandboxPaymentProvider)) throw new BadRequestException('SANDBOX_ONLY')

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

  /** 成功入账（回调与 reconcile 查单共用的唯一路径）：CAS 幂等，同一渠道流水号绝不入账两次。 */
  private async handleSuccess(
    channel: PaymentChannel,
    attempt: AttemptRecord,
    order: OrderRecord,
    opts: { channelTxnNo: string | null },
  ): Promise<{ ok: true; idempotent?: boolean }> {
    const channelTxnNo = opts.channelTxnNo as string // 调用方已保证 success 必带
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
