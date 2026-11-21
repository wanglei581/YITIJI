/**
 * 第 9 条撤回：渠道退款成功不改打印任务状态。
 * 退成之后这张单领不到，是因为支付状态已经不是 paid。同一台机器上另一张已付单仍能领走。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import { convergeNotifiedRefundSuccess } from '../../src/payment/refund-notify-paper-guard'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

export async function runP2b6NotifyClaimCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b6nt_${tag}`
  const terminalId = `term_p2b6nt_${tag}`
  const refundedId = `ord_${tag}_p2b6_nt`
  const paidId = `ord_${tag}_p2b6_ntok`
  const refundedTaskId = `pt_${refundedId}`
  const paidTaskId = `pt_${paidId}`
  input.orderIds.push(refundedId, paidId)
  input.taskIds.push(refundedTaskId, paidTaskId)
  await db.organization.create({ data: { id: orgId, name: '退成后不能领', type: 'school_employment_center' } })
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
  const agent = new TerminalAgentService(db, new AuditService(db), { validateTerminalToken: async () => undefined } as never)
  try {
    await seed(db, refundedId, refundedTaskId, terminalId, `${tag}nt`, 'refunding')
    const refund = await db.refund.create({
      data: {
        orderId: refundedId,
        refundNo: `RFD-NT-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'pending',
        reason: '渠道退款',
        channel: 'wechat',
      },
    })
    await seed(db, paidId, paidTaskId, terminalId, `${tag}ok`, 'paid')
    const outcome = await db.$transaction((tx) => convergeNotifiedRefundSuccess(tx, {
      refundId: refund.id,
      orderId: refundedId,
      priorStatus: 'pending',
      channelRefundNo: `ch-${tag}`,
      amountCents: 200,
      reason: '渠道退款',
    }))
    assert.equal(outcome, 'completed')
    const refundedOrder = await db.order.findUniqueOrThrow({ where: { id: refundedId } })
    const refundedTask = await db.printTask.findUniqueOrThrow({ where: { id: refundedTaskId } })
    assert.equal(refundedOrder.payStatus, 'refunded')
    assert.equal(refundedTask.status, 'pending', '渠道退款成功不能改打印任务状态')
    const claimed = await agent.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer test')
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0]?.taskId, paidTaskId, '同一台机器上已付的任务仍能领走')
    assert.notEqual(claimed[0]?.taskId, refundedTaskId)
    const after = await db.printTask.findUniqueOrThrow({ where: { id: refundedTaskId } })
    assert.equal(after.status, 'pending', '没领到的任务仍停在待打印')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: refundedId } })).payStatus, 'refunded')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: [refundedId, paidId] } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: [refundedId, paidId, refundedTaskId, paidTaskId] } } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId: { in: [refundedTaskId, paidTaskId] } } })
    await db.order.deleteMany({ where: { id: { in: [refundedId, paidId] } } })
    await db.printTask.deleteMany({ where: { id: { in: [refundedTaskId, paidTaskId] } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}

async function seed(
  db: PrismaService,
  orderId: string,
  taskId: string,
  terminalId: string,
  suffix: string,
  payStatus: string,
): Promise<void> {
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: 'pending',
      printOutcome: null,
      orderId,
      terminalId,
    },
  })
  await db.order.create({
    data: {
      id: orderId,
      orderNo: `N6${suffix}`.slice(0, 32),
      type: 'print',
      terminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus,
      paymentSource: 'wechat',
      paidAt: new Date(Date.now() - 60 * 60 * 1000),
      pickupStatus: 'pending',
      taskStatus: 'pending',
      billablePages: 1,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'miniapp_cloud',
      printTaskId: taskId,
    },
  })
}
