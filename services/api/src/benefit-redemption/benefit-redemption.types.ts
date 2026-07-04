// ============================================================
// 权益核销 — 类型与常量（P1「我的页权益核销」，核销 SSOT）。
//
// 合规硬约束（compliance §8.5 / next-tasks C5-4 分工口径）：
// - 券 = 平台 credit，非资金、非真实收款、不承诺补贴到账。
// - 核销必须幂等 + 落库审计；本批只扣 BenefitGrant.quantityRemaining，不碰 Order/金额。
// - subsidy_eligibility_hint 为 info-only 政策资格提示，绝不可核销。
// ============================================================

/** 可核销的权益类型（对齐 BenefitType 中有额度的子集；subsidy_eligibility_hint 不可核销）。 */
export const REDEEMABLE_BENEFIT_TYPES = ['coupon', 'free_quota', 'package_entitlement'] as const
export type RedeemableBenefitType = (typeof REDEEMABLE_BENEFIT_TYPES)[number]

/** 本批接线的核销服务点位（只接 AI 简历优化；打印计费抵扣留 C5-4）。 */
/**
 * 核销服务点位：
 * - `resume_optimize`：P1 AI 简历优化（服务产物 = resume taskId，orderId 恒 null）。
 * - `order_redeem`：C5-4 订单抵扣（服务产物 = orderId，回填 orderId + amountCents 抵扣额）。
 */
export const REDEMPTION_SERVICE_TYPES = ['resume_optimize', 'order_redeem'] as const
export type RedemptionServiceType = (typeof REDEMPTION_SERVICE_TYPES)[number]

/** 核销入参（服务点位内部调用，endUserId 来自已认证会员，绝不接受任意 id）。 */
export interface RedeemBenefitParams {
  endUserId: string
  benefitGrantId: string
  serviceType: RedemptionServiceType
  /** 服务产物稳定 id（resume taskId / orderId），构成幂等键；调用方须保证稳定，不得临时造 id。 */
  serviceRefId: string
  /** C5-4 order-linked：回填 RedemptionRecord.orderId；服务点位（resume）缺省 → null。 */
  orderId?: string | null
  /** C5-4 order-linked：抵扣金额（分，>=0）写入 RedemptionRecord.amountCents；缺省 → 0（平台 credit 非资金）。 */
  amountCents?: number
}

/** 核销结果（内部返回；不含金额/凭证）。 */
export interface RedeemBenefitResult {
  redemptionRecordId: string
  benefitGrantId: string
  /** 核销后剩余额度。 */
  quantityRemaining: number | null
  /** 核销后权益状态（active / used_up）。 */
  status: string
  /** true = 幂等回放（同一权益用于同一产物已核销过），未再次扣减。 */
  idempotent: boolean
}

/** C5-4 订单核销入参（券/免费次数/权益**全额抵扣一个订单**，联动免费单）。 */
export interface RedeemForOrderParams {
  endUserId: string
  orderId: string
  benefitGrantId: string
}

/** C5-4 订单核销结果（含订单联动结果）。 */
export interface RedeemForOrderResult {
  orderId: string
  redemptionRecordId: string
  /** 核销后订单支付状态（全额核销 → paid）。 */
  payStatus: string
  /** 抵扣金额（分）。 */
  discountCents: number
  /** true = 幂等回放（该订单已用该权益核销过）。 */
  idempotent: boolean
}
