/**
 * 渠道受理过、还没有明确失败答复时，确认退成、改为出纸、关单都不放行。
 * 渠道说成功就按渠道记退成，不改出纸、不关单。渠道说失败后，三步照常。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import type { RefundChannelVerdict } from '../../src/payment/resolve-print-return-hold'
import { resolvePrintReturnHold, type PrintReturnResolution } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

async function seed(
  db: PrismaService,
  input: {
    id: string
    terminalId: string
    orderIds: string[]
    taskIds: string[]
    taskStatus?: string
    printOutcome?: string | null
  },
): Promise<void> {
  const taskId = `pt_${input.id}`
  input.taskIds.push(taskId)
  input.orderIds.push(input.id)
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: input.taskStatus ?? 'failed',
      printOutcome: input.printOutcome === undefined ? 'not_printed' : input.printOutcome,
      errorCode: 'PAPER_JAM',
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
      paidAt: new Date(Date.now() - 30 * 60 * 1000),
      pickupStatus: 'pending',
      taskStatus: input.taskStatus ?? 'failed',
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
      refundNo: `RFD-P8S-${input.id}`.slice(0, 40),
      amountCents: 200,
      status: 'pending',
      reason: '渠道还没确认退款结果',
      channel: 'wechat',
      channelRefundNo: `WX-${input.id}`.slice(0, 32),
      channelSubmittedAt: new Date(),
    },
  })
}

export async function runP2b8ChannelStepsCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b8st_${tag}`
  const terminalId = `term_p2b8st_${tag}`
  await db.organization.create({ data: { id: orgId, name: '渠道在途三步', type: 'school_employment_center' } })
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
  const actions: PrintReturnResolution[] = ['confirm_refunded', 'release_paper', 'close_order']
  try {
    for (const action of actions) {
      const id = `ord_${tag}_p2b8_nq_${action.slice(0, 3)}`
      await seed(db, { id, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
      created.push(id)
      const code = await resolvePrintReturnHold(db, id, action, 'admin-test').then(
        () => 'ok',
        (error: unknown) => errorCode(error),
      )
      assert.equal(code, 'REFUND_CHANNEL_UNCONFIRMED', `${action} 不查渠道也不能处置在途退款`)
      assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: id } })).status, 'pending')
      assert.equal((await db.order.findUniqueOrThrow({ where: { id } })).payStatus, 'paid')
      assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: id } })).status, 'failed')
      assert.equal(await db.auditLog.count({ where: { targetId: id, action: 'refund.hold_rejected' } }), 1)
    }

    for (const verdict of ['processing', 'unknown', 'unsupported'] as const) {
      for (const action of actions) {
        const id = `ord_${tag}_p2b8_${verdict.slice(0, 3)}_${action.slice(0, 3)}`
        await seed(db, { id, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
        created.push(id)
        const code = await resolvePrintReturnHold(db, id, action, 'admin-test', async () => verdict).then(
          () => 'ok',
          (error: unknown) => errorCode(error),
        )
        assert.equal(code, 'REFUND_CHANNEL_UNCONFIRMED', `${action} 在渠道 ${verdict} 时不能处置`)
        assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: id } })).status, 'pending')
        assert.equal((await db.order.findUniqueOrThrow({ where: { id } })).payStatus, 'paid')
        assert.notEqual((await db.printTask.findFirstOrThrow({ where: { orderId: id } })).status, 'pending')
      }
    }

    for (const action of actions) {
      const id = `ord_${tag}_p2b8_fault_${action.slice(0, 3)}`
      await seed(db, { id, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
      created.push(id)
      const code = await resolvePrintReturnHold(db, id, action, 'admin-test', async () => {
        throw new Error('渠道证书读不出来')
      }).then(() => 'ok', (error: unknown) => errorCode(error))
      assert.equal(code, 'REFUND_CHANNEL_QUERY_FAILED', `${action} 查询出错不能处置`)
      assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: id } })).status, 'pending')
      assert.equal((await db.order.findUniqueOrThrow({ where: { id } })).payStatus, 'paid')
      assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: id } })).status, 'failed')
    }

    for (const action of actions) {
      const id = `ord_${tag}_p2b8_ok_${action.slice(0, 3)}`
      await seed(db, { id, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
      created.push(id)
      const done = await resolvePrintReturnHold(db, id, action, 'admin-test', async () => 'success' as RefundChannelVerdict)
      assert.equal(done.payStatus, 'refunded', `${action} 遇到渠道成功必须记退成`)
      assert.equal(done.refundStatus, 'success')
      assert.notEqual(done.taskStatus, 'pending', `${action} 遇到渠道成功不能改为出纸`)
      assert.notEqual((await db.order.findUniqueOrThrow({ where: { id } })).payStatus, 'closed')
      const audit = await db.auditLog.findFirst({ where: { targetId: id, action: 'refund.hold_resolved' } })
      assert.match(audit?.payloadJson ?? '', /确认退款已经退成/)
    }

    const failedRelease = `ord_${tag}_p2b8_fl_rel`
    await seed(db, { id: failedRelease, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
    created.push(failedRelease)
    const released = await resolvePrintReturnHold(db, failedRelease, 'release_paper', 'admin-test', async () => 'failed')
    assert.equal(released.payStatus, 'paid')
    assert.equal(released.refundStatus, 'withdrawn')
    assert.equal(released.taskStatus, 'pending')

    const failedClose = `ord_${tag}_p2b8_fl_cls`
    await seed(db, { id: failedClose, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
    created.push(failedClose)
    const closed = await resolvePrintReturnHold(db, failedClose, 'close_order', 'admin-test', async () => 'failed')
    assert.equal(closed.payStatus, 'closed')
    assert.equal(closed.refundStatus, 'closed')
    assert.notEqual(closed.payStatus, 'refunded')

    const failedConfirm = `ord_${tag}_p2b8_fl_cfm`
    await seed(db, { id: failedConfirm, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
    created.push(failedConfirm)
    const confirmed = await resolvePrintReturnHold(db, failedConfirm, 'confirm_refunded', 'admin-test', async () => 'failed')
    assert.equal(confirmed.payStatus, 'refunded')
    assert.equal(confirmed.refundStatus, 'success')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
