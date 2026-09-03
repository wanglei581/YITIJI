// 会员「我的打印订单」只读列表类型（Phase C-2C 后续小步）。
// 与 packages/shared/src/types/memberPrintOrders.ts 结构对齐（前后端契约 SSOT 见 shared）。
// 只含安全元数据，绝不含 fileUrl / fileMd5 / paramsJson 原文 / 内部错误信息。
// P0a 起补支付字段（关联 Order 才有值；历史无 Order 一律 null；无 live 网关，绝不为微信/支付宝）。
import type { OrderPayStatus, PaymentSource, PrintPriceLine } from '../payment/payment.types'
import type { BillingPageSource } from '../print-jobs/print-page-count.types'

export interface MemberPrintOrderItem {
  id: string
  status: string
  fileName: string | null
  createdAt: string
  completedAt: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  /**
   * 单双面（2026-09-02 补）。取值与 shared 的 `DuplexMode` 一致；
   * 历史 paramsJson 无该键时为 null（= 未记录，前端不得默认成「单面」）。
   */
  duplex: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge' | null
  paperSize: string | null
  // ── 支付字段（P0a，无 live 网关；可选以保持向后兼容）──
  amountCents?: number | null
  payStatus?: OrderPayStatus | null
  paymentSource?: PaymentSource | null
  billablePages?: number | null
  billingPageSource?: BillingPageSource | null
  /** 取件凭证码；仅 paid 且未退款/非终态时返回，否则 null（走 pickupCodeVisibleFor 门控）。 */
  pickupCode?: string | null
  // ── C5-4 只读退款/核销字段（会员只读展示；无任何操作入口）：无 Order 一律 null ──
  /** 已退金额累计（分）；未退款为 0，无 Order 为 null。 */
  refundedAmountCents?: number | null
  /** 券/权益核销抵扣额（分）；无抵扣为 0，无 Order 为 null。券=平台 credit，非资金。 */
  discountCents?: number | null
}

export type MemberPendingPrintStatus = 'pending' | 'claimed' | 'printing'

export type MemberPendingTaskResume =
  | {
      kind: 'payment'
      orderId: string
      orderNo: string
      amountCents: number
      priceLines: PrintPriceLine[]
      paymentSessionToken: string
    }
  | {
      kind: 'print-progress'
      orderId?: string
      orderNo?: string
      amountCents?: number
      paymentSessionToken?: string
    }

/** 当前登录会员可续办的真实打印任务；不包含文件地址、哈希或任意服务端路由。 */
export interface MemberPendingTaskItem {
  id: string
  type: 'print'
  status: MemberPendingPrintStatus
  payStatus: OrderPayStatus | null
  fileName: string | null
  updatedAt: string
  resume: MemberPendingTaskResume
}
