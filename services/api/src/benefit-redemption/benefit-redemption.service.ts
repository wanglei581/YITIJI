import { createHash } from 'crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { OrderStatusService } from '../payment/order-status.service'
import {
  REDEEMABLE_BENEFIT_TYPES,
  type RedeemBenefitParams,
  type RedeemBenefitResult,
  type RedeemForOrderParams,
  type RedeemForOrderResult,
} from './benefit-redemption.types'

// ============================================================
// 权益核销服务（P1「我的页权益核销」，核销 SSOT）。
//
// 核销 = 在服务点位真实消费一次 BenefitGrant 额度：扣 quantityRemaining、落 RedemptionRecord、写审计。
//
// 幂等（compliance §8.5「同一成果不重复扣同一权益」）：
//   idempotencyKey = sha256(benefitGrantId : serviceType : serviceRefId)。
//   同一权益用于同一服务产物（同一 taskId）重复调用 → 只扣一次，回放返回既有记录。
//
// 事务边界：$transaction 内 ①幂等命中即返回不扣减 → ②校验归属/类型/状态/有效期/额度
//   → ③CAS 扣减（updateMany where quantityRemaining>0 且 active，count!==1 拒）→ ④余 0 置 used_up
//   → ⑤create RedemptionRecord（唯一键并发保护）。
//   并发下丢失方 create 命中 P2002 → 整个事务回滚（扣减撤销）→ 外层按幂等回放返回赢家记录。
//
// 合规红线：券=平台 credit，非资金、非收款；本批 orderId 恒 null、amountCents 恒 0，不碰 Order/支付；
//   subsidy_eligibility_hint（不在 REDEEMABLE 白名单）一律拒核销；endUserId 只用已认证本人，杜绝越权。
// ============================================================

