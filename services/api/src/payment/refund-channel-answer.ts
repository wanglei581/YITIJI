/**
 * 渠道对在途退款给了明确答复之后，先把答复记下来。答复是事实，记在处置事务之外。
 * - 失败：这一笔记失败，订单离开「退款中」（和退款明确失败的回滚同一口径：有更早成功退款回部分退款，
 *   迟到回调待退回关闭，其余回已付），之后按点的那一步往下做。只记退款行、订单留在退款中会让关单
 *   绕过「只退了一部分不能关单」，处置被拒后订单也会卡在退款中。
 * - 成功：按渠道回报的退款金额把这一笔记成成功并落库审计。渠道退成是事实，绝不因纸已出或
 *   非过期成功退款合计超应付而回滚该笔退款成功事实；遇冲突时保留 Refund.status = 'success'，
 *   写入冲突审计并触发告警，让订单进入/停留在冲突待人工核对态，不再引导二次退款。
 *   未冲突时订单按非过期成功退款的合计记账：合计等于应付记已退，小于应付记部分退。
 * 渠道已经退成时，改为出纸、关单照实拒绝，不改写成整单「确认退成」；确认退成直接给出记账后的结果。
 * 重复点击重新读库；每一笔都按「状态还没落定」做条件更新，已经记过的不再记。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { isOnlineCollectedRefundLock, ONLINE_PAID_PENDING_REFUND_REASON, payableCents } from './pending-refund-signal'
import { STALE_ATTEMPT_REFUND_REASON } from './print-no-paper-refund.constants'
import { notifyPrintReturnHold } from './print-return-alert'
import { markOrderIfPaperUnreleased } from './refund-paper-exclusion'
import { nonStaleSuccessCents, payStatusAfterRefundFailure } from './refund-remainder'
import type { PrintReturnResolution } from './resolve-print-return-hold'

export type DefinitiveChannelAnswer =
  | { refundNo: string; verdict: 'failed' }
  | { refundNo: string; verdict: 'success'; amountCents: number; channelRefundNo: string | null }

const OPEN_STATUSES = ['pending', 'manual_review']
const ORDER_KEPT_PAY_STATUSES = new Set(['unpaid', 'paying', 'closed'])
const ALREADY_RESOLVED = '这笔待人工退款刚刚已经被处理，请刷新后再看。'
export const CHANNEL_REFUNDED_CODE = 'REFUND_CHANNEL_REFUNDED'
export const CHANNEL_SUCCESS_CONFLICT_AUDIT = 'refund.channel_success_conflict'
export const CHANNEL_SUCCESS_PAPER_CONFLICT_CODE = 'REFUND_CHANNEL_SUCCESS_PAPER_CONFLICT'
const AMOUNT_EXCEEDS_CONFLICT_MESSAGE = '渠道退款已成功并已记账，但成功退款合计超过订单实付，已转待人工核对，请勿重复退款。'
const PAPER_RELEASED_CONFLICT_MESSAGE = '渠道退款已成功并已记账，但纸已经放行或已出纸，已转待人工核对，请勿重复退款。'

function deny(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

/** 返回 true 表示这次至少记下了一笔属于这单实付的成功退款。 */
/** 按商户平台核实结果登记（第 8 条）。登记和渠道答复走同一条记账路径，登记审计写在同一事务里。 */
export type ChannelResultRegistration = {
  result: 'refunded' | 'not_refunded'
  channelRefundNo: string | null
  note: string | null
}

