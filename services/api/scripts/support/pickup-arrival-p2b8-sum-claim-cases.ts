/**
 * 事务内按非过期成功退款的合计判断，不按单行金额。
 * 领取先通过查询条件，两笔各 100 分随后凑满 200，不能再把任务领走。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import {
  claimOrderNotBlockedByRefundWhere,
  findBlockingRefund,
  lockOrderRow,
} from '../../src/payment/refund-paper-exclusion'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import type { PrismaService, PrismaTransactionClient } from '../../src/prisma/prisma.service'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const ROUNDS = 20

async function waitForLockWaiter(db: PrismaService): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 3_000) {
    const rows = await db.$transaction((tx) => tx.$queryRaw<Array<{ n: number | bigint }>>`
      SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock'
    `)
    if (Number(rows[0]?.n ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('领取没有等到订单行锁')
}

async function seedClaimable(
  db: PrismaService,
  input: { orderIds: string[]; taskIds: string[] },
  orderId: string,
  terminalId: string,
): Promise<void> {
  const taskId = `pt_${orderId}`
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
      paidAt: new Date(),
      pickupStatus: 'pending',
      taskStatus: 'pending',
      billablePages: 2,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'kiosk',
      printTaskId: taskId,
    },
  })
}

async function addSuccess(
  db: PrismaService | PrismaTransactionClient,
  orderId: string,
  suffix: string,
  amountCents: number,
  reason: string | null,
): Promise<void> {
  await db.refund.create({
    data: {
      orderId,
      refundNo: `RFD-P8SM-${suffix}`.slice(0, 40),
      amountCents,
      status: 'success',
      reason,
      channel: 'wechat',
    },
  })
}

export async function runP2b8SumClaimCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b8sm_${tag}`
  const terminalId = `term_p2b8sm_${tag}`
  await db.organization.create({ data: { id: orgId, name: '合计退款挡住领取', type: 'school_employment_center' } })
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
  const created: string[] = []
  try {
    for (let round = 0; round < ROUNDS; round += 1) {
      const id = `ord_${tag}_p2b8s${round}`
      created.push(id)
      await seedClaimable(db, input, id, terminalId)
      const open = await db.order.count({
        where: { id, payStatus: 'paid', taskStatus: 'pending', ...claimOrderNotBlockedByRefundWhere() },
      })
      assert.equal(open, 1, `第 ${round} 轮领取条件在成功行写上之前应该放行`)
      let notifyLocked!: () => void
      const locked = new Promise<void>((resolve) => { notifyLocked = resolve })
      let writeNow!: () => void
      const writeGate = new Promise<void>((resolve) => { writeNow = resolve })
      const holder = db.$transaction(async (tx: PrismaTransactionClient) => {
        await lockOrderRow(tx, db.dbKind, id)
        notifyLocked()
        await writeGate
        await addSuccess(tx, id, `${tag}${round}a`, 100, null)
        await addSuccess(tx, id, `${tag}${round}b`, 100, null)
      }, { timeout: 15_000, maxWait: 5_000 })
      await locked
      const claimP = agent.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer test')
      if (db.dbKind === 'postgres') await waitForLockWaiter(db)
      writeNow()
      const [claimed] = await Promise.all([claimP, holder])
      const task = await db.printTask.findUniqueOrThrow({ where: { id: `pt_${id}` } })
      const order = await db.order.findUniqueOrThrow({ where: { id } })
      const taken = task.status === 'claimed' || order.taskStatus === 'claimed'
      assert.equal(taken && claimed.length > 0, false, `第 ${round} 轮既领走又凑满退款 claimed=${claimed.length} task=${task.status}`)
      assert.equal(claimed.length, 0, `第 ${round} 轮领取应被合计退款挡住`)
      assert.equal(task.status, 'pending')
      assert.equal(order.taskStatus, 'pending')
      const sum = await db.refund.aggregate({
        where: { orderId: id, status: 'success' },
        _sum: { amountCents: true },
      })
      assert.equal(sum._sum.amountCents, 200)
    }

    const coveredId = `ord_${tag}_p2b8sum`
    created.push(coveredId)
    await seedClaimable(db, input, coveredId, terminalId)
    await addSuccess(db, coveredId, `${tag}ca`, 100, null)
    await addSuccess(db, coveredId, `${tag}cb`, 100, null)
    assert.ok(await findBlockingRefund(db, coveredId), '两笔各 100 分凑满应付，事务内判断应挡住')

    const partialId = `ord_${tag}_p2b8part`
    created.push(partialId)
    await seedClaimable(db, input, partialId, terminalId)
    await addSuccess(db, partialId, `${tag}pa`, 100, null)
    assert.equal(await findBlockingRefund(db, partialId), null, '一笔 100 分没凑满应付，不能按合计挡住')

    const staleId = `ord_${tag}_p2b8stale`
    created.push(staleId)
    await seedClaimable(db, input, staleId, terminalId)
    await addSuccess(db, staleId, `${tag}sa`, 100, STALE_ATTEMPT_REFUND_REASON)
    await addSuccess(db, staleId, `${tag}sb`, 100, null)
    assert.equal(await findBlockingRefund(db, staleId), null, '过期成功退款不计入合计')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId: { in: input.taskIds } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { id: { in: input.taskIds } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
