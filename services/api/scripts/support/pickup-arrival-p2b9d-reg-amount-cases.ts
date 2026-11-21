/**
 * P2b9d 第 6 条：按商户平台核实结果登记支持填实退金额（agy #7 + 18:22 裁定）。
 * - 严格校验 0 < actualAmountCents <= refund.amountCents（0、负数、超上限、非整数全拒 REGISTRATION_AMOUNT_INVALID）。
 * - 实退小于实付（200 分单实退 60 分）：Refund.status='success'、amountCents=60、order.payStatus='partial_refunded'、
 *   refundedAmountCents=60、remainderAmountCents=140，且余款 140 仍可经 RefundService.refund() 退完至 refunded。
 * - 实退等于申请额（200 分）：记为整单 refunded。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { registerChannelResult } from '../../src/payment/refund-channel-registration'
import { remainderAmountCents } from '../../src/payment/refund-remainder'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const DAY = 24 * 60 * 60 * 1000

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } } | string
  if (typeof body === 'string') return body
  return body?.error?.code ?? error.message
}

export async function runP2b9dRegAmountCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9d6_${tag}`
  const terminalId = `term_p2b9d6_${tag}`
  await db.organization.create({ data: { id: orgId, name: '登记实退金额', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const seed = async (label: string) => {
    const id = `ord_${tag}_p2b9d6_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9D6${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    const refundNo = `RFD-${orderNo}`
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
    await db.paymentAttempt.create({
      data: { id: `pa_${id}`, orderId: id, channel: 'wechat', amountCents: 200, status: 'success', channelTxnNo: `wxtxn_${tag}_${label}`.slice(0, 64), prepayId: `prepay_${id}`.slice(0, 64) },
    })
    const submitted = new Date(Date.now() - DAY - 60_000)
    await db.refund.create({
      data: { orderId: id, refundNo, amountCents: 200, status: 'pending', reason: '没出纸先退', channel: 'wechat', createdAt: submitted, channelSubmittedAt: submitted },
    })
    return { id, orderNo, refundNo }
  }

  try {
    // 1. 非法实退金额（0、负数、超申请额 201、小数 60.5）一律拒绝 REGISTRATION_AMOUNT_INVALID，不改状态。
    const part = await seed('part')
    for (const bad of [0, -10, 201, 60.5]) {
      const code = await registerChannelResult(db, part.id, {
        refundNo: part.refundNo,
        result: 'refunded',
        channelRefundNo: 'WX-BAD-AMT',
        actualAmountCents: bad,
        confirmOrderNo: part.orderNo,
      }, 'admin-p2b9d', {
        supportsQuery: () => true,
        channelQuery: async () => 'unknown',
      }).then(() => 'ok', errorCode)
      assert.equal(code, 'REGISTRATION_AMOUNT_INVALID', `实退金额 ${bad} 必须被拒绝`)
    }
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: part.refundNo } })).status, 'pending')

    // 2. 合法部分实退（200 分单实退 60 分）：落 partial_refunded，已退 60，余款 140 可继续退完。
    const done = await registerChannelResult(db, part.id, {
      refundNo: part.refundNo,
      result: 'refunded',
      channelRefundNo: 'WX-REG-60',
      actualAmountCents: 60,
      confirmOrderNo: part.orderNo,
    }, 'admin-p2b9d', {
      supportsQuery: () => true,
      channelQuery: async () => 'unknown',
    })
    assert.equal(done.recordedBy, 'registration')
    assert.equal(done.refundStatus, 'success')
    assert.equal(done.amountCents, 60)
    assert.equal(done.payStatus, 'partial_refunded')
    const partOrder = await db.order.findUniqueOrThrow({ where: { id: part.id } })
    assert.equal(partOrder.refundedAmountCents, 60)
    assert.equal(await remainderAmountCents(db, partOrder), 140)
    const audit = await db.auditLog.findFirst({ where: { targetId: part.id, action: 'refund.channel_result_registered' } })
    assert.match(audit?.payloadJson ?? '', /"actualAmountCents":60/)

    // 余款 140 仍走同一退款入口退完。
    const restSvc = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([
      { channel: 'wechat', refund: async () => ({ status: 'success', channelRefundNo: 'WX-REST-140', refundAmountCents: 140 }) } as unknown as PaymentProvider,
    ]))
    const restView = await restSvc.refund(part.id, { reason: '退还剩余' })
    assert.equal(restView.refund.amountCents, 140)
    assert.equal(restView.order.payStatus, 'refunded')
    assert.equal(restView.order.refundedAmountCents, 200)

    // 3. 合法全额实退（200 分）：直接落 refunded。
    const full = await seed('full')
    const fullDone = await registerChannelResult(db, full.id, {
      refundNo: full.refundNo,
      result: 'refunded',
      channelRefundNo: 'WX-REG-200',
      actualAmountCents: 200,
      confirmOrderNo: full.orderNo,
    }, 'admin-p2b9d', {
      supportsQuery: () => true,
      channelQuery: async () => 'unknown',
    })
    assert.equal(fullDone.payStatus, 'refunded')
    assert.equal(fullDone.amountCents, 200)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
