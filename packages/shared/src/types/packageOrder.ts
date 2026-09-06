import type { ColorMode, DuplexMode, PrintTaskStatus } from './print'
import type { OrderPayStatus } from './payment'

/** 材料包逐行履约快照。价格、页数、状态均来自服务端，不由小程序推断。 */
export interface PackageOrderItem {
  seq: number
  fileId: string
  colorMode: ColorMode
  duplex: DuplexMode
  copies: number
  pageRange: string | null
  billablePages: number
  amountCents: number
  status: PrintTaskStatus
  printTaskId: string | null
}

export interface PackageOrderView {
  orderId: string
  orderNo: string
  pickupCode: string | null
  expiresAt: string | null
  pickupStatus: 'pending' | 'claimed' | 'used' | 'expired' | 'cancelled' | 'none'
  payStatus: OrderPayStatus
  taskStatus: string
  amountCents: number
  paymentSessionToken: string
  items: PackageOrderItem[]
}
