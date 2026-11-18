/**
 * 退款与出纸互斥、已付没出纸的去向、到机重算清掉旧抵扣、超时结算失败进待人工。
 * SQLite 与 PostgreSQL 共用。引用打印退款，不碰招聘托管。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import { AuditService } from '../../src/audit/audit.service'
import { OnlinePaymentService } from '../../src/payment/online-payment.service'
import { OrderStatusService } from '../../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { SandboxPaymentProvider } from '../../src/payment/providers/sandbox-payment.provider'
import {
  explainPrintRefund,
  listPrintReturnHolds,
} from '../../src/payment/print-return-disposition'
import { PAID_NO_PAPER_AUTO_REASON, STALE_ATTEMPT_REFUND_REASON, staleAttemptRefundNo } from '../../src/payment/print-no-paper-refund.constants'
import { settleExplicitNoPaper } from '../../src/payment/print-no-paper-refund'
import { RefundService } from '../../src/payment/refund.service'
import {
  PAPER_ALREADY_RELEASED_CODE,
  REFUND_ALREADY_OPEN_CODE,
} from '../../src/payment/refund-paper-exclusion'
import { convergeNotifiedRefundSuccess } from '../../src/payment/refund-notify-paper-guard'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { expireQueuedPrintTasks } from '../../src/print-jobs/print-queue-timeout'
import { settlePickupArrival } from '../../src/print-jobs/pickup-arrival-price'
import { releaseArrivalPaymentHold } from '../../src/print-jobs/pickup-arrival-hold'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const SANDBOX_SECRET = 'verify-p2b4-sandbox-secret-0123456789abcd'

function readRepo(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../../..', relativePath), 'utf8')
}

function errorBody(error: unknown): { code: string; message: string } {
  assert.ok(error instanceof BadRequestException)
  const body = error.getResponse() as { error?: { code?: string; message?: string } }
  return { code: body.error?.code ?? '', message: body.error?.message ?? '' }
}

export async function runP2b4Cases(
  db: PrismaService,
  input: {
    tag: string
    orgId: string
    pricedTerminalId: string
    publicTerminalId: string
    orderIds: string[]
    taskIds: string[]
  },
): Promise<void> {
  const actions = readRepo('apps/admin/src/routes/orders/OrderPaymentActions.tsx')
  const holds = readRepo('apps/admin/src/routes/orders/PrintReturnHoldActions.tsx')
  const controller = readRepo('services/api/src/payment/admin-order-actions.controller.ts')
  assert.match(actions, /detail\.payableCents/)
  assert.match(readRepo('services/api/src/admin-orders-readonly/admin-orders-readonly.service.ts'), /payableCents\(row\)/)
  assert.match(holds, /确认退成/)
  assert.match(holds, /refundLedgerCents/)
  assert.match(holds, /核对后仍退款/)
  assert.match(controller, /print-return\/confirm-refunded/)
  assert.match(controller, /print-return\/release-paper/)
  assert.match(controller, /print-return\/close/)
  assert.match(controller, /refund-after-paper-check/)

  const tag = input.tag
  const claimTerminalId = `term_p2b4_${tag}`
  await db.terminal.create({
    data: {
      id: claimTerminalId,
      terminalCode: claimTerminalId,
      agentToken: `tok-${claimTerminalId}`,
      deviceFingerprint: `fp-${claimTerminalId}`,
      orgId: input.orgId,
      enabled: true,
      lifecycleStatus: 'active',
    },
  })
  const agent = new TerminalAgentService(db, new AuditService(db), { validateTerminalToken: async () => undefined } as never)
  const claimCount = async () => (await agent.claimTasks(claimTerminalId, { maxTasks: 1 }, 'Bearer test')).length
  const refunds = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([]))
  const admin = new AdminOrdersReadonlyService(db)
  let seq = 0

  const seed = async (label: string, fields: {
    payStatus?: string
    taskStatus?: string
    printStatus?: string
    printOutcome?: string | null
    amountCents?: number
    discountCents?: number
    paymentSource?: string | null
    terminalId?: string | null
    refund?: { status: string; amountCents: number; reason?: string | null; channel?: string } | null
    refundReason?: string | null
    pickupStatus?: string
    billablePages?: number
  }): Promise<{ orderId: string; taskId: string; refundNo: string | null }> => {
    seq += 1
    const orderId = `ord_${tag}_p2b4_${label}_${seq}`
    const taskId = `pt_${orderId}`
    const printStatus = fields.printStatus ?? 'failed'
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: printStatus,
        errorCode: printStatus === 'failed' ? 'PRINT_COMMAND_FAILED' : null,
        printOutcome: fields.printOutcome === undefined ? (printStatus === 'failed' ? 'not_printed' : null) : fields.printOutcome,
        terminalId: fields.terminalId === undefined ? claimTerminalId : fields.terminalId,
        orderId,
      },
    })
    input.taskIds.push(taskId)
    await db.order.create({
      data: {
        id: orderId,
        orderNo: `P4${tag}${label}${seq}`.slice(0, 32),
        type: 'print',
        terminalId: fields.terminalId === undefined ? claimTerminalId : fields.terminalId,
        amountCents: fields.amountCents ?? 200,
        discountCents: fields.discountCents ?? 0,
        payStatus: fields.payStatus ?? 'paid',
        paymentSource: fields.paymentSource === undefined ? 'offline' : fields.paymentSource,
        paidAt: (fields.payStatus ?? 'paid') === 'paid' ? new Date() : null,
        refundReason: fields.refundReason ?? null,
        pickupStatus: fields.pickupStatus ?? 'used',
        taskStatus: fields.taskStatus ?? printStatus,
        billablePages: fields.billablePages ?? 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    input.orderIds.push(orderId)
    let refundNo: string | null = null
    if (fields.refund) {
      refundNo = `RFD-P2B4-${tag}-${label}-${seq}`
      await db.refund.create({
        data: {
          orderId,
          refundNo,
          amountCents: fields.refund.amountCents,
          status: fields.refund.status,
          reason: fields.refund.reason ?? '后台退款',
          channel: fields.refund.channel ?? 'offline',
        },
      })
    }
    return { orderId, taskId, refundNo }
  }

  const once = async (orderId: string, disposition: 'auto_success' | 'auto_failed' | 'manual' | null, reason: string | null) => {
    const view = await explainPrintRefund(db, orderId)
    assert.equal(view.disposition, disposition, orderId)
    assert.equal(view.reason, reason, orderId)
    const detail = await admin.getById(orderId)
    assert.equal(detail.printRefundDisposition, disposition)
    assert.equal(detail.printRefundReason, reason)
    const listed = (await listPrintReturnHolds(db)).filter((hold) => hold.orderId === orderId)
    const alerts = (await collectPrintReturnAlerts(db)).filter((alert) => alert.subjectId === orderId)
    if (disposition === 'manual' || disposition === 'auto_failed') {
      assert.equal(listed.length, 1, orderId)
      assert.equal(listed[0]?.reason, reason)
      assert.equal(alerts.length, 1, orderId)
      assert.equal(alerts[0]?.type, 'print_return_manual')
      assert.equal(alerts[0]?.detail, reason)
    } else {
      assert.equal(listed.length, 0, orderId)
      assert.equal(alerts.length, 0, orderId)
    }
  }

  const blocked = await seed('blocked', {
    printStatus: 'pending',
    taskStatus: 'pending',
    printOutcome: null,
    refund: { status: 'failed', amountCents: 200 },
  })
  assert.equal(await claimCount(), 0, '退款失败时终端不能领纸')
  await assert.rejects(
    () => refunds.refund(blocked.orderId, { refundNo: `RFD-OTHER-${tag}`, reason: '再退一笔' }),
    (error: unknown) => errorBody(error).code === REFUND_ALREADY_OPEN_CODE,
  )

  const released = await seed('released', {
    printStatus: 'claimed',
    taskStatus: 'claimed',
    printOutcome: null,
    amountCents: 180,
  })
  await assert.rejects(
    () => refunds.refund(released.orderId, { reason: '普通退款' }),
    (error: unknown) => {
      const body = errorBody(error)
      return body.code === PAPER_ALREADY_RELEASED_CODE && body.message.includes('核对后仍退款')
    },
  )
  const verified = await refunds.refund(released.orderId, { reason: '核对后仍退款', verifiedAfterPaper: true })
  assert.equal(verified.refund.amountCents, 180)
  assert.equal(verified.refund.status, 'success')
  assert.equal((await db.order.findUnique({ where: { id: released.orderId } }))?.payStatus, 'refunded')
  assert.equal((await db.printTask.findUnique({ where: { id: released.taskId } }))?.status, 'claimed')
  const checked = await db.auditLog.findFirst({ where: { targetId: released.orderId, action: 'refund.paper_checked' } })
  assert.match(checked?.payloadJson ?? '', /核对后仍退款，纸可能已经出去/)

  const confirmed = await seed('confirm', {
    printStatus: 'pending',
    taskStatus: 'pending',
    printOutcome: null,
    refund: { status: 'failed', amountCents: 200 },
  })
  const confirmedResult = await resolvePrintReturnHold(db, confirmed.orderId, 'confirm_refunded', 'admin-test')
  assert.equal(confirmedResult.payStatus, 'refunded')
  assert.equal(confirmedResult.refundStatus, 'success')
  assert.equal(confirmedResult.taskStatus, 'cancelled')
  assert.equal(await claimCount(), 0)
  await once(confirmed.orderId, 'auto_success', null)

  const closed = await seed('close', {
    printStatus: 'failed',
    refund: { status: 'manual_review', amountCents: 200 },
  })
  const closedResult = await resolvePrintReturnHold(db, closed.orderId, 'close_order', 'admin-test')
  assert.equal(closedResult.payStatus, 'closed')
  assert.equal(closedResult.refundStatus, 'closed')
  assert.equal(closedResult.taskStatus, 'cancelled')
  assert.equal(await claimCount(), 0)
  await once(closed.orderId, null, null)

  const paper = await seed('paper', {
    printStatus: 'failed',
    refund: { status: 'failed', amountCents: 200 },
  })
  const paperResult = await resolvePrintReturnHold(db, paper.orderId, 'release_paper', 'admin-test')
  assert.equal(paperResult.payStatus, 'paid')
  assert.equal(paperResult.refundStatus, 'withdrawn')
  assert.equal(paperResult.taskStatus, 'pending')
  assert.equal((await db.order.findUnique({ where: { id: paper.orderId } }))?.refundedAmountCents, 0)
  const claimed = await agent.claimTasks(claimTerminalId, { maxTasks: 1 }, 'Bearer test')
  assert.equal(claimed.length, 1)
  assert.equal(claimed[0]?.taskId, paper.taskId)

  const bare = await seed('bare', { printOutcome: 'not_printed' })
  await once(bare.orderId, 'manual', '已付款，打印失败，没有退款记录，待人工处理')
  const emptyPaper = await seed('empty', { printOutcome: null })
  await once(emptyPaper.orderId, 'manual', '已付款，打印失败，没有退款记录，待人工处理')
  const refunding = await seed('refunding', { payStatus: 'refunding', paymentSource: 'offline', printStatus: 'failed' })
  await once(refunding.orderId, 'manual', '订单停在退款中，但没有退款记录，待人工处理')
  const partial = await seed('partial', {
    payStatus: 'partial_refunded',
    paymentSource: 'offline',
    refund: { status: 'success', amountCents: 50, reason: '只退了一部分' },
  })
  await once(partial.orderId, 'manual', '只退了一部分，纸没有出，待人工核对')
  const full = await seed('full', {
    payStatus: 'refunded',
    paymentSource: 'offline',
    refund: { status: 'success', amountCents: 200, reason: '管理员退了' },
  })
  await once(full.orderId, 'auto_success', null)
  const failedOther = await seed('failother', {
    payStatus: 'refunding',
    refund: { status: 'failed', amountCents: 200, reason: '后台退款' },
  })
  await once(failedOther.orderId, 'manual', '退款没有成功，待人工处理')
  const pendingOther = await seed('pendother', {
    payStatus: 'refunding',
    refund: { status: 'pending', amountCents: 200, reason: '后台退款' },
  })
  await once(pendingOther.orderId, 'manual', '退款还在处理，待人工核对')
  const hidden = await seed('hidden', {
    payStatus: 'paid',
    printStatus: 'failed',
    amountCents: 200,
    refund: { status: 'failed', amountCents: 200, reason: PAID_NO_PAPER_AUTO_REASON },
  })
  await db.refund.create({
    data: {
      orderId: hidden.orderId,
      refundNo: `RFD-P2B4-STALE-${tag}`,
      amountCents: 80,
      status: 'success',
      reason: STALE_ATTEMPT_REFUND_REASON,
      channel: 'sandbox',
    },
  })
  await once(hidden.orderId, 'auto_failed', '退款渠道返回失败（REFUND_CHANNEL_FAILED），没有退成')

  const printedPending = await seed('printedpending', {
    payStatus: 'refunding',
    paymentSource: 'wechat',
    printStatus: 'completed',
    taskStatus: 'completed',
    printOutcome: 'printed',
    refund: { status: 'pending', amountCents: 200, reason: PAID_NO_PAPER_AUTO_REASON, channel: 'wechat' },
  })
  const printedRefund = await db.refund.findUniqueOrThrow({ where: { refundNo: printedPending.refundNo ?? '' } })
  const printedOutcome = await db.$transaction((tx) => convergeNotifiedRefundSuccess(tx, {
    refundId: printedRefund.id,
    orderId: printedPending.orderId,
    priorStatus: 'pending',
    channelRefundNo: 'ch-printed-pending',
    amountCents: 200,
    reason: printedRefund.reason,
  }))
  assert.equal(printedOutcome, 'blocked', '退款还在处理时纸已经出去，不能再记成退款成功')
  assert.equal((await db.refund.findUnique({ where: { id: printedRefund.id } }))?.status, 'manual_review')
  assert.equal((await db.order.findUnique({ where: { id: printedPending.orderId } }))?.payStatus, 'paid')
  assert.equal((await db.printTask.findUnique({ where: { id: printedPending.taskId } }))?.printOutcome, 'printed')

  const pendingClear = await seed('pendingclear', {
    payStatus: 'refunding',
    paymentSource: 'wechat',
    printStatus: 'failed',
    printOutcome: 'not_printed',
    refund: { status: 'pending', amountCents: 200, reason: PAID_NO_PAPER_AUTO_REASON, channel: 'wechat' },
  })
  const clearRefund = await db.refund.findUniqueOrThrow({ where: { refundNo: pendingClear.refundNo ?? '' } })
  const clearOutcome = await db.$transaction((tx) => convergeNotifiedRefundSuccess(tx, {
    refundId: clearRefund.id,
    orderId: pendingClear.orderId,
    priorStatus: 'pending',
    channelRefundNo: 'ch-pending-clear',
    amountCents: 200,
    reason: clearRefund.reason,
  }))
  assert.equal(clearOutcome, 'completed', '纸还没出去时，处理中的退款仍可以记成成功')
  assert.equal((await db.order.findUnique({ where: { id: pendingClear.orderId } }))?.payStatus, 'refunded')

  const waiting = await seed('waiting', {
    printStatus: 'pending',
    taskStatus: 'pending',
    printOutcome: null,
    terminalId: input.pricedTerminalId,
  })
  assert.equal((await listPrintReturnHolds(db)).some((hold) => hold.orderId === waiting.orderId), false)

  const priced = await db.order.create({
    data: {
      id: `ord_${tag}_p2b4_priced`,
      orderNo: `P4${tag}priced`.slice(0, 32),
      type: 'print',
      terminalId: null,
      amountCents: 400,
      discountCents: 300,
      payStatus: 'unpaid',
      paymentSource: null,
      pickupStatus: 'pending',
      pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      taskStatus: 'awaiting_payment',
      billablePages: 2,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'miniapp_cloud',
    },
  })
  input.orderIds.push(priced.id)
  const arrival = await settlePickupArrival(db, { orderId: priced.id, terminalId: input.pricedTerminalId })
  assert.equal(arrival.kind, 'pay')
  assert.equal(arrival.arrivalCents, 200)
  const repriced = await db.order.findUniqueOrThrow({ where: { id: priced.id } })
  assert.equal(repriced.amountCents, 200)
  assert.equal(repriced.discountCents, 0)
  assert.equal((await admin.getById(priced.id)).payableCents, 200)
  const cut = await seed('cut', {
    amountCents: 300,
    discountCents: 100,
    paymentSource: 'offline',
    printStatus: 'failed',
  })
  assert.equal((await admin.getById(cut.orderId)).payableCents, 200)
  const cutRefund = await refunds.refund(cut.orderId, { reason: '按实付退' })
  assert.equal(cutRefund.refund.amountCents, 200)
  assert.equal(cutRefund.refund.status, 'success')
  const payment = new OnlinePaymentService(
    db,
    new AuditService(db),
    new OrderStatusService(db, new AuditService(db)),
    new PaymentProviderRegistry([new SandboxPaymentProvider(SANDBOX_SECRET)]),
  )
  await db.paymentAttempt.create({
    data: {
      id: `pa_${priced.id}`,
      orderId: priced.id,
      channel: 'sandbox',
      amountCents: 200,
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  const paid = await payment.simulateSandboxCallback({ attemptId: `pa_${priced.id}`, result: 'success' })
  assert.equal(paid.ok, true)
  const paidRow = await db.order.findUniqueOrThrow({ where: { id: priced.id } })
  assert.equal(paidRow.payStatus, 'paid')
  assert.equal(paidRow.paymentSource, 'sandbox')
  assert.equal(paidRow.amountCents, 200)
  const sandboxRefunds = new RefundService(
    db,
    new AuditService(db),
    new PaymentProviderRegistry([new SandboxPaymentProvider(SANDBOX_SECRET)]),
  )
  const returned = await settleExplicitNoPaper(db, {
    orderId: priced.id,
    taskStatus: 'failed',
    errorCode: 'PRINT_QUEUE_TIMEOUT',
    printOutcome: null,
    completedItemCount: 0,
  }, { refund: sandboxRefunds })
  assert.equal(returned, 'refunded')
  const pricedRefund = await db.refund.findFirstOrThrow({ where: { orderId: priced.id } })
  assert.equal(pricedRefund.amountCents, 200)
  assert.equal(pricedRefund.status, 'success')

  const bookId = `ord_${tag}_p2b4_book`
  await db.order.create({
    data: {
      id: bookId,
      orderNo: `P4${tag}book`.slice(0, 32),
      type: 'print',
      terminalId: null,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'unpaid',
      pickupStatus: 'pending',
      pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      taskStatus: 'awaiting_payment',
      billablePages: 2,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'miniapp_cloud',
    },
  })
  input.orderIds.push(bookId)
  await db.paymentAttempt.create({
    data: {
      id: `pa_${bookId}`,
      orderId: bookId,
      channel: 'sandbox',
      amountCents: 200,
      status: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
      failReason: '这次付款已过期',
    },
  })
  await payment.simulateSandboxCallback({ attemptId: `pa_${bookId}`, result: 'success' })
  const booked = await db.order.findUniqueOrThrow({ where: { id: bookId } })
  assert.equal(booked.payStatus, 'paid', '金额一致且窗口还开着，过期尝试仍应入账')
  assert.equal(await db.refund.count({ where: { orderId: bookId } }), 0)

  const dupId = `ord_${tag}_p2b4_dup`
  await db.order.create({
    data: {
      id: dupId,
      orderNo: `P4${tag}dup`.slice(0, 32),
      type: 'print',
      terminalId: input.pricedTerminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'paid',
      paymentSource: 'sandbox',
      paidAt: new Date(),
      pickupStatus: 'pending',
      pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      taskStatus: 'pending',
      billablePages: 2,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'miniapp_cloud',
    },
  })
  input.orderIds.push(dupId)
  await db.paymentAttempt.create({
    data: {
      id: `pa_${dupId}`,
      orderId: dupId,
      channel: 'sandbox',
      amountCents: 200,
      status: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    },
  })
  await payment.simulateSandboxCallback({ attemptId: `pa_${dupId}`, result: 'success' })
  const dupRow = await db.order.findUniqueOrThrow({ where: { id: dupId } })
  assert.equal(dupRow.payStatus, 'paid')
  assert.equal(dupRow.paymentSource, 'sandbox')
  const dupRefund = await db.refund.findUnique({ where: { refundNo: staleAttemptRefundNo(`pa_${dupId}`) } })
  assert.equal(dupRefund?.status, 'success')
  assert.equal(dupRefund?.amountCents, 200)

  const shutId = `ord_${tag}_p2b4_shut`
  await db.order.create({
    data: {
      id: shutId,
      orderNo: `P4${tag}shut`.slice(0, 32),
      type: 'print',
      terminalId: null,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'closed',
      pickupStatus: 'expired',
      pickupCodeExpiresAt: new Date(Date.now() - 60_000),
      taskStatus: 'awaiting_payment',
      billablePages: 2,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'miniapp_cloud',
    },
  })
  input.orderIds.push(shutId)
  await db.paymentAttempt.create({
    data: {
      id: `pa_${shutId}`,
      orderId: shutId,
      channel: 'sandbox',
      amountCents: 200,
      status: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    },
  })
  await payment.simulateSandboxCallback({ attemptId: `pa_${shutId}`, result: 'success' })
  const shutRow = await db.order.findUniqueOrThrow({ where: { id: shutId } })
  assert.equal(shutRow.payStatus, 'closed', '窗口已关的同额迟到款不入账')
  const shutRefund = await db.refund.findUnique({ where: { refundNo: staleAttemptRefundNo(`pa_${shutId}`) } })
  assert.equal(shutRefund?.status, 'success')
  assert.equal(shutRefund?.amountCents, 200)

  const lateOpenId = `ord_${tag}_p2b4_lateopen`
  await db.order.create({
    data: {
      id: lateOpenId,
      orderNo: `P4${tag}late`.slice(0, 32),
      type: 'print',
      terminalId: null,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'closed',
      pickupStatus: 'pending',
      pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      taskStatus: 'awaiting_payment',
      billablePages: 2,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'miniapp_cloud',
    },
  })
  input.orderIds.push(lateOpenId)
  await db.paymentAttempt.create({
    data: {
      id: `pa_${lateOpenId}`,
      orderId: lateOpenId,
      channel: 'sandbox',
      amountCents: 200,
      status: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    },
  })
  await payment.simulateSandboxCallback({ attemptId: `pa_${lateOpenId}`, result: 'success' })
  const lateOpenRow = await db.order.findUniqueOrThrow({ where: { id: lateOpenId } })
  assert.equal(lateOpenRow.payStatus, 'paid', '订单已关闭但取件窗口还开着，同额迟到款入账，可以出纸')
  assert.equal(await db.refund.count({ where: { orderId: lateOpenId } }), 0)

  const abandonId = `ord_${tag}_p2b4_abandon`
  await db.order.create({
    data: {
      id: abandonId,
      orderNo: `P4${tag}aban`.slice(0, 32),
      type: 'print',
      terminalId: input.pricedTerminalId,
      amountCents: 200,
      discountCents: 0,
      payStatus: 'unpaid',
      pickupStatus: 'pending',
      pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      taskStatus: 'awaiting_payment',
      billablePages: 2,
      printParamsJson: PAGES,
      itemsJson: '[]',
      channel: 'miniapp_cloud',
    },
  })
  input.orderIds.push(abandonId)
  await db.paymentAttempt.create({
    data: {
      id: `pa_${abandonId}`,
      orderId: abandonId,
      channel: 'sandbox',
      amountCents: 200,
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  assert.equal(await releaseArrivalPaymentHold(db, abandonId, input.pricedTerminalId), 'released')
  const abandonedAttempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: `pa_${abandonId}` } })
  assert.equal(abandonedAttempt.status, 'expired')
  assert.equal(abandonedAttempt.failReason, '用户返回，这次付款已取消')
  const freed = await settlePickupArrival(db, { orderId: abandonId, terminalId: input.publicTerminalId })
  assert.equal(freed.kind, 'release', '公共就业点位放弃后仍免费放行')
  await payment.simulateSandboxCallback({ attemptId: `pa_${abandonId}`, result: 'success' })
  const freedRow = await db.order.findUniqueOrThrow({ where: { id: abandonId } })
  assert.equal(freedRow.payStatus, 'paid')
  assert.equal(freedRow.paymentSource, 'free')
  assert.equal(freedRow.amountCents, 0)
  const freedRefund = await db.refund.findUnique({ where: { refundNo: staleAttemptRefundNo(`pa_${abandonId}`) } })
  assert.equal(freedRefund?.amountCents, 200)
  assert.equal(freedRefund?.status, 'success')

  const staleHold = await seed('stalehold', {
    payStatus: 'unpaid',
    paymentSource: null,
    taskStatus: 'awaiting_payment',
    printStatus: 'pending',
    printOutcome: null,
    amountCents: 200,
    terminalId: null,
    refund: { status: 'manual_review', amountCents: 80, reason: STALE_ATTEMPT_REFUND_REASON, channel: 'sandbox' },
  })
  const staleDetail = await admin.getById(staleHold.orderId)
  assert.equal(staleDetail.payStatus, 'unpaid')
  assert.equal(staleDetail.refundEligible, false)
  assert.equal(staleDetail.printRefundDisposition, 'manual')
  assert.equal(staleDetail.refundLedgerNo, staleHold.refundNo)
  assert.equal(staleDetail.refundLedgerCents, 80)
  const staleResolved = await resolvePrintReturnHold(db, staleHold.orderId, 'confirm_refunded', 'admin-test')
  assert.equal(staleResolved.refundStatus, 'success')
  assert.equal(staleResolved.amountCents, 80)
  assert.equal(staleResolved.payStatus, 'unpaid')

  const fault = await seed('fault', {
    printStatus: 'pending',
    taskStatus: 'pending',
    printOutcome: null,
    paymentSource: 'sandbox',
    amountCents: 200,
    terminalId: input.pricedTerminalId,
  })
  const swept = await expireQueuedPrintTasks(db, new Date(Date.now() + 40 * 60 * 1000), async (_db, taskId) => {
    if (taskId === fault.taskId) throw new Error('结算注入失败')
  })
  assert.ok(swept >= 1)
  const faultAudit = await db.auditLog.findFirst({
    where: { targetId: fault.orderId, action: 'print_order.no_paper_manual' },
  })
  assert.match(faultAudit?.payloadJson ?? '', /排队超时后的结算没有完成：结算注入失败/)
  assert.equal(await db.refund.count({ where: { orderId: fault.orderId } }), 0)
  assert.equal((await db.printTask.findUnique({ where: { id: fault.taskId } }))?.status, 'failed')
  const faultView = await explainPrintRefund(db, fault.orderId)
  assert.equal(faultView.disposition, 'manual')
  assert.match(faultView.reason ?? '', /排队超时后的结算没有完成/)
  const faultAlert = (await collectPrintReturnAlerts(db)).find((alert) => alert.subjectId === fault.orderId)
  assert.equal(faultAlert?.type, 'print_return_manual')
  assert.match(faultAlert?.detail ?? '', /排队超时后的结算没有完成/)
}
