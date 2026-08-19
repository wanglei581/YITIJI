export interface AdminOrderReadonlyPrintSummary {
  fileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  duplex: string | null
  paperSize: string | null
  pageRange: string | null
}

export type AdminOrderAftercareStatus = 'manual_check_required' | null

export interface AdminOrderReadonlyItem {
  id: string
  orderNo: string
  type: string
  ownerType: 'member' | 'anonymous'
  userLabel: string
  terminalCode: string | null
  amountCents: number
  currency: string
  /** 下单渠道：kiosk | miniapp_cloud；null = 存量单无法可靠判定，前端显示「未标注」 */
  channel: string | null
  /** 取件状态：none | pending | claimed | used | expired | cancelled；一体机单恒 none */
  pickupStatus: string
  /** 取件码过期时间（ISO）；仅小程序云单有值 */
  pickupCodeExpiresAt: string | null
  payStatus: string
  taskStatus: string
  printFileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
  errorCode: string | null
  /** 管理员现场核查：null = 未核查；printed / not_printed 与 errorCode 正交。 */
  printOutcome: 'printed' | 'not_printed' | null
  aftercareStatus: AdminOrderAftercareStatus
  refundEligible: boolean
  retryForbidden: boolean
  createdAt: string
  updatedAt: string
}

export interface AdminOrderStatusLogItem {
  fromStatus: string
  toStatus: string
  errorCode: string | null
  createdAt: string
}

export interface AdminOrderReadonlyDetail extends AdminOrderReadonlyItem {
  refundedAt: string | null
  refundReason: string | null
  /** PrintTask.id（废弃孤单入口使用；非文件链接，不含敏感内容）。 */
  printTaskId: string | null
  print: (AdminOrderReadonlyPrintSummary & {
    status: string
    createdAt: string
    completedAt: string | null
    errorCode: string | null
  }) | null
  statusLogs: AdminOrderStatusLogItem[]
}

export interface AdminOrderReadonlyPage {
  items: AdminOrderReadonlyItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}
