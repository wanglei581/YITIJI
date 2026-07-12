import { randomBytes } from 'crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { ONLINE_PAYMENT_CHANNELS, P0A_ALLOWED_PAYMENT_SOURCES, type PaymentChannel } from './payment.types'

/** Order 行类型（从 prisma delegate 推导，避免直接 import 生成 client 类型）。 */
type OrderRecord = NonNullable<Awaited<ReturnType<PrismaService['order']['findUnique']>>>

type RedemptionSettlementOptions = { discountCents: number; benefitRef: string; operatorId?: string }
type OrderClient = Pick<PrismaTransactionClient, 'order'>

// 取件码字符集：去掉易混字符 0/O/1/I/L；10 位 ≈ 49 bit 熵（非低熵）。
const PICKUP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const PICKUP_CODE_LEN = 10
const PICKUP_MAX_ATTEMPTS = 6

function randomPickupCode(): string {
  const bytes = randomBytes(PICKUP_CODE_LEN)
  let out = ''
  for (let i = 0; i < PICKUP_CODE_LEN; i += 1) {
    out += PICKUP_ALPHABET[(bytes[i] ?? 0) % PICKUP_ALPHABET.length]
  }
  return out
}

/** 判断是否为 pickupCode 唯一约束冲突（Prisma P2002）。markPaid 的 update data 中唯一带唯一索引的列即 pickupCode。 */
function isPickupCodeUniqueConflict(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } }
  if (err?.code !== 'P2002') return false
  const target = err.meta?.target
  if (typeof target === 'string') return target.includes('pickupCode')
  if (Array.isArray(target)) return target.some((t) => String(t).includes('pickupCode'))
  return true // 缺 meta 时按 pickupCode 冲突处理（本更新唯一可能冲突的列）
}

/**
 * 取件码可见性门（P0a）：仅 `paid`、未退款、且任务未进入 completed/cancelled/failed 终态时，
 * 后端才可向会员返回可用取件码。其它状态一律不返回（unpaid / refunded / 终态）。
 */
export function pickupCodeVisibleFor(o: {
  payStatus: string
  taskStatus: string
  refundedAt: Date | null
}): boolean {
  if (o.payStatus !== 'paid') return false
  if (o.refundedAt) return false
  if (o.taskStatus === 'completed' || o.taskStatus === 'cancelled' || o.taskStatus === 'failed') return false
  return true
}

/**
 * P0a 订单支付/退款状态机（支付域后端底座，无 live 网关）。
 *
 * - `unpaid → paid`：paymentSource 只允许 offline/free/manual_confirmed（禁 wechat/alipay/benefit）；
 *   置 paidAt、生成唯一 pickupCode、写 AuditLog；事务内 compare-and-set（updateMany where payStatus='unpaid'）；
 *   重复 markPaid 幂等（同来源直接返回，不重复副作用/审计）。
 * - `paid → refunded`：refundReason 必填、整单退款；置 refundedAt、写 AuditLog；重复 refund 幂等。
 * - 非法转移（refunded/failed→paid、unpaid→refunded、无来源/禁用来源的 paid）→ 明确错误码拒绝，绝不静默。
 * - C5-2 线上入账另走 markPaidOnline（唯一允许写 paymentSource=sandbox 的路径）；
 *   本方法（markPaid）继续只放行 offline/free/manual_confirmed，拒绝 sandbox/wechat/alipay/benefit。
 *
 * 诚实标注：free 只能用于 amountCents=0 的免费单；paid 一律带 paymentSource，绝不伪装线上已收款。
 */