export async function recordChannelAnswers(
  db: PrismaService,
  orderId: string,
  answers: DefinitiveChannelAnswer[],
  operatorId: string,
  registration?: ChannelResultRegistration,
): Promise<boolean> {
  const outcome = await db.$transaction(async (tx): Promise<{
    paidBack: boolean
    conflict: { code: string; message: string } | null
  }> => {
    if (registration) {
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'admin',
          action: 'refund.channel_result_registered',
          targetType: 'order',
          targetId: orderId,
          payloadJson: JSON.stringify({
            refundNos: answers.map((answer) => answer.refundNo),
            result: registration.result,
            channelRefundNo: registration.channelRefundNo,
            note: registration.note,
            operatorId,
            basis: '按商户平台核实结果登记',
          }),
        },
      })
    }
    let paidBack = false
    let refundReason: string | null = null
    const successRefundNos: string[] = []
    for (const answer of answers) {
      const row = await tx.refund.findUnique({
        where: { refundNo: answer.refundNo },
        select: { id: true, status: true, reason: true, amountCents: true, channelSubmittedAt: true },
      })
      if (!row || !row.channelSubmittedAt || !OPEN_STATUSES.includes(row.status)) {
        throw deny('REFUND_HOLD_ALREADY_RESOLVED', ALREADY_RESOLVED)
      }
      const marked = await tx.refund.updateMany({
        where: { id: row.id, status: { in: OPEN_STATUSES } },
        data: answer.verdict === 'failed'
          ? { status: 'failed' }
          : {
            status: 'success',
            amountCents: answer.amountCents,
            ...(answer.channelRefundNo ? { channelRefundNo: answer.channelRefundNo } : {}),
          },
      })
      if (marked.count !== 1) throw deny('REFUND_HOLD_ALREADY_RESOLVED', ALREADY_RESOLVED)
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'admin',
          action: 'refund.channel_answer',
          targetType: 'order',
          targetId: orderId,
          payloadJson: JSON.stringify({
            refundNo: answer.refundNo,
            verdict: answer.verdict,
            recordedAmountCents: row.amountCents,
            channelAmountCents: answer.verdict === 'success' ? answer.amountCents : null,
            operatorId,
            source: registration ? 'registration' : 'channel',
          }),
        },
      })
      if (answer.verdict === 'success' && row.reason !== STALE_ATTEMPT_REFUND_REASON) {
        paidBack = true
        refundReason = row.reason
        successRefundNos.push(answer.refundNo)
      }
    }
    if (!paidBack) {
      // 这单没有还在办的退款了，订单不能停在退款中。
      const stillOpen = await tx.refund.count({ where: { orderId, status: 'pending' } })
      if (stillOpen === 0 && answers.some((answer) => answer.verdict === 'failed')) {
        const current = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { refundReason: true, paymentSource: true, paidAt: true },
        })
        const restored = isOnlineCollectedRefundLock(current)
          ? { payStatus: 'closed', refundReason: ONLINE_PAID_PENDING_REFUND_REASON }
          : await payStatusAfterRefundFailure(tx, orderId)
        await tx.order.updateMany({ where: { id: orderId, payStatus: 'refunding' }, data: restored })
      }
      return { paidBack: false, conflict: null }
    }
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { payStatus: true, amountCents: true, discountCents: true, printTaskId: true },
    })
    const payable = payableCents(order)
    const total = await nonStaleSuccessCents(tx, orderId)
    if (payable > 0 && total > payable) {
      // 渠道退成事实绝不回滚：保留 Refund.status = 'success'，冲突写审计并走人工核对告警。
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'admin',
          action: CHANNEL_SUCCESS_CONFLICT_AUDIT,
          targetType: 'order',
          targetId: orderId,
          payloadJson: JSON.stringify({
            code: 'REFUND_CHANNEL_AMOUNT_EXCEEDS',
            refundNos: successRefundNos,
            totalSuccessCents: total,
            payableCents: payable,
            operatorId,
            source: registration ? 'registration' : 'channel',
            detail: AMOUNT_EXCEEDS_CONFLICT_MESSAGE,
          }),
        },
      })
      return {
        paidBack: true,
        conflict: { code: 'REFUND_CHANNEL_AMOUNT_EXCEEDS', message: AMOUNT_EXCEEDS_CONFLICT_MESSAGE },
      }
    }
    // 未付、支付中、已关闭的单只记退款行，不改订单支付状态（和确认退成同一口径）。
    if (ORDER_KEPT_PAY_STATUSES.has(order.payStatus)) return { paidBack: true, conflict: null }
    const fully = payable <= 0 || total >= payable
    const written = await markOrderIfPaperUnreleased(tx, db.dbKind, orderId, {
      payStatus: fully ? 'refunded' : 'partial_refunded',
      refundedAmountCents: total,
      refundReason,
      refundedAt: fully ? new Date() : null,
    })
    if (!written) {
      // 纸已经放行或已出纸，渠道退成事实仍保留不回滚；冲突另写审计并告警，不再引导二次退款。
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'admin',
          action: CHANNEL_SUCCESS_CONFLICT_AUDIT,
          targetType: 'order',
          targetId: orderId,
          payloadJson: JSON.stringify({
            code: CHANNEL_SUCCESS_PAPER_CONFLICT_CODE,
            refundNos: successRefundNos,
            totalSuccessCents: total,
            payableCents: payable,
            operatorId,
            source: registration ? 'registration' : 'channel',
            detail: PAPER_RELEASED_CONFLICT_MESSAGE,
          }),
        },
      })
      return {
        paidBack: true,
        conflict: { code: CHANNEL_SUCCESS_PAPER_CONFLICT_CODE, message: PAPER_RELEASED_CONFLICT_MESSAGE },
      }
    }
    if (fully && order.printTaskId) {
      const cancelled = await tx.printTask.updateMany({
        where: { id: order.printTaskId, status: 'pending', OR: [{ printOutcome: null }, { printOutcome: { not: 'printed' } }] },
        data: { status: 'cancelled', errorCode: 'REFUND_COMPLETED', errorMessage: '退款已经成功，不再出纸' },
      })
      if (cancelled.count === 1) {
        await tx.order.updateMany({ where: { id: orderId, taskStatus: 'pending' }, data: { taskStatus: 'cancelled' } })
      }
    }
    return { paidBack: true, conflict: null }
  })
  if (outcome.conflict) {
    await notifyPrintReturnHold(db, orderId)
    throw deny(outcome.conflict.code, outcome.conflict.message)
  }
  return outcome.paidBack
}

