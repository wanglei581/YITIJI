/**
 * 渠道业务答复里，只有官方文档写明这笔钱没退成的才当失败。
 * 退款关闭、退款单不存在：改为出纸可以继续。
 * 退款异常，以及抛出来的其它错误：状态保持原样，这次不能处置。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider, RefundQueryResult } from '../../src/payment/payment-provider.types'
import { queryRefundChannel } from '../../src/payment/refund-channel-query'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

function registryOf(queryRefund: () => Promise<RefundQueryResult>): PaymentProviderRegistry {
  return new PaymentProviderRegistry([{ channel: 'wechat', queryRefund } as PaymentProvider])
}

async function seedPending(
  db: PrismaService,
  input: { orderIds: string[]; taskIds: string[] },
  orderId: string,
  terminalId: string,
  refundNo: string,
): Promise<void> {
  const taskId = `pt_${orderId}`
  input.orderIds.push(orderId)
  input.taskIds.push(taskId)
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: 'failed',
      errorCode: 'PRINT_COMMAND_FAILED',
      printOutcome: null,
      orderId,
      terminalId,
    },
  })
  await db.order.create({
    data: {
      id: orderId,
      orderNo: orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
      type: 'print',
      terminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'paid',
      paymentSource: 'wechat',
      paidAt: new Date(),
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
      orderId,
      refundNo,
      amountCents: 200,
      status: 'pending',
      reason: null,
      channel: 'wechat',
      channelRefundNo: `ch-${refundNo}`.slice(0, 64),
      channelSubmittedAt: new Date(),
    },
  })
}

export async function runP2b8ChannelBusinessCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b8biz_${tag}`
  const terminalId = `term_p2b8biz_${tag}`
  await db.organization.create({ data: { id: orgId, name: '渠道业务答复', type: 'school_employment_center' } })
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
    const closedId = `ord_${tag}_p2b8closed`
    const closedNo = `RFD-P8B-C-${tag}`.slice(0, 40)
    await seedPending(db, input, closedId, terminalId, closedNo)
    created.push(closedId)
    const closedVerdict = await queryRefundChannel(
      registryOf(async () => ({ status: 'failed', channelRefundNo: 'ch-closed', refundState: 'CLOSED' })),
      db,
      { channel: 'wechat', refundNo: closedNo, orderId: closedId },
    )
    assert.equal(closedVerdict, 'failed')
    const closed = await resolvePrintReturnHold(db, closedId, 'release_paper', 'admin-test', async () => closedVerdict)
    assert.equal(closed.refundStatus, 'withdrawn')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${closedId}` } })).status, 'pending')

    const missingId = `ord_${tag}_p2b8miss`
    const missingNo = `RFD-P8B-M-${tag}`.slice(0, 40)
    await seedPending(db, input, missingId, terminalId, missingNo)
    created.push(missingId)
    const missingVerdict = await queryRefundChannel(
      registryOf(async () => ({ status: 'unknown', channelRefundNo: null, refundState: 'RESOURCE_NOT_EXISTS' })),
      db,
      { channel: 'wechat', refundNo: missingNo, orderId: missingId },
    )
    assert.equal(missingVerdict, 'failed')
    const missing = await resolvePrintReturnHold(db, missingId, 'close_order', 'admin-test', async () => missingVerdict)
    assert.equal(missing.payStatus, 'closed')
    assert.equal(missing.refundStatus, 'closed')

    const abnormalId = `ord_${tag}_p2b8abn`
    const abnormalNo = `RFD-P8B-A-${tag}`.slice(0, 40)
    await seedPending(db, input, abnormalId, terminalId, abnormalNo)
    created.push(abnormalId)
    const abnormalVerdict = await queryRefundChannel(
      registryOf(async () => ({ status: 'failed', channelRefundNo: 'ch-abn', refundState: 'ABNORMAL' })),
      db,
      { channel: 'wechat', refundNo: abnormalNo, orderId: abnormalId },
    )
    // P2b9 第 5 条：退款异常单独归成 abnormal（钱停在渠道中间账户），不再混在 unknown 里；照样不能处置。
    assert.equal(abnormalVerdict, 'abnormal')
    const abnormalCode = await resolvePrintReturnHold(
      db,
      abnormalId,
      'release_paper',
      'admin-test',
      async () => abnormalVerdict,
    ).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(abnormalCode, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: abnormalId } })).status, 'pending')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${abnormalId}` } })).status, 'failed')

    const thrownId = `ord_${tag}_p2b8throw`
    const thrownNo = `RFD-P8B-T-${tag}`.slice(0, 40)
    await seedPending(db, input, thrownId, terminalId, thrownNo)
    created.push(thrownId)
    const thrown = await queryRefundChannel(
      registryOf(async () => { throw new Error('退款单不存在') }),
      db,
      { channel: 'wechat', refundNo: thrownNo, orderId: thrownId },
    )
    assert.equal(typeof thrown === 'string' ? thrown : thrown.verdict, 'fault')
    const thrownCode = await resolvePrintReturnHold(
      db,
      thrownId,
      'release_paper',
      'admin-test',
      async () => thrown,
    ).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(thrownCode, 'REFUND_CHANNEL_QUERY_FAILED')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: thrownId } })).status, 'pending')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId: { in: input.taskIds } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { id: { in: input.taskIds } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