@Injectable()
export class OrderStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async markPaid(orderId: string, opts: { paymentSource: string; operatorId?: string }): Promise<OrderRecord> {
    const { paymentSource, operatorId } = opts
    if (!(P0A_ALLOWED_PAYMENT_SOURCES as readonly string[]).includes(paymentSource)) {
      // 拦截空串 / wechat / alipay / benefit / 任意未知来源
      throw new BadRequestException('PAYMENT_SOURCE_INVALID')
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')

    // 幂等：已支付则原样返回（同来源）；不同来源视为冲突拒绝，不覆盖。
    if (order.payStatus === 'paid') {
      if (order.paymentSource === paymentSource) return order
      throw new BadRequestException('ORDER_ALREADY_PAID')
    }
    // 只允许 unpaid → paid；refunded / failed 不可再转 paid。
    if (order.payStatus !== 'unpaid') throw new BadRequestException('ORDER_INVALID_TRANSITION')
    // free 只能用于零额免费单，杜绝把付费单伪装成免费。
    if (paymentSource === 'free' && order.amountCents !== 0) {
      throw new BadRequestException('FREE_REQUIRES_ZERO_AMOUNT')
    }

    // CAS 落库 + 取件码唯一冲突有界重试：预检后仍可能与并发请求撞码（唯一索引拦截抛 P2002），
    // 仅该情况换码重试；CAS 未命中(count=0)与其它错误不重试、不吞。耗尽仍撞码 → 明确错误码，不落 500。
    let settled = false
    for (let attempt = 0; attempt < PICKUP_MAX_ATTEMPTS; attempt += 1) {
      const pickupCode = await this.generateUniquePickupCode(this.prisma)
      let res: { count: number }
      try {
        res = await this.prisma.order.updateMany({
          where: { id: orderId, payStatus: 'unpaid' }, // compare-and-set：只在仍为 unpaid 时命中
          data: {
            payStatus: 'paid',
            paymentSource,
            paidAt: new Date(),
            paidBy: operatorId ?? 'system',
            pickupCode,
          },
        })
      } catch (e) {
        if (isPickupCodeUniqueConflict(e)) continue // 取件码唯一冲突 → 换码重试
        throw e // 其它错误照抛，不吞
      }
      if (res.count === 0) {
        // 并发竞态（非取件码冲突）：仅同一支付来源可幂等回放；不同来源必须冲突，
        // 不能把「线下已收」误报为已经由 voucher/线上通道入账成功。
        const fresh = await this.prisma.order.findUnique({ where: { id: orderId } })
        if (fresh?.payStatus === 'paid' && fresh.paymentSource === paymentSource) return fresh
        if (fresh?.payStatus === 'paid') throw new BadRequestException('ORDER_ALREADY_PAID')
        throw new BadRequestException('ORDER_INVALID_TRANSITION')
      }
      settled = true
      break
    }
    if (!settled) throw new BadRequestException('PICKUP_CODE_UNAVAILABLE')

    await this.audit.write({
      // actorId 是 User 外键；操作员身份放 payload，避免非 User 标识触发外键约束（服务级动作 actorRole=system）。
      actorId: null,
      actorRole: 'system',
      action: 'order.mark_paid',
      targetType: 'order',
      targetId: orderId,
      payload: { paymentSource, operatorId: operatorId ?? null },
    })

    return this.requireOrder(this.prisma, orderId)
  }

  /**
   * C5-2 线上回调成功入账（唯一允许写 paymentSource=sandbox 的路径）。
   *
   * 只能由 OnlinePaymentService.processCallback 在「验签 + 防重放 + 全字段匹配 +
   * 金额一致」全部通过后调用；Admin / 手工动作绝不走本方法。
   *
   * - 合法起点：unpaid / paying；`closed` 仅当 late=true（已存在支付尝试的有效迟到回调）。
   * - 落库：payStatus=paid + paymentSource=channel + payChannel=channel + paidAt +
   *   paidBy='online_callback' + 唯一 pickupCode；CAS + 取件码撞码有界重试（同 markPaid）。
   * - 幂等：已 paid 且 paymentSource=channel → 原样返回，不重复副作用/审计；
   *   已 paid 但来源不同（如 Admin 已线下确认）→ ORDER_ALREADY_PAID 冲突，绝不覆盖。
   * - 审计 action=order.mark_paid_online，payload 带 late 标记 —— 迟到回调入账必须可审计
   *   （C5-4 前不做自动退款，对账时凭 late 识别超时后仍入账的单）。
   */
  async markPaidOnline(
    orderId: string,
    opts: { channel: PaymentChannel; attemptId: string; channelTxnNo: string; late: boolean },
  ): Promise<OrderRecord> {
    const { channel, attemptId, channelTxnNo } = opts
    if (!(ONLINE_PAYMENT_CHANNELS as readonly string[]).includes(channel)) {
      // 防御纵深：benefit / offline 及任意未知通道在此按名拦截；
      // 白名单 = sandbox / wechat / alipay（C5-6），且只有本方法可写这些 paymentSource。
      throw new BadRequestException('PAYMENT_CHANNEL_INVALID')
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')

    // 幂等：同通道已入账原样返回；不同来源已支付（如 Admin 已线下确认）拒绝覆盖。
    if (order.payStatus === 'paid') {
      if (order.paymentSource === channel) return order
      throw new BadRequestException('ORDER_ALREADY_PAID')
    }
    // closed 只对迟到回调开放（caller 已确认回调绑定到已存在的 PaymentAttempt 且全字段匹配）。
    const late = opts.late || order.payStatus === 'closed'
    const fromStatuses = late ? ['unpaid', 'paying', 'closed'] : ['unpaid', 'paying']
    if (!fromStatuses.includes(order.payStatus)) {
      throw new BadRequestException('ORDER_INVALID_TRANSITION') // refunded / failed 不可转 paid
    }

    let settled = false
    for (let attempt = 0; attempt < PICKUP_MAX_ATTEMPTS; attempt += 1) {
      const pickupCode = await this.generateUniquePickupCode(this.prisma)
      let res: { count: number }
      try {
        res = await this.prisma.order.updateMany({
          where: { id: orderId, payStatus: { in: fromStatuses } }, // compare-and-set
          data: {
            payStatus: 'paid',
            paymentSource: channel,
            payChannel: channel,
            paidAt: new Date(),
            paidBy: 'online_callback',
            pickupCode,
          },
        })
      } catch (e) {
        if (isPickupCodeUniqueConflict(e)) continue // 取件码唯一冲突 → 换码重试
        throw e
      }
      if (res.count === 0) {
        const fresh = await this.prisma.order.findUnique({ where: { id: orderId } })
        if (fresh?.payStatus === 'paid' && fresh.paymentSource === channel) return fresh
        throw new BadRequestException(
          fresh?.payStatus === 'paid' ? 'ORDER_ALREADY_PAID' : 'ORDER_INVALID_TRANSITION',
        )
      }
      settled = true
      break
    }
    if (!settled) throw new BadRequestException('PICKUP_CODE_UNAVAILABLE')

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'order.mark_paid_online',
      targetType: 'order',
      targetId: orderId,
      // late=true 表示超时关单/尝试过期后的迟到回调仍入账（钱已付，诚实入账优先）；
      // C5-4 前不自动退款，对账凭此标记追踪。
      payload: { channel, attemptId, channelTxnNo, late },
    })

