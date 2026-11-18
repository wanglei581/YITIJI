/**
 * 排队超时、渠道关着：退款停在待处理，确认退成按钮金额必须等于这一笔。
 */
import assert from 'node:assert/strict'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { PRINT_NO_PAPER_AUTO_FAILED_AUDIT } from '../../src/payment/print-return-disposition'
import { settleExplicitNoPaperFromReportedFailure } from '../../src/payment/print-no-paper-refund'
import { RefundService } from '../../src/payment/refund.service'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import { PERSONAL_CHARGE_SETTING_KEY } from '../../src/payment/terminal-charge.contract'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { PRINT_QUEUE_TIMEOUT } from '../../src/print-jobs/print-queue-timeout'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

export async function runP2b5LedgerAmountCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5led_${tag}`
  const terminalId = `term_p2b5led_${tag}`
  const orderId = `ord_${tag}_p2b5_ledger`
  const taskId = `pt_${orderId}`
  input.orderIds.push(orderId)
  input.taskIds.push(taskId)
  const prior = await db.platformSetting.findUnique({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
  await db.organization.create({ data: { id: orgId, name: '排队超时金额', type: 'school_employment_center' } })
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
    await db.platformSetting.upsert({
      where: { key: PERSONAL_CHARGE_SETTING_KEY },
      create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
      update: { value: 'true' },
    })
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode: PRINT_QUEUE_TIMEOUT,
        printOutcome: null,
        orderId,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id: orderId,
        orderNo: `L5${tag}q`.slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'sandbox',
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
    const refunds = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([]))
    const outcome = await settleExplicitNoPaperFromReportedFailure(db, taskId, { refund: refunds })
    assert.equal(outcome, 'failed')
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } })
    assert.equal(order.payStatus, 'refunding')
    const refund = await db.refund.findFirstOrThrow({ where: { orderId } })
    assert.equal(refund.status, 'pending')
    assert.equal(refund.amountCents, 200)
    const audit = JSON.parse(
      (await db.auditLog.findFirstOrThrow({
        where: { targetId: orderId, action: PRINT_NO_PAPER_AUTO_FAILED_AUDIT },
      })).payloadJson,
    ) as { code?: string }
    assert.equal(audit.code, 'ONLINE_PAYMENT_DISABLED')
    const detail = await new AdminOrdersReadonlyService(db).getById(orderId)
    assert.equal(detail.printRefundDisposition, 'auto_failed')
    assert.match(detail.printRefundReason ?? '', /ONLINE_PAYMENT_DISABLED/)
    assert.equal(detail.refundLedgerNo, refund.refundNo, '确认退成要对上这一笔待处理退款')
    assert.equal(detail.refundLedgerCents, 200, '按钮金额不能是 0，必须等于待处理退款 200')
    assert.equal(detail.refundStatus, 'pending')
    const confirmed = await resolvePrintReturnHold(db, orderId, 'confirm_refunded', 'admin-test')
    assert.equal(confirmed.amountCents, 200)
    assert.equal(confirmed.payStatus, 'refunded')
    assert.equal(confirmed.refundStatus, 'success')
  } finally {
    if (prior) {
      await db.platformSetting.update({ where: { key: PERSONAL_CHARGE_SETTING_KEY }, data: { value: prior.value } })
    } else {
      await db.platformSetting.deleteMany({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
    }
    await db.refund.deleteMany({ where: { orderId } })
    await db.auditLog.deleteMany({ where: { targetId: orderId } })
    await db.order.deleteMany({ where: { id: orderId } })
    await db.printTask.deleteMany({ where: { id: taskId } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
