/**
 * 部分退款剩下的钱要能再退，并出现在需关注。已出纸且退款失败也进需关注。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import { RefundService } from '../../src/payment/refund.service'
import { SandboxPaymentProvider } from '../../src/payment/providers/sandbox-payment.provider'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const SANDBOX_SECRET = 'verify-p2b5-sandbox-secret-0123456789abcd'

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return ''
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? ''
}

export async function runP2b5RemainderCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5r_${tag}`
  const terminalId = `term_p2b5r_${tag}`
  await db.organization.create({ data: { id: orgId, name: '剩余退款', type: 'school_employment_center' } })
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
  const partialId = `ord_${tag}_p2b5_part`
  const printedId = `ord_${tag}_p2b5_pfail`
  const created = [partialId, printedId]
  input.orderIds.push(...created)
  try {
    const partialTask = `pt_${partialId}`
    const printedTask = `pt_${printedId}`
    input.taskIds.push(partialTask, printedTask)
    await db.printTask.create({
      data: {
        id: partialTask,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode: 'PRINT_QUEUE_TIMEOUT',
        printOutcome: 'not_printed',
        orderId: partialId,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id: partialId,
        orderNo: `R5${tag}part`.slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        refundedAmountCents: 50,
        payStatus: 'partial_refunded',
        paymentSource: 'sandbox',
        paidAt: new Date(),
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: partialTask,
      },
    })
    await db.refund.create({
      data: {
        orderId: partialId,
        refundNo: `RFD-PART-${tag}`,
        amountCents: 50,
        status: 'success',
        reason: '部分退款',
        channel: 'sandbox',
      },
    })
    await db.printTask.create({
      data: {
        id: printedTask,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'completed',
        errorCode: null,
        printOutcome: 'printed',
        orderId: printedId,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id: printedId,
        orderNo: `R5${tag}pfail`.slice(0, 32),
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
        printTaskId: printedTask,
      },
    })
    await db.refund.create({
      data: {
        orderId: printedId,
        refundNo: `RFD-PFAIL-${tag}`,
        amountCents: 200,
        status: 'failed',
        reason: '已出纸后退款失败',
        channel: 'sandbox',
      },
    })

    const orders = new AdminOrdersReadonlyService(db)
    const partialNo = (await db.order.findUniqueOrThrow({ where: { id: partialId } })).orderNo
    const printedNo = (await db.order.findUniqueOrThrow({ where: { id: printedId } })).orderNo
    const attention = await orders.list({ opsAttention: true, search: partialNo, page: 1, pageSize: 20 })
    const partialItem = attention.items.find((item) => item.id === partialId)
    assert.ok(partialItem, '部分退款必须出现在需关注')
    assert.equal(partialItem?.opsAttentionCode, 'partial_refunded')
    const printedAttention = await orders.list({ opsAttention: true, search: printedNo, page: 1, pageSize: 20 })
    const printedItem = printedAttention.items.find((item) => item.id === printedId)
    assert.ok(printedItem, '已出纸且退款失败必须出现在需关注')
    assert.equal(printedItem?.opsAttentionCode, 'paper_refund_failed')

    const detail = await orders.getById(partialId)
    assert.equal(detail.refundRemainderCents, 150)
    assert.equal(detail.refundEligible, true)

    const held = await resolvePrintReturnHold(db, partialId, 'confirm_refunded', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(held, 'REFUND_REMAINDER_REQUIRED')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: `RFD-PART-${tag}` } })).status, 'success')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: partialId } })).payStatus, 'partial_refunded')

    const refunds = new RefundService(
      db,
      new AuditService(db),
      new PaymentProviderRegistry([new SandboxPaymentProvider(SANDBOX_SECRET)]),
    )
    const done = await refunds.refund(partialId, { reason: '退还剩余', operatorId: 'admin-test' })
    assert.equal(done.refund.amountCents, 150)
    assert.equal(done.refund.status, 'success')
    const after = await db.order.findUniqueOrThrow({ where: { id: partialId } })
    assert.equal(after.payStatus, 'refunded')
    assert.equal(after.refundedAmountCents, 200)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
