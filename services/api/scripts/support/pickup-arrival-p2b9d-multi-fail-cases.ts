/**
 * P2b9d 第 3 条：多笔退款失败恢复计入 manual_review（agy #3）。
 * - 订单含在途 manual_review（A）+ pending（B），对 B 走 registerChannelResult 记失败后，
 *   order.payStatus 必须保持 'refunding'，不得提前翻回 'paid'。
 * - 当 A 随后也落定为 failed 时，order.payStatus 才恢复为 'paid'。
 * - 即使 A 为过期付款原因、但已提交渠道（channelSubmittedAt != null）且在途 manual_review，
 *   B 记失败后订单同样保持 'refunding'。
 */
import assert from 'node:assert/strict'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { registerChannelResult } from '../../src/payment/refund-channel-registration'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const DAY = 24 * 60 * 60 * 1000

export async function runP2b9dMultiFailCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9d3_${tag}`
  const terminalId = `term_p2b9d3_${tag}`
  await db.organization.create({ data: { id: orgId, name: '多笔失败恢复计入待人工', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const seed = async (label: string, reasonA: string) => {
    const id = `ord_${tag}_p2b9d3_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9D3${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    const refundA = `RFD-${orderNo}-A`
    const refundB = `RFD-${orderNo}-B`
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: { id: taskId, fileUrl: 'https://example.invalid/print', fileMd5: 'md5', status: 'failed', errorCode: 'PAPER_JAM', printOutcome: 'not_printed', orderId: id, terminalId },
    })
    await db.order.create({
      data: {
        id, orderNo, type: 'print', terminalId, amountCents: 200, discountCents: 0, payStatus: 'refunding', paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 2 * DAY), pickupStatus: 'pending', taskStatus: 'failed', billablePages: 2,
        printParamsJson: PAGES, itemsJson: '[]', channel: 'kiosk', printTaskId: taskId,
      },
    })
    const submitted = new Date(Date.now() - DAY - 60_000)
    await db.refund.create({
      data: { orderId: id, refundNo: refundA, amountCents: 100, status: 'manual_review', reason: reasonA, channel: 'wechat', createdAt: submitted, channelSubmittedAt: submitted },
    })
    await db.refund.create({
      data: { orderId: id, refundNo: refundB, amountCents: 100, status: 'pending', reason: '没出纸先退', channel: 'wechat', createdAt: submitted, channelSubmittedAt: submitted },
    })
    return { id, orderNo, refundA, refundB }
  }

  try {
    // 1. 在途 manual_review（A）+ pending（B），对 B 记失败：订单必须保持 refunding。
    const pair = await seed('pair', '金额不符待核对')
    const resB = await registerChannelResult(db, pair.id, {
      refundNo: pair.refundB,
      result: 'not_refunded',
      note: '商户平台查无此笔退款，确认未出款',
      confirmOrderNo: pair.orderNo,
    }, 'admin-p2b9d', {
      supportsQuery: () => true,
      channelQuery: async () => 'failed',
    })
    assert.equal(resB.recordedBy, 'channel')
    assert.equal(resB.refundStatus, 'failed')
    assert.equal(resB.payStatus, 'refunding', '仍有在途 manual_review 时不得把 order.payStatus 提前翻回 paid')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: pair.id } })).payStatus, 'refunding')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: pair.refundA } })).status, 'manual_review')

    // 当 A 随后也明确失败后，订单才恢复为 paid。
    const resA = await registerChannelResult(db, pair.id, {
      refundNo: pair.refundA,
      result: 'not_refunded',
      note: '商户平台确认此笔也未出款',
      confirmOrderNo: pair.orderNo,
    }, 'admin-p2b9d', {
      supportsQuery: () => true,
      channelQuery: async () => 'unknown',
    })
    assert.equal(resA.recordedBy, 'registration')
    assert.equal(resA.refundStatus, 'failed')
    assert.equal(resA.payStatus, 'paid', '两笔全部落定失败后，订单恢复为 paid')

    // 2. 在途过期付款 manual_review（channelSubmittedAt != null）+ pending（B）失败：同样保持 refunding。
    const stalePair = await seed('stale', STALE_ATTEMPT_REFUND_REASON)
    const staleB = await registerChannelResult(db, stalePair.id, {
      refundNo: stalePair.refundB,
      result: 'not_refunded',
      note: '商户平台查无此笔退款，确认未出款',
      confirmOrderNo: stalePair.orderNo,
    }, 'admin-p2b9d', {
      supportsQuery: () => true,
      channelQuery: async () => 'unknown',
    })
    assert.equal(staleB.payStatus, 'refunding', '在途的过期付款 manual_review 也必须挡住订单提前翻回 paid')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