/** 渠道已经退成之后这一步的结果：确认退成给出记账结果；改为出纸、关单照实拒绝。 */
export async function channelRefundedOutcome(
  db: PrismaService,
  orderId: string,
  action: PrintReturnResolution,
  operatorId: string,
): Promise<{
  orderId: string
  payStatus: string
  refundStatus: string
  taskStatus: string
  refundNo: string
  amountCents: number
}> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } })
  const refund = await db.refund.findFirstOrThrow({
    where: { orderId, status: 'success', OR: [{ reason: null }, { reason: { not: STALE_ATTEMPT_REFUND_REASON } }] },
    orderBy: { updatedAt: 'desc' },
  })
  const task = order.printTaskId
    ? await db.printTask.findUnique({ where: { id: order.printTaskId }, select: { status: true } })
    : null
  const partial = order.payStatus === 'partial_refunded'
  const detail = partial
    ? `渠道已经退成，按渠道金额记账，已退 ${order.refundedAmountCents} 分，还没退完`
    : '渠道已经退成，按渠道金额记账'
  if (action === 'confirm_refunded') {
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'admin',
        action: 'refund.hold_resolved',
        targetType: 'order',
        targetId: orderId,
        payloadJson: JSON.stringify({
          action,
          refundNo: refund.refundNo,
          amountCents: refund.amountCents,
          operatorId,
          detail: partial ? `确认退了一部分（${detail}）` : `确认退款已经退成（${detail}）`,
        }),
      },
    })
    return {
      orderId,
      payStatus: order.payStatus,
      refundStatus: refund.status,
      taskStatus: task?.status ?? order.taskStatus,
      refundNo: refund.refundNo,
      amountCents: refund.amountCents,
    }
  }
  await db.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'admin',
      action: 'refund.hold_rejected',
      targetType: 'order',
      targetId: orderId,
      payloadJson: JSON.stringify({ action, operatorId, code: CHANNEL_REFUNDED_CODE, refundNo: refund.refundNo, detail }),
    },
  })
  const step = action === 'release_paper' ? '改为出纸' : '关单'
  throw deny(CHANNEL_REFUNDED_CODE, `渠道已经退成，不能${step}。已按渠道退回的金额记账，请刷新后看下一步。`)
}
