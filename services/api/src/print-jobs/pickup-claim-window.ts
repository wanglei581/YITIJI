import {
  isLiveKioskPickupLease,
  isPickupWindowClosed,
} from '../payment/order-status.service'
import { PICKUP_VALIDITY_FROM_PAYMENT_MS } from '../payment/pickup-validity'

/**
 * 取件窗口是否已关：未认领过期、付款已满 7 天，或 claimed 未付租约已过。
 * 核销判定与「我的订单」列表的 claimableHere 共用这一处，两边不会各算一套。
 */
export function isPickupClaimWindowClosed(
  order: {
    pickupCodeExpiresAt: Date | null
    pickupStatus: string
    printTaskId: string | null
    payStatus: string
    pickupClaimedAt: Date | null
    paidAt: Date | null
    pickupCodeHash: string | null
  },
  now: Date = new Date(),
): boolean {
  const paymentWindowClosed = Boolean(
    order.paidAt
    && order.pickupCodeHash
    && !isLiveKioskPickupLease(order, now)
    && order.paidAt.getTime() + PICKUP_VALIDITY_FROM_PAYMENT_MS <= now.getTime(),
  )
  return isPickupWindowClosed(order, now) || paymentWindowClosed
}
