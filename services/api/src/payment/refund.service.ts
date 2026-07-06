/**
 * 退款域（C5-4 定义，W-B 接 wechat/alipay 真实渠道原路退回）。**canonical 退款入口**。
 *
 * 退款按订单域建模（不挂靠 PrintTask）；落 Refund 账本 + 状态机 paid → refunding → refunded。
 *
 * 硬约束（对齐用户定版 + compliance §8.4/§8.7 + W-B 双模型审查修复）：
 * - `refundNo` 幂等键：同一 refundNo 重复请求绝不重复出款/审计；渠道侧同样以 refundNo 作
 *   out_refund_no / out_request_no 幂等（双层防重复出款）。**任何重试/重发一律沿用同一
 *   refundNo**——绝不为重试换号（换号=渠道视角的第二笔退款）。
 * - 只有 `paid` 单可发起退款；unpaid/paying/closed/failed → 拒；refunded/partial_refunded → 拒。
 * - 渠道结果三分法（W-B 审查 H1 根因修复）：
 *   · **明确成功** → refunded；
 *   · **明确拒绝**（渠道业务错误码 / 4xx / ABNORMAL）→ Refund failed + 订单回 paid，
 *     可经同号重试路径重新发起；
 *   · **结果不可知**（超时 / 5xx / 网络异常 / 响应验签失败 / 受理中 PROCESSING）→
 *     Refund 保持 pending + 订单保持 refunding，**绝不判失败也绝不假报成功**，
 *     后续同号请求经查证（queryRefund）收敛：成功补完成 / 明确失败回滚 /
 *     渠道查无此单（请求可能从未到达）→ 同号重发。
 * - 退款执行渠道由 Order.paymentSource 决定：
 *   · `sandbox` → 假通道（无外部资金）；
 *   · `wechat` / `alipay` → 真实渠道原路退回；发起前必须唯一定位该单 success
 *     PaymentAttempt（缺失/多条均 fail-closed），且退款额必须等于渠道实收
 *     （discountCents 非 0 拒绝——线上入账单当前不可能有抵扣，防御性断言）；
 *   · `offline` / `manual_confirmed` / `free` / `voucher` → 不调 provider（只记状态 + 审计），
 *     且 voucher/free 退款**不恢复 BenefitGrant 额度**。
 * - 全额退款为主；`partial_refunded` 与部分退款动作仅预留，不接。
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
/** 需要「原单定位 + 查证收敛 + 同号重试」语义的真实资金渠道。 */
const REAL_REFUND_CHANNELS = new Set(['wechat', 'alipay'])
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

/**
 * 渠道异常分类（W-B 审查 H1 修复）：只有「渠道明确给出业务判定」才算明确拒绝；
 * 超时/网络异常/5xx/响应不可解析或验签失败 → 结果不可知（资金可能已动），保持 pending 收敛。
 */
