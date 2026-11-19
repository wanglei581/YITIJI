/**
 * 长期查不到渠道结果时的出路：按商户平台核实结果登记（第 8 条）。
 *
 * 能登记的：渠道受理过、还没落定的那一笔，并且渠道不支持在线查询，或已经提交渠道满 24 小时还没有答复。
 * 登记之前先问一次渠道：渠道这时给了明确答复（退成或失败）就按渠道答复记，不用这次登记；
 * 渠道说退款异常、还在处理，或查询出错，都不能登记；只有查不到（unknown / 不支持）才按登记记。
 * 必须重输订单号确认。登记结果和渠道答复走同一条路径：
 * 「渠道已退成」按这笔退款的金额记成成功、订单按合计记账（第 3 条）；
 * 「渠道确认没退出去」记失败、订单离开退款中（第 7 条），之后三步照常。登记审计写操作人与依据。
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { CHANNEL_ABNORMAL_DETAIL, parkAbnormalChannelRefund } from './refund-abnormal'
import { recordChannelAnswers, type ChannelResultRegistration } from './refund-channel-answer'
import { refundMayStillBeAtChannel } from './refund-channel-acceptance'
import { parkChannelQueryFault } from './refund-channel-query'
import type { PendingRefundChannelQuery } from './resolve-print-return-hold'

export const CHANNEL_REGISTRATION_AFTER_MS = 24 * 60 * 60 * 1000
/** 代码里实现了在线查退款的渠道。后台详情据此估登记入口；接口按当时注册的渠道再判一次。 */
export const REFUND_QUERY_CHANNELS = new Set(['wechat', 'alipay'])

