/**
 * 渠道查询出错不能改退款状态。
 * 在途退款点改为出纸时查询抛错，再点一次仍要查渠道、仍拒绝，状态和任务都不变。
 * 已经记成待人工、但渠道受理过的，同样不能跳过查询直接放行。
 * 窗口清扫、以及没有渠道流水的过期待人工，渠道没受理过，改为出纸照常。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { PICKUP_WINDOW_CLOSED_UNPRINTED_REASON } from '../../src/payment/closed-window-unprinted'
import { PRINT_NO_PAPER_MANUAL_AUDIT } from '../../src/payment/print-return-disposition'
import { REFUND_AMOUNT_MISMATCH_MANUAL_REASON } from '../../src/payment/refund-amount-hold'
import { queryRefundChannel } from '../../src/payment/refund-channel-query'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

async function seedOrder(
  db: PrismaService,
  input: {
    id: string
    terminalId: string
    orderIds: string[]
    taskIds: string[]
    refund: {
      refundNo: string
      status: string
      channel: string
      reason: string | null
      channelRefundNo?: string | null
      channelSubmittedAt?: Date | null
    }
    refundReason?: string | null
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
      status: 'failed',
      printOutcome: 'not_printed',
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
      paymentSource: input.refund.channel,
      paidAt: new Date(Date.now() - 60 * 60 * 1000),
      pickupStatus: 'pending',
      taskStatus: 'failed',
      refundReason: input.refundReason ?? null,
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
      refundNo: input.refund.refundNo.slice(0, 40),
      amountCents: 200,
      status: input.refund.status,
      reason: input.refund.reason,
      channel: input.refund.channel,
      channelRefundNo: input.refund.channelRefundNo ?? null,
      channelSubmittedAt: input.refund.channelSubmittedAt ?? null,
    },
  })
}

export async function runP2b8ChannelFaultCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b8cf_${tag}`
  const terminalId = `term_p2b8cf_${tag}`
  await db.organization.create({ data: { id: orgId, name: '渠道查询出错', type: 'school_employment_center' } })
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
    let calls = 0
    const throwing = {
      channel: 'wechat',
      queryRefund: async () => {
        calls += 1
        throw new Error('渠道证书读不出来')
      },
    } as unknown as PaymentProvider
    const registry = new PaymentProviderRegistry([throwing])
    const channelQuery = (query: { channel: string; refundNo: string; orderId: string }) => (
      queryRefundChannel(registry, db, query)
    )

    const pendingId = `ord_${tag}_p2b8_pend`
    await seedOrder(db, {
      id: pendingId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      refund: {
        refundNo: `RFD-P8-PEND-${tag}`,
        status: 'pending',
        channel: 'wechat',
        reason: '渠道还没确认退款结果',
        channelSubmittedAt: new Date(),
      },
    })
    created.push(pendingId)
    const first = await resolvePrintReturnHold(db, pendingId, 'release_paper', 'admin-test', channelQuery)
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(first, 'REFUND_CHANNEL_QUERY_FAILED')
    assert.equal(calls, 1, '第一次改为出纸必须向渠道查询')
    const pendingRefund = await db.refund.findFirstOrThrow({ where: { orderId: pendingId } })
    assert.equal(pendingRefund.status, 'pending', '查询出错不能把处理中改成待人工')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: pendingId } })).payStatus, 'paid')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: pendingId } })).taskStatus, 'failed')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: pendingId } })).status, 'failed')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: pendingId } })).printOutcome, 'not_printed')
    const faultAudit = await db.auditLog.findFirst({
      where: { targetId: pendingId, action: PRINT_NO_PAPER_MANUAL_AUDIT },
    })
    assert.match(faultAudit?.payloadJson ?? '', /渠道证书读不出来/)
    const second = await resolvePrintReturnHold(db, pendingId, 'release_paper', 'admin-test', channelQuery)
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(second, 'REFUND_CHANNEL_QUERY_FAILED', '第二次仍要拒绝，不能放行出纸')
    assert.equal(calls, 2, '第二次改为出纸仍要向渠道查询')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: pendingId } })).status, 'pending')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: pendingId } })).status, 'failed')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: pendingId } })).taskStatus, 'failed')

    const parkedId = `ord_${tag}_p2b8_park`
    await seedOrder(db, {
      id: parkedId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      refund: {
        refundNo: `RFD-P8-PARK-${tag}`,
        status: 'manual_review',
        channel: 'wechat',
        reason: '渠道还没确认退款结果',
        channelRefundNo: `WX-${tag}`.slice(0, 32),
        channelSubmittedAt: new Date(),
      },
    })
    created.push(parkedId)
    const beforeParkedCalls = calls
    const parked = await resolvePrintReturnHold(db, parkedId, 'release_paper', 'admin-test', channelQuery)
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(parked, 'REFUND_CHANNEL_QUERY_FAILED')
    assert.equal(calls, beforeParkedCalls + 1, '渠道受理过的待人工也要查渠道')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: parkedId } })).status, 'manual_review')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: parkedId } })).status, 'failed')
    const parkedAgain = await resolvePrintReturnHold(db, parkedId, 'release_paper', 'admin-test', channelQuery)
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(parkedAgain, 'REFUND_CHANNEL_QUERY_FAILED')
    assert.equal(calls, beforeParkedCalls + 2)
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: parkedId } })).status, 'manual_review')

    const historyId = `ord_${tag}_p2b8_hist`
    await seedOrder(db, {
      id: historyId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      refund: {
        refundNo: `RFD-P8-HIST-${tag}`,
        status: 'manual_review',
        channel: 'wechat',
        reason: '渠道还没确认退款结果',
        channelSubmittedAt: new Date(),
      },
    })
    created.push(historyId)
    const beforeHistoryCalls = calls
    const history = await resolvePrintReturnHold(db, historyId, 'release_paper', 'admin-test', channelQuery)
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(history, 'REFUND_CHANNEL_QUERY_FAILED', '查询出错留下的待人工不能直接放行')
    assert.equal(calls, beforeHistoryCalls + 1)
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: historyId } })).status, 'manual_review')
    assert.notEqual((await db.printTask.findFirstOrThrow({ where: { orderId: historyId } })).status, 'pending')

    const mismatchId = `ord_${tag}_p2b8_mis`
    await seedOrder(db, {
      id: mismatchId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      refundReason: REFUND_AMOUNT_MISMATCH_MANUAL_REASON,
      refund: {
        refundNo: `RFD-P8-MIS-${tag}`,
        status: 'manual_review',
        channel: 'wechat',
        reason: '渠道金额对不上',
        channelRefundNo: `WX-MIS-${tag}`.slice(0, 32),
        channelSubmittedAt: new Date(),
      },
    })
    created.push(mismatchId)
    const beforeMismatchCalls = calls
    const mismatch = await resolvePrintReturnHold(db, mismatchId, 'release_paper', 'admin-test', channelQuery)
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(mismatch, 'REFUND_CHANNEL_QUERY_FAILED', '金额不符也是渠道受理过，查询出错不能放行')
    assert.equal(calls, beforeMismatchCalls + 1)
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: mismatchId } })).status, 'manual_review')

    let localCalls = 0
    const localQuery = async () => {
      localCalls += 1
      throw new Error('不该查到本地待人工')
    }
    const windowId = `ord_${tag}_p2b8_win`
    await seedOrder(db, {
      id: windowId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      refund: {
        refundNo: `RFD-WINDOW-${tag}`.slice(0, 40),
        status: 'manual_review',
        channel: 'wechat',
        reason: PICKUP_WINDOW_CLOSED_UNPRINTED_REASON,
      },
    })
    created.push(windowId)
    const windowed = await resolvePrintReturnHold(db, windowId, 'release_paper', 'admin-test', localQuery)
    assert.equal(localCalls, 0, '窗口清扫的待人工没有渠道受理，不用查渠道')
    assert.equal(windowed.refundStatus, 'withdrawn')
    assert.equal(windowed.payStatus, 'paid')
    assert.equal(windowed.taskStatus, 'pending')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: windowId } })).printOutcome, null)

    const staleId = `ord_${tag}_p2b8_stale`
    await seedOrder(db, {
      id: staleId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      refund: {
        refundNo: `RFD-STALE-${tag}`.slice(0, 40),
        status: 'manual_review',
        channel: 'sandbox',
        reason: STALE_ATTEMPT_REFUND_REASON,
      },
    })
    created.push(staleId)
    const stale = await resolvePrintReturnHold(db, staleId, 'release_paper', 'admin-test', localQuery)
    assert.equal(localCalls, 0, '没有渠道流水的过期待人工不用查渠道')
    assert.equal(stale.refundStatus, 'withdrawn')
    assert.equal(stale.taskStatus, 'pending')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
