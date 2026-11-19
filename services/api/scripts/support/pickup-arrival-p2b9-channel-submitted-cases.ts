/**
 * 「已提交渠道」显式记录（channelSubmittedAt）替代猜测。
 * - 过期付款原因 + 渠道退款号空 + 已写 channelSubmittedAt 的待人工，改为出纸必须挡住（不再被当成本地新建）。
 * - 历史「在线支付未开」审计不再放行：已写 channelSubmittedAt 的退款仍要查渠道。
 * - 本地窗口关闭、没有渠道流水的过期待人工照旧三步可做（渠道没受理过）。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { PRINT_NO_PAPER_AUTO_FAILED_AUDIT } from '../../src/payment/print-return-disposition'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { REFUND_AMOUNT_MISMATCH_MANUAL_REASON } from '../../src/payment/refund-amount-hold'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
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
    refund: {
      status: string
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
      paymentSource: 'wechat',
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
      refundNo: `RFD-P9-${input.id}`.slice(0, 40),
      amountCents: 200,
      status: input.refund.status,
      reason: input.refund.reason,
      channel: 'wechat',
      channelRefundNo: input.refund.channelRefundNo ?? null,
      channelSubmittedAt: input.refund.channelSubmittedAt ?? null,
    },
  })
}

export async function runP2b9ChannelSubmittedCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9cs_${tag}`
  const terminalId = `term_p2b9cs_${tag}`
  await db.organization.create({ data: { id: orgId, name: '已提交渠道显式记录', type: 'school_employment_center' } })
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
    // 场景 2：过期付款原因 + 渠道退款号空 + 已写 channelSubmittedAt（已发到渠道），改为出纸必须挡住。
    const staleSubmittedId = `ord_${tag}_p2b9_stsub`
    await seed(db, {
      id: staleSubmittedId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      refundReason: REFUND_AMOUNT_MISMATCH_MANUAL_REASON,
      refund: {
        status: 'manual_review',
        reason: STALE_ATTEMPT_REFUND_REASON,
        channelRefundNo: null,
        channelSubmittedAt: new Date(),
      },
    })
    created.push(staleSubmittedId)
    const staleCode = await resolvePrintReturnHold(db, staleSubmittedId, 'release_paper', 'admin-test', async () => 'processing')
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(staleCode, 'REFUND_CHANNEL_UNCONFIRMED', '已发渠道的过期付款待人工不能当本地撤回')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: staleSubmittedId } })).status, 'manual_review')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: staleSubmittedId } })).status, 'failed')

    // 场景 3：历史「在线支付未开」审计不再放行，已写 channelSubmittedAt 的退款仍要查渠道。
    const historyId = `ord_${tag}_p2b9_hist`
    await seed(db, {
      id: historyId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      refund: {
        status: 'pending',
        reason: '渠道还没确认退款结果',
        channelRefundNo: null,
        channelSubmittedAt: new Date(),
      },
    })
    created.push(historyId)
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'system',
        action: PRINT_NO_PAPER_AUTO_FAILED_AUDIT,
        targetType: 'order',
        targetId: historyId,
        payloadJson: JSON.stringify({ code: 'ONLINE_PAYMENT_DISABLED' }),
      },
    })
    let historyQueries = 0
    const historyCode = await resolvePrintReturnHold(db, historyId, 'release_paper', 'admin-test', async () => {
      historyQueries += 1
      return 'processing'
    }).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(historyCode, 'REFUND_CHANNEL_UNCONFIRMED', '历史审计不能绕过渠道查询')
    assert.equal(historyQueries, 1, '已写 channelSubmittedAt 的退款必须查渠道，不被历史审计放行')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: historyId } })).status, 'pending')

    // 本地窗口关闭、没有渠道流水的过期待人工：channelSubmittedAt 为 null，照旧三步可做、不查渠道。
    const localId = `ord_${tag}_p2b9_local`
    await seed(db, {
      id: localId,
      terminalId,
      orderIds: input.orderIds,
      taskIds: input.taskIds,
      refund: {
        status: 'manual_review',
        reason: STALE_ATTEMPT_REFUND_REASON,
        channelRefundNo: null,
        channelSubmittedAt: null,
      },
    })
    created.push(localId)
    let localQueries = 0
    const local = await resolvePrintReturnHold(db, localId, 'release_paper', 'admin-test', async () => {
      localQueries += 1
      return 'processing'
    })
    assert.equal(localQueries, 0, '没有渠道流水的过期待人工不查渠道')
    assert.equal(local.refundStatus, 'withdrawn')
    assert.equal(local.taskStatus, 'pending')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
