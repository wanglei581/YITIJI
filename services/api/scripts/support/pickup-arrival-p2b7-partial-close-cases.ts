/**
 * 部分退款后再关单会把剩下的钱收成关闭。
 * 已退一部分的单不许直接关单。剩下的钱再退，或留在待人工。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

export async function runP2b7PartialCloseCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b7pc_${tag}`
  const terminalId = `term_p2b7pc_${tag}`
  await db.organization.create({ data: { id: orgId, name: '部分退款不能关单', type: 'school_employment_center' } })
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
    const failedId = await seed(db, input, created, tag, terminalId, 'failed')
    const failedCode = await resolvePrintReturnHold(db, failedId, 'close_order', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(failedCode, 'PARTIAL_REFUND_CANNOT_CLOSE')
    const failedOrder = await db.order.findUniqueOrThrow({ where: { id: failedId } })
    assert.equal(failedOrder.payStatus, 'partial_refunded')
    assert.equal(failedOrder.refundedAmountCents, 50)
    assert.equal(failedOrder.taskStatus, 'failed')
    const failedRows = await db.refund.findMany({ where: { orderId: failedId }, orderBy: { amountCents: 'asc' } })
    assert.deepEqual(failedRows.map((row) => row.status), ['success', 'failed'])
    const failedAudit = await db.auditLog.findFirst({
      where: { targetId: failedId, action: 'refund.hold_rejected' },
      orderBy: { createdAt: 'desc' },
    })
    assert.match(failedAudit?.payloadJson ?? '', /PARTIAL_REFUND_CANNOT_CLOSE/)

    const reviewId = await seed(db, input, created, tag, terminalId, 'manual_review')
    const reviewCode = await resolvePrintReturnHold(db, reviewId, 'close_order', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(reviewCode, 'PARTIAL_REFUND_CANNOT_CLOSE')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: reviewId } })).payStatus, 'partial_refunded')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}

async function seed(
  db: PrismaService,
  input: { orderIds: string[]; taskIds: string[] },
  created: string[],
  tag: string,
  terminalId: string,
  holdStatus: 'failed' | 'manual_review',
): Promise<string> {
  const id = `ord_${tag}_p2b7pc_${holdStatus}`
  const taskId = `pt_${id}`
  created.push(id)
  input.orderIds.push(id)
  input.taskIds.push(taskId)
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: 'failed',
      printOutcome: 'not_printed',
      errorCode: 'PAPER_JAM',
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
      refundedAmountCents: 50,
      payStatus: 'partial_refunded',
      paymentSource: 'offline',
      paidAt: new Date(Date.now() - 60 * 60 * 1000),
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
      refundNo: `RFD-PC-OK-${tag}-${holdStatus}`.slice(0, 40),
      amountCents: 50,
      status: 'success',
      reason: '部分页未出',
      channel: 'offline',
    },
  })
  await db.refund.create({
    data: {
      orderId: id,
      refundNo: `RFD-PC-HOLD-${tag}-${holdStatus}`.slice(0, 40),
      amountCents: 150,
      status: holdStatus,
      reason: '退还剩余没有成功',
      channel: 'offline',
    },
  })
  return id
}
