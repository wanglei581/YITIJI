/**
 * 渠道还没答复的 pending 退款，三步都不放行。sandbox 没有查证。
 * 并发夹具是渠道已经明确失败，确认退成和关单仍只成功一笔。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { SandboxPaymentProvider } from '../../src/payment/providers/sandbox-payment.provider'
import { RefundService } from '../../src/payment/refund.service'
import { resolvePrintReturnHold, type PrintReturnResolution } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const SANDBOX_SECRET = 'verify-p2b5-sandbox-secret-0123456789abcd'

export async function runP2b5PendingHoldCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5h_${tag}`
  const terminalId = `term_p2b5h_${tag}`
  await db.organization.create({ data: { id: orgId, name: '待人工退款', type: 'school_employment_center' } })
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
  const ids = {
    confirm: `ord_${tag}_p2b5_pend_c`,
    release: `ord_${tag}_p2b5_pend_r`,
    close: `ord_${tag}_p2b5_pend_x`,
  }
  const created = Object.values(ids)
  input.orderIds.push(...created)
  try {
    for (const [key, id] of Object.entries(ids)) {
      const taskId = `pt_${id}`
      input.taskIds.push(taskId)
      await db.printTask.create({
        data: {
          id: taskId,
          fileUrl: 'https://example.invalid/print',
          fileMd5: 'md5',
          status: 'failed',
          errorCode: 'PRINT_QUEUE_TIMEOUT',
          printOutcome: 'not_printed',
          orderId: id,
          terminalId,
        },
      })
      await db.order.create({
        data: {
          id,
          orderNo: `H5${tag}${key}`.slice(0, 32),
          type: 'print',
          terminalId,
          amountCents: 200,
          discountCents: 0,
          payStatus: 'paid',
          paymentSource: 'sandbox',
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
          orderId: id,
          refundNo: `RFD-PEND-${tag}-${key}`,
          amountCents: 200,
          status: 'pending',
          reason: '渠道还没确认退款结果',
          channel: 'sandbox',
          channelSubmittedAt: new Date(),
        },
      })
    }

    const confirmed = await resolvePrintReturnHold(db, ids.confirm, 'confirm_refunded', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(confirmed, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: ids.confirm } })).status, 'pending')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: ids.confirm } })).payStatus, 'paid')
    const releaseCode = await resolvePrintReturnHold(db, ids.release, 'release_paper', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(releaseCode, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: ids.release } })).payStatus, 'paid')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: ids.release } })).status, 'pending')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: ids.release } })).status, 'failed')
    assert.equal(await db.auditLog.count({ where: { targetId: ids.release, action: 'refund.hold_rejected' } }), 1)
    const closed = await resolvePrintReturnHold(db, ids.close, 'close_order', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(closed, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: ids.close } })).status, 'pending')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: ids.close } })).payStatus, 'paid')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

async function seedPending(
  db: PrismaService,
  input: { id: string; terminalId: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const taskId = `pt_${input.id}`
  input.taskIds.push(taskId)
  input.orderIds.push(input.id)
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: 'pending',
      printOutcome: null,
      orderId: input.id,
      terminalId: input.terminalId,
    },
  })
  await db.order.create({
    data: {
      id: input.id,
      orderNo: input.id.slice(0, 32),
      type: 'print',
      terminalId: input.terminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'paid',
      paymentSource: 'sandbox',
      paidAt: new Date(),
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
      orderId: input.id,
      refundNo: `RFD-RACE-${input.id}`.slice(0, 40),
      amountCents: 200,
      status: 'failed',
      reason: '渠道明确失败',
      channel: 'sandbox',
    },
  })
}

/** 确认退成和关单并发，以及同一按钮连点，只成功一笔。 */
export async function runP2b5HoldRaceCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5race_${tag}`
  const terminalId = `term_p2b5race_${tag}`
  await db.organization.create({ data: { id: orgId, name: '退款并发', type: 'school_employment_center' } })
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
    const race = async (round: number, left: PrintReturnResolution, right: PrintReturnResolution): Promise<void> => {
      const id = `ord_${tag}_${left.slice(0, 1)}${right.slice(0, 1)}${round}`
      created.push(id)
      await seedPending(db, { id, terminalId, orderIds: input.orderIds, taskIds: input.taskIds })
      const run = (action: PrintReturnResolution) => resolvePrintReturnHold(db, id, action, 'admin-test').then(
        () => 'ok',
        (error: unknown) => errorCode(error),
      )
      const [a, b] = await Promise.all([run(left), run(right)])
      const wins = [a, b].filter((item) => item === 'ok')
      assert.equal(wins.length, 1, `${left}/${right} 第 ${round} 轮成功 ${wins.length} 笔：${a}/${b}`)
      const lost = [a, b].find((item) => item !== 'ok')
      assert.equal(lost, 'REFUND_HOLD_ALREADY_RESOLVED', `${left}/${right} 第 ${round} 轮失败码 ${lost}`)
      const order = await db.order.findUniqueOrThrow({ where: { id } })
      const refund = await db.refund.findFirstOrThrow({ where: { orderId: id } })
      const both = order.payStatus === 'closed' && refund.status === 'success' && order.refundedAmountCents === 200
      assert.equal(both, false, `${id} 不能既关单又把退款记成成功`)
      const audits = await db.auditLog.count({ where: { targetId: id, action: 'refund.hold_resolved' } })
      assert.equal(audits, 1, `${id} 审计 ${audits} 条`)
    }
    for (let round = 0; round < 20; round += 1) {
      await race(round, 'confirm_refunded', 'close_order')
      await race(round + 100, 'confirm_refunded', 'confirm_refunded')
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

/** 已出纸且退款失败：确认退成拒绝，改为出纸被拒也写审计，只走核对后仍退款。 */
export async function runP2b5PrintedConfirmCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5paper_${tag}`
  const terminalId = `term_p2b5paper_${tag}`
  const orderId = `ord_${tag}_p2b5_printed`
  input.orderIds.push(orderId)
  const taskId = `pt_${orderId}`
  input.taskIds.push(taskId)
  await db.organization.create({ data: { id: orgId, name: '已出纸退款', type: 'school_employment_center' } })
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
  try {
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'completed',
        printOutcome: 'printed',
        orderId,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id: orderId,
        orderNo: `P5${tag}paper`.slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'sandbox',
        paidAt: new Date(),
        pickupStatus: 'pending',
        taskStatus: 'completed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    await db.refund.create({
      data: {
        orderId,
        refundNo: `RFD-PAPER-${tag}`,
        amountCents: 200,
        status: 'failed',
        reason: '已出纸后退款失败',
        channel: 'sandbox',
      },
    })
    const confirmCode = await resolvePrintReturnHold(db, orderId, 'confirm_refunded', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(confirmCode, 'PAPER_ALREADY_RELEASED')
    const afterConfirm = await db.order.findUniqueOrThrow({ where: { id: orderId } })
    assert.equal(afterConfirm.payStatus, 'paid')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: `RFD-PAPER-${tag}` } })).status, 'failed')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: taskId } })).printOutcome, 'printed')
    assert.equal(await db.auditLog.count({ where: { targetId: orderId, action: 'refund.paper_checked' } }), 0)
    const releaseCode = await resolvePrintReturnHold(db, orderId, 'release_paper', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(releaseCode, 'PAPER_ALREADY_RELEASED')
    assert.equal(await db.auditLog.count({ where: { targetId: orderId, action: 'refund.hold_rejected' } }), 1)
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).payStatus, 'paid')
    const refunds = new RefundService(
      db,
      new AuditService(db),
      new PaymentProviderRegistry([new SandboxPaymentProvider(SANDBOX_SECRET)]),
    )
    const done = await refunds.refund(orderId, { reason: '核对后仍退款', operatorId: 'admin-test', verifiedAfterPaper: true })
    assert.equal(done.refund.status, 'success')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).payStatus, 'refunded')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: taskId } })).printOutcome, 'printed')
    const checked = await db.auditLog.findFirst({ where: { targetId: orderId, action: 'refund.paper_checked' } })
    assert.match(checked?.payloadJson ?? '', /核对后仍退款/)
  } finally {
    await db.refund.deleteMany({ where: { orderId } })
    await db.auditLog.deleteMany({ where: { targetId: orderId } })
    await db.order.deleteMany({ where: { id: orderId } })
    await db.printTask.deleteMany({ where: { id: taskId } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
