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
