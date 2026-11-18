/**
 * 过期尝试的成功回调。金额和订单不一致时仍走原来的改价退款。
 * 金额一致、但这单已经不能再入账（已经付过、正在退、窗口已关）时，按尝试金额退，不能把钱停在没有退款行的地方。
 * 金额一致、订单还是未付且窗口还开着：返回 continue，由原来的入账把这单做成已付。
 */
import type { PrismaService } from '../prisma/prisma.service'
import type { PaymentProviderRegistry } from './payment-provider.factory'
import { isPickupWindowClosed } from './order-status.service'
import {
  refundExpiredAttemptCollection,
  settleStaleRepricedCollection,
  type StaleAttemptCallback,
} from './stale-attempt-collection'

const CANNOT_BOOK = new Set(['paid', 'refunded', 'refunding', 'failed', 'partial_refunded'])

export async function settleUnfulfillableCallback(
  db: PrismaService,
  registry: PaymentProviderRegistry,
  input: StaleAttemptCallback & {
    pickupStatus: string
    pickupCodeExpiresAt: Date | null
    printTaskId: string | null
    pickupClaimedAt: Date | null
  },
): Promise<'settled' | 'mismatch' | 'continue'> {
  if (input.attemptAmountCents !== input.orderAmountCents) {
    const settled = await settleStaleRepricedCollection(db, registry, input)
    return settled ? 'settled' : 'mismatch'
  }
  if (input.result !== 'success' || input.attemptStatus !== 'expired') return 'continue'
  const windowClosed = isPickupWindowClosed({
    pickupStatus: input.pickupStatus,
    pickupCodeExpiresAt: input.pickupCodeExpiresAt,
    printTaskId: input.printTaskId,
    pickupClaimedAt: input.pickupClaimedAt,
    payStatus: input.payStatus,
  })
  if (!CANNOT_BOOK.has(input.payStatus) && !windowClosed) return 'continue'
  await refundExpiredAttemptCollection(db, registry, input)
  return 'settled'
}
