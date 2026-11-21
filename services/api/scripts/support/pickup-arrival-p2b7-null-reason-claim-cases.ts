/**
 * 成功退款的原因是空时，领取条件必须同样排除。
 * SQL 里「不等于某个原因」匹配不到 NULL。漏写这一支，终端仍能领走。
 * 过期付款的成功退款原因不是空，仍不挡住后来这一笔。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import { claimOrderNotBlockedByRefundWhere } from '../../src/payment/refund-paper-exclusion'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

export async function runP2b7NullReasonClaimCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b7nr_${tag}`
  const terminalId = `term_p2b7nr_${tag}`
  const staleTerminalId = `term_p2b7ns_${tag}`
  await db.organization.create({ data: { id: orgId, name: '空原因成功退款', type: 'school_employment_center' } })
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
  await db.terminal.create({
    data: {
      id: staleTerminalId,
      terminalCode: staleTerminalId,
      agentToken: `tok-${staleTerminalId}`,
      deviceFingerprint: `fp-${staleTerminalId}`,
      orgId,
      enabled: true,
      lifecycleStatus: 'active',
    },
  })
  const agent = new TerminalAgentService(db, new AuditService(db), { validateTerminalToken: async () => undefined } as never)
  const created: string[] = []
  try {
    const partialId = `ord_${tag}_p2b7nrp`
    await seedPaid(db, input, created, partialId, terminalId, 50, null)
    const partialWhere = await db.order.count({
      where: { id: partialId, payStatus: 'paid', taskStatus: 'pending', ...claimOrderNotBlockedByRefundWhere() },
    })
    assert.equal(partialWhere, 0, '部分成功退款原因是空，领取条件仍放行')
    const partialClaimed = await agent.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer test')
    assert.equal(partialClaimed.length, 0, '部分成功退款原因是空，领取和退款同时成立')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${partialId}` } })).status, 'pending')

    const fullId = `ord_${tag}_p2b7nrf`
    await seedPaid(db, input, created, fullId, terminalId, 200, null)
    const fullWhere = await db.order.count({
      where: { id: fullId, payStatus: 'paid', taskStatus: 'pending', ...claimOrderNotBlockedByRefundWhere() },
    })
    assert.equal(fullWhere, 0, '整单成功退款原因是空，领取条件仍放行')
    const fullClaimed = await agent.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer test')
    assert.equal(fullClaimed.length, 0, '整单成功退款原因是空，领取和退款同时成立')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${fullId}` } })).status, 'pending')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: fullId } })).payStatus, 'paid')

    const staleId = `ord_${tag}_p2b7nrs`
    await seedPaid(db, input, created, staleId, staleTerminalId, 80, STALE_ATTEMPT_REFUND_REASON)
    const staleClaimed = await agent.claimTasks(staleTerminalId, { maxTasks: 1 }, 'Bearer test')
    assert.equal(staleClaimed.length, 1, '过期付款的成功退款不能挡住后来的新付款')
    assert.equal(staleClaimed[0]?.taskId, `pt_${staleId}`)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId: { in: input.taskIds } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.deleteMany({ where: { id: { in: [terminalId, staleTerminalId] } } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}

async function seedPaid(
  db: PrismaService,
  input: { orderIds: string[]; taskIds: string[] },
  created: string[],
  orderId: string,
  terminalId: string,
  refundCents: number,
  reason: string | null,
): Promise<void> {
  const taskId = `pt_${orderId}`
  created.push(orderId)
  input.orderIds.push(orderId)
  input.taskIds.push(taskId)
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
      orderNo: orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
      type: 'print',
      terminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'paid',
      paymentSource: 'wechat',
      paidAt: new Date(Date.now() - 60 * 60 * 1000),
      pickupStatus: 'pending',
      taskStatus: 'pending',
      billablePages: 1,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'kiosk',
      printTaskId: taskId,
    },
  })
  await db.refund.create({
    data: {
      orderId,
      refundNo: `RFD-NR-${orderId}`.slice(0, 40),
      amountCents: refundCents,
      status: 'success',
      reason,
      channel: 'wechat',
    },
  })
}
