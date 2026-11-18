/**
 * 退款与出纸返工：放弃后的迟到入账，窗口关掉仍没出纸时钱必须有去向。
 * SQLite 与 PostgreSQL 共用。不碰招聘托管。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { OnlinePaymentService } from '../../src/payment/online-payment.service'
import { OrderStatusService } from '../../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { PickupExpiryRefundService } from '../../src/payment/pickup-expiry-refund.service'
import { SandboxPaymentProvider } from '../../src/payment/providers/sandbox-payment.provider'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import { PAID_UNFULFILLED_PENDING_REFUND_REASON } from '../../src/payment/pending-refund-signal'
import {
  explainPrintRefund,
  listPrintReturnHolds,
  staleCollectedRefundReason,
} from '../../src/payment/print-return-disposition'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { releaseArrivalPaymentHold } from '../../src/print-jobs/pickup-arrival-hold'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const SANDBOX_SECRET = 'verify-p2b5-sandbox-secret-0123456789abcd'

export async function runP2b5Cases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5_${tag}`
  const terminalId = `term_p2b5_${tag}`
  await db.organization.create({
    data: { id: orgId, name: '窗口关闭退款', type: 'school_employment_center' },
  })
  await db.terminal.create({
    data: {
      id: terminalId,
      terminalCode: terminalId,
      agentToken: `tok-${terminalId}`,
      deviceFingerprint: `fp-${terminalId}`,
      orgId,
      enabled: true,
      lifecycleStatus: 'active',
    },
  })
  const payment = new OnlinePaymentService(
    db,
    new AuditService(db),
    new OrderStatusService(db, new AuditService(db)),
    new PaymentProviderRegistry([new SandboxPaymentProvider(SANDBOX_SECRET)]),
  )
  const refunds = new RefundService(
    db,
    new AuditService(db),
    new PaymentProviderRegistry([new SandboxPaymentProvider(SANDBOX_SECRET)]),
  )
  const expiry = new PickupExpiryRefundService(db, refunds, new AuditService(db))

  const lateId = `ord_${tag}_p2b5_late`
  const openId = `ord_${tag}_p2b5_open`
  input.orderIds.push(lateId, openId)
  const created = [lateId, openId]
  const windowOpen = new Date(Date.now() + 60 * 60 * 1000)
  try {
    for (const id of created) {
      await db.order.create({
        data: {
          id,
          orderNo: `P5${tag}${id.endsWith('late') ? 'late' : 'open'}`.slice(0, 32),
          type: 'print',
          terminalId,
          amountCents: 200,
          discountCents: 0,
          payStatus: 'unpaid',
          pickupStatus: 'pending',
          pickupCodeExpiresAt: windowOpen,
          taskStatus: 'awaiting_payment',
          billablePages: 2,
          printParamsJson: PAGES,
          itemsJson: '[]',
          channel: 'miniapp_cloud',
        },
      })
      await db.paymentAttempt.create({
        data: {
          id: `pa_${id}`,
          orderId: id,
          channel: 'sandbox',
          amountCents: 200,
          status: 'pending',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      })
    }

    assert.equal(await releaseArrivalPaymentHold(db, lateId, terminalId), 'released')
    await payment.simulateSandboxCallback({ attemptId: `pa_${lateId}`, result: 'success' })
    const booked = await db.order.findUniqueOrThrow({ where: { id: lateId } })
    assert.equal(booked.payStatus, 'paid', '窗口还开着，放弃后的同额迟到通知仍应入账')
    assert.equal(booked.amountCents, 200)
    assert.equal(await db.refund.count({ where: { orderId: lateId } }), 0)
    assert.equal(booked.printTaskId, null)

    await db.order.update({
      where: { id: lateId },
      data: { pickupCodeExpiresAt: new Date(Date.now() - 60_000) },
    })
    await payment.simulateSandboxCallback({ attemptId: `pa_${openId}`, result: 'success' })
    await expiry.sweep()

    const closed = await db.order.findUniqueOrThrow({ where: { id: lateId } })
    const view = await explainPrintRefund(db, lateId)
    const refunded = closed.payStatus === 'refunded'
      && (await db.refund.findFirst({ where: { orderId: lateId, status: 'success' } }))?.amountCents === 200
    const held = view.disposition === 'manual' || view.disposition === 'auto_failed'
    assert.ok(refunded || held, `放弃后入账、窗口关闭、没出纸，必须退成或进待人工，实际 ${closed.payStatus}/${view.disposition ?? '空'}`)
    assert.equal(closed.printTaskId, null, '没出纸')
    const stillOpen = await db.order.findUniqueOrThrow({ where: { id: openId } })
    assert.equal(stillOpen.payStatus, 'paid', '窗口还开着的已付单不能被这次清扫退掉')
    assert.equal(await db.refund.count({ where: { orderId: openId } }), 0)

    const detail = await new AdminOrdersReadonlyService(db).getById(lateId)
    if (refunded) assert.equal(detail.payStatus, 'refunded')
    else assert.ok(detail.printRefundDisposition === 'manual' || detail.printRefundDisposition === 'auto_failed')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}

const COVERED_REASON = '已付款，打印失败，没有退款记录，待人工处理'

/** 更早的过期成功退款不能盖住后来这一笔已付、没出纸。 */
export async function runP2b5CoveredRefundCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5c_${tag}`
  const terminalId = `term_p2b5c_${tag}`
  await db.organization.create({
    data: { id: orgId, name: '退款去向', type: 'school_employment_center' },
  })
  await db.terminal.create({
    data: {
      id: terminalId,
      terminalCode: terminalId,
      agentToken: `tok-${terminalId}`,
      deviceFingerprint: `fp-${terminalId}`,
      orgId,
      enabled: true,
      lifecycleStatus: 'active',
    },
  })
  const coveredId = `ord_${tag}_p2b5_cover`
  const signaledId = `ord_${tag}_p2b5_sig`
  const openTaskId = `ord_${tag}_p2b5_openpay`
  const created = [coveredId, signaledId, openTaskId]
  input.orderIds.push(...created)
  try {
    for (const [id, taskStatus, refundReason] of [
      [coveredId, 'failed', null],
      [signaledId, 'failed', PAID_UNFULFILLED_PENDING_REFUND_REASON],
      [openTaskId, 'pending', null],
    ] as const) {
      const taskId = `pt_${id}`
      input.taskIds.push(taskId)
      await db.printTask.create({
        data: {
          id: taskId,
          fileUrl: 'https://example.invalid/print',
          fileMd5: 'md5',
          status: taskStatus === 'failed' ? 'failed' : 'pending',
          errorCode: taskStatus === 'failed' ? 'PRINT_QUEUE_TIMEOUT' : null,
          printOutcome: taskStatus === 'failed' ? 'not_printed' : null,
          orderId: id,
          terminalId,
        },
      })
      await db.order.create({
        data: {
          id,
          orderNo: `C5${tag}${id.slice(-6)}`.slice(0, 32),
          type: 'print',
          terminalId,
          amountCents: 200,
          discountCents: 0,
          payStatus: 'paid',
          paymentSource: 'sandbox',
          paidAt: new Date(),
          pickupStatus: 'pending',
          taskStatus,
          refundReason,
          billablePages: 2,
          printParamsJson: PAGES,
          itemsJson: '[]',
          channel: 'kiosk',
          printTaskId: taskId,
        },
      })
      await db.refund.create({
        data: {
          orderId: id,
          refundNo: `RFD-OLD-${id}`.slice(0, 40),
          amountCents: 80,
          status: 'success',
          reason: STALE_ATTEMPT_REFUND_REASON,
          channel: 'sandbox',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      })
    }

    const staleReason = staleCollectedRefundReason(80)
    const covered = await explainPrintRefund(db, coveredId)
    assert.notEqual(covered.disposition, 'auto_success')
    assert.notEqual(covered.reason, staleReason)
    assert.equal(covered.disposition, 'manual')
    assert.equal(covered.reason, COVERED_REASON)
    assert.equal((await listPrintReturnHolds(db)).filter((hold) => hold.orderId === coveredId).length, 1)
    assert.equal((await collectPrintReturnAlerts(db)).filter((alert) => alert.subjectId === coveredId).length, 1)

    const signaled = await explainPrintRefund(db, signaledId)
    assert.notEqual(signaled.reason, staleReason)
    assert.equal(signaled.disposition, 'manual')
    assert.match(signaled.reason ?? '', /待人工|不能自动退/)
    assert.equal((await listPrintReturnHolds(db)).filter((hold) => hold.orderId === signaledId).length, 1)

    const stillPrintable = await explainPrintRefund(db, openTaskId)
    assert.notEqual(stillPrintable.disposition, 'auto_success', '还能出纸时，旧的过期退款不能写成这一笔已退成')
    assert.notEqual(stillPrintable.reason, staleReason)
    assert.equal((await listPrintReturnHolds(db)).filter((hold) => hold.orderId === openTaskId).length, 0)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
