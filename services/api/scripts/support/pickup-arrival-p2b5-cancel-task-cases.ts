/**
 * 普通退款成功后，没领走的打印任务要取消，再领取也领不到。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

export async function runP2b5CancelUnclaimedTaskCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5cx_${tag}`
  const terminalId = `term_p2b5cx_${tag}`
  const orderId = `ord_${tag}_p2b5_cancel`
  const taskId = `pt_${orderId}`
  const controlId = `ord_${tag}_p2b5_still`
  const controlTaskId = `pt_${controlId}`
  input.orderIds.push(orderId, controlId)
  input.taskIds.push(taskId, controlTaskId)
  await db.organization.create({ data: { id: orgId, name: '退成取消任务', type: 'school_employment_center' } })
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
  const seed = async (id: string, printTaskId: string) => {
    await db.printTask.create({
      data: {
        id: printTaskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'pending',
        printOutcome: null,
        orderId: id,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id,
        orderNo: id.slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'offline',
        paidAt: new Date(),
        pickupStatus: 'pending',
        taskStatus: 'pending',
        billablePages: 1,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId,
      },
    })
  }
  try {
    await seed(orderId, taskId)
    await seed(controlId, controlTaskId)
    const refunds = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([]))
    const done = await refunds.refund(orderId, { reason: '普通退款', operatorId: 'admin-test' })
    assert.equal(done.refund.status, 'success')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).payStatus, 'refunded')
    const task = await db.printTask.findUniqueOrThrow({ where: { id: taskId } })
    assert.equal(task.status, 'cancelled', '退成后没领走的任务必须取消')
    assert.equal(task.errorCode, 'REFUND_COMPLETED')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).taskStatus, 'cancelled')
    const agent = new TerminalAgentService(db, new AuditService(db), { validateTerminalToken: async () => undefined } as never)
    const claimed = await agent.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer test')
    assert.equal(claimed.some((item) => item.taskId === taskId), false, '退成后再领取，领不到这张单')
    assert.equal(claimed[0]?.taskId, controlTaskId, '同一台机器上还没退的单仍能领')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: [orderId, controlId] } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: [orderId, controlId] } } })
    await db.order.deleteMany({ where: { id: { in: [orderId, controlId] } } })
    await db.printTask.deleteMany({ where: { id: { in: [taskId, controlTaskId] } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
