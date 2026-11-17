/**
 * 实付和本机价不一致时按实付退。退款成功和核码同时到时，不能既退钱又放行。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import type { PaymentProvider, RefundExecuteInput } from '../../src/payment/payment-provider.types'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { PAID_NO_PAPER_AUTO_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { settleExplicitNoPaperFromReportedFailure } from '../../src/payment/print-no-paper-refund'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { settlePickupArrival } from '../../src/print-jobs/pickup-arrival-price'

export async function runArrivalMoneyCases(
  db: PrismaService,
  input: { tag: string; terminalId: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const createOrder = async (suffix: string, data: {
    amountCents: number
    payStatus: string
    paymentSource?: string | null
    taskStatus?: string
    terminalId?: string | null
  }): Promise<string> => {
    const id = `ord_${input.tag}_${suffix}`
    await db.order.create({
      data: {
        id,
        orderNo: `NO${input.tag}${suffix}`.slice(0, 40),
        type: 'print',
        terminalId: data.terminalId === undefined ? input.terminalId : data.terminalId,
        amountCents: data.amountCents,
        payStatus: data.payStatus,
        paymentSource: data.paymentSource ?? null,
        paidAt: data.payStatus === 'paid' ? new Date('2026-11-17T02:00:00Z') : null,
        pickupStatus: 'pending',
        taskStatus: data.taskStatus ?? 'pending',
        billablePages: 2,
        printParamsJson: JSON.stringify({ copies: 1, colorMode: 'black_white' }),
        itemsJson: '[]',
        discountCents: 0,
        channel: 'miniapp_cloud',
      },
    })
    input.orderIds.push(id)
    return id
  }

  const paidId = await createOrder('paid137', {
    amountCents: 137,
    payStatus: 'paid',
    paymentSource: 'sandbox',
    taskStatus: 'failed',
  })
  const taskId = `pt_${paidId}`
  await db.printTask.create({
    data: {
      id: taskId,
      fileUrl: 'https://example.invalid/print',
      fileMd5: 'md5',
      status: 'failed',
      errorCode: 'PRINT_COMMAND_FAILED',
      printOutcome: null,
      orderId: paidId,
    },
  })
  input.taskIds.push(taskId)
  await db.order.update({ where: { id: paidId }, data: { printTaskId: taskId } })
  const seen: number[] = []
  const provider = {
    channel: 'sandbox',
    refund: async (refundInput: RefundExecuteInput) => {
      seen.push(refundInput.amountCents)
      return { status: 'success' as const, channelRefundNo: 'sandbox-137', refundAmountCents: refundInput.amountCents }
    },
  } as PaymentProvider
  const refundApi = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([provider]))
  const outcome = await settleExplicitNoPaperFromReportedFailure(db, taskId, { refund: refundApi })
  assert.equal(outcome, 'refunded', '实付 137 分应当退成')
  assert.deepEqual(seen, [137], '发给退款适配层的金额是实付 137，不是本机两页 200')
  const refund = await db.refund.findFirstOrThrow({ where: { orderId: paidId, reason: PAID_NO_PAPER_AUTO_REASON } })
  assert.equal(refund.amountCents, 137)
  assert.equal(refund.status, 'success')

  for (const [suffix, payStatus] of [['refundedhold', 'refunded'], ['refundinghold', 'refunding']] as const) {
    const id = await createOrder(suffix, { amountCents: 200, payStatus, paymentSource: 'sandbox' })
    const arrival = await settlePickupArrival(db, { orderId: id, terminalId: input.terminalId })
    assert.notEqual(arrival.kind, 'release', `${payStatus} 不能放行`)
  }

  const raceId = await createOrder('refundrace', {
    amountCents: 137,
    payStatus: 'paid',
    paymentSource: 'sandbox',
    terminalId: null,
  })
  const raceProvider = {
    channel: 'sandbox',
    refund: async (refundInput: RefundExecuteInput) => {
      assert.equal(refundInput.amountCents, 137)
      return { status: 'success' as const, channelRefundNo: 'sandbox-race', refundAmountCents: 137 }
    },
  } as PaymentProvider
  const raceRefund = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([raceProvider]))
  const [arrival, money] = await Promise.all([
    settlePickupArrival(db, { orderId: raceId, terminalId: input.terminalId }),
    raceRefund.refund(raceId, { reason: PAID_NO_PAPER_AUTO_REASON }).catch((error: unknown) => error),
  ])
  const refundRow = await db.refund.findFirst({ where: { orderId: raceId } })
  const released = arrival.kind === 'release'
  const refunded = refundRow?.status === 'success'
  assert.equal(released && refunded, false, '退款成功和核码同时到，不能既退钱又放行')
  if (money instanceof Error && released) {
    assert.notEqual(refundRow?.status, 'success')
  }
  const again = await settlePickupArrival(db, { orderId: raceId, terminalId: input.terminalId })
  if (refunded) assert.notEqual(again.kind, 'release', '退款成功之后再核码不能放行')
}
