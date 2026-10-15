// ============================================================
// 权益计价（订单金额抵扣的 SSOT）—— 纯函数，无 I/O、无 Prisma、无 Nest 依赖。
//
// 存在的理由：在补齐 amountCents / maxDiscountCents / serviceScope 之前，系统没有
// 「这张券值多少钱」的概念，redeemForOrder 只能取 discountCents = order.amountCents 整单免单
// （P0 资损，曾用 REDEEM_PRINT_ORDER_UNSUPPORTED 止血闸把打印订单核销整条关死）。
// 抵扣额的计算口径必须只有一处，且可单独推理 —— 因此独立成本模块，不散落在 service 里。
//
// 计算口径（三重约束，缺一不可）：
//   discountCents = min(面值 amountCents, 抵扣上限 maxDiscountCents ?? ∞, 订单应付 orderAmountCents)
//
// fail-closed 原则（金额相关一律从严）：
// - amountCents 为 null / 负数 / 非整数 → 拒（BENEFIT_NOT_VALUED）。**存量权益全是 null，
//   因此迁移后可抵扣集合仍是空集**，不会有任何券凭空获得抵扣能力。
// - serviceScope 非空且不含订单类型 → 拒（BENEFIT_SCOPE_MISMATCH），绝不跨服务乱抵。
//   null = 不限服务类型（当前 Order.type 只有 'print' 一种取值；限定语义留给多服务类型时启用）。
// - 抵扣额恒 <= 订单应付：券面值高于订单金额时按订单应付封顶，**不找零、不转结余、不退现**。
//
// 合规（CLAUDE.md §12 / compliance §8.5）：券 = 平台 credit，非资金、非真实收款、非可提现金额，
// 不得表述为补贴发放或退款到账。面值只表示「可抵扣的平台服务额度」。
// ============================================================

/** 计价三要素（BenefitGrant / BenefitActivity 同名列的结构子集）。 */
export interface BenefitValuation {
  amountCents: number | null
  maxDiscountCents: number | null
  serviceScope: string | null
}

/** 计价失败原因码（与 HTTP 层错误码一一对应，调用方负责包成 Nest 异常）。 */
export type BenefitValuationErrorCode =
  | 'BENEFIT_NOT_VALUED'
  | 'BENEFIT_SCOPE_MISMATCH'
  | 'BENEFIT_DISCOUNT_INVALID'

export type BenefitValuationResult =
  | { ok: true; discountCents: number }
  | { ok: false; code: BenefitValuationErrorCode; message: string }

/**
 * 解析 serviceScope（逗号分隔的订单类型白名单）。
 *
 * 返回 null 表示「不限服务类型」（字段为 null / 空串 / 只有分隔符和空白）。
 * 空白与大小写在此归一，避免 " Print , " 这类录入把合法券判成范围不匹配。
 */
export function parseServiceScope(scope: string | null | undefined): string[] | null {
  if (!scope) return null
  const items = scope
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  return items.length > 0 ? items : null
}

/** 订单类型是否落在权益的适用范围内。scope 为 null（不限）时恒 true。 */
export function isScopeApplicable(scope: string | null | undefined, orderType: string): boolean {
  const allow = parseServiceScope(scope)
  if (allow === null) return true
  return allow.includes(orderType.trim().toLowerCase())
}

/**
 * 计算本次订单抵扣额（分）。
 *
 * @param valuation      权益的计价三要素
 * @param orderAmountCents 订单应付（分，> 0；调用方已排除免费单）
 * @param orderType      订单类型（Order.type，用于 serviceScope 校验）
 */
export function computeOrderDiscountCents(
  valuation: BenefitValuation,
  orderAmountCents: number,
  orderType: string,
): BenefitValuationResult {
  // ① 面值必须存在且是合法非负整数。null 是存量行的常态 —— 明确拒绝而不是当 0 或当无限。
  const face = valuation.amountCents
  if (face === null || face === undefined || !Number.isInteger(face) || face < 0) {
    return {
      ok: false,
      code: 'BENEFIT_NOT_VALUED',
      message: '该权益未定义面值，无法用于订单金额抵扣',
    }
  }

  // ② 适用范围校验先于金额计算：范围不匹配的券连算都不该算。
  if (!isScopeApplicable(valuation.serviceScope, orderType)) {
    return {
      ok: false,
      code: 'BENEFIT_SCOPE_MISMATCH',
      message: '该权益不适用于本类型订单',
    }
  }

  // ③ 抵扣上限：null = 不额外设限；非法值（负数 / 非整数）按异常数据拒绝，不静默忽略。
  const cap = valuation.maxDiscountCents
  if (cap !== null && cap !== undefined && (!Number.isInteger(cap) || cap < 0)) {
    return {
      ok: false,
      code: 'BENEFIT_DISCOUNT_INVALID',
      message: '该权益的抵扣上限配置异常，暂不可用',
    }
  }

  // ④ 三重取小：面值、上限、订单应付。封顶于订单应付 → 绝不出现负应付 / 找零 / 结余。
  const capped = cap === null || cap === undefined ? face : Math.min(face, cap)
  const discountCents = Math.min(capped, orderAmountCents)

  // ⑤ 抵扣额为 0 的券（面值 0 或上限 0）不构成一次有效核销：放行会白扣一次额度却不省钱。
  if (discountCents <= 0) {
    return {
      ok: false,
      code: 'BENEFIT_NOT_VALUED',
      message: '该权益可抵扣金额为 0，无法用于订单抵扣',
    }
  }

  return { ok: true, discountCents }
}
