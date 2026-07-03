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

/**
 * 订单支付状态（对齐 `Order.payStatus`）。注意 `cancelled` 属 `Order.taskStatus`，不是 payStatus。
 * C5-2 线上态：`paying`（已出码待支付）/ `closed`（超时关单）；线下与免费单不进这两态。
 */
export type OrderPayStatus = 'unpaid' | 'paying' | 'paid' | 'refunded' | 'failed' | 'closed'

/**
 * 支付来源 —— 表示资金性质，绝不伪装线上真实收款：
 * offline（线下收款）/ free（免费单）/ manual_confirmed（管理员人工确认）/
 * sandbox（C5-2 沙箱测试通道入账，**非真实资金**，只能由回调成功入账路径写入）。
 * `wechat` / `alipay` / `benefit` 为未来扩展（C5-6 / C5-4），**继续按名禁止写入**。
 */
export type PaymentSource = 'offline' | 'free' | 'manual_confirmed' | 'sandbox'

/** P0a 允许写入的 paymentSource 白名单（线下路径状态机与 verify 共用，避免各处硬编码）。 */
export const P0A_ALLOWED_PAYMENT_SOURCES: readonly PaymentSource[] = ['offline', 'free', 'manual_confirmed'] as const

/**
 * C5-2 线上支付通道白名单（同时是线上入账 paymentSource 的唯一合法取值）。
 * 本波只有 sandbox；wechat / alipay 到 C5-6 真实渠道适配才允许出现。
 */
export type PaymentChannel = 'sandbox'
export const C52_ONLINE_PAYMENT_CHANNELS: readonly PaymentChannel[] = ['sandbox'] as const

/** 支付尝试状态（对齐 `PaymentAttempt.status`）。 */
export type PaymentAttemptStatus = 'created' | 'pending' | 'success' | 'failed' | 'expired'

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
