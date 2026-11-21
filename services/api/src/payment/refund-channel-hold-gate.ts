/**
 * 渠道受理过、还没有明确答复时，三步都先问渠道。
 * 订单上每一笔都问；全部有了明确答复才往下走，任何一笔还在途就整单拒绝、哪一笔都不改。
 * 渠道说失败：这一笔记失败，再按点的那一步做。
 * 渠道说成功：按渠道回报的金额记成成功、订单按合计记账；改为出纸、关单照实拒绝，不改写成「确认退成」。
 * 「渠道受理过」只看 Refund.channelSubmittedAt（显式记录），不再按原因、单号前缀或历史审计猜。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { CHANNEL_ABNORMAL_DETAIL, parkAbnormalChannelRefund } from './refund-abnormal'
import { CHANNEL_SUCCESS_PAPER_CONFLICT_CODE, recordChannelAnswers, type DefinitiveChannelAnswer } from './refund-channel-answer'
import { refundMayStillBeAtChannel } from './refund-channel-acceptance'
import { parkChannelQueryFault } from './refund-channel-query'
import type { PendingRefundChannelQuery, PrintReturnResolution, RefundChannelVerdict } from './resolve-print-return-hold'

const OPEN_STATUSES = ['pending', 'manual_review'] as const
const BLOCKED_MESSAGE = '退款还在渠道处理中，结果出来前不能处置。'
const AMOUNT_UNKNOWN_MESSAGE = '渠道说已经退成，但没有回报退款金额，核对前不能处置。'
const ABNORMAL_MESSAGE = `${CHANNEL_ABNORMAL_DETAIL}结果出来前不能处置。`

function deny(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

function exceptionCode(error: unknown): string | null {
  if (!(error instanceof BadRequestException)) return null
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? null
}

async function auditRejected(
  db: PrismaService,
  orderId: string,
  action: PrintReturnResolution,
  operatorId: string,
  fact: { code: string; refundNo: string | null; verdict: RefundChannelVerdict; detail: string },
): Promise<void> {
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
        code: fact.code,
        refundNo: fact.refundNo,
        channelVerdict: fact.verdict,
        detail: fact.detail,
      }),
    },
  })
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
  const code = 'REFUND_CHANNEL_UNCONFIRMED'
  await auditRejected(db, orderId, action, operatorId, { code, refundNo, verdict, detail: message })
  throw deny(code, message)
}

type InFlightRefund = { id: string; refundNo: string; status: string; channel: string; channelSubmittedAt: Date | null }
type ChannelAnswer = {
  refund: InFlightRefund
  verdict: RefundChannelVerdict
  error: unknown
  amountCents: number | null
  channelRefundNo: string | null
}

async function askChannel(
  channelQuery: PendingRefundChannelQuery | undefined,
  refund: InFlightRefund,
  orderId: string,
): Promise<ChannelAnswer> {
  const blank = { refund, error: null, amountCents: null, channelRefundNo: null }
  if (!channelQuery) return { ...blank, verdict: 'unsupported' }
  try {
    const raw = await channelQuery({ channel: refund.channel, refundNo: refund.refundNo, orderId })
    if (typeof raw !== 'object') return { ...blank, verdict: raw }
    if (raw.verdict === 'fault') return { ...blank, verdict: 'fault', error: raw.error }
    return { ...blank, verdict: 'success', amountCents: raw.refundAmountCents, channelRefundNo: raw.channelRefundNo }
  } catch (error) {
    return { ...blank, verdict: 'fault', error }
  }
}

/**
 * 返回这一步真正要做的动作；渠道已经退成时返回 channel_refunded，由调用方给出结果或照实拒绝。
 * 订单上每一笔渠道受理过、还没落定的退款都要问渠道。全部有了明确答复（成功或失败）才往下走；
 * 任何一笔还在途、查不到或查询出错，整单拒绝，哪一笔都不改状态。
 */
export async function resolveChannelBeforeHold(
  db: PrismaService,
  orderId: string,
  action: PrintReturnResolution,
  operatorId: string,
  channelQuery: PendingRefundChannelQuery | undefined,
): Promise<PrintReturnResolution | 'channel_refunded'> {
  const rows = await db.refund.findMany({
    where: { orderId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
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
  // 退款异常：钱停在渠道中间账户，记诊断、告警，照样不能处置。
  const abnormal = answers.find((answer) => answer.verdict === 'abnormal')
  if (abnormal) {
    await parkAbnormalChannelRefund(db, {
      refundId: abnormal.refund.id,
      refundNo: abnormal.refund.refundNo,
      orderId,
      channelRefundNo: null,
      source: 'hold',
    })
    return rejectUnconfirmed(db, orderId, action, operatorId, 'abnormal', ABNORMAL_MESSAGE, abnormal.refund.refundNo)
  }
  const open = answers.find((answer) => answer.verdict !== 'success' && answer.verdict !== 'failed')
  if (open) return rejectUnconfirmed(db, orderId, action, operatorId, open.verdict, BLOCKED_MESSAGE, open.refund.refundNo)
  const unpriced = answers.find((answer) => answer.verdict === 'success' && answer.amountCents === null)
  if (unpriced) return rejectUnconfirmed(db, orderId, action, operatorId, 'success', AMOUNT_UNKNOWN_MESSAGE, unpriced.refund.refundNo)
  const definitive: DefinitiveChannelAnswer[] = answers.map((answer) => answer.verdict === 'success'
    ? { refundNo: answer.refund.refundNo, verdict: 'success', amountCents: answer.amountCents ?? 0, channelRefundNo: answer.channelRefundNo }
    : { refundNo: answer.refund.refundNo, verdict: 'failed' })
  try {
    const paidBack = await recordChannelAnswers(db, orderId, definitive, operatorId)
    return paidBack ? 'channel_refunded' : action
  } catch (error) {
    const code = exceptionCode(error)
    if (code === 'REFUND_CHANNEL_AMOUNT_EXCEEDS' || code === CHANNEL_SUCCESS_PAPER_CONFLICT_CODE) {
      const detail = code === CHANNEL_SUCCESS_PAPER_CONFLICT_CODE
        ? '纸已经放行或已出纸，渠道退款成功事实已记账，冲突已转待人工核对'
        : '渠道回报的退款合计超过这单实付，渠道退款成功事实已记账，冲突已转待人工核对'
      await auditRejected(db, orderId, action, operatorId, { code, refundNo: null, verdict: 'success', detail })
    }
    throw error
  }
}
