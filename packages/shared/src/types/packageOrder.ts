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
  /** 到机码。可取，或失败后仍可续打时解密下发；否则 null。 */
  pickupCode: string | null
  /** 绑定的那台终端此刻用同一个到机码能否把失败任务拉回待打印。 */
  reprintAllowed: boolean
  /** 剩余自助续打次数（0–2）。没有任务，或没有到机码哈希，为 null。 */
  reprintRemaining: number | null
  expiresAt: string | null
  pickupStatus: 'pending' | 'claimed' | 'used' | 'expired' | 'cancelled' | 'none'
  payStatus: OrderPayStatus
  taskStatus: string
  amountCents: number
  paymentSessionToken: string
  items: PackageOrderItem[]
}
