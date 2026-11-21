/**
 * 渠道说成功时按渠道金额记账（第 3 条）。
 * - 实付 100、退款 30 在途，点改为出纸，渠道回成功 30：照实拒绝；订单部分退款、已退 30、剩余 70 还能再退。
 * - 关单同样照实拒绝；确认退成直接给出部分退款的结果。全额退成记已退，待打印的任务一起取消。
 * - 金额不符（记 100、渠道退 60）：按渠道的 60 记账。
 * - 渠道说成功但没回报金额：不能拿本地金额顶替，拒绝且不改。合计超过实付：拒绝且不改。
 * - 已关的单：只记退款行，订单保持关闭。过期付款那一笔退成不算这一单的退款。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider, RefundQueryResult } from '../../src/payment/payment-provider.types'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { queryRefundChannel } from '../../src/payment/refund-channel-query'
import { remainderAmountCents } from '../../src/payment/refund-remainder'
import { RefundService } from '../../src/payment/refund.service'
import { resolvePrintReturnHold, type PrintReturnResolution, type RefundChannelVerdict } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } } | string
  if (typeof body === 'string') return body
  return body?.error?.code ?? error.message
}

type RefundSeed = { suffix: string; amountCents: number; status: string; reason: string | null; submitted: boolean }

export async function runP2b9ChannelAmountCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9ca_${tag}`
  const terminalId = `term_p2b9ca_${tag}`
  await db.organization.create({ data: { id: orgId, name: '渠道金额记账', type: 'school_employment_center' } })
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
  const seed = async (
    label: string,
    refunds: RefundSeed[],
    opts?: { amountCents?: number; payStatus?: string; taskStatus?: string },
  ): Promise<{ id: string; taskId: string; refundNos: string[] }> => {
    const id = `ord_${tag}_p2b9ca_${label}`
    const taskId = `pt_${id}`
    const amountCents = opts?.amountCents ?? 100
    const taskStatus = opts?.taskStatus ?? 'failed'
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: taskStatus,
        printOutcome: taskStatus === 'failed' ? 'not_printed' : null,
        errorCode: taskStatus === 'failed' ? 'PAPER_JAM' : null,
        orderId: id,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id,
        orderNo: `P9CA${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
        type: 'print',
        terminalId,
        amountCents,
        discountCents: 0,
        payStatus: opts?.payStatus ?? 'refunding',
        paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus,
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    await db.paymentAttempt.create({
      data: {
        id: `pa_${id}`,
        orderId: id,
        channel: 'wechat',
        amountCents,
        status: 'success',
        channelTxnNo: `wxtxn_${tag}_${label}`.slice(0, 64),
        prepayId: `prepay_${id}`.slice(0, 64),
      },
    })
    const refundNos: string[] = []
    let minute = 120
    for (const refund of refunds) {
      const refundNo = `RFD-P9CA-${tag}-${label}-${refund.suffix}`.slice(0, 48)
      refundNos.push(refundNo)
      minute -= 10
      const at = new Date(Date.now() - minute * 60 * 1000)
      await db.refund.create({
        data: {
          orderId: id,
          refundNo,
          amountCents: refund.amountCents,
          status: refund.status,
          reason: refund.reason,
          channel: 'wechat',
          createdAt: at,
          ...(refund.submitted ? { channelSubmittedAt: at } : {}),
        },
      })
    }
    return { id, taskId, refundNos }
  }
  const registryAnswering = (answer: RefundQueryResult) => new PaymentProviderRegistry([
    { channel: 'wechat', queryRefund: async () => answer } as unknown as PaymentProvider,
  ])
  const viaChannel = (registry: PaymentProviderRegistry) =>
    (query: { channel: string; refundNo: string; orderId: string }) => queryRefundChannel(registry, db, query)
  const run = (orderId: string, action: PrintReturnResolution, query: Parameters<typeof resolvePrintReturnHold>[4]) =>
    resolvePrintReturnHold(db, orderId, action, 'admin-test', query).then(
      (done) => ({ code: 'ok', done }),
      (error: unknown) => ({ code: errorCode(error), done: null }),
    )
  const thirty = viaChannel(registryAnswering({ status: 'success', channelRefundNo: 'WX-PART-30', refundAmountCents: 30, refundState: 'SUCCESS' }))

  try {
    // 1. 实付 100、退款 30 在途，点改为出纸，渠道回成功 30。
    const partial = await seed('part', [{ suffix: 'a', amountCents: 30, status: 'pending', reason: '部分退款', submitted: true }])
    const partialRun = await run(partial.id, 'release_paper', thirty)
    assert.equal(partialRun.code, 'REFUND_CHANNEL_REFUNDED', '渠道已经退成，改为出纸照实拒绝')
    const partialOrder = await db.order.findUniqueOrThrow({ where: { id: partial.id } })
    assert.equal(partialOrder.payStatus, 'partial_refunded', '只退了 30，不能记成整单已退')
    assert.notEqual(partialOrder.payStatus, 'refunded')
    assert.equal(partialOrder.refundedAmountCents, 30)
    const partialRefund = await db.refund.findUniqueOrThrow({ where: { refundNo: partial.refundNos[0] } })
    assert.equal(partialRefund.status, 'success')
    assert.equal(partialRefund.amountCents, 30)
    assert.equal(partialRefund.channelRefundNo, 'WX-PART-30')
    assert.equal(await remainderAmountCents(db, partialOrder), 70, '剩余 70 还没退')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: partial.taskId } })).status, 'failed', '不能改为出纸')
    const partialDetail = await new AdminOrdersReadonlyService(db).getById(partial.id)
    assert.equal(partialDetail.refundRemainderCents, 70)
    assert.equal(partialDetail.refundStatus, 'success')
    // 剩余 70 仍有下一步：退还剩余走同一个退款入口，退完才记成已退。
    const rest = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([
      { channel: 'wechat', refund: async () => ({ status: 'success', channelRefundNo: 'WX-REST-70', refundAmountCents: 70 }) } as unknown as PaymentProvider,
    ]))
    const restView = await rest.refund(partial.id, { reason: '退还剩余' })
    assert.equal(restView.refund.amountCents, 70)
    assert.equal(restView.order.payStatus, 'refunded')
    assert.equal(restView.order.refundedAmountCents, 100)

    // 2. 关单同样照实拒绝；3. 确认退成直接给出部分退款的结果。
    const partClose = await seed('pcls', [{ suffix: 'a', amountCents: 30, status: 'pending', reason: '部分退款', submitted: true }])
    const partCloseRun = await run(partClose.id, 'close_order', thirty)
    assert.equal(partCloseRun.code, 'REFUND_CHANNEL_REFUNDED')
    const partCloseOrder = await db.order.findUniqueOrThrow({ where: { id: partClose.id } })
    assert.equal(partCloseOrder.payStatus, 'partial_refunded', '渠道退成 30 之后不能关单')
    assert.equal(partCloseOrder.refundedAmountCents, 30)
    const partConfirm = await seed('pcfm', [{ suffix: 'a', amountCents: 30, status: 'manual_review', reason: '部分退款', submitted: true }])
    const partConfirmRun = await run(partConfirm.id, 'confirm_refunded', thirty)
    assert.equal(partConfirmRun.code, 'ok')
    assert.equal(partConfirmRun.done?.payStatus, 'partial_refunded')
    assert.equal(partConfirmRun.done?.refundStatus, 'success')
    assert.equal(partConfirmRun.done?.amountCents, 30)

    // 4. 全额退成：记已退，待打印的任务一起取消，不能出纸。
    const whole = await seed('whole', [{ suffix: 'a', amountCents: 100, status: 'pending', reason: '整单退款', submitted: true }], { taskStatus: 'pending' })
    const wholeRun = await run(whole.id, 'release_paper', viaChannel(registryAnswering({ status: 'success', channelRefundNo: 'WX-ALL', refundAmountCents: 100 })))
    assert.equal(wholeRun.code, 'REFUND_CHANNEL_REFUNDED')
    const wholeOrder = await db.order.findUniqueOrThrow({ where: { id: whole.id } })
    assert.equal(wholeOrder.payStatus, 'refunded')
    assert.equal(wholeOrder.refundedAmountCents, 100)
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: whole.taskId } })).status, 'cancelled', '整单退成后不能再出纸')

    // 5. 金额不符：本地记 100，渠道说退了 60。按渠道的 60 记账。
    const mismatch = await seed('mism', [{ suffix: 'a', amountCents: 100, status: 'manual_review', reason: '整单退款', submitted: true }])
    await db.order.update({ where: { id: mismatch.id }, data: { refundReason: 'REFUND_AMOUNT_MISMATCH_MANUAL' } })
    const mismatchRun = await run(mismatch.id, 'release_paper', viaChannel(registryAnswering({ status: 'success', channelRefundNo: 'WX-60', refundAmountCents: 60 })))
    assert.equal(mismatchRun.code, 'REFUND_CHANNEL_REFUNDED')
    const mismatchRefund = await db.refund.findUniqueOrThrow({ where: { refundNo: mismatch.refundNos[0] } })
    assert.equal(mismatchRefund.status, 'success')
    assert.equal(mismatchRefund.amountCents, 60, '按渠道回报的金额记这一笔')
    const mismatchOrder = await db.order.findUniqueOrThrow({ where: { id: mismatch.id } })
    assert.equal(mismatchOrder.payStatus, 'partial_refunded')
    assert.equal(mismatchOrder.refundedAmountCents, 60)
    assert.equal(await remainderAmountCents(db, mismatchOrder), 40)
    const answerAudit = await db.auditLog.findFirst({ where: { targetId: mismatch.id, action: 'refund.channel_answer' } })
    assert.match(answerAudit?.payloadJson ?? '', /"recordedAmountCents":100/)
    assert.match(answerAudit?.payloadJson ?? '', /"channelAmountCents":60/)

    // 6. 渠道说成功但没回报金额：拒绝，哪儿都不改。
    for (const [label, query] of [
      ['plain', async () => 'success' as RefundChannelVerdict],
      ['noamt', viaChannel(registryAnswering({ status: 'success', channelRefundNo: 'WX-NOAMT' }))],
    ] as const) {
      const unknown = await seed(label, [{ suffix: 'a', amountCents: 100, status: 'pending', reason: '整单退款', submitted: true }])
      const unknownRun = await run(unknown.id, 'confirm_refunded', query)
      assert.equal(unknownRun.code, 'REFUND_CHANNEL_UNCONFIRMED', `${label}：没有渠道金额不能拿本地金额顶替`)
      assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: unknown.refundNos[0] } })).status, 'pending')
      assert.equal((await db.order.findUniqueOrThrow({ where: { id: unknown.id } })).payStatus, 'refunding')
    }

    // 7. 合计超过实付（已有成功 50，渠道又说这一笔退了 100）：P2b9d 18:22 裁定——渠道退成事实绝不回滚，
    // 保留 Refund.status='success' 与审计，写入冲突审计并转待人工核对告警，订单不静默写成已退。
    const over = await seed('over', [
      { suffix: 'a', amountCents: 50, status: 'success', reason: '先退一部分', submitted: true },
      { suffix: 'b', amountCents: 100, status: 'pending', reason: '再退一笔', submitted: true },
    ])
    const overRun = await run(over.id, 'confirm_refunded', viaChannel(registryAnswering({ status: 'success', channelRefundNo: 'WX-OVER', refundAmountCents: 100 })))
    assert.equal(overRun.code, 'REFUND_CHANNEL_AMOUNT_EXCEEDS')
    const overRefund = await db.refund.findUniqueOrThrow({ where: { refundNo: over.refundNos[1] } })
    assert.equal(overRefund.status, 'success', '渠道退成事实绝不因超应付冲突而回滚')
    assert.equal(overRefund.amountCents, 100)
    assert.equal(overRefund.channelRefundNo, 'WX-OVER')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: over.id } })).payStatus, 'refunding')
    assert.equal(await db.auditLog.count({ where: { targetId: over.id, action: 'refund.channel_answer' } }), 1)
    assert.equal(await db.auditLog.count({ where: { targetId: over.id, action: 'refund.channel_success_conflict' } }), 1)

    // 8. 已关的单（关单后渠道又通知退成）：只记退款行，订单保持关闭。
    const shut = await seed('shut', [{ suffix: 'a', amountCents: 100, status: 'manual_review', reason: '退款失败', submitted: true }], { payStatus: 'closed', taskStatus: 'cancelled' })
    const shutQuery = viaChannel(registryAnswering({ status: 'success', channelRefundNo: 'WX-SHUT', refundAmountCents: 100 }))
    const shutRun = await run(shut.id, 'confirm_refunded', shutQuery)
    assert.equal(shutRun.code, 'ok')
    assert.equal(shutRun.done?.payStatus, 'closed')
    assert.equal(shutRun.done?.refundStatus, 'success')
    const shutRelease = await seed('shutr', [{ suffix: 'a', amountCents: 100, status: 'manual_review', reason: '退款失败', submitted: true }], { payStatus: 'closed', taskStatus: 'cancelled' })
    assert.equal((await run(shutRelease.id, 'release_paper', shutQuery)).code, 'REFUND_CHANNEL_REFUNDED')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: shutRelease.id } })).payStatus, 'closed')

    // 9. 过期付款那一笔退成、这一单那一笔失败：过期的不算这单的退款，按点的那一步照常做。
    const stale = await seed('stale', [
      { suffix: 'cur', amountCents: 100, status: 'pending', reason: '整单退款', submitted: true },
      { suffix: 'old', amountCents: 300, status: 'pending', reason: STALE_ATTEMPT_REFUND_REASON, submitted: true },
    ], { payStatus: 'paid' })
    const staleRun = await run(stale.id, 'release_paper', async (query) => (query.refundNo === stale.refundNos[1]
      ? { verdict: 'success' as const, refundAmountCents: 300, channelRefundNo: 'WX-STALE' }
      : 'failed'))
    assert.equal(staleRun.code, 'ok')
    assert.equal(staleRun.done?.payStatus, 'paid')
    assert.equal(staleRun.done?.taskStatus, 'pending')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: stale.refundNos[1] } })).status, 'success')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: stale.id } })).refundedAmountCents, 0, '过期付款退回不计入这一单')
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
