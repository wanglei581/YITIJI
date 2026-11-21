/**
 * 查询出错时，不是 Error 的抛出也要写进诊断。
 * 先去掉手机号、网址、证件号，再截断。退款状态不改。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { PRINT_NO_PAPER_MANUAL_AUDIT } from '../../src/payment/print-return-disposition'
import { queryRefundChannel } from '../../src/payment/refund-channel-query'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const LEAK = '请联系13800138000打开 https://evil.example/secret 证件110101199001011234后重试'

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

export async function runP2b8FaultTextCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b8ft_${tag}`
  const terminalId = `term_p2b8ft_${tag}`
  const orderId = `ord_${tag}_p2b8ft`
  const taskId = `pt_${orderId}`
  const refundNo = `RFD-P8F-${tag}`.slice(0, 40)
  input.orderIds.push(orderId)
  input.taskIds.push(taskId)
  await db.organization.create({ data: { id: orgId, name: '诊断脱敏', type: 'school_employment_center' } })
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
  try {
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode: 'PRINT_COMMAND_FAILED',
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
        channelRefundNo: 'ch-fault-text',
        channelSubmittedAt: new Date(),
      },
    })
    const registry = new PaymentProviderRegistry([{
      channel: 'wechat',
      queryRefund: async () => { throw LEAK },
    } as PaymentProvider])
    const code = await resolvePrintReturnHold(db, orderId, 'release_paper', 'admin-test', (query) => (
      queryRefundChannel(registry, db, query)
    )).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(code, 'REFUND_CHANNEL_QUERY_FAILED')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId } })).status, 'pending')
    const audit = await db.auditLog.findFirstOrThrow({
      where: { targetId: orderId, action: PRINT_NO_PAPER_MANUAL_AUDIT },
      orderBy: { createdAt: 'desc' },
    })
    const detail = audit.payloadJson ?? ''
    assert.equal(detail.includes('13800138000'), false)
    assert.equal(detail.includes('evil.example'), false)
    assert.equal(detail.includes('110101199001011234'), false)
    assert.equal(detail.includes('请联系'), true)
    assert.equal(detail.includes('后重试'), true)
  } finally {
    await db.refund.deleteMany({ where: { orderId } })
    await db.auditLog.deleteMany({ where: { targetId: orderId } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId } })
    await db.order.deleteMany({ where: { id: orderId } })
    await db.printTask.deleteMany({ where: { id: taskId } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
