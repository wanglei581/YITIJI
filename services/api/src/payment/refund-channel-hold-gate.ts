/**
 * 渠道受理过、还没有明确失败答复时，三步都先问渠道。
 * 成功就改为记退成。失败先记下，再按点的那一步做。其余结果保持原状态并拒绝。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { refundMayStillBeAtChannel, type ChannelAcceptanceRefund } from './refund-channel-acceptance'
import { parkChannelQueryFault } from './refund-channel-query'
import { REFUND_AMOUNT_MISMATCH_MANUAL_REASON } from './refund-amount-hold'
import { PRINT_NO_PAPER_AUTO_FAILED_AUDIT } from './print-return-disposition'
import type { PendingRefundChannelQuery, PrintReturnResolution, RefundChannelVerdict } from './resolve-print-return-hold'

const OPEN_STATUSES = ['pending', 'manual_review'] as const
const BLOCKED_MESSAGE = '退款还在渠道处理中，结果出来前不能处置。'
const MISMATCH_MESSAGE = '渠道已经退成，但金额对不上，结果核对前不能处置。'

function deny(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

async function rejectUnconfirmed(
  db: PrismaService,
  orderId: string,
  action: PrintReturnResolution,
  operatorId: string,
  verdict: RefundChannelVerdict,
  message: string,
): Promise<never> {
  await db.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'admin',
      action: 'refund.hold_rejected',
      targetType: 'order',
      targetId: orderId,
      payloadJson: JSON.stringify({
        action,
        operatorId,
        code: 'REFUND_CHANNEL_UNCONFIRMED',
        channelVerdict: verdict,
        detail: message,
      }),
    },
  })
  throw deny('REFUND_CHANNEL_UNCONFIRMED', message)
}

/**
 * 通道没配上，退款行已经写成处理中，但请求没有离开本机。
 * 这种不是渠道受理过。超时、处理中才算可能已经交给渠道。
 */
async function providerRefundNeverLeft(
  db: PrismaService,
  orderId: string,
  refund: ChannelAcceptanceRefund,
): Promise<boolean> {
  if (refund.status !== 'pending' || refund.channelRefundNo) return false
  const audits = await db.auditLog.findMany({
    where: {
      targetId: orderId,
      action: { in: [PRINT_NO_PAPER_AUTO_FAILED_AUDIT, 'refund.channel_ambiguous', 'refund.processing'] },
    },
    select: { action: true, payloadJson: true },
  })
  if (audits.some((row) => row.action === 'refund.channel_ambiguous' || row.action === 'refund.processing')) {
    return false
  }
  return audits.some((row) => {
    if (row.action !== PRINT_NO_PAPER_AUTO_FAILED_AUDIT) return false
    try {
      const payload = JSON.parse(row.payloadJson) as { code?: string }
      return payload.code === 'ONLINE_PAYMENT_DISABLED'
    } catch {
      return false
    }
  })
}

/** 返回这一步真正要做的动作。渠道说成功时，不论点的是哪一步，都改成记退成。 */
export async function resolveChannelBeforeHold(
  db: PrismaService,
  orderId: string,
  action: PrintReturnResolution,
  operatorId: string,
  channelQuery: PendingRefundChannelQuery | undefined,
): Promise<PrintReturnResolution> {
  const rows = await db.refund.findMany({
    where: { orderId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    select: {
      refundNo: true,
      status: true,
      channel: true,
      reason: true,
      channelRefundNo: true,
    },
  })
  const refund = rows.find((row) => refundMayStillBeAtChannel(row))
  if (!refund) return action
  if (await providerRefundNeverLeft(db, orderId, refund)) return action
  // 订单已经关闭之后，渠道又通知退成，才会把已关闭的退款行搁成待人工并写下渠道退款号。
  // 这是渠道的成功答复，不是还在处理。不再查一次，直接记退成。金额不符仍要拦住。
  if (refund.status === 'manual_review' && refund.channelRefundNo) {
    const parked = await db.order.findUnique({
      where: { id: orderId },
      select: { payStatus: true, refundReason: true },
    })
    if (
      parked?.payStatus === 'closed'
      && parked.refundReason !== REFUND_AMOUNT_MISMATCH_MANUAL_REASON
    ) {
      return 'confirm_refunded'
    }
  }
  let verdict: RefundChannelVerdict = 'unsupported'
  let faultError: unknown = null
  if (channelQuery) {
    try {
      const raw = await channelQuery({ channel: refund.channel, refundNo: refund.refundNo, orderId })
      if (typeof raw === 'object') {
        verdict = raw.verdict
        faultError = raw.error
      } else {
        verdict = raw
      }
    } catch (error) {
      verdict = 'fault'
      faultError = error
    }
  }
  if (verdict === 'fault') {
    await parkChannelQueryFault(db, orderId, refund.refundNo, faultError)
  }
  if (verdict === 'failed') {
    const marked = await db.refund.updateMany({
      where: { refundNo: refund.refundNo, status: { in: [...OPEN_STATUSES] } },
      data: { status: 'failed' },
    })
    if (marked.count !== 1) {
      throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
    }
    return action
  }
  if (verdict === 'success') {
    const order = await db.order.findUnique({ where: { id: orderId }, select: { refundReason: true } })
    if (order?.refundReason === REFUND_AMOUNT_MISMATCH_MANUAL_REASON) {
      await rejectUnconfirmed(db, orderId, action, operatorId, verdict, MISMATCH_MESSAGE)
    }
    return 'confirm_refunded'
  }
  return rejectUnconfirmed(db, orderId, action, operatorId, verdict, BLOCKED_MESSAGE)
}
