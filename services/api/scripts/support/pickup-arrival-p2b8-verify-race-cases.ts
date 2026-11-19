/**
 * 核验出纸和「把退款改成在途」必须抢同一把订单锁。
 * 核验先等锁、退款后提交：不能既写成已出纸，退款又停在处理中。
 * 渠道没受理过的待人工，核验已出纸要放行，并在同一事务里撤回。
 * 未出纸不撤回。渠道还在途的，核验拒绝且不撤回。
 */
import assert from 'node:assert/strict'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { PICKUP_WINDOW_CLOSED_UNPRINTED_REASON } from '../../src/payment/closed-window-unprinted'
import { listPrintReturnHolds } from '../../src/payment/print-return-disposition'
import { stageNewRefund } from '../../src/payment/stage-order-refund'
import { AdminPrintJobsVerifyOutcomeService } from '../../src/print-jobs/admin-print-jobs-verify-outcome.service'
import type { PrismaService, PrismaTransactionClient } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const ROUNDS = 20
const WITHDRAW_REASON = '核验已出纸'

function errorCode(error: unknown): string {
  if (error instanceof BadRequestException || error instanceof ConflictException) {
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
  throw new Error('核验出纸没有等到订单行锁')
}

async function seedUnconfirmed(
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
      errorCode: 'PRINT_JOB_UNCONFIRMED',
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
      paymentSource: 'wechat',
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
  return taskId
}

async function holdOrderThen(
  db: PrismaService,
  id: string,
  write: (tx: PrismaTransactionClient) => Promise<void>,
  verify: () => Promise<string>,
): Promise<string> {
  let notifyLocked!: () => void
  const locked = new Promise<void>((resolve) => { notifyLocked = resolve })
  let release!: () => void
  const releasedGate = new Promise<void>((resolve) => { release = resolve })
  const holder = db.$transaction(async (tx) => {
    if (db.dbKind === 'postgres') {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`
    } else {
      await tx.order.updateMany({ where: { id }, data: { updatedAt: new Date() } })
    }
    await write(tx)
    notifyLocked()
    await releasedGate
  }, { timeout: 15_000, maxWait: 5_000 })
  await locked
  const verifyP = verify()
  if (db.dbKind === 'postgres') await waitForLockWaiter(db)
  release()
  const [code] = await Promise.all([verifyP, holder])
  return code
}

export async function runP2b8VerifyRaceCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b8vr_${tag}`
  const terminalId = `term_p2b8vr_${tag}`
  const adminId = `user_p2b8vr_${tag}`
  await db.organization.create({ data: { id: orgId, name: '核验与在途退款', type: 'school_employment_center' } })
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
      username: `p2b8vr_${tag}`,
      name: '核验出纸',
      passwordHash: 'hash',
      role: 'admin',
      enabled: true,
      tokenVersion: 0,
    },
  })
  const verifySvc = new AdminPrintJobsVerifyOutcomeService(db, new AuditService(db))
  const created: string[] = []
  const ask = (taskId: string, outcome: 'printed' | 'not_printed') => verifySvc.verifyOutcome(
    taskId,
    { outcome, confirm: outcome === 'printed' ? 'VERIFY_PRINTED' : 'VERIFY_NOT_PRINTED' },
    adminId,
  ).then(() => 'ok', (error: unknown) => errorCode(error))

  try {
    for (let round = 0; round < ROUNDS; round += 1) {
        const id = `ord_${tag}_p2b8vr${round}`
        created.push(id)
        const taskId = await seedUnconfirmed(db, { id, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
        const code = await holdOrderThen(db, id, async (tx) => {
          await tx.refund.create({
            data: {
              orderId: id,
              refundNo: `RFD-P8VR-${tag}-${round}`.slice(0, 40),
              amountCents: 200,
              status: 'pending',
              reason: null,
              channel: 'wechat',
              channelRefundNo: `WX-P8VR-${tag}-${round}`.slice(0, 32),
              channelSubmittedAt: new Date(),
            },
          })
        }, () => ask(taskId, 'printed'))
        const task = await db.printTask.findUniqueOrThrow({ where: { id: taskId } })
        const refund = await db.refund.findFirstOrThrow({ where: { orderId: id } })
        const paper = task.printOutcome === 'printed'
        const inflight = refund.status === 'pending'
        assert.equal(paper && inflight, false, `第 ${round} 轮既出纸又在退 code=${code} outcome=${task.printOutcome} refund=${refund.status}`)
        assert.equal(inflight, true, `第 ${round} 轮退款应该留在处理中 code=${code}`)
        assert.equal(paper, false, `第 ${round} 轮核验不该写成已出纸 code=${code}`)
        assert.equal(code, 'PRINT_OUTCOME_REFUND_BLOCKED')
      }

    const pendingFirst = `ord_${tag}_p2b8_pf`
    created.push(pendingFirst)
    const pendingTask = await seedUnconfirmed(db, {
      id: pendingFirst,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
    })
    await db.refund.create({
      data: {
        orderId: pendingFirst,
        refundNo: `RFD-P8PF-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'pending',
        reason: null,
        channel: 'wechat',
        channelRefundNo: `WX-PF-${tag}`.slice(0, 32),
        channelSubmittedAt: new Date(),
      },
    })
    const pendingCode = await ask(pendingTask, 'printed')
    assert.equal(pendingCode, 'PRINT_OUTCOME_REFUND_BLOCKED', '先提交在途退款，再核验必须拒绝')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: pendingTask } })).printOutcome, null)
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: pendingFirst } })).status, 'pending')

    const paperFirst = `ord_${tag}_p2b8_yp`
    created.push(paperFirst)
    const paperTask = await seedUnconfirmed(db, {
      id: paperFirst,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
    })
    const paperCode = await ask(paperTask, 'printed')
    assert.equal(paperCode, 'ok', '还没有退款时核验已出纸要成功')
    const opened = await stageNewRefund(db, {
      orderId: paperFirst,
      refundNo: `RFD-P8YP-${tag}`.slice(0, 40),
      reason: '核验之后再退',
      channel: 'wechat',
      amountCents: 200,
      operatorId: adminId,
      collected: false,
      unreleasedOnly: false,
      verifiedAfterPaper: false,
    }).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(opened, 'PAPER_ALREADY_RELEASED', '先核验已出纸，再发起退款必须拒绝')
    assert.equal(await db.refund.count({ where: { orderId: paperFirst, status: 'pending' } }), 0)
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: paperTask } })).printOutcome, 'printed')

    const localId = `ord_${tag}_p2b8_loc`
    created.push(localId)
    const localTask = await seedUnconfirmed(db, {
      id: localId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
    })
    await db.refund.create({
      data: {
        orderId: localId,
        refundNo: `RFD-WINDOW-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'manual_review',
        reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON,
        channel: 'wechat',
      },
    })
    const before = await new AdminOrdersReadonlyService(db).getById(localId)
    assert.equal(before.opsAttention, true, '渠道没受理的待人工要出现在需关注')
    const localCode = await ask(localTask, 'printed')
    assert.equal(localCode, 'ok')
    const localRefund = await db.refund.findFirstOrThrow({ where: { orderId: localId } })
    assert.equal(localRefund.status, 'withdrawn')
    assert.equal(localRefund.reason, WITHDRAW_REASON)
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: localTask } })).printOutcome, 'printed')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: localId } })).payStatus, 'paid')
    const withdrawnAudit = await db.auditLog.findFirst({
      where: { targetId: localId, action: 'refund.hold_resolved' },
    })
    assert.match(withdrawnAudit?.payloadJson ?? '', /核验已出纸/)
    const after = await new AdminOrdersReadonlyService(db).getById(localId)
    assert.equal(after.opsAttention, false, '撤回后需关注里不再出现')
    assert.equal((await listPrintReturnHolds(db)).some((hold) => hold.orderId === localId), false)

    const quietId = `ord_${tag}_p2b8_np`
    created.push(quietId)
    const quietTask = await seedUnconfirmed(db, {
      id: quietId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
    })
    await db.refund.create({
      data: {
        orderId: quietId,
        refundNo: `RFD-WINDOW-NP-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'manual_review',
        reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON,
        channel: 'wechat',
      },
    })
    const quietCode = await ask(quietTask, 'not_printed')
    assert.equal(quietCode, 'ok')
    const quietRefund = await db.refund.findFirstOrThrow({ where: { orderId: quietId } })
    assert.equal(quietRefund.status, 'manual_review', '核验未出纸不能撤回待人工')
    assert.equal(quietRefund.reason, PICKUP_WINDOW_CLOSED_UNPRINTED_REASON)
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: quietTask } })).printOutcome, 'not_printed')

    const channelHold = `ord_${tag}_p2b8_ch`
    created.push(channelHold)
    const channelTask = await seedUnconfirmed(db, {
      id: channelHold,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
    })
    await db.refund.create({
      data: {
        orderId: channelHold,
        refundNo: `RFD-P8CH-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'manual_review',
        reason: '渠道还没确认退款结果',
        channel: 'wechat',
        channelRefundNo: `WX-CH-${tag}`.slice(0, 32),
        channelSubmittedAt: new Date(),
      },
    })
    const channelCode = await ask(channelTask, 'printed')
    assert.equal(channelCode, 'PRINT_OUTCOME_REFUND_BLOCKED', '渠道受理过的待人工不能核验出纸')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: channelHold } })).status, 'manual_review')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: channelTask } })).printOutcome, null)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({
      where: { OR: [{ targetId: { in: created } }, { targetId: { in: input.taskIds } }] },
    })
    await db.printTaskStatusLog.deleteMany({ where: { taskId: { in: input.taskIds } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { id: { in: input.taskIds } } })
    await db.user.deleteMany({ where: { id: adminId } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
