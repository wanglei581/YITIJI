/**
 * 反方第 1 条：200 分的单第一次只退成 50，不能记成全额已退。
 * 剩下的 150 必须还能从普通退款入口退掉。走和 completePendingRefund 同一套结算。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { settlementAfterSuccess } from '../../src/payment/refund-remainder'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

export async function runP2b6PartialSettlementCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b6pt_${tag}`
  const terminalId = `term_p2b6pt_${tag}`
  const orderId = `ord_${tag}_p2b6_part`
  input.orderIds.push(orderId)
  await db.organization.create({ data: { id: orgId, name: '部分退款结算', type: 'school_employment_center' } })
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
  const orderNo = `P6${tag}`.slice(0, 32)
  try {
    await db.order.create({
      data: {
        id: orderId,
        orderNo,
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'refunding',
        paymentSource: 'offline',
        paidAt: new Date(Date.now() - 60 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: 'pending',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
      },
    })
    const refund = await db.refund.create({
      data: {
        orderId,
        refundNo: `RFD-${orderNo}`,
        amountCents: 50,
        status: 'pending',
        reason: '部分页未出',
        channel: 'offline',
      },
    })
    await db.$transaction(async (tx) => {
      const marked = await tx.refund.updateMany({
        where: { id: refund.id, status: 'pending' },
        data: { status: 'success' },
      })
      assert.equal(marked.count, 1)
      const before = await tx.order.findUniqueOrThrow({ where: { id: orderId } })
      const settlement = await settlementAfterSuccess(tx, refund, before)
      await tx.order.updateMany({
        where: { id: orderId, payStatus: 'refunding' },
        data: {
          payStatus: settlement.payStatus,
          refundedAt: new Date(),
          refundReason: settlement.refundReason,
          refundedAmountCents: settlement.refundedAmountCents,
        },
      })
    })
    const afterFirst = await db.order.findUniqueOrThrow({ where: { id: orderId } })
    assert.equal(afterFirst.payStatus, 'partial_refunded', '第一次只退 50，不能记成全额已退')
    assert.equal(afterFirst.refundedAmountCents, 50)
    const refunds = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([]))
    const rest = await refunds.refund(orderId, { reason: '退还剩余', operatorId: 'admin-test' })
    assert.equal(rest.refund.amountCents, 150)
    assert.equal(rest.refund.status, 'success')
    const afterRest = await db.order.findUniqueOrThrow({ where: { id: orderId } })
    assert.equal(afterRest.payStatus, 'refunded')
    assert.equal(afterRest.refundedAmountCents, 200)
  } finally {
    await db.refund.deleteMany({ where: { orderId } })
    await db.auditLog.deleteMany({ where: { targetId: orderId } })
    await db.order.deleteMany({ where: { id: orderId } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
