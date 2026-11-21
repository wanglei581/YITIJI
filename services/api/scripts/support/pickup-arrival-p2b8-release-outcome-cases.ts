/**
 * 改为出纸把任务重置成待领取时，不是 printed 的出纸结论要清掉。
 * 先记下 unprinted，再改为出纸，重新领取后结论不能残留。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

export async function runP2b8ReleaseOutcomeCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b8ro_${tag}`
  const terminalId = `term_p2b8ro_${tag}`
  const orderId = `ord_${tag}_p2b8ro`
  const taskId = `pt_${orderId}`
  input.orderIds.push(orderId)
  input.taskIds.push(taskId)
  await db.organization.create({ data: { id: orgId, name: '改为出纸清结论', type: 'school_employment_center' } })
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
  try {
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode: 'PRINT_COMMAND_FAILED',
        printOutcome: 'unprinted',
        orderId,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id: orderId,
        orderNo: orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'offline',
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
        orderId,
        refundNo: `RFD-P8RO-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'manual_review',
        reason: '卡纸待人工',
        channel: 'offline',
      },
    })
    const released = await resolvePrintReturnHold(db, orderId, 'release_paper', 'admin-test')
    assert.equal(released.payStatus, 'paid')
    assert.equal(released.taskStatus, 'pending')
    assert.equal(released.refundStatus, 'withdrawn')
    const reset = await db.printTask.findUniqueOrThrow({ where: { id: taskId } })
    assert.equal(reset.status, 'pending')
    assert.equal(reset.printOutcome, null, '改为出纸后 unprinted 还留在任务上')
    const agent = new TerminalAgentService(db, new AuditService(db), { validateTerminalToken: async () => undefined } as never)
    const claimed = await agent.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer test')
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0]?.taskId, taskId)
    const afterClaim = await db.printTask.findUniqueOrThrow({ where: { id: taskId } })
    assert.equal(afterClaim.status, 'claimed')
    assert.equal(afterClaim.printOutcome, null, '重新领取后旧的未出纸结论还在')
  } finally {
    await db.refund.deleteMany({ where: { orderId } })
    await db.auditLog.deleteMany({ where: { targetId: orderId } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId } })
    await db.order.deleteMany({ where: { id: orderId } })
    await db.printTask.deleteMany({ where: { id: taskId } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
