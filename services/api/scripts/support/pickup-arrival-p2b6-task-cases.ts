/**
 * 已经挂上打印任务、纸还没出去：窗口关闭后和没挂任务一样要有去向。
 * 反方第 6 条：迟到同额入账后到机生成任务，卡纸或脱机，清扫不能因为 printTaskId 有值就漏掉。
 * 已出纸的不退、不进待人工。SQLite 与 PostgreSQL 共用。
 */
import assert from 'node:assert/strict'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import { AuditService } from '../../src/audit/audit.service'
import { PICKUP_WINDOW_CLOSED_UNPRINTED_REASON } from '../../src/payment/closed-window-unprinted'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { PickupExpiryRefundService } from '../../src/payment/pickup-expiry-refund.service'
import { PickupExpiryRefundTask } from '../../src/payment/pickup-expiry-refund.task'
import { PRINT_RETURN_MANUAL_TYPE } from '../../src/payment/print-no-paper-refund.constants'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const SWITCH = 'PICKUP_EXPIRY_AUTO_REFUND_ENABLED'

export async function runP2b6AttachedTaskCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b6tk_${tag}`
  const terminalId = `term_p2b6tk_${tag}`
  await db.organization.create({ data: { id: orgId, name: '挂任务没出纸', type: 'school_employment_center' } })
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
  const jamOff = `ord_${tag}_p2b6_jam`
  const pendingOff = `ord_${tag}_p2b6_pend`
  const printedId = `ord_${tag}_p2b6_out`
  const jamOn = `ord_${tag}_p2b6_jamon`
  const created = [jamOff, pendingOff, printedId, jamOn]
  input.orderIds.push(...created)
  const taskIds = [`pt_${jamOff}`, `pt_${pendingOff}`, `pt_${printedId}`, `pt_${jamOn}`]
  input.taskIds.push(...taskIds)
  const previous = process.env[SWITCH]
  const refunds = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([]))
  const expiry = new PickupExpiryRefundService(db, refunds, new AuditService(db))
  const task = new PickupExpiryRefundTask(expiry)
  const orders = new AdminOrdersReadonlyService(db)
  try {
    await seedAttached(db, jamOff, terminalId, `${tag}jam`, {
      taskStatus: 'failed',
      orderTaskStatus: 'failed',
      printOutcome: 'not_printed',
    })
    await seedAttached(db, pendingOff, terminalId, `${tag}pend`, {
      taskStatus: 'pending',
      orderTaskStatus: 'pending',
      printOutcome: null,
    })
    await seedAttached(db, printedId, terminalId, `${tag}out`, {
      taskStatus: 'completed',
      orderTaskStatus: 'completed',
      printOutcome: 'printed',
    })
    delete process.env[SWITCH]
    await task.handle()

    const jammed = await db.order.findUniqueOrThrow({ where: { id: jamOff } })
    const jammedRefund = await db.refund.findFirst({
      where: { orderId: jamOff, reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON },
    })
    assert.equal(jammed.payStatus, 'paid', '开关关着不能把已挂任务的单直接改成已退')
    assert.equal(jammedRefund?.status, 'manual_review', '卡纸未出纸、窗口已关，必须进待人工')
    assert.equal(jammedRefund?.amountCents, 200)
    const pendingRefund = await db.refund.findFirst({
      where: { orderId: pendingOff, reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON },
    })
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: pendingOff } })).payStatus, 'paid')
    assert.equal(pendingRefund?.status, 'manual_review', '任务已生成但还没领走，窗口已关也要进待人工')
    const alerts = await collectPrintReturnAlerts(db)
    assert.equal(alerts.find((item) => item.subjectId === jamOff)?.type, PRINT_RETURN_MANUAL_TYPE)
    const attention = await orders.list({ opsAttention: true, search: jammed.orderNo, page: 1, pageSize: 20 })
    assert.equal(attention.items.find((row) => row.id === jamOff)?.opsAttentionCode, 'print_return_manual')
    const printed = await db.order.findUniqueOrThrow({ where: { id: printedId } })
    assert.equal(printed.payStatus, 'paid', '已经出纸的不能因为窗口关闭被清扫')
    assert.equal(await db.refund.count({ where: { orderId: printedId } }), 0)

    await seedAttached(db, jamOn, terminalId, `${tag}on`, {
      taskStatus: 'failed',
      orderTaskStatus: 'failed',
      printOutcome: 'not_printed',
    })
    process.env[SWITCH] = 'true'
    await task.handle()
    const refunded = await db.order.findUniqueOrThrow({ where: { id: jamOn } })
    const success = await db.refund.findFirst({
      where: { orderId: jamOn, status: 'success', reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON },
    })
    assert.equal(refunded.payStatus, 'refunded', '开关开着，挂了任务但没出纸必须原路退')
    assert.equal(success?.amountCents, 200)
    assert.equal(await db.refund.count({ where: { orderId: jamOn, status: 'manual_review' } }), 0)
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: printedId } })).payStatus, 'paid')
  } finally {
    if (previous === undefined) delete process.env[SWITCH]
    else process.env[SWITCH] = previous
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: [...created, ...taskIds] } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}

async function seedAttached(
  db: PrismaService,
  id: string,
  terminalId: string,
  suffix: string,
  paper: { taskStatus: string; orderTaskStatus: string; printOutcome: string | null },
): Promise<void> {
  const taskId = `pt_${id}`
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: paper.taskStatus,
      printOutcome: paper.printOutcome,
      orderId: id,
      terminalId,
    },
  })
  await db.order.create({
    data: {
      id,
      orderNo: `T6${suffix}`.slice(0, 32),
      type: 'print',
      terminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'paid',
      paymentSource: 'offline',
      paidAt: new Date(Date.now() - 60 * 60 * 1000),
      pickupStatus: 'used',
      pickupCodeExpiresAt: new Date(Date.now() - 60_000),
      taskStatus: paper.orderTaskStatus,
      billablePages: 2,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'miniapp_cloud',
      printTaskId: taskId,
    },
  })
}
