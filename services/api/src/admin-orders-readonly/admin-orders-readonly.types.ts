export interface AdminOrderReadonlyPrintSummary {
  fileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  duplex: string | null
  paperSize: string | null
  pageRange: string | null
}

export interface AdminOrderReadonlyItem {
  id: string
  orderNo: string
  type: string
  printTaskId: string | null
  ownerType: 'member' | 'anonymous'
  userLabel: string
  terminalCode: string | null
  amountCents: number
  currency: string
  payStatus: string
  taskStatus: string
  printFileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
  errorCode: string | null
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
