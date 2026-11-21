/**
 * 24 小时内在途退款「只查不处置」入口（P2b9d 第 5 条，18:13 裁定）。
 * 逐笔向渠道查询并复用 recordChannelAnswers 把明确答复（成功/失败）落库；
 * 绝不自动改为出纸、绝不自动关单、绝不新开退款。
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { CHANNEL_ABNORMAL_DETAIL, parkAbnormalChannelRefund } from './refund-abnormal'
import { orderHasRefundAtChannel, refundMayStillBeAtChannel } from './refund-channel-acceptance'
import {
  CHANNEL_SUCCESS_PAPER_CONFLICT_CODE,
  recordChannelAnswers,
  type DefinitiveChannelAnswer,
} from './refund-channel-answer'
import { parkChannelQueryFault } from './refund-channel-query'
import type { PendingRefundChannelQuery, RefundChannelVerdict } from './resolve-print-return-hold'

export type ChannelQuerySummaryOutcome =
  | 'no_in_flight'
  | 'refunded'
  | 'failed'
  | 'processing'
  | 'abnormal'
  | 'unknown'
  | 'unsupported'
  | 'conflict'

export interface QueryPrintReturnChannelOutcome {
  orderId: string
  outcome: ChannelQuerySummaryOutcome
  payStatus: string
  refundStatus: string | null
  channelInFlight: boolean
  checkedCount: number
  message: string
}

const OPEN_STATUSES = ['pending', 'manual_review'] as const

type InFlightRow = { id: string; refundNo: string; status: string; channel: string; channelSubmittedAt: Date | null }
type Asked = {
  refund: InFlightRow
  verdict: RefundChannelVerdict
  error: unknown
  amountCents: number | null
  channelRefundNo: string | null
}

function exceptionBody(error: unknown): { code: string | null; message: string } {
  if (!(error instanceof BadRequestException)) return { code: null, message: '' }
  const body = error.getResponse() as { error?: { code?: string; message?: string } } | string
  if (typeof body === 'string') return { code: body, message: '' }
  return { code: body?.error?.code ?? null, message: body?.error?.message ?? '' }
}

async function askOne(
  channelQuery: PendingRefundChannelQuery | undefined,
  refund: InFlightRow,
  orderId: string,
): Promise<Asked> {
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

export async function queryPrintReturnChannel(
  db: PrismaService,
  orderId: string,
  operatorId: string,
  channelQuery?: PendingRefundChannelQuery,
): Promise<QueryPrintReturnChannelOutcome> {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { payStatus: true } })
  if (!order) throw new NotFoundException('ORDER_NOT_FOUND')

  const openRows = await db.refund.findMany({
    where: { orderId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, refundNo: true, status: true, channel: true, channelSubmittedAt: true },
  })
  const inFlight = openRows.filter((row) => refundMayStillBeAtChannel(row))
  if (inFlight.length === 0) {
    const latest = await db.refund.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' }, select: { status: true } })
    return {
      orderId,
      outcome: 'no_in_flight',
      payStatus: order.payStatus,
      refundStatus: latest?.status ?? null,
      channelInFlight: false,
      checkedCount: 0,
      message: '这单目前没有渠道在途退款，无需查询。请刷新后查看最新状态。',
    }
  }

  const answers: Asked[] = []
  for (const refund of inFlight) answers.push(await askOne(channelQuery, refund, orderId))

  const fault = answers.find((item) => item.verdict === 'fault')
  if (fault) await parkChannelQueryFault(db, orderId, fault.refund.refundNo, fault.error)

  for (const item of answers) {
    if (item.verdict !== 'abnormal') continue
    await parkAbnormalChannelRefund(db, {
      refundId: item.refund.id,
      refundNo: item.refund.refundNo,
      orderId,
      channelRefundNo: null,
      source: 'query',
    })
  }

  const definitive: DefinitiveChannelAnswer[] = []
  for (const item of answers) {
    if (item.verdict === 'failed') definitive.push({ refundNo: item.refund.refundNo, verdict: 'failed' })
    else if (item.verdict === 'success' && item.amountCents !== null) {
      definitive.push({
        refundNo: item.refund.refundNo,
        verdict: 'success',
        amountCents: item.amountCents,
        channelRefundNo: item.channelRefundNo,
      })
    }
  }

  let conflictMessage: string | null = null
  if (definitive.length > 0) {
    try {
      await recordChannelAnswers(db, orderId, definitive, operatorId)
    } catch (error) {
      const { code, message } = exceptionBody(error)
      if (code === CHANNEL_SUCCESS_PAPER_CONFLICT_CODE || code === 'REFUND_CHANNEL_AMOUNT_EXCEEDS') {
        conflictMessage = message || '渠道退款已成功并已记账，但与当前订单状态存在冲突，已转待人工核对，请勿重复退款。'
      } else {
        throw error
      }
    }
  }

  const [freshOrder, latestRefund, stillInFlight] = await Promise.all([
    db.order.findUniqueOrThrow({ where: { id: orderId }, select: { payStatus: true } }),
    db.refund.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' }, select: { status: true } }),
    orderHasRefundAtChannel(db, orderId),
  ])

  let outcome: ChannelQuerySummaryOutcome
  let message: string
  if (conflictMessage) {
    outcome = 'conflict'
    message = conflictMessage
  } else if (answers.some((item) => item.verdict === 'abnormal')) {
    outcome = 'abnormal'
    message = `${CHANNEL_ABNORMAL_DETAIL}处理完成后请再点「向渠道查询结果」收口。`
  } else if (answers.some((item) => item.verdict === 'processing')) {
    outcome = 'processing'
    message = '渠道还在处理这笔退款，结果出来前不能处置，请稍后再查。'
  } else if (answers.some((item) => item.verdict === 'success' && item.amountCents === null)) {
    outcome = 'unknown'
    message = '渠道说已经退成，但没有回报退款金额，核对前不能处置。'
  } else if (answers.some((item) => item.verdict === 'unknown')) {
    outcome = 'unknown'
    message = '渠道暂时查不到这笔退款结果，请稍后再查；满 24 小时仍查不到可按商户平台核实结果登记。'
  } else if (answers.some((item) => item.verdict === 'unsupported')) {
    outcome = 'unsupported'
    message = '该支付渠道不支持在线查询退款结果，请先在商户平台核实后按核实结果登记。'
  } else if (definitive.some((item) => item.verdict === 'success')) {
    outcome = 'refunded'
    message = freshOrder.payStatus === 'partial_refunded'
      ? '渠道已确认部分退成，已按渠道金额记账，请查看剩余可退金额。'
      : '渠道已确认退款成功，已按渠道金额记账。'
  } else {
    outcome = 'failed'
    message = stillInFlight
      ? '渠道确认该笔退款未退成，但本单仍有其他在途退款未结清。'
      : '渠道确认这笔退款未退成，已记为失败，现在可以按需处置。'
  }

  return {
    orderId,
    outcome,
    payStatus: freshOrder.payStatus,
    refundStatus: latestRefund?.status ?? null,
    channelInFlight: stillInFlight,
    checkedCount: inFlight.length,
    message,
  }
}
