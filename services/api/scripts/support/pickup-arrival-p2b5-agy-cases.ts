/**
 * agy 反方里还没被前面几条盖住的四条：改为出纸后要能领、过期退款不能挡住新付款、
 * 同额迟到通知重试要能应答、结算异常单要有退款入口。
 */
import assert from 'node:assert/strict'
import { AuditService } from '../../src/audit/audit.service'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { OnlinePaymentService } from '../../src/payment/online-payment.service'
import { OrderStatusService } from '../../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { PAID_UNFULFILLED_PENDING_REFUND_REASON } from '../../src/payment/pending-refund-signal'
import { SandboxPaymentProvider } from '../../src/payment/providers/sandbox-payment.provider'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { recordTimeoutSettlementFault } from '../../src/payment/print-return-settlement-fault'
import { RefundService } from '../../src/payment/refund.service'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const SANDBOX_SECRET = 'verify-p2b5-sandbox-secret-0123456789abcd'

async function terminal(
  db: PrismaService,
  id: string,
  orgId: string,
): Promise<void> {
  await db.organization.create({ data: { id: orgId, name: orgId, type: 'school_employment_center' } })
  await db.terminal.create({
    data: {
      id,
      terminalCode: id,
      agentToken: `tok-${id}`,
      deviceFingerprint: `fp-${id}`,
      orgId,
      enabled: true,
      lifecycleStatus: 'active',
    },
  })
}

