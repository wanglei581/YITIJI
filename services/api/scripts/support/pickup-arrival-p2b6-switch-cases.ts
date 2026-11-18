/**
 * 窗口关闭、没出纸的已付单：自动退开关开着就原路退，关着进待人工。
 * 开关默认值不动。SQLite 与 PostgreSQL 共用。
 */
import assert from 'node:assert/strict'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import { AuditService } from '../../src/audit/audit.service'
import { PickupExpiryRefundService } from '../../src/payment/pickup-expiry-refund.service'
import { PickupExpiryRefundTask } from '../../src/payment/pickup-expiry-refund.task'
import { PICKUP_WINDOW_CLOSED_UNPRINTED_REASON } from '../../src/payment/closed-window-unprinted'
import { PRINT_RETURN_MANUAL_TYPE } from '../../src/payment/print-no-paper-refund.constants'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const SWITCH = 'PICKUP_EXPIRY_AUTO_REFUND_ENABLED'

export async function runP2b6ClosedWindowSwitchCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b6sw_${tag}`
  const terminalId = `term_p2b6sw_${tag}`
  await db.organization.create({ data: { id: orgId, name: '窗口关闭去向', type: 'school_employment_center' } })
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
  const offId = `ord_${tag}_p2b6_off`
  const onId = `ord_${tag}_p2b6_on`
  const created = [offId, onId]
  input.orderIds.push(...created)
  const previous = process.env[SWITCH]
  const refunds = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([]))
  const expiry = new PickupExpiryRefundService(db, refunds, new AuditService(db))
  const task = new PickupExpiryRefundTask(expiry)
  const orders = new AdminOrdersReadonlyService(db)
  try {
    await seedClosed(db, offId, terminalId, `${tag}off`)
    delete process.env[SWITCH]
    await task.handle()
    const parked = await db.order.findUniqueOrThrow({ where: { id: offId } })
    const parkedRefund = await db.refund.findFirst({
      where: { orderId: offId, reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON },
    })
    assert.equal(parked.payStatus, 'paid', '开关关着不能直接改成已退')
    assert.equal(parkedRefund?.status, 'manual_review')
    assert.equal(parkedRefund?.amountCents, 200)
    const alerts = await collectPrintReturnAlerts(db)
    const alert = alerts.find((item) => item.subjectId === offId)
    assert.equal(alert?.type, PRINT_RETURN_MANUAL_TYPE)
    const offNo = parked.orderNo
    const attention = await orders.list({ opsAttention: true, search: offNo, page: 1, pageSize: 20 })
    const item = attention.items.find((row) => row.id === offId)
    assert.ok(item, '开关关着时，窗口关闭没出纸的已付单必须出现在需关注')
    assert.equal(item?.opsAttentionCode, 'print_return_manual')

    await seedClosed(db, onId, terminalId, `${tag}on`)
    process.env[SWITCH] = 'true'
    await task.handle()
    const refunded = await db.order.findUniqueOrThrow({ where: { id: onId } })
    const success = await db.refund.findFirst({
      where: { orderId: onId, status: 'success', reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON },
    })
    assert.equal(refunded.payStatus, 'refunded', '开关开着必须原路退成')
    assert.equal(success?.amountCents, 200)
    assert.equal(await db.refund.count({ where: { orderId: onId, status: 'manual_review' } }), 0)
  } finally {
    if (previous === undefined) delete process.env[SWITCH]
    else process.env[SWITCH] = previous
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}

async function seedClosed(db: PrismaService, id: string, terminalId: string, suffix: string): Promise<void> {
  await db.order.create({
    data: {
      id,
      orderNo: `W6${suffix}`.slice(0, 32),
      type: 'print',
      terminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'paid',
      paymentSource: 'offline',
      paidAt: new Date(Date.now() - 60 * 60 * 1000),
      pickupStatus: 'expired',
      pickupCodeExpiresAt: new Date(Date.now() - 60_000),
      taskStatus: 'pending',
      billablePages: 2,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'miniapp_cloud',
    },
  })
}