@Injectable()
export class BenefitRedemptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orderStatus: OrderStatusService,
  ) {}

  async redeem(params: RedeemBenefitParams): Promise<RedeemBenefitResult> {
    const { endUserId, benefitGrantId, serviceType, serviceRefId } = params
    if (!serviceRefId || !serviceRefId.trim()) {
      // 调用方必须提供稳定的服务产物 id；空值会污染幂等键，直接拒绝，不兜底造 id。
      throw new BadRequestException({ error: { code: 'REDEEM_SERVICE_REF_REQUIRED', message: '缺少服务产物标识' } })
    }
    const idempotencyKey = createHash('sha256')
      .update(`${benefitGrantId}:${serviceType}:${serviceRefId}`)
      .digest('hex')

    try {
      return await this.redeemOnce(params, idempotencyKey)
    } catch (error) {
      // 并发收敛（统一在此处理，覆盖 DB 唯一约束击穿窗口）：
      // - 同 idempotencyKey 并发（同权益同产物，含最后 1 份 CAS 输家得 used_up）：赢家已按本 key 落记录
      //   → replayIfPresent 命中且归属为本人 → 返回幂等回放，不二次扣。
      // - 一产物一核销唯一约束命中（不同权益并发核销同一 serviceType+serviceRefId）：本 key 无记录
      //   → replay 落空且仍是唯一冲突 → 归一为 BENEFIT_OUTPUT_ALREADY_REDEEMED（事务已回滚扣减）。
      // - 其余（越权 / 类型 / 状态 / 有效期 / 额度校验拒绝）：透传原始错误。
      const replay = await this.replayIfPresent(idempotencyKey, endUserId)
      if (replay) return replay
      if (isUniqueError(error)) {
        throw new ConflictException({
          error: { code: 'BENEFIT_OUTPUT_ALREADY_REDEEMED', message: '该服务已使用其他权益核销，不能重复核销' },
        })
      }
      throw error
    }
  }

  /**
   * C5-4 订单核销：券/免费次数/权益**全额抵扣一个未支付订单**，联动免费单。
   *
   * 复用同一核销账本（RedemptionRecord，serviceType='order_redeem' / serviceRefId=orderId）
   * 与同一幂等/一产物一核销/CAS/审计机制（**不重建第二套账本**）；随后 markPaidByRedemption
   * 将订单置 paid(voucher)（幂等）。全额抵扣（本波不接部分抵扣）。
   *
   * 幂等：同订单同权益重复调用 → RedemptionRecord 回放 + markPaidByRedemption 幂等，不二次扣。
   * 一单一核销：`@@unique([serviceType,serviceRefId])` 保证同一订单只被核销一次（换权益也拒）。
   */
  async redeemForOrder(params: RedeemForOrderParams): Promise<RedeemForOrderResult> {
    const { endUserId, orderId, benefitGrantId } = params

    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: '订单不存在' } })
    // 归属：只允许本人订单核销（endUserId 来自已认证会员）。
    if (order.endUserId && order.endUserId !== endUserId) {
      throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: '订单不存在或不属于本人' } })
    }

    // 幂等 / 一单一核销前置：该订单是否已被核销（@@unique([serviceType,serviceRefId])）。
    //   核销成功后订单即 paid(voucher)，故重复调用必先落这里，不会被下方 unpaid 门误拒。
    const existing = await this.prisma.redemptionRecord.findFirst({ where: { serviceType: 'order_redeem', serviceRefId: orderId } })
    if (existing) {
      // 同权益 + 本人 → 幂等回放（订单已 paid(voucher)）。
      if (existing.endUserId === endUserId && existing.benefitRef === benefitGrantId) {
        return { orderId, redemptionRecordId: existing.id, payStatus: order.payStatus, discountCents: existing.amountCents, idempotent: true }
      }
      // 不同权益（或非本人）核销同一订单 → 一单一核销拒绝，绝不二次消费。
      throw new ConflictException({ error: { code: 'BENEFIT_OUTPUT_ALREADY_REDEEMED', message: '该订单已用其他权益核销，不能重复核销' } })
    }

    // 只对未支付付费单首次核销；已支付（线上/线下/免费）/退款态不核销。
    if (order.payStatus !== 'unpaid') {
      throw new BadRequestException({ error: { code: 'ORDER_NOT_REDEEMABLE', message: '订单当前不可核销抵扣' } })
    }
    if (order.amountCents <= 0) {
      throw new BadRequestException({ error: { code: 'REDEEM_NOT_REQUIRED', message: '免费单无需核销' } })
    }

    const discountCents = order.amountCents // 全额核销（本波不接部分抵扣）

    // ① 核销账本（order-linked）：serviceType='order_redeem' / serviceRefId=orderId → 一单一核销。
    const redeem = await this.redeem({
      endUserId,
      benefitGrantId,
      serviceType: 'order_redeem',
      serviceRefId: orderId,
      orderId,
      amountCents: discountCents,
    })

    // ② 免费单联动：全额核销 → Order 置 paid(voucher) + pickupCode + 审计（幂等，可安全重试收敛）。
    const paidOrder = await this.orderStatus.markPaidByRedemption(orderId, {
      discountCents,
      benefitRef: benefitGrantId,
      operatorId: endUserId,
    })

    return {
      orderId,
      redemptionRecordId: redeem.redemptionRecordId,
      payStatus: paidOrder.payStatus,
      discountCents,
      idempotent: redeem.idempotent,
    }
  }

  private async redeemOnce(params: RedeemBenefitParams, idempotencyKey: string): Promise<RedeemBenefitResult> {
    const { endUserId, benefitGrantId, serviceType, serviceRefId } = params

    const outcome = await this.prisma.$transaction(async (tx) => {
      // ① 幂等快路径：同 (grant+service+ref) 已存在 → 回放，不扣减。
      const existing = await tx.redemptionRecord.findUnique({ where: { idempotencyKey } })
      if (existing) {
        // 归属硬约束：replay 也必须校验本人，绝不把他人核销结果回放给非本人（不泄露 + 不越权）。
        if (existing.endUserId !== endUserId) {
          throw new NotFoundException({ error: { code: 'BENEFIT_GRANT_NOT_FOUND', message: '权益不存在或不属于本人' } })
        }
        const grant = await tx.benefitGrant.findUnique({ where: { id: benefitGrantId } })
        return { record: existing, grant, idempotent: true, decremented: false }
      }

      // ①b 一产物一核销：同一服务产物（serviceType+serviceRefId）已被**其他权益**核销 → 拒绝二次消费
      //     （同权益已在 ① 命中；此处命中的必是不同 grant，防止一次优化产物同时吃掉两个权益）。
      const redeemedForOutput = await tx.redemptionRecord.findFirst({ where: { serviceType, serviceRefId } })
      if (redeemedForOutput) {
        throw new ConflictException({
          error: { code: 'BENEFIT_OUTPUT_ALREADY_REDEEMED', message: '该服务已使用其他权益核销，不能重复核销' },
        })
      }

      // ② 读 grant + 校验归属 / 类型 / 状态 / 有效期 / 额度。
      const grant = await tx.benefitGrant.findUnique({ where: { id: benefitGrantId } })
      if (!grant || grant.endUserId !== endUserId) {
        throw new NotFoundException({ error: { code: 'BENEFIT_GRANT_NOT_FOUND', message: '权益不存在或不属于本人' } })
      }
      if (!(REDEEMABLE_BENEFIT_TYPES as readonly string[]).includes(grant.benefitType)) {
        // subsidy_eligibility_hint 等 info-only / 不可核销类型落这里。
        throw new BadRequestException({ error: { code: 'BENEFIT_NOT_REDEEMABLE', message: '该权益类型不支持核销' } })
      }
      if (grant.status !== 'active') {
        throw new ConflictException({ error: { code: 'BENEFIT_NOT_ACTIVE', message: '权益当前不可用' } })
      }
      const now = new Date()
      if (grant.validFrom && grant.validFrom.getTime() > now.getTime()) {
        throw new ConflictException({ error: { code: 'BENEFIT_NOT_STARTED', message: '权益未到生效时间' } })
      }
      if (grant.validUntil && grant.validUntil.getTime() < now.getTime()) {
        throw new ConflictException({ error: { code: 'BENEFIT_EXPIRED', message: '权益已过期' } })
      }
      if (grant.quantityRemaining === null) {
        throw new BadRequestException({ error: { code: 'BENEFIT_NOT_QUANTIFIED', message: '该权益无可核销额度' } })
      }

      // ③ CAS 扣减：只在 quantityRemaining>0 且仍 active 时成功；count!==1 表示并发用尽 / 状态变更。
      const updated = await tx.benefitGrant.updateMany({
        where: { id: benefitGrantId, status: 'active', quantityRemaining: { gt: 0 } },
        data: { quantityRemaining: { decrement: 1 } },
      })
      if (updated.count !== 1) {
        throw new ConflictException({ error: { code: 'BENEFIT_USED_UP', message: '权益次数已用完' } })
      }

      // ④ 读回新余量，用尽则置 used_up。
      const after = await tx.benefitGrant.findUnique({ where: { id: benefitGrantId } })
      const remaining = after?.quantityRemaining ?? 0
      let finalStatus = after?.status ?? 'active'
      if (remaining <= 0) {
        const usedUp = await tx.benefitGrant.update({ where: { id: benefitGrantId }, data: { status: 'used_up' } })
        finalStatus = usedUp.status
      }

      // ⑤ 落核销记录（唯一 idempotencyKey；并发丢失方在此命中 P2002 → 事务回滚）。
      //    order-linked（C5-4）：orderId + amountCents 由 params 回填；服务点位（resume）缺省 null/0。
      const record = await tx.redemptionRecord.create({
        data: {
          endUserId,
          orderId: params.orderId ?? null, // 服务点位恒 null；C5-4 订单核销回填 orderId
          kind: grant.benefitType,
          benefitRef: benefitGrantId,
          serviceType,
          serviceRefId,
          quantity: 1,
          amountCents: params.amountCents ?? 0, // 服务点位恒 0（非资金）；C5-4 写抵扣额
          idempotencyKey,
        },
      })

      return {
        record,
        grant: { quantityRemaining: remaining, status: finalStatus },
        idempotent: false,
        decremented: true,
      }
    })

    // 审计：只有真实扣减（非幂等回放）才写核销审计，回放不重复记账。
    if (!outcome.idempotent) {
      await this.audit.write({
        actorId: null,
        actorRole: 'end_user',
        action: 'benefit.redeem',
        targetType: 'BenefitGrant',
        targetId: benefitGrantId,
        payload: {
          endUserId,
          redemptionRecordId: outcome.record.id,
          serviceType,
          serviceRefId,
          kind: outcome.record.kind,
          // C5-4 order-linked：审计带 orderId + 抵扣额，便于对账（非资金，券=平台 credit）。
          orderId: params.orderId ?? null,
          amountCents: params.amountCents ?? 0,
          quantityRemaining: outcome.grant?.quantityRemaining ?? null,
          status: outcome.grant?.status ?? 'active',
        },
      })
    }

    return {
      redemptionRecordId: outcome.record.id,
      benefitGrantId,
      quantityRemaining: outcome.grant?.quantityRemaining ?? null,
      status: outcome.grant?.status ?? 'active',
      idempotent: outcome.idempotent,
    }
  }

  /**
   * 并发回放：按 idempotencyKey 读回赢家记录。仅当记录存在**且归属为本人**时返回幂等回放，
   * 否则返回 null（让调用方透传原始错误——不存在则非本 key 冲突，不属本人则不泄露他人核销）。
   */
  private async replayIfPresent(idempotencyKey: string, endUserId: string): Promise<RedeemBenefitResult | null> {
    const record = await this.prisma.redemptionRecord.findUnique({ where: { idempotencyKey } })
    if (!record || record.endUserId !== endUserId) return null
    const grant = await this.prisma.benefitGrant.findUnique({ where: { id: record.benefitRef } })
    return {
      redemptionRecordId: record.id,
      benefitGrantId: record.benefitRef,
      quantityRemaining: grant?.quantityRemaining ?? null,
      status: grant?.status ?? 'active',
      idempotent: true,
    }
  }
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
