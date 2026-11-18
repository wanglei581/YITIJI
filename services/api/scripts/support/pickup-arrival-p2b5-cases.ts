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
import { explainPrintRefund } from '../../src/payment/print-return-disposition'
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
