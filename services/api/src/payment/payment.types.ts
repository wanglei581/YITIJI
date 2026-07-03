/**
 * 支付域契约本地副本（P0a）。
 *
 * **契约源**：packages/shared/src/types/payment.ts（`PrintPriceLine` / `PrintPriceBreakdown`）
 *
 * 为什么不直接 import @ai-job-print/shared：services/api 走 commonjs + node
 * moduleResolution，packages/shared 的 exports 直指 .ts，互操作复杂 —— 见 files/file.types.ts。
 * 任何字段变更须同时改两处：packages/shared 与本文件。
 *
 * 金额一律整数「分」，绝不用浮点。
 */
import type { BillingPageSource } from '../print-jobs/print-page-count.types'

/** 单条计费明细（单位：分）。 */
export interface PrintPriceLine {
  /** 价目项键，如 print_bw_page / print_color_page。 */
  serviceKey: string
  /** 单价（分），>= 0。 */
  unitCents: number
  /** 数量（页×份）。 */
  quantity: number
  /** 小计（分）= unitCents × quantity。 */
  subtotalCents: number
  /** 可选说明。 */
  description?: string
}

/**
 * 打印报价结果（PricingService 输出）：金额明细 + 后端识别的计费页数。
 * `amountCents` = 各 line.subtotalCents 之和（本批单行）。绝不信任前端金额。
 */
export interface PrintPriceQuote {
  amountCents: number
  billablePages: number
  billingPageSource: BillingPageSource
  lines: PrintPriceLine[]
}
