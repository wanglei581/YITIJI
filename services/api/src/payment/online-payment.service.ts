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

function ttlSecondsFromEnv(key: string, fallback: number, minimumSeconds = 30): number {
  const raw = Number(process.env[key])
  if (!Number.isFinite(raw) || raw < minimumSeconds || raw > 24 * 3600) return fallback
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

export interface CodePayAttemptView {
  status: 'success' | 'paying' | 'failed'
  attemptId: string
  failReason: string | null
}

export interface CodePaymentConvergenceResult {
  scanned: number
  paid: number
  released: number
  stillPending: number
  skipped: number
  failed: number
}

/** 已过期的屏上二维码释放：先查单/关单，仅渠道确认终态后释放；不伪造退款。 */
export interface QrPaymentExpiryReleaseResult {
  scanned: number
  released: number
  closed: number
  skipped: number
  failed: number
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
  // 微信 Native 的 time_expire 不得早于下单后 1 分钟；统一收紧所有屏上码，避免本地/渠道有效期分叉。
  private readonly qrTtlSeconds = ttlSecondsFromEnv('PAYMENT_QR_TTL_SECONDS', DEFAULT_QR_TTL_SECONDS, 60)
  private readonly orderTtlSeconds = ttlSecondsFromEnv('PAYMENT_ORDER_TTL_SECONDS', DEFAULT_ORDER_TTL_SECONDS)

  /**
   * reconcile 主动查单的最小间隔（毫秒）：防止持会话 token 的客户端高频打渠道查单 API。
   * 诚实边界：进程内 Map（与 ReplayGuard 同级语义）——多实例/重启后不共享；当前部署为
   * 单实例 PM2，多实例化时应升级为 Redis 级限流（已记录在 C5-6 审查结论，非入账安全依赖：
   * 入账正确性由验签 + 金额比对 + (channel,channelTxnNo) 唯一索引保证，与限流无关）。
   */
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
    const qrExpiry = await this.convergeExpiredScreenQrAttempt(order)
    order = qrExpiry.order
    if (order.payStatus === 'paid') throw new BadRequestException('ORDER_ALREADY_PAID')
    if (order.payStatus === 'closed') throw new BadRequestException('ORDER_CLOSED')
    if (order.payStatus !== 'unpaid' && order.payStatus !== 'paying') {
      throw new BadRequestException('ORDER_INVALID_TRANSITION') // refunded / failed
    }

    // 同一订单只能有一个未完成的可扣款尝试。相同通道的二维码可幂等复用；
    // 付款码、另一通道二维码或正在创建的尝试一律阻断，不能靠 Kiosk UI 单独防双扣。
    const now = Date.now()
    const existing = await this.prisma.paymentAttempt.findFirst({
      where: {
        orderId: order.id,
        OR: [
          { status: { in: ['created', 'pending'] }, expiresAt: { gt: new Date(now) } },
          // 付款码过期不代表渠道绝对未扣款。必须先查单收敛，不能改发二维码造成双扣。
          { status: 'expired', qrCodeContent: null, prepayId: { not: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      if (existing.status === 'expired') throw new BadRequestException('PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED')
      if (existing.channel === provider.channel && existing.status === 'pending' && existing.qrCodeContent) {
        return this.toAttemptView(existing, order)
      }
      throw new BadRequestException('PAYMENT_ATTEMPT_PENDING')
    }

    // 订单状态既是支付生命周期，也是本次出码的互斥锁。CAS 预留和 created 尝试必须同一事务提交：
    // 不能暴露「已 paying、但还没有 Attempt」的窗口，否则第二请求的惰性过期可能错误释放预留。
    // Provider 调用仍在事务外，绝不把外部 I/O 包进数据库事务。
    if (order.payStatus === 'paying') throw new BadRequestException('PAYMENT_ATTEMPT_PENDING')
    const attemptExpiresAt = new Date(now + this.qrTtlSeconds * 1000)
    const attempt = await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.order.updateMany({
        where: { id: order.id, payStatus: 'unpaid' },
        data: { payStatus: 'paying', expiresAt: order.expiresAt ?? new Date(now + this.orderTtlSeconds * 1000) },
      })
      if (reserved.count !== 1) throw new BadRequestException('PAYMENT_ATTEMPT_PENDING')

      // 先建行（status=created，占位）再向渠道出码，最后回填 pending + 码内容；
      // 本地建行失败时由事务回滚 CAS 预留；渠道出码失败仍保留 created 以便惰性过期收敛。
      return tx.paymentAttempt.create({
        data: {
          orderId: order.id,
          channel: provider.channel,
          amountCents: order.amountCents, // 金额快照自服务端订单，绝不信任前端
          status: 'created',
          expiresAt: attemptExpiresAt,
        },
      })
    })
    const qr = await provider.createQrPayment({
      orderId: order.id,
      orderNo: order.orderNo,
      attemptId: attempt.id,
      amountCents: order.amountCents,
      expiresAt: attemptExpiresAt,
    })
    const pendingAttempt = await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'pending', prepayId: qr.prepayId, qrCodeContent: qr.qrCodeContent },
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

  /**
   * 付款码支付（商户扫用户付款码）。付款码只在当前请求中传给 Provider，绝不落库、审计或日志。
   * 同一订单已有未完成支付尝试时拒绝并要求先完成/过期，避免二维码与付款码并行导致重复扣款。
   */
  async createCodePayAttempt(
    orderId: string,
    paymentSessionToken: string | undefined,
    authCode: string,
    channel?: string,
  ): Promise<CodePayAttemptView> {
    this.requirePaymentSessionHeader(paymentSessionToken)
    if (!/^\d{18}$/.test(authCode)) throw new BadRequestException('AUTH_CODE_INVALID')
    const provider = this.requireChannel(channel)
    if (!provider.createCodePayment) throw new BadRequestException('CODE_PAYMENT_NOT_SUPPORTED')

    let order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
    this.requirePaymentSession(order, paymentSessionToken)
    if (order.amountCents <= 0) throw new BadRequestException('PAY_NOT_REQUIRED')

    order = await this.applyLazyExpiry(order)
    const qrExpiry = await this.convergeExpiredScreenQrAttempt(order)
    order = qrExpiry.order
    if (order.payStatus === 'paid') throw new BadRequestException('ORDER_ALREADY_PAID')
    if (order.payStatus === 'closed') throw new BadRequestException('ORDER_CLOSED')
    if (order.payStatus !== 'unpaid' && order.payStatus !== 'paying') throw new BadRequestException('ORDER_INVALID_TRANSITION')

    const now = Date.now()
    const existing = await this.prisma.paymentAttempt.findFirst({
      where: {
        orderId: order.id,
        OR: [
          { status: { in: ['created', 'pending'] } },
          // 付款码过期不代表渠道绝对未扣款，必须先查单；屏上二维码只有在
          // convergeExpiredScreenQrAttempt 已获渠道关单确认后才会退出此互斥集合。
          { status: 'expired', qrCodeContent: null, prepayId: { not: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      // expired 也可能是渠道迟到入账，必须先查账，绝不在同一订单叠加另一笔付款码扣款。
      throw new BadRequestException(existing.status === 'expired' ? 'PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED' : 'PAYMENT_ATTEMPT_PENDING')
    }
    // 订单 CAS 预留和 created 尝试同一事务提交，避免暴露无 Attempt 的 paying 窗口；
    // 外部付款码渠道调用严格在事务外，不能拉长数据库锁。
    if (order.payStatus === 'paying') throw new BadRequestException('PAYMENT_ATTEMPT_PENDING')
    const attempt = await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.order.updateMany({
        where: { id: order.id, payStatus: 'unpaid' },
        data: { payStatus: 'paying', expiresAt: order.expiresAt ?? new Date(now + this.orderTtlSeconds * 1000) },
      })
      if (reserved.count !== 1) throw new BadRequestException('PAYMENT_ATTEMPT_PENDING')

      return tx.paymentAttempt.create({
        data: {
          orderId: order.id,
          channel: provider.channel,
          amountCents: order.amountCents,
          status: 'created',
          expiresAt: new Date(now + this.qrTtlSeconds * 1000),
        },
      })
    })
    const freshOrder = await this.requireOrder(order.id)
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'payment.code_attempt_created',
      targetType: 'payment_attempt',
      targetId: attempt.id,
      payload: { orderId: order.id, orderNo: order.orderNo, channel: provider.channel, amountCents: order.amountCents },
    })

    let result: Awaited<ReturnType<NonNullable<PaymentProvider['createCodePayment']>>>
    try {
      result = await provider.createCodePayment({
        orderId: order.id,
        orderNo: order.orderNo,
        attemptId: attempt.id,
        terminalId: order.terminalId,
        amountCents: order.amountCents,
        authCode,
      })
    } catch {
      // Provider 抛出异常时结果不可知（可能已被渠道受理），必须查单收敛，不能回退 unpaid。
      result = { status: 'paying', channelTxnNo: null, prepayId: attempt.id, amountCents: null, failReason: '支付结果待核实，请稍候' }
    }

    if (result.status === 'success' && result.channelTxnNo && result.amountCents === order.amountCents) {
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'pending', prepayId: result.prepayId ?? attempt.id, failReason: null },
      })
      try {
        await this.handleSuccess(provider.channel, attempt, freshOrder, { channelTxnNo: result.channelTxnNo })
        return { status: 'success', attemptId: attempt.id, failReason: null }
      } catch {
        // 渠道已明确成功但本地入账未完成：保持 pending，让 pay-status/reconcile 通过 attempt 查单收敛，禁止用户重复付款。
        return { status: 'paying', attemptId: attempt.id, failReason: '支付结果待核实，请稍候' }
      }
    }

    const successIncomplete =
      result.status === 'success' && (result.channelTxnNo === null || result.amountCents !== order.amountCents)
    if (result.status === 'paying' || successIncomplete) {
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'pending',
          prepayId: result.prepayId ?? attempt.id,
          ...(successIncomplete ? { failReason: '支付结果校验失败，请联系工作人员' } : {}),
        },
      })
      if (successIncomplete) {
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'payment.code_attempt_amount_mismatch',
          targetType: 'payment_attempt',
          targetId: attempt.id,
          payload: { orderId: order.id, channel: provider.channel },
        })
      }
      return { status: 'paying', attemptId: attempt.id, failReason: null }
    }

    const failReason = result.failReason ?? SAFE_FAIL_TEXT
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'failed', prepayId: result.prepayId ?? attempt.id, failReason },
    })
    await this.prisma.order.updateMany({ where: { id: order.id, payStatus: 'paying' }, data: { payStatus: 'unpaid' } })
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'payment.code_attempt_failed',
      targetType: 'payment_attempt',
      targetId: attempt.id,
      payload: { orderId: order.id, channel: provider.channel },
    })
    return { status: 'failed', attemptId: attempt.id, failReason }
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
      await this.reconcileLatestPaymentAttempt(order)
    }

    return this.getPayStatus(orderId, paymentSessionToken)
  }

  /**
   * 付款码自动收敛：只处理没有屏上二维码的真实渠道尝试。即使 Kiosk 已退出或尝试过期，
   * 仍以渠道账本为准终态化；不经 payment-session token，不能暴露为 HTTP 入口。
   */
  async convergeStaleCodePayments({ limit }: { limit: number }): Promise<CodePaymentConvergenceResult> {
    const boundedLimit = Math.max(1, Math.min(limit, 100))
    const candidates = await this.prisma.paymentAttempt.findMany({
      where: {
        channel: { not: 'sandbox' },
        qrCodeContent: null,
        prepayId: { not: null },
        status: { in: ['pending', 'expired'] },
      },
      select: { orderId: true },
      orderBy: { createdAt: 'asc' },
      // 先按时间取有限窗口，再在进程内去重，避开 PostgreSQL DISTINCT ON 的排序约束。
      take: boundedLimit * 5,
    })
    const result: CodePaymentConvergenceResult = { scanned: 0, paid: 0, released: 0, stillPending: 0, skipped: 0, failed: 0 }
    const orderIds = [...new Set(candidates.map((candidate) => candidate.orderId))].slice(0, boundedLimit)
    for (const orderId of orderIds) {
      result.scanned += 1
      try {
        let order = await this.prisma.order.findUnique({ where: { id: orderId } })
        if (!order || order.payStatus === 'paid') {
          result.skipped += 1
          continue
        }
        order = await this.applyLazyExpiry(order)
        const outcome = await this.reconcileLatestPaymentAttempt(order, { rejectAmountMismatch: false })
        if (outcome === 'paid') result.paid += 1
        else if (outcome === 'released') result.released += 1
        else if (outcome === 'pending') result.stillPending += 1
        else result.skipped += 1
      } catch {
        result.failed += 1
      }
    }
    return result
  }

  /**
   * 屏上二维码超时收敛：Kiosk 不在线时也会查单并关闭已超时动态码。
   * 只有渠道确认 closed / failed 才释放本地锁；unknown / pending 保持互斥，绝不伪造失败或退款。
   */
  async releaseExpiredQrPayments({ limit }: { limit: number }): Promise<QrPaymentExpiryReleaseResult> {
    const boundedLimit = Math.max(1, Math.min(limit, 100))
    const candidates = await this.prisma.paymentAttempt.findMany({
      where: {
        qrCodeContent: { not: null },
        status: { in: ['created', 'pending'] },
        expiresAt: { lt: new Date() },
      },
      select: { orderId: true },
      orderBy: { createdAt: 'asc' },
      take: boundedLimit * 5,
    })
    const result: QrPaymentExpiryReleaseResult = { scanned: 0, released: 0, closed: 0, skipped: 0, failed: 0 }
    const orderIds = [...new Set(candidates.map((candidate) => candidate.orderId))].slice(0, boundedLimit)
    for (const orderId of orderIds) {
      result.scanned += 1
      try {
        const order = await this.prisma.order.findUnique({ where: { id: orderId } })
        if (!order || order.payStatus === 'paid') {
          result.skipped += 1
          continue
        }
        const settled = await this.convergeExpiredScreenQrAttempt(order)
        if (settled.outcome === 'released') result.released += 1
        else if (settled.outcome === 'closed') result.closed += 1
        else result.skipped += 1
      } catch {
        result.failed += 1
      }
    }
    return result
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

    // 渠道流水号跨尝试冲突预检（C5-6 双模型审查 High 修复）：(channel, channelTxnNo)
    // 唯一索引兜底发生在「订单已入账、attempt 回填」之后 —— 若同一流水号已被其它尝试
    // 占用，先入账再冲突会留下 paid 订单 + 未回填尝试的半状态。改单前先按名拒绝；
    // 预检后的并发窗口仍由唯一索引兜底（P2002 → CALLBACK_TXN_ALREADY_USED）。
    const txnHolder = await this.prisma.paymentAttempt.findFirst({
      where: { channel, channelTxnNo, id: { not: attempt.id } },
      select: { id: true },
    })
    if (txnHolder) throw new BadRequestException('CALLBACK_TXN_ALREADY_USED')

    // 先订单入账（CAS 幂等，线上通道 paymentSource 的唯一写入路径），再回填尝试；
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
   * 过期收敛（请求路径惰性调用）：
   * 1) 已有渠道受理标识的过期付款码尝试 → expired；已有屏上二维码必须由
   *    convergeExpiredScreenQrAttempt 查单/关单确认后才可过期；未取得二维码的 created
   *    尝试不可能被顾客扫描，可在本地到期后安全释放；
   * 2) 订单超时（expiresAt 已过且仍 unpaid/paying）→ closed；
   * 3) paying 但已无任何 created/pending 尝试 → 回 unpaid（可重新出码）。
   */
  private async applyLazyExpiry(order: OrderRecord): Promise<OrderRecord> {
    const now = new Date()
    await this.prisma.paymentAttempt.updateMany({
      where: {
        orderId: order.id,
        status: { in: ['created', 'pending'] },
        expiresAt: { lt: now },
        OR: [
          // 付款码已有渠道受理标识，仍须由主动查单路径确认。
          { qrCodeContent: null, prepayId: { not: null } },
          // 屏上码预下单抛错且没有拿到二维码：顾客没有可扫码内容，渠道 time_expire 已限制，
          // 到本地有效期后可以安全解除本地锁，避免滞留到订单 15 分钟超时。
          { status: 'created', qrCodeContent: null, prepayId: null },
        ],
      },
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
        // created/pending 均可能是渠道结果未知态；未经渠道确认绝不能只因本地 expiresAt 释放订单。
        where: { orderId: order.id, status: { in: ['created', 'pending'] } },
      })
      if (alive === 0) {
        await this.prisma.order.updateMany({ where: { id: order.id, payStatus: 'paying' }, data: { payStatus: 'unpaid' } })
        return this.requireOrder(order.id)
      }
    }
    return order
  }

  /**
   * 已到本服务二维码有效期的屏上码，必须由渠道账本确认后才能释放。
   * `pending` / `unknown`（含网络、验签、渠道异常）都保留原订单和 Attempt 互斥锁，
   * 以免旧二维码仍可扣款时又创建另一笔二维码或付款码。
   */
  private async convergeExpiredScreenQrAttempt(
    order: OrderRecord,
  ): Promise<{ order: OrderRecord; outcome: 'paid' | 'released' | 'closed' | 'pending' | 'skipped' }> {
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        orderId: order.id,
        qrCodeContent: { not: null },
        status: { in: ['created', 'pending'] },
        expiresAt: { lt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!attempt || order.payStatus === 'paid') return { order, outcome: 'skipped' }

    const provider = this.registry.get(attempt.channel)
    if (!provider?.closeExpiredQrPayment) return { order, outcome: 'pending' }

    const channelResult = await provider.closeExpiredQrPayment({ attemptId: attempt.id, orderId: order.id })
    if (channelResult.status === 'paid') {
      const freshOrder = await this.requireOrder(order.id)
      if (freshOrder.payStatus === 'paid') return { order: freshOrder, outcome: 'paid' }
      if (
        channelResult.channelTxnNo &&
        channelResult.amountCents !== null &&
        channelResult.amountCents === attempt.amountCents &&
        channelResult.amountCents === freshOrder.amountCents
      ) {
        await this.handleSuccess(attempt.channel as PaymentChannel, attempt, freshOrder, {
          channelTxnNo: channelResult.channelTxnNo,
        })
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'payment.qr_expiry_reconciled_paid',
          targetType: 'payment_attempt',
          targetId: attempt.id,
          payload: { orderId: order.id, channel: attempt.channel, channelTxnNo: channelResult.channelTxnNo },
        })
        return { order: await this.requireOrder(order.id), outcome: 'paid' }
      }
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'payment.qr_expiry_amount_mismatch',
        targetType: 'payment_attempt',
        targetId: attempt.id,
        payload: {
          orderId: order.id,
          channel: attempt.channel,
          queriedAmountCents: channelResult.amountCents,
          expectedAmountCents: order.amountCents,
        },
      })
      return { order: freshOrder, outcome: 'pending' }
    }

    if (channelResult.status !== 'closed' && channelResult.status !== 'failed') {
      return { order, outcome: 'pending' }
    }

    const closed = await this.prisma.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { in: ['created', 'pending'] } },
      data: { status: 'expired', failReason: null },
    })
    const refreshed = await this.requireOrder(order.id)
    if (closed.count === 0) return { order: refreshed, outcome: refreshed.payStatus === 'paid' ? 'paid' : 'skipped' }

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'payment.qr_expiry_channel_closed',
      targetType: 'payment_attempt',
      targetId: attempt.id,
      payload: { orderId: order.id, channel: attempt.channel, channelStatus: channelResult.status },
    })
    const settledOrder = await this.applyLazyExpiry(refreshed)
    if (settledOrder.payStatus === 'unpaid') return { order: settledOrder, outcome: 'released' }
    if (settledOrder.payStatus === 'closed') return { order: settledOrder, outcome: 'closed' }
    return { order: settledOrder, outcome: 'skipped' }
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

  /** 手动查单和付款码 cron 共用：渠道明确终态才释放，unknown/pending 永远保持互斥。 */
  private async reconcileLatestPaymentAttempt(
    order: OrderRecord,
    opts: { rejectAmountMismatch?: boolean } = {},
  ): Promise<'paid' | 'released' | 'pending' | 'skipped'> {
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { orderId: order.id, prepayId: { not: null }, status: { in: ['pending', 'expired', 'success'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!attempt || attempt.status === 'success') return 'skipped'
    const provider = this.registry.get(attempt.channel)
    if (!provider) throw new BadRequestException('PAY_CHANNEL_NOT_ENABLED')
    if (!provider.queryPayment) throw new BadRequestException('RECONCILE_UNSUPPORTED')

    const queried = await provider.queryPayment({ attemptId: attempt.id, orderId: order.id })
    if (queried.status === 'paid') {
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
        await this.handleSuccess(attempt.channel as PaymentChannel, attempt, order, { channelTxnNo: queried.channelTxnNo })
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'payment.reconciled',
          targetType: 'payment_attempt',
          targetId: attempt.id,
          payload: { orderId: order.id, channel: attempt.channel, channelTxnNo: queried.channelTxnNo, late },
        })
        return 'paid'
      }
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
      if (opts.rejectAmountMismatch !== false) throw new BadRequestException('RECONCILE_AMOUNT_MISMATCH')
      return 'pending'
    }
    if (queried.status === 'closed' || queried.status === 'failed') {
      await this.prisma.paymentAttempt.updateMany({
        where: { id: attempt.id, status: { in: ['pending', 'expired'] } },
        data: { status: 'failed', failReason: SAFE_FAIL_TEXT },
      })
      const stillPending = await this.prisma.paymentAttempt.count({
        where: { orderId: order.id, status: 'pending', expiresAt: { gt: new Date() }, id: { not: attempt.id } },
      })
      if (stillPending === 0) {
        await this.prisma.order.updateMany({ where: { id: order.id, payStatus: 'paying' }, data: { payStatus: 'unpaid' } })
      }
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'payment.reconcile_terminal_failure',
        targetType: 'payment_attempt',
        targetId: attempt.id,
        payload: { orderId: order.id, channel: attempt.channel, status: queried.status },
      })
      return 'released'
    }
    return 'pending'
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
