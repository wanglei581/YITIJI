/**
 * 待人工的 pending 退款，三步处置都要能处理。
 */
import assert from 'node:assert/strict'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

export async function runP2b5PendingHoldCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5h_${tag}`
  const terminalId = `term_p2b5h_${tag}`
  await db.organization.create({ data: { id: orgId, name: '待人工退款', type: 'school_employment_center' } })
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
  const ids = {
    confirm: `ord_${tag}_p2b5_pend_c`,
    release: `ord_${tag}_p2b5_pend_r`,
    close: `ord_${tag}_p2b5_pend_x`,
  }
  const created = Object.values(ids)
  input.orderIds.push(...created)
  try {
    for (const [key, id] of Object.entries(ids)) {
      const taskId = `pt_${id}`
      input.taskIds.push(taskId)
      await db.printTask.create({
        data: {
          id: taskId,
          fileUrl: 'https://example.invalid/print',
          fileMd5: 'md5',
          status: 'failed',
          errorCode: 'PRINT_QUEUE_TIMEOUT',
          printOutcome: 'not_printed',
          orderId: id,
          terminalId,
        },
      })
      await db.order.create({
        data: {
          id,
          orderNo: `H5${tag}${key}`.slice(0, 32),
          type: 'print',
          terminalId,
          amountCents: 200,
          discountCents: 0,
          payStatus: 'paid',
          paymentSource: 'sandbox',
          paidAt: new Date(),
          pickupStatus: 'pending',
          taskStatus: 'failed',
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
          refundNo: `RFD-PEND-${tag}-${key}`,
          amountCents: 200,
          status: 'pending',
          reason: '渠道还没确认退款结果',
          channel: 'sandbox',
        },
      })
    }

    const confirmed = await resolvePrintReturnHold(db, ids.confirm, 'confirm_refunded', 'admin-test')
    assert.equal(confirmed.refundStatus, 'success')
    assert.equal(confirmed.payStatus, 'refunded')
    assert.equal(confirmed.amountCents, 200)
    const released = await resolvePrintReturnHold(db, ids.release, 'release_paper', 'admin-test')
    assert.equal(released.refundStatus, 'withdrawn')
    assert.equal(released.payStatus, 'paid')
    assert.equal(released.taskStatus, 'pending')
    const closed = await resolvePrintReturnHold(db, ids.close, 'close_order', 'admin-test')
    assert.equal(closed.refundStatus, 'closed')
    assert.equal(closed.payStatus, 'closed')
    assert.notEqual((await db.order.findUniqueOrThrow({ where: { id: ids.close } })).payStatus, 'refunded')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
