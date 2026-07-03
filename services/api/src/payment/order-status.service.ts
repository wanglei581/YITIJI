import { randomBytes } from 'crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { P0A_ALLOWED_PAYMENT_SOURCES } from './payment.types'

/** Order 行类型（从 prisma delegate 推导，避免直接 import 生成 client 类型）。 */
type OrderRecord = NonNullable<Awaited<ReturnType<PrismaService['order']['findUnique']>>>

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
      const pickupCode = await this.generateUniquePickupCode()
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
        // 并发竞态（非取件码冲突）：他人已支付则幂等返回，否则非法转移，不重试。
        const fresh = await this.prisma.order.findUnique({ where: { id: orderId } })
        if (fresh?.payStatus === 'paid') return fresh
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

    return this.requireOrder(orderId)
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

    return this.requireOrder(orderId)
  }

  private async requireOrder(orderId: string): Promise<OrderRecord> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
    return order
  }

  /** 生成库内唯一取件码；有界重试（不无限循环），穷尽后 fail-closed。唯一索引为最终防撞。 */
  private async generateUniquePickupCode(): Promise<string> {
    for (let i = 0; i < PICKUP_MAX_ATTEMPTS; i += 1) {
      const code = randomPickupCode()
      const existing = await this.prisma.order.findUnique({ where: { pickupCode: code } })
      if (!existing) return code
    }
    throw new BadRequestException('PICKUP_CODE_UNAVAILABLE')
  }
}