    return this.requireOrder(this.prisma, orderId)
  }

  /**
   * C5-4 核销入账（全额券/免费次数/权益抵扣，**唯一允许写 paymentSource='voucher' 的路径**）。
   *
   * 只能由 BenefitRedemptionService.redeemForOrder 在核销账本（RedemptionRecord）落库后调用；
   * Admin / markPaid / markPaidOnline 绝不写 voucher。
   *
   * - 合法起点：unpaid（付费单）；要求 discountCents >= order.amountCents（**全额核销**，本波不接部分抵扣）。
   * - 落库：payStatus=paid + paymentSource='voucher' + payChannel='voucher' + discountCents(=应付) + paidAt +
   *   paidBy='redemption' + 唯一 pickupCode；CAS + 取件码撞码有界重试（同 markPaid）。
   * - 幂等：已 paid 且 paymentSource='voucher' → 原样返回；已 paid 但来源不同 → 冲突拒绝。
   * - 诚实标注：voucher = 平台券/权益抵扣，**非真实资金收款**；免费单同样落 Order + 审计。
   */
  async markPaidByRedemption(
    orderId: string,
    opts: RedemptionSettlementOptions,
  ): Promise<OrderRecord> {
    const outcome = await this.prisma.$transaction(async (tx: PrismaTransactionClient) => {
      const order = await this.requireOrder(tx, orderId)
      // 保持公开方法既有幂等语义；事务 helper 则仅接受仍为 unpaid 的订单，供核销账本事务安全调用。
      if (order.payStatus === 'paid') {
        if (order.paymentSource === 'voucher') return { order, settled: false }
        throw new BadRequestException('ORDER_ALREADY_PAID')
      }
      return { order: await this.settleRedemptionInTransaction(tx, orderId, opts), settled: true }
    })

    if (!outcome.settled) return outcome.order

    await this.writeRedemptionSettlementAudit(orderId, outcome.order, opts)

    return outcome.order
  }

  /**
   * 将订单核销审计放在外层事务提交后写入；订单核销需要借此复用同一审计格式，
   * 同时避免审计 I/O 位于 Prisma 事务中而拉长结算锁持有时间。
   */
  async writeRedemptionSettlementAudit(
    orderId: string,
    order: OrderRecord,
    opts: RedemptionSettlementOptions,
  ): Promise<void> {
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'order.mark_paid_redemption',
      targetType: 'order',
      targetId: orderId,
      // voucher = 平台券/权益抵扣，非真实资金；benefitRef 记录来源权益，便于对账与追溯。
      payload: {
        paymentSource: 'voucher',
        discountCents: order.amountCents,
        benefitRef: opts.benefitRef,
        operatorId: opts.operatorId ?? null,
      },
    })
  }

  /**
   * 在调用方事务内完成全额权益核销入账。此方法不写审计，避免账本、权益扣减与订单结算跨事务分裂。
   * 已支付订单（包括 voucher）不做幂等回放：调用方必须整体回滚或按既有核销账本回放。
   */
  async settleRedemptionInTransaction(
    tx: PrismaTransactionClient,
    orderId: string,
    opts: RedemptionSettlementOptions,
  ): Promise<OrderRecord> {
    const order = await this.requireOrder(tx, orderId)
    if (order.payStatus === 'paid') throw new BadRequestException('ORDER_ALREADY_PAID')
    if (order.payStatus !== 'unpaid') throw new BadRequestException('ORDER_INVALID_TRANSITION')
    // 全额核销：抵扣额必须 >= 应付；部分抵扣（<应付）本波不接（留结账用券 UI 波）。
    if (!Number.isInteger(opts.discountCents) || opts.discountCents < order.amountCents) {
      throw new BadRequestException('REDEEM_REQUIRES_FULL_COVERAGE')
    }

    for (let attempt = 0; attempt < PICKUP_MAX_ATTEMPTS; attempt += 1) {
      const pickupCode = await this.generateUniquePickupCode(tx)
      let res: { count: number }
      try {
        res = await tx.order.updateMany({
          where: { id: orderId, payStatus: 'unpaid' }, // compare-and-set
          data: {
            payStatus: 'paid',
            paymentSource: 'voucher',
            payChannel: 'voucher',
            discountCents: order.amountCents, // 全额抵扣（净应付 0）
            paidAt: new Date(),
            paidBy: 'redemption',
            pickupCode,
          },
        })
      } catch (e) {
        if (isPickupCodeUniqueConflict(e)) continue // 取件码唯一冲突 → 换码重试
        throw e
      }
      if (res.count === 0) {
        const fresh = await this.requireOrder(tx, orderId)
        if (fresh.payStatus === 'paid') throw new BadRequestException('ORDER_ALREADY_PAID')
        throw new BadRequestException('ORDER_INVALID_TRANSITION')
      }
      return this.requireOrder(tx, orderId)
    }
    throw new BadRequestException('PICKUP_CODE_UNAVAILABLE')
  }

  async refund(orderId: string, opts: { reason: string; operatorId?: string }): Promise<OrderRecord> {
    const reason = opts.reason?.trim()
    if (!reason) throw new BadRequestException('REFUND_REASON_REQUIRED')

    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')

    // 幂等：已退款则原样返回。
    if (order.payStatus === 'refunded') return order
    // 仅 paid → refunded；拒绝 unpaid / failed → refunded。
    if (order.payStatus !== 'paid') throw new BadRequestException('ORDER_INVALID_TRANSITION')

    const res = await this.prisma.order.updateMany({
      where: { id: orderId, payStatus: 'paid' }, // compare-and-set
      data: { payStatus: 'refunded', refundReason: reason, refundedAt: new Date() }, // 整单退款，无部分退款
    })
    if (res.count === 0) {
      const fresh = await this.prisma.order.findUnique({ where: { id: orderId } })
      if (fresh?.payStatus === 'refunded') return fresh
      throw new BadRequestException('ORDER_INVALID_TRANSITION')
    }

    await this.audit.write({
      // actorId 是 User 外键；操作员身份放 payload（服务级动作 actorRole=system）。
      actorId: null,
      actorRole: 'system',
      action: 'order.refund',
      targetType: 'order',
      targetId: orderId,
      payload: { reason, operatorId: opts.operatorId ?? null },
    })

    return this.requireOrder(this.prisma, orderId)
  }

  private async requireOrder(client: OrderClient, orderId: string): Promise<OrderRecord> {
    const order = await client.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
    return order
  }

  /** 生成库内唯一取件码；有界重试（不无限循环），穷尽后 fail-closed。唯一索引为最终防撞。 */
  private async generateUniquePickupCode(client: OrderClient): Promise<string> {
    for (let i = 0; i < PICKUP_MAX_ATTEMPTS; i += 1) {
      const code = randomPickupCode()
      const existing = await client.order.findUnique({ where: { pickupCode: code } })
      if (!existing) return code
    }
    throw new BadRequestException('PICKUP_CODE_UNAVAILABLE')
  }
}
