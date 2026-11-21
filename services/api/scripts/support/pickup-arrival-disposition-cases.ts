/**
 * 已付大于 0 且没出纸的单，每一种异常只落在自动退成功、自动退失败、待人工之一。
 * 自动退成功不进待处理列表。其余两种各出现一次。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { AuditService } from '../../src/audit/audit.service'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import {
  CHANNEL_UNCONFIRMED_REFUND_REASON,
  explainPrintRefund,
  listPrintReturnHolds,
  PRINT_NO_PAPER_AUTO_FAILED_AUDIT,
  PRINT_NO_PAPER_MANUAL_AUDIT,
  staleCollectedRefundReason,
} from '../../src/payment/print-return-disposition'
import { PAID_NO_PAPER_AUTO_REASON, STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { PickupOrderService } from '../../src/print-jobs/pickup-order.service'
import { settlePickupArrival } from '../../src/print-jobs/pickup-arrival-price'
import { TerminalCapabilitiesService } from '../../src/terminals/terminal-capabilities.service'
import { createPaymentSessionToken } from '../../src/payment/payment-session-token'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

async function seedPaid(
  db: PrismaService,
  input: {
    id: string
    orderNo: string
    amountCents: number
    payStatus?: string
    taskStatus?: string
    refundReason?: string | null
    terminalId: string
    printStatus?: string
    printOutcome?: string | null
    errorCode?: string | null
  },
  orderIds: string[],
  taskIds: string[],
): Promise<void> {
  const taskId = `pt_${input.id}`
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: input.printStatus ?? 'failed',
      errorCode: input.errorCode ?? 'PRINT_COMMAND_FAILED',
      printOutcome: input.printOutcome === undefined ? 'not_printed' : input.printOutcome,
      orderId: input.id,
      terminalId: input.terminalId,
    },
  })
  taskIds.push(taskId)
  await db.order.create({
    data: {
      id: input.id,
      orderNo: input.orderNo,
      type: 'print',
      terminalId: input.terminalId,
      amountCents: input.amountCents,
      discountCents: 0,
      payStatus: input.payStatus ?? 'paid',
      paymentSource: 'offline',
      paidAt: new Date('2026-11-18T02:00:00Z'),
      pickupStatus: 'pending',
      taskStatus: input.taskStatus ?? 'failed',
      refundReason: input.refundReason ?? null,
      billablePages: 1,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'kiosk',
      printTaskId: taskId,
    },
  })
  orderIds.push(input.id)
}

async function expectOne(
  db: PrismaService,
  orderId: string,
  disposition: 'auto_success' | 'auto_failed' | 'manual',
  reason: string | null,
): Promise<void> {
  const view = await explainPrintRefund(db, orderId)
  assert.equal(view.disposition, disposition, orderId)
  assert.equal(view.reason, reason, orderId)
  const detail = await new AdminOrdersReadonlyService(db).getById(orderId)
  assert.equal(detail.printRefundDisposition, disposition)
  assert.equal(detail.printRefundReason, reason)
  assert.equal(detail.refundLedgerNo, view.refundNo)
  assert.equal(detail.refundLedgerCents, view.amountCents)
  const holds = (await listPrintReturnHolds(db)).filter((hold) => hold.orderId === orderId)
  const alerts = (await collectPrintReturnAlerts(db)).filter((alert) => alert.subjectId === orderId)
  if (disposition === 'auto_success') {
    assert.equal(holds.length, 0, `${orderId} 退成后不能再挂着`)
    assert.equal(alerts.length, 0)
    return
  }
  assert.equal(holds.length, 1, `${orderId} 必须只出现一次`)
  assert.equal(holds[0]?.disposition, disposition)
  assert.equal(holds[0]?.reason, reason)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0]?.detail, reason)
}

export async function runArrivalDispositionCases(
  db: PrismaService,
  input: { tag: string; terminalId: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const terminalId = input.terminalId
  const successId = `ord_${tag}_disp_ok`
  await seedPaid(db, { id: successId, orderNo: `DSP${tag}OK`.slice(0, 32), amountCents: 200, payStatus: 'refunded', terminalId }, input.orderIds, input.taskIds)
  await db.refund.create({
    data: { orderId: successId, refundNo: `RFD-DSP-OK-${tag}`, amountCents: 200, status: 'success', reason: PAID_NO_PAPER_AUTO_REASON, channel: 'offline' },
  })
  await expectOne(db, successId, 'auto_success', null)

  const failedId = `ord_${tag}_disp_fail`
  await seedPaid(db, { id: failedId, orderNo: `DSP${tag}FL`.slice(0, 32), amountCents: 200, payStatus: 'refunding', terminalId }, input.orderIds, input.taskIds)
  await db.refund.create({
    data: { orderId: failedId, refundNo: `RFD-DSP-FL-${tag}`, amountCents: 200, status: 'failed', reason: PAID_NO_PAPER_AUTO_REASON, channel: 'offline' },
  })
  await db.auditLog.create({
    data: {
      actorId: null, actorRole: 'system', action: PRINT_NO_PAPER_AUTO_FAILED_AUDIT, targetType: 'order', targetId: failedId,
      payloadJson: JSON.stringify({ code: 'REFUND_CHANNEL_FAILED' }),
    },
  })
  await expectOne(db, failedId, 'auto_failed', '退款渠道返回失败（REFUND_CHANNEL_FAILED），没有退成')

  const auditOnlyId = `ord_${tag}_disp_audit`
  await seedPaid(db, { id: auditOnlyId, orderNo: `DSP${tag}AU`.slice(0, 32), amountCents: 200, terminalId }, input.orderIds, input.taskIds)
  await db.auditLog.create({
    data: {
      actorId: null, actorRole: 'system', action: PRINT_NO_PAPER_AUTO_FAILED_AUDIT, targetType: 'order', targetId: auditOnlyId,
      payloadJson: JSON.stringify({ code: 'REFUND_SOURCE_ATTEMPT_MISSING' }),
    },
  })
  await expectOne(db, auditOnlyId, 'auto_failed', '找不到当时的付款记录，没有退成')

  const reviewId = `ord_${tag}_disp_review`
  await seedPaid(db, {
    id: reviewId, orderNo: `DSP${tag}RV`.slice(0, 32), amountCents: 137, payStatus: 'refunding',
    taskStatus: 'pending', printStatus: 'pending', printOutcome: null, errorCode: null, terminalId,
    refundReason: 'REFUND_AMOUNT_MISMATCH_MANUAL',
  }, input.orderIds, input.taskIds)
  await db.refund.create({
    data: { orderId: reviewId, refundNo: `RFD-DSP-RV-${tag}`, amountCents: 137, status: 'manual_review', reason: 'test', channel: 'wechat' },
  })
  await db.auditLog.create({
    data: {
      actorId: null, actorRole: 'system', action: 'refund.notify_amount_mismatch', targetType: 'order', targetId: reviewId,
      payloadJson: JSON.stringify({ notifyAmountCents: 50, wholeOrderCents: 137, refundNo: `RFD-DSP-RV-${tag}` }),
    },
  })
  await expectOne(db, reviewId, 'manual', '渠道通知退了 50 分，这笔应退 137 分，待人工核对')
  const reviewDetail = await new AdminOrdersReadonlyService(db).getById(reviewId)
  assert.equal(reviewDetail.refundStatus, 'manual_review')
  assert.equal(reviewDetail.refundEligible, false, '待人工核对时不再放一颗会出第二笔的按钮')

  const pendingId = `ord_${tag}_disp_pend`
  await seedPaid(db, { id: pendingId, orderNo: `DSP${tag}PD`.slice(0, 32), amountCents: 200, payStatus: 'refunding', terminalId }, input.orderIds, input.taskIds)
  await db.refund.create({
    data: { orderId: pendingId, refundNo: `RFD-DSP-PD-${tag}`, amountCents: 200, status: 'pending', reason: PAID_NO_PAPER_AUTO_REASON, channel: 'wechat' },
  })
  await expectOne(db, pendingId, 'manual', CHANNEL_UNCONFIRMED_REFUND_REASON)

  const staleOkId = `ord_${tag}_disp_stale_ok`
  await seedPaid(db, { id: staleOkId, orderNo: `DSP${tag}SO`.slice(0, 32), amountCents: 200, payStatus: 'unpaid', taskStatus: 'awaiting_payment', terminalId }, input.orderIds, input.taskIds)
  await db.refund.create({
    data: { orderId: staleOkId, refundNo: `RFD-DSP-SO-${tag}`, amountCents: 80, status: 'success', reason: STALE_ATTEMPT_REFUND_REASON, channel: 'sandbox' },
  })
  await expectOne(db, staleOkId, 'auto_success', staleCollectedRefundReason(80))

  const staleFailId = `ord_${tag}_disp_stale_fl`
  await seedPaid(db, { id: staleFailId, orderNo: `DSP${tag}SF`.slice(0, 32), amountCents: 200, payStatus: 'unpaid', taskStatus: 'awaiting_payment', terminalId }, input.orderIds, input.taskIds)
  await db.refund.create({
    data: { orderId: staleFailId, refundNo: `RFD-DSP-SF-${tag}`, amountCents: 80, status: 'failed', reason: STALE_ATTEMPT_REFUND_REASON, channel: 'sandbox' },
  })
  await expectOne(db, staleFailId, 'auto_failed', '退款渠道返回失败（REFUND_CHANNEL_FAILED），没有退成')

  const staleReviewId = `ord_${tag}_disp_stale_rv`
  await seedPaid(db, { id: staleReviewId, orderNo: `DSP${tag}SR`.slice(0, 32), amountCents: 200, payStatus: 'unpaid', taskStatus: 'awaiting_payment', terminalId }, input.orderIds, input.taskIds)
  await db.refund.create({
    data: { orderId: staleReviewId, refundNo: `RFD-DSP-SR-${tag}`, amountCents: 80, status: 'manual_review', reason: STALE_ATTEMPT_REFUND_REASON, channel: 'sandbox' },
  })
  await expectOne(db, staleReviewId, 'manual', '过期付款 80 分没有渠道流水，待人工原路退回')

  const seen = new Map<string, number>()
  for (const hold of await listPrintReturnHolds(db)) {
    seen.set(hold.orderId, (seen.get(hold.orderId) ?? 0) + 1)
  }
  for (const [orderId, count] of seen) assert.equal(count, 1, `${orderId} 出现了 ${count} 次`)

  const blockedId = `ord_${tag}_disp_block`
  await db.order.create({
    data: {
      id: blockedId,
      orderNo: `DSP${tag}BK`.slice(0, 32),
      type: 'print',
      terminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'paid',
      paymentSource: 'offline',
      paidAt: new Date(),
      pickupStatus: 'claimed',
      taskStatus: 'pending',
      billablePages: 1,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'kiosk',
    },
  })
  input.orderIds.push(blockedId)
  await db.refund.create({
    data: { orderId: blockedId, refundNo: `RFD-DSP-BK-${tag}`, amountCents: 200, status: 'failed', reason: PAID_NO_PAPER_AUTO_REASON, channel: 'offline' },
  })
  await db.auditLog.create({
    data: {
      actorId: null, actorRole: 'system', action: PRINT_NO_PAPER_MANUAL_AUDIT, targetType: 'order', targetId: blockedId,
      payloadJson: JSON.stringify({ detail: '占位' }),
    },
  })
  const heartbeat = await db.terminalHeartbeat.create({ data: { terminalId } })
  try {
    const lost = await settlePickupArrival(db, { orderId: blockedId, terminalId })
    assert.equal(lost.kind, 'lost', '退款还可能变成成功时，核码不能放行')
    const order = await db.order.findUniqueOrThrow({ where: { id: blockedId } })
    const token = createPaymentSessionToken({
      orderId: order.id,
      orderNo: order.orderNo,
      terminalId,
      amountCents: order.amountCents,
      printTaskId: null,
    })
    const pickup = new PickupOrderService(
      db,
      new TerminalCapabilitiesService(db),
      new AuditService(db),
      {} as never,
      {} as never,
    )
    await assert.rejects(
      () => pickup.release(blockedId, terminalId, token),
      (error: unknown) => error instanceof BadRequestException && `${error.message}`.includes('ORDER_REFUND_UNRESOLVED'),
      '取件放行在文件检查之前就要拒绝未结束的退款',
    )
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: blockedId } })).printTaskId, null)
  } finally {
    await db.terminalHeartbeat.delete({ where: { id: heartbeat.id } }).catch(() => undefined)
  }
}
