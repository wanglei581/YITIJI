/**
 * 会员权益契约本地副本（Phase C-2C 底座）。
 *
 * **契约源**：packages/shared/src/types/memberBenefits.ts
 *
 * 为什么不直接 import @ai-job-print/shared：见 files/file.types.ts / member-favorites.types.ts。
 * 任何字段变更必须同时改 shared SSOT 与本副本。
 *
 * 合规（next-tasks §五）：subsidy_eligibility_hint 仅 info-only 资格提示，绝不出现
 * "补贴已到账 / 已发放金额"等承诺性文案；本类型不含任何支付凭证。
 */

export type BenefitType = 'coupon' | 'free_quota' | 'package_entitlement' | 'subsidy_eligibility_hint'

export type BenefitStatus = 'active' | 'used_up' | 'expired' | 'revoked'

export type BenefitSourceType = 'platform' | 'campus' | 'gov' | 'fair' | 'partner'

export interface MemberBenefitItem {
  id: string
  benefitType: BenefitType
  title: string
  description: string | null
  quantityTotal: number | null
  quantityRemaining: number | null
  status: BenefitStatus
  sourceType: BenefitSourceType
  validFrom: string | null
  validUntil: string | null
  createdAt: string
}

/**
 * 核销记录只读视图（Wave 3 — GET /me/benefits/redemptions）。
 *
 * 安全约束：
 * - 只返回本人（endUserId）的核销记录，后端 EndUserAuthGuard 保证。
 * - amountCents 代表本次核销抵扣的订单金额（平台 credit，非真实收款）；
 *   serviceType='order_redeem' 时有值；服务点位（AI简历优化等）恒 0。
 * - 不含任何支付凭证、密钥或跨用户信息。
 */
export interface MemberRedemptionItem {
  id: string
  /** 核销权益类型（coupon / free_quota / package_entitlement） */
  kind: string
  /** 关联 BenefitGrant id */
  benefitRef: string
  /** 核销场景：order_redeem / resume_optimize / print_task 等 */
  serviceType: string
  /** 场景产物 id（orderId / taskId 等） */
  serviceRefId: string
  /** 订单 id（serviceType=order_redeem 时有值，其余为 null） */
  orderId: string | null
  /** 本次核销抵扣金额（分，平台 credit；服务点位为 0）*/
  amountCents: number
  /** 核销数量（通常为 1） */
  quantity: number
  createdAt: string
}
