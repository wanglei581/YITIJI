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

/**
 * 我的核销记录（Wave 3）：会员名下一条 RedemptionRecord 只读视图。
 *
 * 安全约束：
 * - 后端 EndUserAuthGuard 保证只返回本人记录，跨用户越权天然不可能。
 * - amountCents 代表平台 credit 抵扣额（非资金、非真实收款）。
 * - 不含 idempotencyKey 等内部字段。
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