function deny(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

export function channelRegistrationOpen(
  refund: { status: string; channelSubmittedAt: Date | null },
  supportsQuery: boolean,
  now: Date = new Date(),
): boolean {
  if (!refundMayStillBeAtChannel(refund) || !refund.channelSubmittedAt) return false
  if (!supportsQuery) return true
  return now.getTime() - refund.channelSubmittedAt.getTime() >= CHANNEL_REGISTRATION_AFTER_MS
}

/** 后台详情用：这单哪一笔现在可以按商户平台核实结果登记。没有就是 null。 */
export async function channelRegistrationEntry(
  db: PrismaService,
  orderId: string,
  now: Date = new Date(),
): Promise<{ refundNo: string; amountCents: number; submittedAt: string } | null> {
  const rows = await db.refund.findMany({
    where: { orderId, channelSubmittedAt: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { refundNo: true, amountCents: true, status: true, channel: true, channelSubmittedAt: true },
  })
  const open = rows.find((row) => channelRegistrationOpen(row, REFUND_QUERY_CHANNELS.has(row.channel), now))
  if (!open?.channelSubmittedAt) return null
  return { refundNo: open.refundNo, amountCents: open.amountCents, submittedAt: open.channelSubmittedAt.toISOString() }
}

export async function registerChannelResult(
  db: PrismaService,
  orderId: string,
  input: { refundNo: string; result: string; channelRefundNo?: string | null; note?: string | null; confirmOrderNo: string },
  operatorId: string,
  deps: { supportsQuery: (channel: string) => boolean; channelQuery: PendingRefundChannelQuery },
): Promise<{ orderId: string; payStatus: string; refundStatus: string; refundNo: string; amountCents: number; recordedBy: 'registration' | 'channel' }> {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { orderNo: true } })
  if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
  if (input.confirmOrderNo.trim() !== order.orderNo) {
    throw deny('REGISTRATION_ORDER_NO_MISMATCH', '重输的订单号和这张单对不上，没有登记。')
  }
  const refund = await db.refund.findFirst({
    where: { orderId, refundNo: input.refundNo },
    select: { refundNo: true, status: true, channel: true, amountCents: true, channelSubmittedAt: true, id: true },
  })
  if (!refund || !refundMayStillBeAtChannel(refund)) {
    throw deny('REGISTRATION_NOT_IN_FLIGHT', '这笔退款不在渠道处理中，不用登记。请刷新后再看。')
  }
  const supportsQuery = deps.supportsQuery(refund.channel)
  if (!channelRegistrationOpen(refund, supportsQuery)) {
    throw deny('REGISTRATION_TOO_EARLY', '渠道受理还不到 24 小时，先等渠道答复，到时再按商户平台核实结果登记。')
  }
  let registration: ChannelResultRegistration
  if (input.result === 'refunded') {
    const channelRefundNo = input.channelRefundNo?.trim() ?? ''
    if (!channelRefundNo || channelRefundNo.length > 64) {
      throw deny('REGISTRATION_INPUT_REQUIRED', '登记「渠道已退成」要填渠道退款单号（64 字以内）。')
    }
    registration = { result: 'refunded', channelRefundNo, note: input.note?.trim() || null }
  } else if (input.result === 'not_refunded') {
    const note = input.note?.trim() ?? ''
    if (note.length < 4 || note.length > 200) {
      throw deny('REGISTRATION_INPUT_REQUIRED', '登记「渠道确认没退出去」要写核实说明（4 到 200 字）。')
    }
    registration = { result: 'not_refunded', channelRefundNo: null, note }
  } else {
    throw deny('REGISTRATION_INPUT_REQUIRED', '请选登记结果：渠道已退成，或渠道确认没退出去。')
  }

  let recordedBy: 'registration' | 'channel' = 'registration'
  if (supportsQuery) {
    let raw: Awaited<ReturnType<PendingRefundChannelQuery>>
    try {
      raw = await deps.channelQuery({ channel: refund.channel, refundNo: refund.refundNo, orderId })
    } catch (error) {
      raw = { verdict: 'fault', error }
    }
    if (typeof raw === 'object' && raw.verdict === 'fault') await parkChannelQueryFault(db, orderId, refund.refundNo, raw.error)
    if (typeof raw === 'object' && raw.verdict === 'success') {
      if (raw.refundAmountCents === null) throw deny('REFUND_CHANNEL_UNCONFIRMED', '渠道说已经退成，但没有回报退款金额，核对前不能登记。')
      await recordChannelAnswers(db, orderId, [{ refundNo: refund.refundNo, verdict: 'success', amountCents: raw.refundAmountCents, channelRefundNo: raw.channelRefundNo }], operatorId)
      recordedBy = 'channel'
    } else if (raw === 'success') {
      throw deny('REFUND_CHANNEL_UNCONFIRMED', '渠道说已经退成，但没有回报退款金额，核对前不能登记。')
    } else if (raw === 'failed') {
      await recordChannelAnswers(db, orderId, [{ refundNo: refund.refundNo, verdict: 'failed' }], operatorId)
      recordedBy = 'channel'
    } else if (raw === 'abnormal') {
      await parkAbnormalChannelRefund(db, { refundId: refund.id, refundNo: refund.refundNo, orderId, channelRefundNo: null, source: 'hold' })
      throw deny('REFUND_CHANNEL_ABNORMAL', `${CHANNEL_ABNORMAL_DETAIL}不能按登记处理。`)
    } else if (raw === 'processing') {
      throw deny('REFUND_CHANNEL_UNCONFIRMED', '渠道说这笔退款还在处理，不能登记，等渠道答复。')
    }
  }
  if (recordedBy === 'registration') {
    await recordChannelAnswers(
      db,
      orderId,
      [registration.result === 'refunded'
        ? { refundNo: refund.refundNo, verdict: 'success', amountCents: refund.amountCents, channelRefundNo: registration.channelRefundNo }
        : { refundNo: refund.refundNo, verdict: 'failed' }],
      operatorId,
      registration,
    )
  }
  const freshOrder = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { payStatus: true } })
  const freshRefund = await db.refund.findUniqueOrThrow({ where: { refundNo: refund.refundNo }, select: { status: true, amountCents: true } })
  return {
    orderId,
    payStatus: freshOrder.payStatus,
    refundStatus: freshRefund.status,
    refundNo: refund.refundNo,
    amountCents: freshRefund.amountCents,
    recordedBy,
  }
}
