/**
 * 确认退成必须和「纸已经出去」抢同一条条件。
 * 后台核验出纸只写 printOutcome=printed，不改订单任务状态。
 * 行锁住打印任务、只写这个结果再放行确认退成，不能既退款又出纸。
 * 反过来，核验出纸时订单已经在退或已经退成，也不能写成已出纸。
 * PostgreSQL 上两边各 20 轮只一边成立。
 */
import assert from 'node:assert/strict'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import { AdminPrintJobsVerifyOutcomeService } from '../../src/print-jobs/admin-print-jobs-verify-outcome.service'
import type { PrismaService, PrismaTransactionClient } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const ROUNDS = 20

function errorCode(error: unknown): string {
  if (error instanceof BadRequestException || error instanceof ConflictException) {
    const body = error.getResponse() as { error?: { code?: string } }
    return body?.error?.code ?? error.message
  }
  return error instanceof Error ? error.message : 'error'
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
  throw new Error('确认退成没有等到打印任务行锁')
}

async function seedHold(
  db: PrismaService,
  input: {
    id: string
    terminalId: string
    orderIds: string[]
    taskIds: string[]
    taskStatus: 'pending' | 'failed'
    orderTaskStatus: 'pending' | 'failed'
    errorCode: string | null
  },
): Promise<string> {
  const taskId = `pt_${input.id}`
  input.orderIds.push(input.id)
  input.taskIds.push(taskId)
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: input.taskStatus,
      errorCode: input.errorCode,
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
      taskStatus: input.orderTaskStatus,
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
      refundNo: `RFD-P7-${input.id}`.slice(0, 40),
      amountCents: 200,
      status: 'manual_review',
      reason: '卡纸待人工',
      channel: 'offline',
    },
  })
  return taskId
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

export async function runP2b7OutcomeRaceCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b7oc_${tag}`
  const terminalId = `term_p2b7oc_${tag}`
  const adminId = `user_p2b7oc_${tag}`
  await db.organization.create({ data: { id: orgId, name: '核验出纸与退款', type: 'school_employment_center' } })
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
  await db.user.create({
    data: {
      id: adminId,
      username: `p2b7oc_${tag}`,
      name: '核验出纸',
      passwordHash: 'hash',
      role: 'admin',
      enabled: true,
      tokenVersion: 0,
    },
  })
  const verify = new AdminPrintJobsVerifyOutcomeService(db, new AuditService(db))
  const created: string[] = []
  try {
    for (let round = 0; round < ROUNDS; round += 1) {
      const id = `ord_${tag}_p2b7o${round}`
      created.push(id)
      const taskId = await seedHold(db, {
        id,
        terminalId,
        orderIds: input.orderIds,
        taskIds: input.taskIds,
        taskStatus: 'pending',
        orderTaskStatus: 'pending',
        errorCode: null,
      })
      const confirmCode = await holdThenConfirm(db, id, async (tx) => {
        const locked = await tx.printTask.updateMany({
          where: { id: taskId, printOutcome: null },
          data: { printOutcome: 'printed' },
        })
        assert.equal(locked.count, 1, `${id} 没有锁住打印任务`)
      })
      const order = await db.order.findUniqueOrThrow({ where: { id } })
      const task = await db.printTask.findUniqueOrThrow({ where: { id: taskId } })
      const refund = await db.refund.findFirstOrThrow({ where: { orderId: id } })
      const money = order.payStatus === 'refunded' || order.payStatus === 'partial_refunded' || refund.status === 'success'
      const paper = task.printOutcome === 'printed'
      assert.equal(money && paper, false, `只写 printOutcome 第 ${round} 轮既退又出 pay=${order.payStatus} outcome=${task.printOutcome} confirm=${confirmCode}`)
      assert.equal((money ? 1 : 0) + (paper ? 1 : 0), 1, `只写 printOutcome 第 ${round} 轮 confirm=${confirmCode} pay=${order.payStatus} outcome=${task.printOutcome}`)
      assert.equal(paper, true, `只写 printOutcome 第 ${round} 轮纸的标记丢了`)
      assert.equal(confirmCode, 'PAPER_ALREADY_RELEASED')
    }

    for (let round = 0; round < ROUNDS; round += 1) {
      const id = `ord_${tag}_p2b7v${round}`
      created.push(id)
      const taskId = await seedHold(db, {
        id,
        terminalId,
        orderIds: input.orderIds,
        taskIds: input.taskIds,
        taskStatus: 'failed',
        orderTaskStatus: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
      })
      const [confirmCode, verifyCode] = await Promise.all([
        resolvePrintReturnHold(db, id, 'confirm_refunded', 'admin-test').then(
          () => 'ok',
          (error: unknown) => errorCode(error),
        ),
        verify.verifyOutcome(taskId, { outcome: 'printed', confirm: 'VERIFY_PRINTED' }, adminId).then(
          () => 'ok',
          (error: unknown) => errorCode(error),
        ),
      ])
      const order = await db.order.findUniqueOrThrow({ where: { id } })
      const task = await db.printTask.findUniqueOrThrow({ where: { id: taskId } })
      const refund = await db.refund.findFirstOrThrow({ where: { orderId: id } })
      const money = order.payStatus === 'refunded' || refund.status === 'success'
      const paper = task.printOutcome === 'printed' || verifyCode === 'ok'
      assert.equal(money && paper, false, `核验对确认退成 第 ${round} 轮既退又出 confirm=${confirmCode} verify=${verifyCode} pay=${order.payStatus} outcome=${task.printOutcome}`)
      assert.equal((money ? 1 : 0) + (paper ? 1 : 0), 1, `核验对确认退成 第 ${round} 轮 confirm=${confirmCode} verify=${verifyCode}`)
    }

    const blockedId = `ord_${tag}_p2b7blk`
    created.push(blockedId)
    const blockedTask = await seedHold(db, {
      id: blockedId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      taskStatus: 'failed',
      orderTaskStatus: 'failed',
      errorCode: 'PRINT_JOB_UNCONFIRMED',
    })
    await db.refund.updateMany({
      where: { orderId: blockedId },
      data: { status: 'pending', reason: null },
    })
    const blocked = await verify.verifyOutcome(
      blockedTask,
      { outcome: 'printed', confirm: 'VERIFY_PRINTED' },
      adminId,
    ).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(blocked, 'PRINT_OUTCOME_REFUND_BLOCKED', '退款还在处理时不能核验成已出纸')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: blockedTask } })).printOutcome, null)
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: blockedId } })).payStatus, 'paid')

    const doneId = `ord_${tag}_p2b7done`
    created.push(doneId)
    const doneTask = await seedHold(db, {
      id: doneId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      taskStatus: 'failed',
      orderTaskStatus: 'failed',
      errorCode: 'PRINT_JOB_UNCONFIRMED',
    })
    await db.order.update({ where: { id: doneId }, data: { payStatus: 'refunded' } })
    await db.refund.updateMany({ where: { orderId: doneId }, data: { status: 'success', reason: null } })
    const done = await verify.verifyOutcome(
      doneTask,
      { outcome: 'printed', confirm: 'VERIFY_PRINTED' },
      adminId,
    ).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.notEqual(done, 'ok', '已经退成的单不能再核验成已出纸')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: doneTask } })).printOutcome, null)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: created } }, { targetId: { in: input.taskIds } }] } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId: { in: input.taskIds } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.user.delete({ where: { id: adminId } }).catch(() => undefined)
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
