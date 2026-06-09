// ============================================================
// Admin 订单管理返回契约（Sprint 1 / Task 2）。
//
// 数据源是 Order 表（Task 1 落地）+ 关联 PrintTask（打印参数 / 状态日志）。
//
// 合规（CLAUDE.md §10/§11/§12）：
//   - 这是线下打印运营订单，不涉招聘闭环。
//   - 不返回文件签名链接 / 文件哈希（fileUrl / fileMd5）等敏感串。
//   - userLabel 为脱敏展示标签（游客 / 昵称 / 会员），不回传手机号等 PII。
//   - 本阶段不接真实支付：amountCents 恒为 0，payStatus 默认 'unpaid'；
//     退款只置状态 + 原因，不发生真实资金流。
// ============================================================

export type AdminOrderType = 'print' | 'scan' | 'photo' | 'ai'
export type AdminPayStatus = 'unpaid' | 'paid' | 'refunded' | 'failed'
export type AdminTaskStatus =
  | 'pending' | 'claimed' | 'printing' | 'completed' | 'failed' | 'cancelled'

/** 列表行（安全字段）。 */
export interface AdminOrderListItem {
  id: string
  orderNo: string
  type: string
  endUserId: string | null
  /** 脱敏展示：endUserId 为空 → '游客'；有昵称 → 昵称；否则 '会员'。 */
  userLabel: string
  terminalId: string | null
  terminalCode: string | null
  amountCents: number
  currency: string
  payStatus: string
  taskStatus: string
  refundedAt: string | null
  createdAt: string
}

export interface AdminOrdersListResponse {
  items: AdminOrderListItem[]
  total: number
  limit: number
  offset: number
}

/** 关联 PrintTask 的打印参数 / 状态（从 paramsJson 安全解析，无文件正文/链接/哈希）。 */
export interface AdminOrderPrintDetail {
  status: string
  fileName: string | null
  copies: number | null
  colorMode: string | null
  duplex: string | null
  paperSize: string | null
  pageRange: string | null
  createdAt: string
  completedAt: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface AdminOrderStatusLog {
  fromStatus: string
  toStatus: string
  errorCode: string | null
  createdAt: string
}

export interface AdminOrderDetail extends AdminOrderListItem {
  refundReason: string | null
  updatedAt: string
  /** 关联打印任务；订单无对应 PrintTask（理论上不应发生）时为 null。 */
  print: AdminOrderPrintDetail | null
  statusLogs: AdminOrderStatusLog[]
}
