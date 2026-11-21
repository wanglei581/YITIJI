/**
 * 反方第 7 条。确认退成在事务外读「还没出纸」，事务里改订单时不看任务状态。
 * 领取或出纸回报先把订单行锁住、提交前确认退成只能读到旧状态。锁一放开，两边不该都提交。
 * 真实领取在退款行还在时选不中这张单，另外各跑 20 轮。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService, PrismaTransactionClient } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const ROUNDS = 20

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

async function waitForLockWaiter(db: PrismaService): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 3_000) {
    const rows = await db.$transaction((tx) => tx.$queryRaw<Array<{ n: number | bigint }>>`
      SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock'
    `)
    if (Number(rows[0]?.n ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('确认退成没有等到订单行锁')
}

async function seedHold(
  db: PrismaService,
  input: { id: string; terminalId: string; orderIds: string[]; taskIds: string[] },
): Promise<string> {
  const taskId = `pt_${input.id}`
  input.orderIds.push(input.id)
  input.taskIds.push(taskId)
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: 'pending',
      orderId: input.id,
      terminalId: input.terminalId,
    },
  })
  await db.order.create({
    data: {
      id: input.id,
      orderNo: input.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
      type: 'print',
      terminalId: input.terminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'paid',
      paymentSource: 'offline',
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
  await db.refund.create({
    data: {
      orderId: input.id,
      refundNo: `RFD-P6-${input.id}`.slice(0, 40),
      amountCents: 200,
      status: 'manual_review',
      reason: '卡纸待人工',
      channel: 'offline',
    },
  })
  return taskId
}

function released(status: string, printOutcome: string | null): boolean {
  return status === 'claimed' || status === 'printing' || status === 'completed' || printOutcome === 'printed'
}

async function assertOneSide(
  db: PrismaService,
  id: string,
  confirmCode: string,
  label: string,
): Promise<void> {
  const order = await db.order.findUniqueOrThrow({ where: { id } })
  const task = await db.printTask.findFirstOrThrow({ where: { orderId: id } })
  const refund = await db.refund.findFirstOrThrow({ where: { orderId: id } })
  const money = order.payStatus === 'refunded' || order.payStatus === 'partial_refunded' || refund.status === 'success'
  const paper = released(task.status, task.printOutcome) || released(order.taskStatus, null)
  assert.equal(money && paper, false, `${label} 既退款又出纸 pay=${order.payStatus} task=${task.status} outcome=${task.printOutcome} confirm=${confirmCode}`)
  const wins = (confirmCode === 'ok' ? 1 : 0) + (paper ? 1 : 0)
  assert.equal(wins, 1, `${label} 成功 ${wins} 边 confirm=${confirmCode} paper=${paper} pay=${order.payStatus} task=${task.status}`)
  // PostgreSQL 把行锁留到确认退成已经读过旧状态。拒绝发生在事务里，回滚后还要有审计。
  // SQLite 单写者会先提交出纸，确认退成在进事务前就看见纸已经出去，这条路径本来就不写审计。
  if (db.dbKind === 'postgres' && confirmCode === 'PAPER_ALREADY_RELEASED') {
    assert.equal(await db.auditLog.count({ where: { targetId: id, action: 'refund.hold_rejected' } }), 1, `${label} 拒绝审计`)
  }
}

async function holdThenConfirm(
  db: PrismaService,
  id: string,
  write: (tx: PrismaTransactionClient) => Promise<void>,
): Promise<string> {
  let notifyLocked!: () => void
  const locked = new Promise<void>((resolve) => { notifyLocked = resolve })
  let release!: () => void
  const releasedGate = new Promise<void>((resolve) => { release = resolve })
  const holder = db.$transaction(async (tx) => {
    await write(tx)
    notifyLocked()
    await releasedGate
  }, { timeout: 15_000, maxWait: 5_000 })
  await locked
  const confirmP = resolvePrintReturnHold(db, id, 'confirm_refunded', 'admin-test').then(
    () => 'ok',
    (error: unknown) => errorCode(error),
  )
  if (db.dbKind === 'postgres') await waitForLockWaiter(db)
  release()
  const [confirmCode] = await Promise.all([confirmP, holder])
  return confirmCode
}

export async function runP2b6PaperRaceCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b6race_${tag}`
  const terminalId = `term_p2b6race_${tag}`
  await db.organization.create({ data: { id: orgId, name: '出纸退款并发', type: 'school_employment_center' } })
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
  const created: string[] = []
  try {
    for (let round = 0; round < ROUNDS; round += 1) {
        const claimId = `ord_${tag}_p2b6c${round}`
        created.push(claimId)
        const claimTask = await seedHold(db, { id: claimId, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
        const claimCode = await holdThenConfirm(db, claimId, async (tx) => {
          const orderLocked = await tx.order.updateMany({
            where: { id: claimId, payStatus: 'paid', taskStatus: 'pending' },
            data: { taskStatus: 'claimed' },
          })
          assert.equal(orderLocked.count, 1, `${claimId} 领取没有锁住订单`)
          const taskLocked = await tx.printTask.updateMany({
            where: { id: claimTask, status: 'pending' },
            data: { status: 'claimed' },
          })
          assert.equal(taskLocked.count, 1, `${claimId} 领取没有锁住任务`)
        })
        await assertOneSide(db, claimId, claimCode, `领取对确认退成 第 ${round} 轮`)

        const paperId = `ord_${tag}_p2b6p${round}`
        created.push(paperId)
        const paperTask = await seedHold(db, { id: paperId, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
        const paperCode = await holdThenConfirm(db, paperId, async (tx) => {
          const orderLocked = await tx.order.updateMany({
            where: { id: paperId, payStatus: 'paid', taskStatus: 'pending' },
            data: { taskStatus: 'completed' },
          })
          assert.equal(orderLocked.count, 1, `${paperId} 出纸没有锁住订单`)
          const taskLocked = await tx.printTask.updateMany({
            where: { id: paperTask, status: 'pending' },
            data: { status: 'completed', printOutcome: 'printed' },
          })
          assert.equal(taskLocked.count, 1, `${paperId} 出纸没有锁住任务`)
        })
        await assertOneSide(db, paperId, paperCode, `出纸回报对确认退成 第 ${round} 轮`)
    }

    const { TerminalAgentService } = await import('../../src/terminals/terminals-agent.service')
    const agent = new TerminalAgentService(db, new AuditService(db), { validateTerminalToken: async () => undefined } as never)
    for (let round = 0; round < ROUNDS; round += 1) {
      const id = `ord_${tag}_p2b6live${round}`
      created.push(id)
      const taskId = await seedHold(db, { id, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
      const [confirmCode, claimed] = await Promise.all([
        resolvePrintReturnHold(db, id, 'confirm_refunded', 'admin-test').then(() => 'ok', (error: unknown) => errorCode(error)),
        agent.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer verify').then(
          (rows) => rows.some((row) => row.taskId === taskId),
          (error: unknown) => { throw error },
        ),
      ])
      const order = await db.order.findUniqueOrThrow({ where: { id } })
      const task = await db.printTask.findUniqueOrThrow({ where: { id: taskId } })
      const money = order.payStatus === 'refunded' || order.payStatus === 'partial_refunded'
      const paper = claimed || released(task.status, task.printOutcome)
      assert.equal(money && paper, false, `真实领取 第 ${round} 轮既退又领 confirm=${confirmCode}`)
      assert.equal((confirmCode === 'ok' ? 1 : 0) + (paper ? 1 : 0), 1, `真实领取 第 ${round} 轮 confirm=${confirmCode} paper=${paper}`)

      const reportId = `ord_${tag}_p2b6rep${round}`
      created.push(reportId)
      const reportTask = await seedHold(db, { id: reportId, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
      const [reportConfirm, reported] = await Promise.all([
        resolvePrintReturnHold(db, reportId, 'confirm_refunded', 'admin-test').then(() => 'ok', (error: unknown) => errorCode(error)),
        agent.patchTaskStatus(reportTask, { status: 'completed' }, 'Bearer verify', terminalId).then(
          () => 'ok',
          (error: unknown) => errorCode(error),
        ),
      ])
      const reportOrder = await db.order.findUniqueOrThrow({ where: { id: reportId } })
      const reportRow = await db.printTask.findUniqueOrThrow({ where: { id: reportTask } })
      const reportMoney = reportOrder.payStatus === 'refunded' || reportOrder.payStatus === 'partial_refunded'
      const reportPaper = reported === 'ok' || released(reportRow.status, reportRow.printOutcome)
      assert.equal(reportMoney && reportPaper, false, `真实出纸回报 第 ${round} 轮既退又出 confirm=${reportConfirm} report=${reported}`)
      assert.equal((reportConfirm === 'ok' ? 1 : 0) + (reportPaper ? 1 : 0), 1, `真实出纸回报 第 ${round} 轮 confirm=${reportConfirm} report=${reported}`)
    }
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
