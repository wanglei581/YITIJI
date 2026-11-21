/**
 * 确认改为出纸和终端领取抢同一行。
 * 领取先把订单和任务改成已领并占着行锁时，改为出纸不能再把订单改回待打印。
 * PostgreSQL 上 20 轮只放行一次出纸。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
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
  throw new Error('改为出纸没有等到订单行锁')
}

export async function runP2b7ReleaseRaceCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b7rr_${tag}`
  const terminalId = `term_p2b7rr_${tag}`
  await db.organization.create({ data: { id: orgId, name: '改为出纸并发', type: 'school_employment_center' } })
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
      const id = `ord_${tag}_p2b7rr${round}`
      created.push(id)
      const taskId = `pt_${id}`
      input.orderIds.push(id)
      input.taskIds.push(taskId)
      await db.printTask.create({
        data: {
          id: taskId,
          fileUrl: 'https://example.invalid/print',
          fileMd5: 'md5',
          status: 'pending',
          orderId: id,
          terminalId,
        },
      })
      await db.order.create({
        data: {
          id,
          orderNo: id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
          type: 'print',
          terminalId,
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
          orderId: id,
          refundNo: `RFD-RR-${id}`.slice(0, 40),
          amountCents: 200,
          status: 'manual_review',
          reason: '卡纸待人工',
          channel: 'offline',
        },
      })
      const releaseCode = await holdThenRelease(db, id, async (tx) => {
        const orderLocked = await tx.order.updateMany({
          where: { id, payStatus: 'paid', taskStatus: 'pending' },
          data: { taskStatus: 'printing' },
        })
        assert.equal(orderLocked.count, 1, `${id} 领取没有锁住订单`)
        const taskLocked = await tx.printTask.updateMany({
          where: { id: taskId, status: 'pending' },
          data: { status: 'printing' },
        })
        assert.equal(taskLocked.count, 1, `${id} 领取没有锁住任务`)
      })
      const order = await db.order.findUniqueOrThrow({ where: { id } })
      const task = await db.printTask.findUniqueOrThrow({ where: { id: taskId } })
      const refund = await db.refund.findFirstOrThrow({ where: { orderId: id } })
      const paper = task.status === 'printing' || task.status === 'claimed' || order.taskStatus === 'printing' || order.taskStatus === 'claimed'
      const reopened = releaseCode === 'ok'
      assert.equal(paper && reopened, false, `改为出纸 第 ${round} 轮既在打又放行 release=${releaseCode} orderTask=${order.taskStatus} task=${task.status}`)
      assert.equal((paper ? 1 : 0) + (reopened ? 1 : 0), 1, `改为出纸 第 ${round} 轮 release=${releaseCode} orderTask=${order.taskStatus} task=${task.status}`)
      assert.equal(order.taskStatus, 'printing')
      assert.equal(task.status, 'printing')
      assert.equal(refund.status, 'manual_review')
      assert.equal(releaseCode, 'PAPER_ALREADY_RELEASED')
      if (db.dbKind === 'postgres') {
        assert.equal(await db.auditLog.count({ where: { targetId: id, action: 'refund.hold_rejected' } }), 1)
      }
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

async function holdThenRelease(
  db: PrismaService,
  id: string,
  write: (tx: PrismaTransactionClient) => Promise<void>,
): Promise<string> {
  let notifyLocked!: () => void
  const locked = new Promise<void>((resolve) => { notifyLocked = resolve })
  let releaseGate!: () => void
  const releasedGate = new Promise<void>((resolve) => { releaseGate = resolve })
  const holder = db.$transaction(async (tx) => {
    await write(tx)
    notifyLocked()
    await releasedGate
  }, { timeout: 15_000, maxWait: 5_000 })
  await locked
  const releaseP = resolvePrintReturnHold(db, id, 'release_paper', 'admin-test').then(
    () => 'ok',
    (error: unknown) => errorCode(error),
  )
  if (db.dbKind === 'postgres') await waitForLockWaiter(db)
  releaseGate()
  const [releaseCode] = await Promise.all([releaseP, holder])
  return releaseCode
}
