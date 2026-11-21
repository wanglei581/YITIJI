/**
 * 窗口已关、没出纸、自动退关着：同一单只记一次待人工。
 * 再跑一轮清扫不能再写一条，也不能再发一次告警。
 */
import assert from 'node:assert/strict'
import { parkClosedWindowUnprinted, PICKUP_WINDOW_CLOSED_UNPRINTED_REASON } from '../../src/payment/closed-window-unprinted'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

export async function runP2b7WindowParkCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b7wp_${tag}`
  const terminalId = `term_p2b7wp_${tag}`
  const orderId = `ord_${tag}_p2b7wp`
  input.orderIds.push(orderId)
  await db.organization.create({ data: { id: orgId, name: '窗口清扫只记一次', type: 'school_employment_center' } })
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
  let notifies = 0
  const notify = async (): Promise<void> => {
    notifies += 1
  }
  try {
    await db.order.create({
      data: {
        id: orderId,
        orderNo: orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'offline',
        paidAt: new Date(Date.now() - 60 * 60 * 1000),
        pickupStatus: 'expired',
        pickupCodeExpiresAt: new Date(Date.now() - 60_000),
        taskStatus: 'pending',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'miniapp_cloud',
      },
    })
    const first = await parkClosedWindowUnprinted(db, orderId, notify)
    const second = await parkClosedWindowUnprinted(db, orderId, notify)
    assert.equal(first, 'manual')
    assert.equal(second, 'skipped', '第二轮清扫不能再记一次')
    assert.equal(notifies, 1, '第二轮清扫不能再发告警')
    const rows = await db.refund.findMany({
      where: { orderId, reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON },
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.status, 'manual_review')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).payStatus, 'paid')
  } finally {
    await db.refund.deleteMany({ where: { orderId } })
    await db.auditLog.deleteMany({ where: { targetId: orderId } })
    await db.order.deleteMany({ where: { id: orderId } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
