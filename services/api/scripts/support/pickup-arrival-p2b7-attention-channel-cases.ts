/**
 * 过期成功退款之外还有当前这笔失败退款时，需关注不能把这单滤掉。
 * 渠道查询自己抛错，不能记成渠道未知。要留下诊断，并把退款改成待人工。
 * 渠道明确返回未知时，仍是查不到，退款行保持处理中。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { PRINT_NO_PAPER_MANUAL_AUDIT } from '../../src/payment/print-return-disposition'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { queryRefundChannel } from '../../src/payment/refund-channel-query'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

export async function runP2b7AttentionChannelCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b7ac_${tag}`
  const terminalId = `term_p2b7ac_${tag}`
  await db.organization.create({ data: { id: orgId, name: '需关注与渠道故障', type: 'school_employment_center' } })
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
    const missedId = `ord_${tag}_p2b7ac_miss`
    const missedNo = missedId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    const missedTask = `pt_${missedId}`
    created.push(missedId)
    input.orderIds.push(missedId)
    input.taskIds.push(missedTask)
    await db.printTask.create({
      data: {
        id: missedTask,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        printOutcome: 'not_printed',
        errorCode: 'PAPER_JAM',
        orderId: missedId,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id: missedId,
        orderNo: missedNo,
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: missedTask,
      },
    })
    await db.refund.create({
      data: {
        orderId: missedId,
        refundNo: `RFD-AC-STALE-${tag}`.slice(0, 40),
        amountCents: 80,
        status: 'success',
        reason: STALE_ATTEMPT_REFUND_REASON,
        channel: 'wechat',
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      },
    })
    await db.refund.create({
      data: {
        orderId: missedId,
        refundNo: `RFD-AC-FAIL-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'failed',
        reason: '当前这笔退款失败',
        channel: 'wechat',
      },
    })
    const orders = new AdminOrdersReadonlyService(db)
    const page = await orders.list({ opsAttention: true, search: missedNo, page: 1, pageSize: 20 })
    assert.equal(page.pagination.total, 1, '过期成功再加上当前失败退款，需关注不能漏')
    assert.equal(page.items[0]?.id, missedId)
    assert.equal(page.items[0]?.opsAttentionCode, 'print_return_manual')

    const throwing = {
      channel: 'wechat',
      queryRefund: async () => {
        throw new Error('渠道证书读不出来')
      },
    } as unknown as PaymentProvider
    const explicitUnknown = {
      channel: 'alipay',
      queryRefund: async () => ({ status: 'unknown' as const, channelRefundNo: null }),
    } as unknown as PaymentProvider
    const registry = new PaymentProviderRegistry([throwing, explicitUnknown])
    const faultQuery = await queryRefundChannel(registry, db, {
      channel: 'wechat',
      refundNo: 'RFD-BOOM',
      orderId: missedId,
    })
    assert.equal(
      typeof faultQuery === 'string' ? faultQuery : faultQuery.verdict,
      'fault',
      '我们自己出错不能记成渠道未知',
    )
    assert.equal(
      await queryRefundChannel(registry, db, { channel: 'alipay', refundNo: 'RFD-UNK', orderId: missedId }),
      'unknown',
      '渠道明确未知仍是未知',
    )

    const faultId = `ord_${tag}_p2b7ac_fault`
    const faultTask = `pt_${faultId}`
    created.push(faultId)
    input.orderIds.push(faultId)
    input.taskIds.push(faultTask)
    await db.printTask.create({
      data: {
        id: faultTask,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        printOutcome: 'not_printed',
        errorCode: 'PAPER_JAM',
        orderId: faultId,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id: faultId,
        orderNo: faultId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 60 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: faultTask,
      },
    })
    await db.refund.create({
      data: {
        orderId: faultId,
        refundNo: `RFD-AC-PEND-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'pending',
        reason: '渠道还没确认退款结果',
        channel: 'wechat',
      },
    })
    const faultCode = await resolvePrintReturnHold(
      db,
      faultId,
      'release_paper',
      'admin-test',
      (query) => queryRefundChannel(registry, db, query),
    ).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(faultCode, 'REFUND_CHANNEL_QUERY_FAILED')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: faultId } })).status, 'manual_review')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: faultId } })).payStatus, 'paid')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: faultId } })).taskStatus, 'failed')
    const faultAudit = await db.auditLog.findFirst({
      where: { targetId: faultId, action: PRINT_NO_PAPER_MANUAL_AUDIT },
    })
    assert.match(faultAudit?.payloadJson ?? '', /渠道证书读不出来/)

    const unknownId = `ord_${tag}_p2b7ac_unk`
    const unknownTask = `pt_${unknownId}`
    created.push(unknownId)
    input.orderIds.push(unknownId)
    input.taskIds.push(unknownTask)
    await db.printTask.create({
      data: {
        id: unknownTask,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        printOutcome: 'not_printed',
        errorCode: 'PAPER_JAM',
        orderId: unknownId,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id: unknownId,
        orderNo: unknownId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 60 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: unknownTask,
      },
    })
    await db.refund.create({
      data: {
        orderId: unknownId,
        refundNo: `RFD-AC-UNK-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'pending',
        reason: null,
        channel: 'wechat',
      },
    })
    const unknownCode = await resolvePrintReturnHold(
      db,
      unknownId,
      'release_paper',
      'admin-test',
      async () => 'unknown',
    ).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(unknownCode, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: unknownId } })).status, 'pending')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
