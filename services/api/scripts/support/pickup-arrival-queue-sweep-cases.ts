/**
 * 排队超时清扫必须真的走到没出纸退款。
 * 个人收费开着：留下成功退款行。关着：不建退款行，只留待人工审计。
 * 去掉清扫里的 settle 调用，这两边都会红。
 */
import assert from 'node:assert/strict'
import { PAID_NO_PAPER_AUTO_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { PAID_UNFULFILLED_PENDING_REFUND_REASON } from '../../src/payment/pending-refund-signal'
import { PRINT_NO_PAPER_MANUAL_AUDIT } from '../../src/payment/print-return-disposition'
import { PERSONAL_CHARGE_SETTING_KEY } from '../../src/payment/terminal-charge.contract'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { expireQueuedPrintTasks, PRINT_QUEUE_TIMEOUT } from '../../src/print-jobs/print-queue-timeout'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

async function seedQueued(
  db: PrismaService,
  input: { id: string; terminalId: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const past = new Date(Date.now() - 40 * 60_000)
  const taskId = `pt_${input.id}`
  await db.printTask.create({
    data: {
      id: taskId,
      terminalId: input.terminalId,
      fileUrl: 'https://example.invalid/queue',
      fileMd5: 'md5',
      status: 'pending',
      orderId: input.id,
    },
  })
  input.taskIds.push(taskId)
  await db.order.create({
    data: {
      id: input.id,
      orderNo: input.id.slice(0, 32),
      type: 'print',
      terminalId: input.terminalId,
      printTaskId: taskId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'paid',
      paymentSource: 'offline',
      paidAt: past,
      taskStatus: 'pending',
      pickupStatus: 'none',
      billablePages: 1,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'kiosk',
    },
  })
  input.orderIds.push(input.id)
  // PrismaService 只转发模型委托和事务。@updatedAt 会盖掉 update()，所以在事务里直接写过去的时间。
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "PrintTask" SET "updatedAt" = ${past} WHERE "id" = ${taskId}`
  })
  const aged = await db.printTask.findUniqueOrThrow({ where: { id: taskId }, select: { updatedAt: true } })
  assert.ok(Math.abs(aged.updatedAt.getTime() - past.getTime()) < 2000, `排队任务时间没有写成过去：${aged.updatedAt.toISOString()}`)
}

export async function runQueueSweepRefundCases(
  db: PrismaService,
  input: { tag: string; terminalId: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const prior = await db.platformSetting.findUnique({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
  const writeSwitch = async (value: string) => {
    await db.platformSetting.upsert({
      where: { key: PERSONAL_CHARGE_SETTING_KEY },
      create: { key: PERSONAL_CHARGE_SETTING_KEY, value },
      update: { value },
    })
  }
  try {
    await writeSwitch('true')
    const onId = `ord_${input.tag}_qsweep_on`
    await seedQueued(db, { id: onId, terminalId: input.terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
    assert.ok(await expireQueuedPrintTasks(db) >= 1)
    const onTask = await db.printTask.findUniqueOrThrow({ where: { id: `pt_${onId}` } })
    assert.equal(onTask.status, 'failed')
    assert.equal(onTask.errorCode, PRINT_QUEUE_TIMEOUT)
    const onRefunds = await db.refund.findMany({ where: { orderId: onId, reason: PAID_NO_PAPER_AUTO_REASON } })
    assert.equal(onRefunds.length, 1)
    assert.equal(onRefunds[0]?.status, 'success')
    assert.equal(onRefunds[0]?.amountCents, 200)

    await writeSwitch('false')
    const offId = `ord_${input.tag}_qsweep_off`
    await seedQueued(db, { id: offId, terminalId: input.terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
    assert.ok(await expireQueuedPrintTasks(db) >= 1)
    assert.equal(await db.refund.count({ where: { orderId: offId } }), 0)
    const offOrder = await db.order.findUniqueOrThrow({ where: { id: offId } })
    assert.equal(offOrder.refundReason, PAID_UNFULFILLED_PENDING_REFUND_REASON)
    assert.equal(offOrder.taskStatus, 'failed')
    const offAudit = await db.auditLog.findFirst({ where: { targetId: offId, action: PRINT_NO_PAPER_MANUAL_AUDIT } })
    assert.ok(offAudit, '开关关着时清扫仍要留下待人工审计')
  } finally {
    if (prior) {
      await writeSwitch(prior.value)
    } else {
      await db.platformSetting.deleteMany({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
    }
  }
}
