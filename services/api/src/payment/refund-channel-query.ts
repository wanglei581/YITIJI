/**
 * 在途退款改为出纸之前，向渠道查这一笔的结果。
 * 没有查证能力时明确返回 unsupported，不把「没查」说成失败。
 */
import type { PrismaService } from '../prisma/prisma.service'
import type { PaymentProviderRegistry } from './payment-provider.factory'
import type { RefundChannelVerdict } from './resolve-print-return-hold'

export async function queryRefundChannel(
  registry: PaymentProviderRegistry,
  db: PrismaService,
  input: { channel: string; refundNo: string; orderId: string },
): Promise<RefundChannelVerdict> {
  const provider = registry.get(input.channel)
  if (!provider?.queryRefund) return 'unsupported'
  const attempt = await db.paymentAttempt.findFirst({
    where: { orderId: input.orderId, channel: input.channel, status: 'success' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  try {
    const queried = await provider.queryRefund({
      refundNo: input.refundNo,
      outTradeNo: attempt?.id ?? null,
    })
    if (
      queried.status === 'success'
      || queried.status === 'processing'
      || queried.status === 'failed'
      || queried.status === 'unknown'
    ) {
      return queried.status
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}