function isDefinitiveChannelRejection(e: unknown): boolean {
  const msg = (e as Error)?.message ?? ''
  // 发起前的本地输入校验失败：未发出任何请求，必然明确失败。
  if (msg.includes('REFUND_INPUT_MISSING')) return true
  // 渠道返回了可解析的业务错误码（providers 统一以 *_CHANNEL_ERROR: <code> 抛出）。
  if (msg.includes('CHANNEL_ERROR:')) {
    if (/HTTP_5\d\d/.test(msg)) return false // 5xx：渠道内部错误，结果不可知
    // 瞬态 4xx（第二轮审查 High 修复）：408 超时 / 409 冲突 / 425 too-early / 429 限流 ——
    // 请求可能已被渠道受理或稍后可重试，均按结果不可知处理，绝不回滚为明确失败。
    if (/HTTP_(408|409|425|429)\b/.test(msg)) return false
    // 渠道自述「结果未知/请同参数重试/频控」的业务码：wechat SYSTEM_ERROR、FREQUENCY_LIMITED /
    // alipay code=20000。
    if (msg.includes('SYSTEM_ERROR') || msg.includes('FREQUENCY_LIMITED') || /CHANNEL_ERROR:\s*20000\b/.test(msg)) {
      return false
    }
    if (msg.includes('RESPONSE_NOT_JSON') || msg.includes('RESPONSE_NODE_MISSING') || msg.includes('RESPONSE_SIGN_INVALID')) {
      return false // 响应损坏/不可验签：请求可能已被处理，结果不可知
    }
    return true // 其余 4xx / 明确业务 sub_code：渠道明确拒绝，未出款
  }
  return false // fetch/超时/连接异常等传输层错误：结果不可知
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
   * 同 refundNo 重复请求：success/非渠道 failed → 幂等返回；真实渠道 pending → 查证收敛；
   * 真实渠道 failed → 同号重试（H2 修复：明确拒绝后的合法重试路径，渠道幂等兜底）。
   */
  async refund(
    orderId: string,
    opts: { refundNo?: string; reason: string; operatorId?: string },
  ): Promise<RefundResultView> {
    const reason = opts.reason?.trim()
    if (!reason) throw new BadRequestException('REFUND_REASON_REQUIRED')

    const order = await this.requireOrder(orderId)
    const refundNo = opts.refundNo?.trim() || `RFD-${order.orderNo}`

    // ① 幂等门：同 refundNo 已存在。
    const existing = await this.prisma.refund.findUnique({ where: { refundNo } })
    if (existing) {
      if (REAL_REFUND_CHANNELS.has(existing.channel)) {
        // 真实渠道 pending（受理中/结果不可知）→ 查证收敛；failed（明确拒绝）→ 同号重试。
        if (existing.status === 'pending') return this.convergePendingRefund(existing, opts.operatorId)
        if (existing.status === 'failed') return this.retryFailedRefund(existing, opts.operatorId)
      }
      return this.toView(existing, await this.requireOrder(existing.orderId), true)
    }

    // ② 状态门：只有 paid 可发起。
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
      const staged = await this.prisma.$transaction(async (tx) => {
        const cas = await tx.order.updateMany({
          where: { id: orderId, payStatus: 'paid' },
          data: { payStatus: 'refunding' },
        })
        if (cas.count === 0) {
          // 同 refundNo 并发竞态（第二轮审查 M2 修复）：先发方可能刚过①闸建好同号记录 ——
          // 幂等返回既有记录，而不是对合法重试方报 ORDER_ALREADY_REFUNDED。
          const raced = await tx.refund.findUnique({ where: { refundNo } })
          if (raced) return { record: raced, raced: true as const }
          const fresh = await tx.order.findUnique({ where: { id: orderId } })
          if (fresh && ALREADY_REFUND_STATES.has(fresh.payStatus)) throw new BadRequestException('ORDER_ALREADY_REFUNDED')
          throw new BadRequestException('ORDER_INVALID_TRANSITION')
        }
        const record = await tx.refund.create({
          data: { orderId, refundNo, amountCents, status: 'pending', reason, channel, operatorId: opts.operatorId ?? null },
        })
        return { record, raced: false as const }
      })
      if (staged.raced) return this.toView(staged.record, await this.requireOrder(orderId), true)
      refund = staged.record
    } catch (e) {
      if (isRefundNoConflict(e)) {
        const ex = await this.prisma.refund.findUnique({ where: { refundNo } })
        if (ex) return this.toView(ex, await this.requireOrder(orderId), true)
      }
      throw e
    }

    // ④ 阶段二：provider 通道执行渠道退款（三分法）；非 provider 通道直接完成。
    if (PROVIDER_REFUND_CHANNELS.has(channel)) {
      return this.executeProviderRefund(refund, opts.operatorId)
    }
    return this.completePendingRefund(refund, null, opts.operatorId, { converged: false })
  }

  // ── 内部：渠道执行 / 完成 / 回滚 / 收敛 / 重试 ─────────────────────────────

  /**
   * 对 pending Refund 执行渠道退款（主流程 ④、同号重试、查证 unknown 同号重发共用）。
   * 前置：Refund=pending、订单=refunding。渠道结果三分法处置（见文件头注释）。
   */
  private async executeProviderRefund(refund: RefundRecord, operatorId?: string): Promise<RefundResultView> {
    const order = await this.requireOrder(refund.orderId)
    const channel = refund.channel
    const provider = this.requireProvider(channel)
    const providerInput: RefundExecuteInput = {
      orderId: order.id,
      orderNo: order.orderNo,
      refundNo: refund.refundNo,
      amountCents: refund.amountCents,
    }

    if (REAL_REFUND_CHANNELS.has(channel)) {
      // 真实渠道：唯一定位 success 支付尝试（out_trade_no）。缺失/多条均 fail-closed（数据异常，
      // 人工介入）——多条 success 意味着可能存在双重扣款，按最新一条盲退会漏掉另一笔（审查 M5）。
      const successAttempts = await this.prisma.paymentAttempt.findMany({
        where: { orderId: order.id, channel, status: 'success' },
        orderBy: { createdAt: 'desc' },
      })
      if (successAttempts.length === 0) {
        return this.blockRefund(refund, 'REFUND_SOURCE_ATTEMPT_MISSING', operatorId)
      }
      if (successAttempts.length > 1) {
        return this.blockRefund(refund, 'REFUND_SOURCE_AMBIGUOUS', operatorId)
      }
      const src = successAttempts[0] as NonNullable<(typeof successAttempts)[0]>
      // 金额口径（审查 M2）：真实渠道退款额必须 = 渠道实收 = 尝试快照 = 订单应付；
      // 线上入账单当前不可能有抵扣（voucher 全额核销不经渠道），discount 非 0 即异常。
      if (order.discountCents !== 0 || refund.amountCents !== order.amountCents || src.amountCents !== refund.amountCents) {
        return this.blockRefund(refund, 'REFUND_AMOUNT_BASIS_UNSUPPORTED', operatorId)
      }
      providerInput.orderAmountCents = order.amountCents
      providerInput.outTradeNo = src.id
      providerInput.channelTxnNo = src.channelTxnNo
    }

    let res: RefundExecuteResult
    try {
      res = await provider.refund(providerInput)
    } catch (e) {
      const errorCode = ((e as Error).message ?? 'UNKNOWN').slice(0, 160)
      if (isDefinitiveChannelRejection(e)) {
        // 渠道明确拒绝：未出款，回滚 paid（可同号重试）；原始错误只进审计。
        await this.rollbackRefundFailure(refund.id, refund.orderId, null)
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'refund.channel_error',
          targetType: 'order',
          targetId: refund.orderId,
          payload: { refundNo: refund.refundNo, channel, errorCode, operatorId: operatorId ?? null },
        })
        throw new BadRequestException('REFUND_CHANNEL_FAILED')
      }
      // 结果不可知（超时/5xx/网络/响应不可验签）：渠道可能已受理——保持 pending+refunding，
      // **绝不判失败**（判失败即账实不符 + 换号重试就是二次出款，审查 H1）；
      // 后续同号请求经 queryRefund 收敛或同号重发。
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'refund.channel_ambiguous',
        targetType: 'order',
        targetId: refund.orderId,
        payload: { refundNo: refund.refundNo, channel, errorCode, operatorId: operatorId ?? null },
      })
      const pendingRefund = await this.prisma.refund.findUnique({ where: { id: refund.id } })
      return this.toView(pendingRefund ?? refund, await this.requireOrder(refund.orderId), false)
    }

    if (res.status === 'failed') {
      await this.rollbackRefundFailure(refund.id, refund.orderId, res.channelRefundNo)
      throw new BadRequestException('REFUND_CHANNEL_FAILED')
    }
    if (res.status === 'processing') {
      // 受理中：保持 pending+refunding，绝不假报已退款；同号请求经查证收敛。
      if (res.channelRefundNo) {
        await this.prisma.refund.updateMany({ where: { id: refund.id, status: 'pending' }, data: { channelRefundNo: res.channelRefundNo } })
      }
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'refund.processing',
        targetType: 'order',
        targetId: refund.orderId,
        payload: { refundNo: refund.refundNo, channel, channelRefundNo: res.channelRefundNo, operatorId: operatorId ?? null },
      })
      const pendingRefund = await this.prisma.refund.findUnique({ where: { id: refund.id } })
      return this.toView(pendingRefund ?? refund, await this.requireOrder(refund.orderId), false)
    }

    return this.completePendingRefund(refund, res.channelRefundNo, operatorId, { converged: false })
  }

  /**
   * 完成退款（唯一完成路径；主流程/收敛/重试共用）：CAS pending→success +
   * refunding→refunded 同事务；CAS 未命中 → 他方已完成，幂等返回不重复审计（审查 M3）。
   */
  private async completePendingRefund(
    refund: RefundRecord,
    channelRefundNo: string | null,
    operatorId: string | undefined,
    flags: { converged: boolean },
  ): Promise<RefundResultView> {
    const finalChannelRefundNo = channelRefundNo ?? refund.channelRefundNo
    const { completed, order } = await this.prisma.$transaction(async (tx) => {
      const casRefund = await tx.refund.updateMany({
        where: { id: refund.id, status: 'pending' },
        data: { status: 'success', channelRefundNo: finalChannelRefundNo },
      })
      if (casRefund.count === 0) {
        // 并发完成竞态：他方已把这笔退款收敛完成 → 幂等返回（不再改订单、不重复审计）。
        const o = await tx.order.findUnique({ where: { id: refund.orderId } })
        if (!o) throw new NotFoundException('ORDER_NOT_FOUND')
        return { completed: false, order: o }
      }
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
      return { completed: true, order: o }
    })

    if (completed) {
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'refund.created',
        targetType: 'order',
        targetId: refund.orderId,
        // benefitRestored=false：免费/权益单退款只记状态，绝不恢复 BenefitGrant 额度。
        payload: {
          refundNo: refund.refundNo,
          channel: refund.channel,
          amountCents: refund.amountCents,
          paymentSource: order.paymentSource,
          channelRefundNo: finalChannelRefundNo,
          operatorId: operatorId ?? null,
          benefitRestored: false,
          ...(flags.converged ? { convergedFromProcessing: true } : {}),
        },
      })
    }

    const freshRefund = await this.prisma.refund.findUnique({ where: { id: refund.id } })
    return this.toView(freshRefund ?? refund, order, !completed)
  }

  /** 前置守卫拦截（原单缺失/多条/金额口径异常）：回滚 + 审计 + 明确错误码（人工介入）。 */
  private async blockRefund(refund: RefundRecord, code: string, operatorId?: string): Promise<never> {
    await this.rollbackRefundFailure(refund.id, refund.orderId, null)
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'refund.blocked',
      targetType: 'order',
      targetId: refund.orderId,
      payload: { refundNo: refund.refundNo, channel: refund.channel, code, operatorId: operatorId ?? null },
    })
    throw new BadRequestException(code)
  }

  /**
   * 退款明确失败统一回滚：Refund pending→failed 命中时才回滚订单 refunding→paid，同事务
   * （第一轮 M1：防半状态；第二轮 L1：CAS 未命中说明记录已被他方推进，不得把订单拉回 paid）。
   */
  private async rollbackRefundFailure(refundId: string, orderId: string, channelRefundNo: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.refund.updateMany({
        where: { id: refundId, status: 'pending' },
        data: { status: 'failed', channelRefundNo },
      })
      if (cas.count > 0) {
        await tx.order.updateMany({ where: { id: orderId, payStatus: 'refunding' }, data: { payStatus: 'paid' } })
      }
    })
  }

  /**
   * 后台自动收敛入口（W-C part2b：调度器调用；关闭 W-B codex M1 的运营卡单风险）。
   * 扫出**真实渠道**的 pending Refund（受理中/结果不可知的退款），逐笔走同一
   * `convergePendingRefund` 查证收敛——与人工重复调用完全相同的幂等路径，绝不二次出款。
   *
   * 只处理 wechat/alipay（有 queryRefund 能力）；单笔收敛异常/明确失败（抛 REFUND_CHANNEL_FAILED）
   * 不阻断其它笔，计入 failed 计数。返回批处理统计供调度器记录日志。
   */
  async convergeStalePendingRefunds(opts?: { limit?: number }): Promise<{ scanned: number; refunded: number; stillPending: number; failed: number }> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 500)
    const pendings = await this.prisma.refund.findMany({
      where: { status: 'pending', channel: { in: ['wechat', 'alipay'] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
    let refunded = 0
    let stillPending = 0
    let failed = 0
    for (const r of pendings) {
      try {
        const view = await this.convergePendingRefund(r, 'system_auto_converge')
        if (view.refund.status === 'success') refunded += 1
        else stillPending += 1
      } catch {
        // convergePendingRefund 在明确失败时抛 REFUND_CHANNEL_FAILED（已回滚 paid，可后续人工/自动重试）。
        failed += 1
      }
    }
    return { scanned: pendings.length, refunded, stillPending, failed }
  }

  /**
   * 真实渠道 pending 退款收敛（同 refundNo 重复请求触发）。向渠道 queryRefund 查证：
   * - success → 补完成（唯一完成路径，CAS 幂等）；
   * - failed（明确 ABNORMAL/CLOSED）→ 回滚 paid 可重试；
   * - processing → 原样返回；
   * - unknown（渠道查无此单——原请求可能从未到达，审查 M4）→ **同号重发** provider.refund
   *   （渠道以 out_refund_no/out_request_no 幂等，重发绝不二次出款）；
   * - 查证网络异常 → 原样返回，下次再收敛。
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
    if (!q || q.status === 'processing') {
      return this.toView(refund, order, true)
    }
    if (q.status === 'failed') {
      await this.rollbackRefundFailure(refund.id, refund.orderId, q.channelRefundNo)
      throw new BadRequestException('REFUND_CHANNEL_FAILED')
    }
    if (q.status === 'unknown') {
      // 渠道查无此单：原退款请求可能从未到达渠道 —— 同号重发（渠道幂等，绝不二次出款）。
      return this.executeProviderRefund(refund, operatorId)
    }
    return this.completePendingRefund(refund, q.channelRefundNo, operatorId, { converged: true })
  }

  /**
   * 真实渠道 failed 退款的同号重试（审查 H2 修复）：明确拒绝后允许再次发起
   * （运营处理完拒绝原因后重试，如余额不足充值后）。**沿用同一 refundNo**，
   * 渠道幂等保证与「其实已出款」的极端错判也不会二次出款。
   */
  private async retryFailedRefund(refund: RefundRecord, operatorId?: string): Promise<RefundResultView> {
    const order = await this.requireOrder(refund.orderId)
    if (order.payStatus !== 'paid') {
      // failed 记录 + 非 paid 订单：状态异常（如已被另一 refundNo 退掉），原样返回不动。
      return this.toView(refund, order, true)
    }
    // CAS：订单 paid→refunding + 记录 failed→pending，同事务；任一未命中即并发竞态，放弃本次重试。
    const reopened = await this.prisma.$transaction(async (tx) => {
      const casOrder = await tx.order.updateMany({
        where: { id: refund.orderId, payStatus: 'paid' },
        data: { payStatus: 'refunding' },
      })
      if (casOrder.count === 0) return false
      const casRefund = await tx.refund.updateMany({
        where: { id: refund.id, status: 'failed' },
        data: { status: 'pending' },
      })
      if (casRefund.count === 0) throw new BadRequestException('REFUND_STATE_CONFLICT')
      return true
    })
    if (!reopened) {
      return this.toView(refund, await this.requireOrder(refund.orderId), true)
    }
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'refund.retried',
      targetType: 'order',
      targetId: refund.orderId,
      payload: { refundNo: refund.refundNo, channel: refund.channel, operatorId: operatorId ?? null },
    })
    const pendingRefund = await this.prisma.refund.findUnique({ where: { id: refund.id } })
    return this.executeProviderRefund(pendingRefund ?? refund, operatorId)
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
