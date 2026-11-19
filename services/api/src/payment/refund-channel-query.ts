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
import type { RefundQueryResult } from './payment-provider.types'
import type { RefundChannelVerdict } from './resolve-print-return-hold'

const logger = new Logger('RefundChannelQuery')

/** 查询过程自己抛错。error 要带到待人工诊断，不能只留一个 fault 字。 */
export type ChannelQueryFault = { verdict: 'fault'; error: unknown }

/**
 * 三步处置用的渠道结论。退款收敛不走这里，仍看 RefundQueryResult.status。
 * 只有官方文档写明这笔钱没退成的，才当失败：
 * - CLOSED：退款关闭。处理中超过 7 天且出资账户余额不足，请求已关闭，要换新单号再申请。
 *   https://pay.weixin.qq.com/doc/v3/partner/4013080623
 * - RESOURCE_NOT_EXISTS：受理失败，退款单不存在。原单原参数重试不会重复出款。
 *   https://pay.weixin.qq.com/doc/v3/partner/4014960215
 * ABNORMAL 是原路到银行卡失败后要人工处理，文档没有写钱已经确定没退出去，不当失败。
 * https://pay.weixin.qq.com/doc/v3/merchant/4012791884
 * 支付宝没返回 refund_status 时写的是「未收到或者退款失败」，两种可能，也不当失败。
 * https://opendocs.alipay.com/open-v3/b9ef37bd_alipay.trade.fastpay.refund.query
 */
export function classifyChannelRefundStatus(
  queried: Pick<RefundQueryResult, 'status' | 'refundState'>,
): 'success' | 'processing' | 'failed' | 'unknown' {
  if (queried.refundState === 'RESOURCE_NOT_EXISTS' || queried.refundState === 'CLOSED') return 'failed'
  if (queried.refundState === 'ABNORMAL') return 'unknown'
  if (
    queried.status === 'success'
    || queried.status === 'processing'
    || queried.status === 'failed'
    || queried.status === 'unknown'
  ) {
    return queried.status
  }
  return 'unknown'
}

function channelFaultText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = raw
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b1[3-9]\d{9}\b/g, '')
    .replace(/\b\d{17}[\dXx]\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return redacted || '查询渠道没有完成'
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
    return classifyChannelRefundStatus(queried)
  } catch (error) {
    logger.error(
      `查询退款渠道失败 orderId=${input.orderId} refundNo=${input.refundNo}：${channelFaultText(error)}`,
    )
    return { verdict: 'fault', error }
  }
}
