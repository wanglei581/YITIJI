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
import {
  REDEEMABLE_BENEFIT_TYPES,
  type RedeemBenefitParams,
  type RedeemBenefitResult,
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
  ) {}

  async redeem(params: RedeemBenefitParams): Promise<RedeemBenefitResult> {
    const { benefitGrantId, serviceType, serviceRefId } = params
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
      // 并发回放：另一请求已写入同 idempotencyKey（本请求扣减已随事务回滚）→ 读回既有记录返回幂等。
      if (isUniqueError(error)) {
        return await this.loadExisting(idempotencyKey, benefitGrantId)
      }
      throw error
    }
  }

  private async redeemOnce(params: RedeemBenefitParams, idempotencyKey: string): Promise<RedeemBenefitResult> {
    const { endUserId, benefitGrantId, serviceType, serviceRefId } = params

    const outcome = await this.prisma.$transaction(async (tx) => {
      // ① 幂等快路径：同 key 已存在 → 回放，不扣减。
      const existing = await tx.redemptionRecord.findUnique({ where: { idempotencyKey } })
      if (existing) {
        const grant = await tx.benefitGrant.findUnique({ where: { id: benefitGrantId } })
        return { record: existing, grant, idempotent: true, decremented: false }
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
      const record = await tx.redemptionRecord.create({
        data: {
          endUserId,
          orderId: null, // 本批恒 null（平台 credit，无 Order）
          kind: grant.benefitType,
          benefitRef: benefitGrantId,
          serviceType,
          serviceRefId,
          quantity: 1,
          amountCents: 0, // 本批恒 0（非资金）
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

  /** 并发回放兜底：按 idempotencyKey 读回赢家记录 + 当前权益快照。 */
  private async loadExisting(idempotencyKey: string, benefitGrantId: string): Promise<RedeemBenefitResult> {
    const record = await this.prisma.redemptionRecord.findUnique({ where: { idempotencyKey } })
    const grant = await this.prisma.benefitGrant.findUnique({ where: { id: benefitGrantId } })
    if (!record) {
      // 理论不可达（isUniqueError 已保证存在）；防御性抛出，不静默造数据。
      throw new ConflictException({ error: { code: 'REDEEM_CONFLICT', message: '核销冲突，请重试' } })
    }
    return {
      redemptionRecordId: record.id,
      benefitGrantId,
      quantityRemaining: grant?.quantityRemaining ?? null,
      status: grant?.status ?? 'active',
      idempotent: true,
    }
  }
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
