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
 * C5-4 退款态：`refunding`（退款处理中）/ `refunded`（已全额退款）/ `partial_refunded`
 *   （部分退款，**本波仅类型/状态机预留，不接部分退款动作**）。
 * C5-3 出纸门控口径：**只有 paid 可 claim 出纸**；refunding/partial_refunded/refunded 一律不放行。
 */
export type OrderPayStatus =
  | 'unpaid'
  | 'paying'
  | 'paid'
  | 'refunding'
  | 'partial_refunded'
  | 'refunded'
  | 'failed'
  | 'closed'

/**
 * 支付来源 —— 表示资金性质，绝不伪装线上真实收款：
 * offline（线下收款）/ free（免费单）/ manual_confirmed（管理员人工确认）/
 * sandbox（C5-2 沙箱测试通道入账，**非真实资金**，只能由回调成功入账路径写入）/
 * voucher（C5-4 券/免费次数/权益全额核销单，**非资金**，只能由核销路径 markPaidByRedemption 写入）。
 * `wechat` / `alipay` / `benefit` 为未来扩展（C5-6），**继续按名禁止写入**。
 */
export type PaymentSource = 'offline' | 'free' | 'manual_confirmed' | 'sandbox' | 'voucher'

/** P0a 允许写入的 paymentSource 白名单（**markPaid 线下路径**专用，voucher/sandbox 各有独立入账路径，禁经 markPaid 写）。 */
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
