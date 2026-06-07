// ============================================================
// 会员权益 — 只读权益列表类型（Phase C-2C 底座）
//
// 本阶段只建模 + 只读列表；真实发放（活动 C-3 / 套餐 C-4）、核销 / 支付（C-5）后续接入。
//
// 合规约束（next-tasks §五 / compliance §八）:
// - 'subsidy_eligibility_hint' 只能是 info-only 资格提示：仅展示政策说明 / 材料清单 / 官方入口，
//   **绝不**出现"补贴已到账 / 已发放金额"等承诺性文案。
// - 券 / 套餐额度只代表"平台内服务 / 打印额度"，不代表录用结果，不承诺面试 / 录用 / 补贴到账。
// - 只返回归属本人（endUserId）的权益；跨用户、匿名一律拒绝（后端 EndUserAuthGuard）。
// - 不含任何支付凭证 / 密钥。
// ============================================================

/** 权益类型。 */
export type BenefitType =
  | 'coupon' // 优惠券
  | 'free_quota' // 免费次数额度
  | 'package_entitlement' // 套餐服务额度
  | 'subsidy_eligibility_hint' // 补贴资格提示（info-only）

/** 权益状态。 */
export type BenefitStatus = 'active' | 'used_up' | 'expired' | 'revoked'

/** 权益发放来源种类。 */
export type BenefitSourceType = 'platform' | 'campus' | 'gov' | 'fair' | 'partner'

/** 我的权益：会员名下一项权益（只读展示，无支付凭证）。 */
export interface MemberBenefitItem {
  /** BenefitGrant 行 id */
  id: string
  benefitType: BenefitType
  title: string
  description: string | null
  /** 额度类（free_quota / 多次券）总量；不适用时为 null */
  quantityTotal: number | null
  /** 额度类剩余；不适用时为 null */
  quantityRemaining: number | null
  status: BenefitStatus
  sourceType: BenefitSourceType
  /** 有效期起（可空） */
  validFrom: string | null
  /** 有效期止（可空） */
  validUntil: string | null
  createdAt: string
}
