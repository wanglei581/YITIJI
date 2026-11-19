/**
 * 反方第 2、3 条。
 * 在途 pending 点「确认改为出纸」不能不查渠道就放行。
 * 已经出纸的单不能「确认关单」。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { queryRefundChannel } from '../../src/payment/refund-channel-query'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

type ChannelVerdict =
  | 'success'
  | 'processing'
  | 'failed'
  | 'unknown'
  | 'unsupported'
  | { verdict: 'success'; refundAmountCents: number | null; channelRefundNo: string | null }

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

export async function runP2b6HoldChannelCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b6h_${tag}`
  const terminalId = `term_p2b6h_${tag}`
  await db.organization.create({ data: { id: orgId, name: '在途退款查渠道', type: 'school_employment_center' } })
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
  let n = 0

  const seed = async (opts: {
    suffix: string
    refundStatus: 'pending' | 'failed'
    taskStatus: 'failed' | 'completed' | 'pending'
    printOutcome: 'not_printed' | 'printed' | null
    orderTaskStatus: 'failed' | 'completed' | 'pending'
  }): Promise<string> => {
    n += 1
    const id = `ord_${tag}_p2b6h_${n}`
    const taskId = `pt_${id}`
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: opts.taskStatus,
        printOutcome: opts.printOutcome,
        errorCode: opts.taskStatus === 'failed' ? 'PAPER_JAM' : null,
        orderId: id,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id,
        orderNo: `C6${tag}${opts.suffix}${n}`.slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'sandbox',
        paidAt: new Date(Date.now() - 60 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: opts.orderTaskStatus,
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
        refundNo: `RFD-H6-${tag}-${n}`.slice(0, 40),
        amountCents: 200,
        status: opts.refundStatus,
        reason: opts.refundStatus === 'pending' ? '渠道还没确认退款结果' : '退款失败',
        channel: 'sandbox',
        ...(opts.refundStatus === 'pending' ? { channelSubmittedAt: new Date() } : {}),
      },
    })
    return id
  }

  const releaseCode = async (id: string, verdict?: ChannelVerdict): Promise<string> => {
    const query = verdict === undefined
      ? undefined
      : async () => verdict
    return resolvePrintReturnHold(db, id, 'release_paper', 'admin-test', query).then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
  }

  try {
    const processingProvider = {
      channel: 'wechat',
      queryRefund: async () => ({ status: 'processing' as const, channelRefundNo: null }),
    } as unknown as PaymentProvider
    assert.equal(
      await queryRefundChannel(new PaymentProviderRegistry([processingProvider]), db, {
        channel: 'wechat',
        refundNo: 'RFD-LOOKUP',
        orderId: 'missing-order',
      }),
      'processing',
    )
    assert.equal(
      await queryRefundChannel(new PaymentProviderRegistry([]), db, {
        channel: 'sandbox',
        refundNo: 'RFD-LOOKUP',
        orderId: 'missing-order',
      }),
      'unsupported',
    )

    const noQuery = await seed({
      suffix: 'nq',
      refundStatus: 'pending',
      taskStatus: 'failed',
      printOutcome: 'not_printed',
      orderTaskStatus: 'failed',
    })
    const noQueryCode = await releaseCode(noQuery)
    assert.equal(noQueryCode, 'REFUND_CHANNEL_UNCONFIRMED', '没有查渠道能力时，在途退款不能直接改为出纸')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: noQuery } })).payStatus, 'paid')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: noQuery } })).status, 'pending')
    assert.equal(await db.auditLog.count({ where: { targetId: noQuery, action: 'refund.hold_rejected' } }), 1)

    for (const verdict of ['processing', 'unknown', 'unsupported'] as const) {
      const id = await seed({
        suffix: verdict.slice(0, 2),
        refundStatus: 'pending',
        taskStatus: 'failed',
        printOutcome: 'not_printed',
        orderTaskStatus: 'failed',
      })
      const code = await releaseCode(id, verdict)
      assert.equal(code, 'REFUND_CHANNEL_UNCONFIRMED', `渠道结果 ${verdict} 不能改为出纸`)
      assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: id } })).status, 'pending')
      assert.equal(await db.auditLog.count({ where: { targetId: id, action: 'refund.hold_rejected' } }), 1)
    }

    const channelSuccess = await seed({
      suffix: 'su',
      refundStatus: 'pending',
      taskStatus: 'failed',
      printOutcome: 'not_printed',
      orderTaskStatus: 'failed',
    })
    // P2b9 第 3 条：渠道答复成功时按渠道回报的金额记账，改为出纸照实拒绝，不再改写成「确认退成」后返回成功。
    const successCode = await releaseCode(channelSuccess, { verdict: 'success', refundAmountCents: 200, channelRefundNo: null })
    assert.equal(successCode, 'REFUND_CHANNEL_REFUNDED', '渠道说成功就按渠道金额记账，改为出纸照实拒绝')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: channelSuccess } })).payStatus, 'refunded')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: channelSuccess } })).status, 'success')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: channelSuccess } })).status, 'failed')

    const failedChannel = await seed({
      suffix: 'fl',
      refundStatus: 'pending',
      taskStatus: 'failed',
      printOutcome: 'not_printed',
      orderTaskStatus: 'failed',
    })
    const failedCode = await releaseCode(failedChannel, 'failed')
    assert.equal(failedCode, 'ok', '渠道明确失败后才能改为出纸')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: failedChannel } })).payStatus, 'paid')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: failedChannel } })).status, 'withdrawn')

    const printed = await seed({
      suffix: 'pr',
      refundStatus: 'failed',
      taskStatus: 'completed',
      printOutcome: 'printed',
      orderTaskStatus: 'completed',
    })
    const closeCode = await resolvePrintReturnHold(db, printed, 'close_order', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(closeCode, 'PAPER_ALREADY_OUT_CANNOT_CLOSE', '已经出纸不能关单')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: printed } })).payStatus, 'paid')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: printed } })).status, 'failed')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: printed } })).printOutcome, 'printed')
    assert.equal(await db.auditLog.count({ where: { targetId: printed, action: 'refund.hold_rejected' } }), 1)

    const stillClose = await seed({
      suffix: 'cl',
      refundStatus: 'pending',
      taskStatus: 'failed',
      printOutcome: 'not_printed',
      orderTaskStatus: 'failed',
    })
    const heldCloseCode = await resolvePrintReturnHold(db, stillClose, 'close_order', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(heldCloseCode, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: stillClose } })).status, 'pending')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: stillClose } })).payStatus, 'paid')
    const stillConfirm = await seed({
      suffix: 'cf',
      refundStatus: 'pending',
      taskStatus: 'pending',
      printOutcome: null,
      orderTaskStatus: 'pending',
    })
    const confirmCode = await resolvePrintReturnHold(db, stillConfirm, 'confirm_refunded', 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )
    assert.equal(confirmCode, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: stillConfirm } })).status, 'pending')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: stillConfirm } })).payStatus, 'paid')
    assert.equal((await db.printTask.findFirstOrThrow({ where: { orderId: stillConfirm } })).status, 'pending')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
