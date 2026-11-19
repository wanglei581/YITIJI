/**
 * 关单必须和「纸已经出去」抢同一条条件。
 * 行锁只写 printOutcome=printed 再放行关单，不能既关单又留下已出纸。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService, PrismaTransactionClient } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const ROUNDS = 20

function errorCode(error: unknown): string {
  if (error instanceof BadRequestException) {
    const body = error.getResponse()
    if (typeof body === 'string') return body
    const wrapped = body as { error?: { code?: string } }
    return wrapped.error?.code ?? 'error'
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
  throw new Error('关单没有等到打印任务行锁')
}

async function seedCloseable(
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
      status: 'failed',
      errorCode: 'PRINT_COMMAND_FAILED',
      printOutcome: null,
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
      orderId: input.id,
      refundNo: `RFD-P8CL-${input.id}`.slice(0, 40),
      amountCents: 200,
      status: 'failed',
      reason: '渠道明确失败',
      channel: 'offline',
    },
  })
  return taskId
}

export async function runP2b8CloseRaceCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b8cl_${tag}`
  const terminalId = `term_p2b8cl_${tag}`
  await db.organization.create({ data: { id: orgId, name: '关单与出纸', type: 'school_employment_center' } })
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
      const id = `ord_${tag}_p2b8c${round}`
      created.push(id)
      const taskId = await seedCloseable(db, { id, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
      let notifyLocked!: () => void
      const locked = new Promise<void>((resolve) => { notifyLocked = resolve })
      let release!: () => void
      const releasedGate = new Promise<void>((resolve) => { release = resolve })
      const holder = db.$transaction(async (tx: PrismaTransactionClient) => {
        const wrote = await tx.printTask.updateMany({
          where: { id: taskId, printOutcome: null },
          data: { printOutcome: 'printed' },
        })
        assert.equal(wrote.count, 1, `${id} 没有锁住打印任务`)
        notifyLocked()
        await releasedGate
      }, { timeout: 15_000, maxWait: 5_000 })
      await locked
      const closeP = resolvePrintReturnHold(db, id, 'close_order', 'admin-test').then(
        () => 'ok',
        (error: unknown) => errorCode(error),
      )
      if (db.dbKind === 'postgres') await waitForLockWaiter(db)
      release()
      const [closeCode] = await Promise.all([closeP, holder])
      const order = await db.order.findUniqueOrThrow({ where: { id } })
      const task = await db.printTask.findUniqueOrThrow({ where: { id: taskId } })
      const closed = order.payStatus === 'closed'
      const paper = task.printOutcome === 'printed'
      assert.equal(closed && paper, false, `第 ${round} 轮既关单又出纸 code=${closeCode} pay=${order.payStatus} outcome=${task.printOutcome}`)
      assert.equal((closed ? 1 : 0) + (paper ? 1 : 0), 1, `第 ${round} 轮 code=${closeCode} pay=${order.payStatus} outcome=${task.printOutcome}`)
      assert.equal(paper, true, `第 ${round} 轮纸的标记丢了`)
      assert.equal(closeCode, 'PAPER_ALREADY_OUT_CANNOT_CLOSE')
      assert.notEqual(order.payStatus, 'closed')
    }

    const plainId = `ord_${tag}_p2b8_plain`
    created.push(plainId)
    await seedCloseable(db, { id: plainId, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
    const plain = await resolvePrintReturnHold(db, plainId, 'close_order', 'admin-test')
    assert.equal(plain.payStatus, 'closed')
    assert.notEqual((await db.printTask.findFirstOrThrow({ where: { orderId: plainId } })).printOutcome, 'printed')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: plainId } })).status, 'closed')
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
