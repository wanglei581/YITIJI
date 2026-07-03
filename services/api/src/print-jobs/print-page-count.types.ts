/**
 * 打印计费页数契约本地副本（P0a 支付域）。
 *
 * **契约源**：packages/shared/src/types/payment.ts（`BillingPageSource`）
 *
 * 为什么不直接 import @ai-job-print/shared：services/api 走 commonjs + node
 * moduleResolution，而 packages/shared 的 exports 直指 .ts，互操作复杂 —— 见 files/file.types.ts。
 * 任何字段变更必须同时改两处：
 *   1. packages/shared/src/types/payment.ts（前端 SSOT）
 *   2. 本文件（后端副本）
 */

/** 计费页数来源（与 shared `BillingPageSource` 保持一致）。 */
export type BillingPageSource = 'pdf_lightweight_scan' | 'image_single_page'

/** 后端识别出的计费页数结果。 */
export interface PrintPageCount {
  billablePages: number
  billingPageSource: BillingPageSource
}
