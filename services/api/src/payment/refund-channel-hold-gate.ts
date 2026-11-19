/**
 * 渠道受理过、还没有明确答复时，三步都先问渠道。
 * 成功就改为记退成。失败先记下，再按点的那一步做。其余结果保持原状态并拒绝。
 * 「渠道受理过」只看 Refund.channelSubmittedAt（显式记录），不再按原因、单号前缀或历史审计猜。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { refundMayStillBeAtChannel } from './refund-channel-acceptance'
import { parkChannelQueryFault } from './refund-channel-query'
import { REFUND_AMOUNT_MISMATCH_MANUAL_REASON } from './refund-amount-hold'
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
  refundNo: string | null = null,
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
        refundNo,
        channelVerdict: verdict,
        detail: message,
      }),
    },
  })
  throw deny('REFUND_CHANNEL_UNCONFIRMED', message)
}

type InFlightRefund = { refundNo: string; status: string; channel: string; channelSubmittedAt: Date | null }
type ChannelAnswer = { refund: InFlightRefund; verdict: RefundChannelVerdict; error: unknown }

async function askChannel(
  channelQuery: PendingRefundChannelQuery | undefined,
  refund: InFlightRefund,
  orderId: string,
): Promise<ChannelAnswer> {
  if (!channelQuery) return { refund, verdict: 'unsupported', error: null }
  try {
    const raw = await channelQuery({ channel: refund.channel, refundNo: refund.refundNo, orderId })
    if (typeof raw === 'object') return { refund, verdict: raw.verdict, error: raw.error }
    return { refund, verdict: raw, error: null }
  } catch (error) {
    return { refund, verdict: 'fault', error }
  }
}

/**
 * 返回这一步真正要做的动作。
 * 订单上每一笔渠道受理过、还没落定的退款都要问渠道。全部有了明确答复（成功或失败）才往下走；
 * 任何一笔还在途、查不到或查询出错，整单拒绝，哪一笔都不改状态。
 * 渠道说成功时，不论点的是哪一步，都改成记退成。
 */
export async function resolveChannelBeforeHold(
  db: PrismaService,
  orderId: string,
  action: PrintReturnResolution,
  operatorId: string,
  channelQuery: PendingRefundChannelQuery | undefined,
): Promise<PrintReturnResolution> {
  const rows = await db.refund.findMany({
    where: { orderId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'asc' },
    select: {
      refundNo: true,
      status: true,
      channel: true,
      channelSubmittedAt: true,
    },
  })
  // 不再按「订单已关、待人工、有渠道退款号」猜渠道已经答复过：这一组字段谁都能写下。
  // 渠道受理过、状态还没落定的，一律先问渠道。
  const inFlight = rows.filter((row) => refundMayStillBeAtChannel(row))
  if (inFlight.length === 0) return action
  const answers: ChannelAnswer[] = []
  for (const refund of inFlight) answers.push(await askChannel(channelQuery, refund, orderId))
  const fault = answers.find((answer) => answer.verdict === 'fault')
  if (fault) await parkChannelQueryFault(db, orderId, fault.refund.refundNo, fault.error)
  const open = answers.find((answer) => answer.verdict !== 'success' && answer.verdict !== 'failed')
  if (open) return rejectUnconfirmed(db, orderId, action, operatorId, open.verdict, BLOCKED_MESSAGE, open.refund.refundNo)
  if (answers.some((answer) => answer.verdict === 'success')) {
    const order = await db.order.findUnique({ where: { id: orderId }, select: { refundReason: true } })
    if (order?.refundReason === REFUND_AMOUNT_MISMATCH_MANUAL_REASON) {
      await rejectUnconfirmed(db, orderId, action, operatorId, 'success', MISMATCH_MESSAGE)
    }
    return 'confirm_refunded'
  }
  for (const answer of answers) {
    const marked = await db.refund.updateMany({
      where: { refundNo: answer.refund.refundNo, status: { in: [...OPEN_STATUSES] } },
      data: { status: 'failed' },
    })
    if (marked.count !== 1) {
      throw deny('REFUND_HOLD_ALREADY_RESOLVED', '这笔待人工退款刚刚已经被处理，请刷新后再看。')
    }
  }
  return action
}
