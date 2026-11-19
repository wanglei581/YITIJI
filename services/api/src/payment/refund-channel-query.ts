/**
 * 在途退款改为出纸之前，向渠道查这一笔的结果。
 * 没有查证能力时明确返回 unsupported，不把「没查」说成失败。
 * 渠道自己说未知，仍是 unknown。我们这边抛错是 fault，要记下来，退款状态保持原样。
 */
import { BadRequestException, Logger } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import type { PaymentProviderRegistry } from './payment-provider.factory'
import { notifyPrintReturnHold } from './print-return-alert'
import { PRINT_NO_PAPER_MANUAL_AUDIT } from './print-return-disposition'
import type { RefundChannelVerdict } from './resolve-print-return-hold'

const logger = new Logger('RefundChannelQuery')

/** 查询过程自己抛错。error 要带到待人工诊断，不能只留一个 fault 字。 */
export type ChannelQueryFault = { verdict: 'fault'; error: unknown }

function channelFaultText(error: unknown): string {
  const raw = error instanceof Error ? error.message : '查询渠道没有完成'
  return raw.replace(/\s+/g, ' ').slice(0, 120)
}

/** 查询本身失败。状态保持原样，写诊断，不放行这次处置。 */
export async function parkChannelQueryFault(
  db: PrismaService,
  orderId: string,
  refundNo: string,
  error: unknown,
): Promise<never> {
  const detail = `查询渠道时出错：${channelFaultText(error)}。退款状态保持原样，这次不能处置。`
  logger.error(`${detail} orderId=${orderId} refundNo=${refundNo}`)
  await db.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'admin',
      action: PRINT_NO_PAPER_MANUAL_AUDIT,
      targetType: 'order',
      targetId: orderId,
      payloadJson: JSON.stringify({ refundNo, detail }),
    },
  })
  await notifyPrintReturnHold(db, orderId)
  throw new BadRequestException({
    error: {
      code: 'REFUND_CHANNEL_QUERY_FAILED',
      message: '查询渠道时出错了，退款状态保持原样，这次不能处置。',
    },
  })
}

export async function queryRefundChannel(
  registry: PaymentProviderRegistry,
  db: PrismaService,
  input: { channel: string; refundNo: string; orderId: string },
): Promise<Exclude<RefundChannelVerdict, 'fault'> | ChannelQueryFault> {
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
  } catch (error) {
    logger.error(
      `查询退款渠道失败 orderId=${input.orderId} refundNo=${input.refundNo}：${channelFaultText(error)}`,
    )
    return { verdict: 'fault', error }
  }
}