export async function runP2b5AgyCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b5agy_${tag}`
  const terminalId = `term_p2b5agy_${tag}`
  await terminal(db, terminalId, orgId)
  const agent = new TerminalAgentService(db, new AuditService(db), { validateTerminalToken: async () => undefined } as never)
  const claim = () => agent.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer test')
  const releaseId = `ord_${tag}_agy_release`
  const staleId = `ord_${tag}_agy_stale`
  const blockedId = `ord_${tag}_agy_block`
  const retryId = `ord_${tag}_agy_retry`
  const faultId = `ord_${tag}_agy_fault`
  const ids = [releaseId, staleId, blockedId, retryId, faultId]
  input.orderIds.push(...ids)
  try {
    await db.printTask.create({
      data: {
        id: `pt_${releaseId}`,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode: 'PRINTER_OFFLINE',
        printOutcome: 'not_printed',
        orderId: releaseId,
        terminalId,
      },
    })
    input.taskIds.push(`pt_${releaseId}`)
    await db.order.create({
      data: {
        id: releaseId,
        orderNo: `A5${tag}rel`.slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'offline',
        paidAt: new Date(),
        refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON,
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 1,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: `pt_${releaseId}`,
      },
    })
    await db.refund.create({
      data: {
        orderId: releaseId,
        refundNo: `RFD-AGY-REL-${tag}`,
        amountCents: 200,
        status: 'failed',
        reason: '自动退款失败',
        channel: 'offline',
      },
    })
    const released = await resolvePrintReturnHold(db, releaseId, 'release_paper', 'admin-test')
    assert.equal(released.payStatus, 'paid')
    assert.equal(released.taskStatus, 'pending')
    const releasedOrder = await db.order.findUniqueOrThrow({ where: { id: releaseId } })
    assert.equal(releasedOrder.refundReason, null, '改为出纸必须清掉未履约待退信号，否则终端永远领不到')
    const releasedClaim = await claim()
    assert.equal(releasedClaim[0]?.taskId, `pt_${releaseId}`, '改为出纸后终端要能领到这张单')

    const seedPending = async (id: string, refundReason: string | null) => {
      await db.printTask.create({
        data: {
          id: `pt_${id}`,
          fileUrl: 'https://example.invalid/print',
          fileMd5: 'md5',
          status: 'pending',
          printOutcome: null,
          orderId: id,
          terminalId,
        },
      })
      input.taskIds.push(`pt_${id}`)
      await db.order.create({
        data: {
          id,
          orderNo: id.slice(0, 32),
          type: 'print',
          terminalId,
          amountCents: 200,
          discountCents: 0,
          payStatus: 'paid',
          paymentSource: 'sandbox',
          paidAt: new Date(),
          pickupStatus: 'pending',
          taskStatus: 'pending',
          billablePages: 1,
          printParamsJson: PAGES,
          itemsJson: '[]',
          channel: 'kiosk',
          printTaskId: `pt_${id}`,
        },
      })
      if (refundReason) {
        await db.refund.create({
          data: {
            orderId: id,
            refundNo: `RFD-AGY-${id}`.slice(0, 40),
            amountCents: 80,
            status: 'pending',
            reason: refundReason,
            channel: 'sandbox',
          },
        })
      }
    }
    await seedPending(staleId, STALE_ATTEMPT_REFUND_REASON)
    await seedPending(blockedId, '后台退款')
    const staleClaim = await claim()
    assert.equal(staleClaim[0]?.taskId, `pt_${staleId}`, '过期付款的待处理退款不能挡住后来已付的出纸')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${blockedId}` } })).status, 'pending')

    await db.order.create({
      data: {
        id: retryId,
        orderNo: `A5${tag}rty`.slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'sandbox',
        paidAt: new Date(),
        pickupStatus: 'pending',
        pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        taskStatus: 'pending',
        billablePages: 1,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
      },
    })
    await db.paymentAttempt.create({
      data: {
        id: `pa_${retryId}`,
        orderId: retryId,
        channel: 'sandbox',
        amountCents: 200,
        status: 'expired',
        expiresAt: new Date(Date.now() - 60_000),
      },
    })
    const payment = new OnlinePaymentService(
      db,
      new AuditService(db),
      new OrderStatusService(db, new AuditService(db)),
      new PaymentProviderRegistry([new SandboxPaymentProvider(SANDBOX_SECRET)]),
    )
    const first = await payment.simulateSandboxCallback({ attemptId: `pa_${retryId}`, result: 'success' })
    assert.equal(first.ok, true)
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: retryId } })).payStatus, 'paid')
    assert.equal(await db.refund.count({ where: { orderId: retryId, reason: STALE_ATTEMPT_REFUND_REASON } }), 1)
    const second = await payment.simulateSandboxCallback({ attemptId: `pa_${retryId}`, result: 'success' })
    assert.equal(second.ok, true, '同一笔迟到成功通知重试必须应答，不能再抛已支付')
    assert.equal(await db.refund.count({ where: { orderId: retryId } }), 1)
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: retryId } })).payStatus, 'paid')

    await db.printTask.create({
      data: {
        id: `pt_${faultId}`,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode: 'PRINT_QUEUE_TIMEOUT',
        printOutcome: null,
        orderId: faultId,
        terminalId,
      },
    })
    input.taskIds.push(`pt_${faultId}`)
    await db.order.create({
      data: {
        id: faultId,
        orderNo: `A5${tag}flt`.slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'offline',
        paidAt: new Date(),
        refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON,
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 1,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: `pt_${faultId}`,
      },
    })
    await recordTimeoutSettlementFault(db, `pt_${faultId}`, new Error('settlement blew up'))
    assert.equal(await db.refund.count({ where: { orderId: faultId } }), 0)
    const faultDetail = await new AdminOrdersReadonlyService(db).getById(faultId)
    assert.equal(faultDetail.refundLedgerNo, null)
    assert.equal(faultDetail.refundEligible, true, '没有退款行的结算异常单仍要能走普通退款')
    const faultRefund = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([]))
    const faultDone = await faultRefund.refund(faultId, { reason: '结算异常后退款', operatorId: 'admin-test' })
    assert.equal(faultDone.refund.status, 'success')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: faultId } })).payStatus, 'refunded')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: ids } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: ids } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: ids } } })
    await db.order.deleteMany({ where: { id: { in: ids } } })
    await db.printTask.deleteMany({ where: { orderId: { in: ids } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
