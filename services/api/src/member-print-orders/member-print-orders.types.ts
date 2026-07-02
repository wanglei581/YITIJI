// 会员「我的打印订单」只读列表类型（Phase C-2C 后续小步）。
// 与 packages/shared/src/types/memberPrintOrders.ts 结构对齐（前后端契约 SSOT 见 shared）。
// 只含安全元数据，绝不含 fileUrl / fileMd5 / paramsJson 原文 / 内部错误信息。
// P0a 起补支付字段（关联 Order 才有值；历史无 Order 一律 null；无 live 网关，绝不为微信/支付宝）。
import type { OrderPayStatus, PaymentSource } from '../payment/payment.types'
import type { BillingPageSource } from '../print-jobs/print-page-count.types'

export interface MemberPrintOrderItem {
  id: string
  status: string
  fileName: string | null
  createdAt: string
  completedAt: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
// 面向用户的安全失败原因（仅失败订单非 null）；由内部 errorCode 白名单映射，绝不透出原始错误。
  failureReasonForUser: string | null

  // ── 支付字段（P0a，无 live 网关；可选以保持向后兼容）──
  amountCents?: number | null
  payStatus?: OrderPayStatus | null
  paymentSource?: PaymentSource | null
  billablePages?: number | null
  billingPageSource?: BillingPageSource | null
  /** 取件凭证码；仅 paid 且未退款/非终态时返回，否则 null（走 pickupCodeVisibleFor 门控）。 */
  pickupCode?: string | null
}
