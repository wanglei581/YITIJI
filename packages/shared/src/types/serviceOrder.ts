import type { MemberInvoiceStatus } from './memberPrintOrders'

/** 一体机按次付款的三项。打印仍走原来的打印订单，不进这张服务单。 */
export const SERVICE_ORDER_KEYS = ['resume_optimize', 'mock_interview', 'scan'] as const

export type ServiceOrderKey = (typeof SERVICE_ORDER_KEYS)[number]

export const SERVICE_ORDER_NAMES: Record<ServiceOrderKey, string> = {
  resume_optimize: 'AI 简历优化',
  mock_interview: 'AI 模拟面试',
  scan: '扫描',
}

export const SERVICE_ORDER_STATUSES = ['pending', 'paid', 'consumed', 'refunding', 'refunded', 'refund_failed', 'closed'] as const

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number]

/** 会员侧服务单列表可出现的状态（排除未付草稿 pending 与关闭单 closed）。 */
export const MEMBER_SERVICE_ORDER_STATUSES = ['paid', 'consumed', 'refunding', 'refunded', 'refund_failed'] as const

export type MemberServiceOrderStatus = (typeof MEMBER_SERVICE_ORDER_STATUSES)[number]

/** GET /api/v1/me/service-orders 单项（零 PII：不含税号/邮箱/抬头/支付流水/openid）。 */
export interface MemberServiceOrderItem {
  id: string
  serviceKey: ServiceOrderKey
  serviceName: string
  status: MemberServiceOrderStatus
  amountCents: number
  paidAt: string | null
  settledAt: string | null
  refundedAt: string | null
  refundReason: string | null
  createdAt: string
  canInvoice: boolean
  invoiceStatus: MemberInvoiceStatus
  invoiceRequestId: string | null
}

export interface MemberServiceOrderPage {
  items: MemberServiceOrderItem[]
  nextCursor: string | null
  total: number
}
