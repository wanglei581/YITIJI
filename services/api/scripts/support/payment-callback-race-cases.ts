/**
 * 本轮支付回调竞态场景。
 *
 * verify-payment-flow.ts 已经超过 1500 行，本文件只承接这一轮新增的出码互斥、
 * 迟到成功退款和回填竞态。由 verify-payment-flow 调用，不是单独的门禁入口。
 */
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { AuditService } from '../../src/audit/audit.service'
import { CHANNEL_ACCEPTED_UNCONFIRMED_REASON } from '../../src/payment/channel-accepted-signal'
import { OnlinePaymentService } from '../../src/payment/online-payment.service'
import { ONLINE_PAID_PENDING_REFUND_REASON, OrderStatusService } from '../../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider, PaymentQueryResult } from '../../src/payment/payment-provider.types'
import { ReconciliationService } from '../../src/payment/reconciliation.service'
import { RefundService } from '../../src/payment/refund.service'
import { PrismaService } from '../../src/prisma/prisma.service'
import { SandboxPaymentProvider } from '../../src/payment/providers/sandbox-payment.provider'

type CallbackRequest = { rawBody: Buffer; headers: Record<string, string> }

export interface PaymentCallbackRaceDeps {
  prisma: PrismaService
  payment: OnlinePaymentService
  provider: SandboxPaymentProvider
  audit: AuditService
  suffix: string
  channel: string
  makeOrder: (amountCents: number, payStatus?: string) => Promise<string>
  paymentSessionFor: (orderId: string) => Promise<string>
  buildCallback: (input: {
    payload: Record<string, unknown>
    nonce?: string
  }) => CallbackRequest
  pass: (message: string) => void
  fail: (message: string) => never
  expectCode: (label: string, code: string, fn: () => Promise<unknown>) => Promise<void>
}

const UNKNOWN_QR_CASES = [
  { label: 'plain error looking like 40004 ACQ.INVALID_PARAMETER', message: 'ALIPAY_CHANNEL_ERROR: 40004 ACQ.INVALID_PARAMETER' },
  { label: 'alipay 40004 ACQ.NEW_UNKNOWN_CODE', message: 'ALIPAY_CHANNEL_ERROR: 40004 ACQ.NEW_UNKNOWN_CODE' },
  { label: 'alipay code UNKNOWN', message: 'ALIPAY_CHANNEL_ERROR: UNKNOWN' },
  { label: 'wechat HTTP 400 UNKNOWN_NEW_CODE', message: 'WECHAT_PAY_CHANNEL_ERROR: HTTP_400 UNKNOWN_NEW_CODE' },
  { label: 'alipay QR_CODE_MISSING', message: 'ALIPAY_CHANNEL_ERROR: QR_CODE_MISSING' },
  { label: 'wechat CODE_URL_MISSING', message: 'WECHAT_PAY_CHANNEL_ERROR: CODE_URL_MISSING' },
  { label: 'alipay RESPONSE_SIGN_INVALID', message: 'ALIPAY_CHANNEL_ERROR: RESPONSE_SIGN_INVALID' },
  { label: 'alipay RESPONSE_NOT_JSON', message: 'ALIPAY_CHANNEL_ERROR: RESPONSE_NOT_JSON' },
  { label: 'alipay 20000', message: 'ALIPAY_CHANNEL_ERROR: 20000' },
  { label: 'wechat HTTP 500 SYSTEM_ERROR', message: 'WECHAT_PAY_CHANNEL_ERROR: HTTP_500 SYSTEM_ERROR' },
  { label: 'network timeout', message: 'network timeout' },
] as const

const RAW_LEAKS = [
  'ACQ.INVALID_PARAMETER',
  '40004',
  'ACQ.NEW_UNKNOWN_CODE',
  'UNKNOWN_NEW_CODE',
  'QR_CODE_MISSING',
  'CODE_URL_MISSING',
  'RESPONSE_SIGN_INVALID',
  'RESPONSE_NOT_JSON',
  '20000',
  'SYSTEM_ERROR',
  'network timeout',
]

function responseText(error: unknown): string {
  const exception = error as { getResponse?: () => unknown; message?: string }
  const response = typeof exception.getResponse === 'function' ? exception.getResponse() : undefined
  return JSON.stringify(response ?? { message: exception.message ?? String(error) })
}

function errorCodeOf(error: unknown): string {
  const exception = error as { getResponse?: () => unknown; message?: string }
  const response = typeof exception.getResponse === 'function' ? exception.getResponse() : undefined
  const code = (response as { error?: { code?: string } } | undefined)?.error?.code
  return code ?? exception.message ?? String(error)
}

export async function verifyPaymentCallbackRace(deps: PaymentCallbackRaceDeps): Promise<void> {
  const originalCreateQr = deps.provider.createQrPayment.bind(deps.provider)
  const originalCreateCode = deps.provider.createCodePayment!.bind(deps.provider)
  const originalRefund = deps.provider.refund.bind(deps.provider)
  let codePayCalls = 0
  let refundCalls = 0
  deps.provider.createCodePayment = async (input) => {
    codePayCalls += 1
    return originalCreateCode(input)
  }
  deps.provider.refund = async (input) => {
    refundCalls += 1
    return originalRefund(input)
  }
  try {
    await verifyUnknownQrDoesNotRelease(deps, originalCreateQr)
    await verifyAuxiliaryAttemptReadDoesNotHideUnknownQr(deps)
    await verifyStructuredQueryRecovery(deps)
    await verifyClosedWindowSuccessIsRefundable(deps)
    await verifyBlockedSuccessWriteRetries(deps)
    await verifyAcceptanceOrderings(deps, originalCreateQr)
    if (codePayCalls !== 0) {
      deps.fail(`callback-race scenarios invoked code-pay provider ${codePayCalls} times`)
    }
    if (refundCalls !== 1) {
      deps.fail(`sandbox refund provider calls=${refundCalls}, expected 1`)
    }
  } finally {
    deps.provider.createQrPayment = originalCreateQr
    deps.provider.createCodePayment = originalCreateCode
    deps.provider.refund = originalRefund
  }
}

async function verifyUnknownQrDoesNotRelease(
  deps: PaymentCallbackRaceDeps,
  originalCreateQr: SandboxPaymentProvider['createQrPayment'],
): Promise<void> {
  let compensated: { orderId: string; attemptId: string; amountCents: number } | null = null
  let expiryOrderId: string | null = null
  let expirySession: string | null = null
  try {
    for (const unknownCase of UNKNOWN_QR_CASES) {
      const orderId = await deps.makeOrder(150, 'unpaid')
      const session = await deps.paymentSessionFor(orderId)
      let calls = 0
      deps.provider.createQrPayment = async () => {
        calls += 1
        throw new Error(unknownCase.message)
      }
      let code = 'RESOLVED'
      let body = ''
      try {
        await deps.payment.createPayAttempt(orderId, session)
      } catch (error) {
        code = errorCodeOf(error)
        body = responseText(error)
      }
      const order = await deps.prisma.order.findUnique({ where: { id: orderId } })
      const attempt = await deps.prisma.paymentAttempt.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
      })
      const leaked = RAW_LEAKS.find((token) => unknownCase.message.includes(token) && body.includes(token))
      if (
        code.includes('PAY_CHANNEL_ACCEPTANCE_UNCONFIRMED') &&
        body.includes('支付结果尚未确认') &&
        body.includes('请勿重复支付') &&
        !body.includes('已受理') &&
        !leaked &&
        order?.payStatus === 'paying' &&
        attempt &&
        attempt.status !== 'failed' &&
        attempt.status !== 'success' &&
        (attempt.failReason === CHANNEL_ACCEPTED_UNCONFIRMED_REASON ||
          (!attempt.prepayId && !attempt.qrCodeContent && !attempt.channelTxnNo))
      ) {
        deps.pass(`${unknownCase.label} stays locked and does not claim the channel already accepted`)
      } else {
        deps.fail(
          `${unknownCase.label} lock mismatch: code=${code} body=${body} pay=${order?.payStatus} attempt=${JSON.stringify(attempt)}`,
        )
      }
      const before = await deps.prisma.paymentAttempt.count({ where: { orderId } })
      await deps.expectCode(
        `${unknownCase.label} retry does not open a second QR (PAYMENT_ATTEMPT_PENDING)`,
        'PAYMENT_ATTEMPT_PENDING',
        () => deps.payment.createPayAttempt(orderId, session),
      )
      const after = await deps.prisma.paymentAttempt.count({ where: { orderId } })
      if (calls === 1 && before === 1 && after === 1) {
        deps.pass(`${unknownCase.label} retry calls the provider once only`)
      } else {
        deps.fail(`${unknownCase.label} provider calls=${calls} attempts ${before}→${after}`)
      }
      if (unknownCase.message.includes('ACQ.NEW_UNKNOWN_CODE') && attempt) {
        expiryOrderId = orderId
        expirySession = session
        await deps.prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        })
        await deps.expectCode(
          'expired-at unknown QR still blocks another QR (PAYMENT_ATTEMPT_PENDING)',
          'PAYMENT_ATTEMPT_PENDING',
          () => deps.payment.createPayAttempt(orderId, session),
        )
        await deps.expectCode(
          'expired-at unknown QR still blocks code-pay (PAYMENT_ATTEMPT_PENDING)',
          'PAYMENT_ATTEMPT_PENDING',
          () => deps.payment.createCodePayAttempt(orderId, session, '123456789012345678'),
        )
        await deps.prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: 'expired' },
        })
        await deps.expectCode(
          'status expired unknown QR still blocks another QR (PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED)',
          'PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED',
          () => deps.payment.createPayAttempt(orderId, session),
        )
        await deps.expectCode(
          'status expired unknown QR still blocks code-pay (PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED)',
          'PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED',
          () => deps.payment.createCodePayAttempt(orderId, session, '123456789012345678'),
        )
        const expiredAttempts = await deps.prisma.paymentAttempt.count({ where: { orderId } })
        if (calls === 1 && expiredAttempts === 1) {
          deps.pass('unknown new alipay code stays locked after expiry for both QR and code-pay')
        } else {
          deps.fail(`expired unknown QR leaked: calls=${calls} attempts=${expiredAttempts}`)
        }
      }
      if (!compensated && attempt && unknownCase.message.includes('20000')) {
        compensated = { orderId, attemptId: attempt.id, amountCents: 150 }
      }
    }
  } finally {
    deps.provider.createQrPayment = originalCreateQr
  }
  if (!expiryOrderId || !expirySession) deps.fail('missing unknown-code expiry probe')
  if (!compensated) deps.fail('missing 20000 attempt for late-success compensation')

  const txn = `sbx_txn_${deps.suffix}_unknown_compensated`
  const callback = deps.buildCallback({
    payload: {
      channel: deps.channel,
      attemptId: compensated.attemptId,
      prepayId: compensated.attemptId,
      orderId: compensated.orderId,
      amountCents: compensated.amountCents,
      result: 'success',
      channelTxnNo: txn,
    },
  })
  const settled = await deps.payment.processCallback(deps.channel, callback.rawBody, callback.headers)
  const attempt = await deps.prisma.paymentAttempt.findUnique({ where: { id: compensated.attemptId } })
  const order = await deps.prisma.order.findUnique({ where: { id: compensated.orderId } })
  if (
    settled.ok === true &&
    attempt?.status === 'success' &&
    attempt.channelTxnNo === txn &&
    order?.payStatus === 'paid' &&
    order.paymentSource === deps.channel
  ) {
    deps.pass('signed callback after unknown QR create persists a refundable success attempt')
  } else {
    deps.fail(
      `unknown QR compensation mismatch: ok=${settled.ok} attempt=${JSON.stringify(attempt)} pay=${order?.payStatus}`,
    )
  }
}

class StructuredQueryProvider implements PaymentProvider {
  readonly channel = 'wechat' as const
  calls = 0
  readonly queries = new Map<string, PaymentQueryResult>()
  async createQrPayment(): Promise<never> {
    this.calls += 1
    throw new Error('ALIPAY_CHANNEL_ERROR: 40004 ACQ.INVALID_PARAMETER')
  }
  async queryPayment(input: { attemptId: string }): Promise<PaymentQueryResult> {
    return this.queries.get(input.attemptId) ?? { status: 'unknown', channelTxnNo: null, amountCents: null }
  }
  async verifyAndParseCallback(): Promise<never> {
    throw new Error('VERIFY_NOT_USED')
  }
  async refund(): Promise<never> {
    throw new Error('REFUND_NOT_USED')
  }
}

async function lockThrownQr(
  deps: PaymentCallbackRaceDeps,
  payment: OnlinePaymentService,
  provider: StructuredQueryProvider,
  amountCents: number,
): Promise<{ orderId: string; session: string; attemptId: string; orderNo: string }> {
  const orderId = await deps.makeOrder(amountCents, 'unpaid')
  const session = await deps.paymentSessionFor(orderId)
  const before = provider.calls
  let code = 'RESOLVED'
  try {
    await payment.createPayAttempt(orderId, session)
    deps.fail('structured-query fixture QR create should throw')
  } catch (error) {
    code = errorCodeOf(error)
  }
  const order = await deps.prisma.order.findUnique({ where: { id: orderId } })
  const attempt = await deps.prisma.paymentAttempt.findFirst({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  })
  if (
    !code.includes('PAY_CHANNEL_ACCEPTANCE_UNCONFIRMED') ||
    provider.calls !== before + 1 ||
    !attempt ||
    !order ||
    attempt.channel !== 'wechat' ||
    attempt.qrCodeContent != null ||
    attempt.status === 'failed' ||
    attempt.status === 'success' ||
    order.payStatus !== 'paying'
  ) {
    deps.fail(
      `structured-query lock mismatch: code=${code} calls=${provider.calls} attempt=${JSON.stringify(attempt)} pay=${order?.payStatus}`,
    )
  }
  return { orderId, session, attemptId: attempt.id, orderNo: order.orderNo }
}

async function verifyAuxiliaryAttemptReadDoesNotHideUnknownQr(deps: PaymentCallbackRaceDeps): Promise<void> {
  const orderId = await deps.makeOrder(151, 'unpaid')
  const session = await deps.paymentSessionFor(orderId)
  let calls = 0
  const originalCreateQr = deps.provider.createQrPayment.bind(deps.provider)
  deps.provider.createQrPayment = async () => {
    calls += 1
    throw new Error('ALIPAY_CHANNEL_ERROR: 40004 ACQ.INVALID_PARAMETER')
  }
  const attemptReads = deps.prisma.paymentAttempt as unknown as {
    findUnique: (args: { select?: Record<string, boolean> }) => Promise<{ orderId?: string; channel?: string } | null>
  }
  const originalFindUnique = attemptReads.findUnique.bind(deps.prisma.paymentAttempt)
  attemptReads.findUnique = async (args) => {
    const select = args?.select
    const keys = select ? Object.keys(select) : []
    if (select?.orderId === true && select?.channel === true && keys.length === 2) {
      throw new Error('VERIFY_AUX_FINDUNIQUE_DB_FAULT')
    }
    return originalFindUnique(args)
  }
  let failure = ''
  try {
    let code = 'RESOLVED'
    let body = ''
    try {
      await deps.payment.createPayAttempt(orderId, session)
    } catch (error) {
      code = errorCodeOf(error)
      body = responseText(error)
    }
    const order = await deps.prisma.order.findUnique({ where: { id: orderId } })
    const attempt = await deps.prisma.paymentAttempt.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    })
    const audit = attempt
      ? await deps.prisma.auditLog.findFirst({
          where: {
            action: 'payment.channel_accepted_unconfirmed',
            targetType: 'payment_attempt',
            targetId: attempt.id,
          },
        })
      : null
    let payload: { orderId?: string | null; channel?: string | null; reason?: string } = {}
    try {
      payload = JSON.parse((audit as { payloadJson?: string } | null)?.payloadJson ?? '{}') as typeof payload
    } catch {
      payload = {}
    }
    const reserved =
      order?.payStatus === 'paying' &&
      attempt != null &&
      attempt.status !== 'failed' &&
      attempt.status !== 'success' &&
      attempt.failReason === CHANNEL_ACCEPTED_UNCONFIRMED_REASON
    if (
      code.includes('PAY_CHANNEL_ACCEPTANCE_UNCONFIRMED') &&
      body.includes('支付结果尚未确认') &&
      body.includes('请勿重复支付') &&
      !body.includes('VERIFY_AUX_FINDUNIQUE_DB_FAULT') &&
      !body.includes('已受理') &&
      reserved &&
      audit != null &&
      payload.reason === CHANNEL_ACCEPTED_UNCONFIRMED_REASON &&
      payload.orderId == null &&
      payload.channel == null
    ) {
      deps.pass('auxiliary attempt read failure still returns the unknown QR code and audits the attempt id')
    } else {
      failure =
        `auxiliary read mismatch: code=${code} body=${body} pay=${order?.payStatus} attempt=${JSON.stringify(attempt)} audit=${JSON.stringify(audit)} payload=${JSON.stringify(payload)}`
    }
  } finally {
    attemptReads.findUnique = originalFindUnique
  }
  if (failure) deps.fail(failure)
  await deps.expectCode(
    'retry after the auxiliary read recovers stays locked (PAYMENT_ATTEMPT_PENDING)',
    'PAYMENT_ATTEMPT_PENDING',
    () => deps.payment.createPayAttempt(orderId, session),
  )
  const attempts = await deps.prisma.paymentAttempt.count({ where: { orderId } })
  if (calls === 1 && attempts === 1) {
    deps.pass('retry after the auxiliary read recovers does not call the provider again')
  } else {
    deps.fail(`auxiliary read retry leaked a second QR: calls=${calls} attempts=${attempts}`)
  }
  deps.provider.createQrPayment = originalCreateQr
}

async function verifyStructuredQueryRecovery(deps: PaymentCallbackRaceDeps): Promise<void> {
  const provider = new StructuredQueryProvider()
  const payment = new OnlinePaymentService(
    deps.prisma,
    deps.audit,
    new OrderStatusService(deps.prisma, deps.audit),
    new PaymentProviderRegistry([provider]),
  )
  const unknown = await lockThrownQr(deps, payment, provider, 180)
  const recon = new ReconciliationService(deps.prisma)
  const report = await recon.report({ nowMs: Date.now() })
  const listed = report.attention.unconfirmedCollections.some(
    (row) => row.orderId === unknown.orderId && row.code === CHANNEL_ACCEPTED_UNCONFIRMED_REASON,
  )
  const admin = new AdminOrdersReadonlyService(deps.prisma)
  const adminHit = (await admin.list({
    opsAttention: true,
    search: unknown.orderNo,
    page: 1,
    pageSize: 10,
  })).items[0]
  if (
    listed &&
    adminHit?.id === unknown.orderId &&
    adminHit.opsAttentionCode === 'channel_accepted_unconfirmed' &&
    adminHit.payStatus === 'paying'
  ) {
    deps.pass('unknown QR throw is visible to reconciliation and admin opsAttention before any query')
  } else {
    deps.fail(`unknown QR visibility mismatch: listed=${listed} admin=${JSON.stringify(adminHit)}`)
  }

  provider.queries.set(unknown.attemptId, { status: 'unknown', channelTxnNo: null, amountCents: null })
  const unknownConverge = await payment.convergeStaleCodePayments({ limit: 10 })
  const callsAfterUnknown = provider.calls
  await deps.expectCode(
    'queryPayment unknown keeps the thrown QR locked (PAYMENT_ATTEMPT_PENDING)',
    'PAYMENT_ATTEMPT_PENDING',
    () => payment.createPayAttempt(unknown.orderId, unknown.session),
  )
  const unknownOrder = await deps.prisma.order.findUnique({ where: { id: unknown.orderId } })
  const unknownAttempt = await deps.prisma.paymentAttempt.findUnique({ where: { id: unknown.attemptId } })
  if (
    unknownConverge.stillPending >= 1 &&
    provider.calls === callsAfterUnknown &&
    unknownOrder?.payStatus === 'paying' &&
    unknownAttempt?.status !== 'failed' &&
    unknownAttempt?.status !== 'success'
  ) {
    deps.pass('queryPayment unknown, including a not-found shaped result, does not release the thrown QR')
  } else {
    deps.fail(
      `unknown query release mismatch: ${JSON.stringify(unknownConverge)} calls=${provider.calls} pay=${unknownOrder?.payStatus} attempt=${unknownAttempt?.status}`,
    )
  }

  const closed = await lockThrownQr(deps, payment, provider, 181)
  provider.queries.set(closed.attemptId, { status: 'closed', channelTxnNo: null, amountCents: null })
  const closedConverge = await payment.convergeStaleCodePayments({ limit: 10 })
  const closedAttempt = await deps.prisma.paymentAttempt.findUnique({ where: { id: closed.attemptId } })
  const closedOrder = await deps.prisma.order.findUnique({ where: { id: closed.orderId } })
  const callsBeforeReissue = provider.calls
  let reissueCode = 'RESOLVED'
  try {
    await payment.createPayAttempt(closed.orderId, closed.session)
  } catch (error) {
    reissueCode = errorCodeOf(error)
  }
  const reissued = await deps.prisma.paymentAttempt.count({ where: { orderId: closed.orderId } })
  if (
    closedConverge.released >= 1 &&
    closedAttempt?.status === 'failed' &&
    closedOrder?.payStatus === 'unpaid' &&
    provider.calls === callsBeforeReissue + 1 &&
    reissued === 2 &&
    reissueCode.includes('PAY_CHANNEL_ACCEPTANCE_UNCONFIRMED')
  ) {
    deps.pass('queryPayment closed releases a payable thrown QR and allows one new provider call')
  } else {
    deps.fail(
      `closed query mismatch: ${JSON.stringify(closedConverge)} attempt=${closedAttempt?.status} pay=${closedOrder?.payStatus} calls=${provider.calls} reissue=${reissueCode} attempts=${reissued}`,
    )
  }

  const failed = await lockThrownQr(deps, payment, provider, 182)
  provider.queries.set(failed.attemptId, { status: 'failed', channelTxnNo: null, amountCents: null })
  await payment.convergeStaleCodePayments({ limit: 10 })
  const failedAttempt = await deps.prisma.paymentAttempt.findUnique({ where: { id: failed.attemptId } })
  const failedOrder = await deps.prisma.order.findUnique({ where: { id: failed.orderId } })
  const callsBeforeFailedReissue = provider.calls
  try {
    await payment.createPayAttempt(failed.orderId, failed.session)
  } catch {
    /* 新出码再次抛错，仍应已经调用过 provider。 */
  }
  if (
    failedAttempt?.status === 'failed' &&
    failedOrder?.payStatus === 'unpaid' &&
    provider.calls === callsBeforeFailedReissue + 1
  ) {
    deps.pass('queryPayment failed releases a payable thrown QR and allows one new provider call')
  } else {
    deps.fail(
      `failed query mismatch: attempt=${failedAttempt?.status} pay=${failedOrder?.payStatus} calls=${provider.calls} before=${callsBeforeFailedReissue}`,
    )
  }

  const paid = await lockThrownQr(deps, payment, provider, 183)
  const paidTxn = `wx_${deps.suffix}_query_paid`
  provider.queries.set(paid.attemptId, { status: 'paid', channelTxnNo: paidTxn, amountCents: 183 })
  await payment.convergeStaleCodePayments({ limit: 10 })
  const paidAttempt = await deps.prisma.paymentAttempt.findUnique({ where: { id: paid.attemptId } })
  const paidOrder = await deps.prisma.order.findUnique({ where: { id: paid.orderId } })
  const paidCalls = provider.calls
  await deps.expectCode(
    'queryPayment paid blocks another QR (ORDER_ALREADY_PAID)',
    'ORDER_ALREADY_PAID',
    () => payment.createPayAttempt(paid.orderId, paid.session),
  )
  if (
    paidAttempt?.status === 'success' &&
    paidAttempt.channelTxnNo === paidTxn &&
    paidOrder?.payStatus === 'paid' &&
    paidOrder.paymentSource === 'wechat' &&
    provider.calls === paidCalls
  ) {
    deps.pass('queryPayment paid with matching amount and txn books the thrown QR and does not call the provider again')
  } else {
    deps.fail(`paid query mismatch: attempt=${JSON.stringify(paidAttempt)} order=${JSON.stringify(paidOrder)} calls=${provider.calls}`)
  }

  const pendingRefund = await lockThrownQr(deps, payment, provider, 184)
  await deps.prisma.order.update({
    where: { id: pendingRefund.orderId },
    data: {
      pickupStatus: 'expired',
      pickupCodeHash: `hash_query_paid_${deps.suffix}`,
      pickupCodeExpiresAt: new Date(Date.now() - 60_000),
    },
  })
  const pendingTxn = `wx_${deps.suffix}_query_pending_refund`
  provider.queries.set(pendingRefund.attemptId, { status: 'paid', channelTxnNo: pendingTxn, amountCents: 184 })
  await payment.convergeStaleCodePayments({ limit: 10 })
  const pendingAttempt = await deps.prisma.paymentAttempt.findUnique({ where: { id: pendingRefund.attemptId } })
  const pendingOrder = await deps.prisma.order.findUnique({ where: { id: pendingRefund.orderId } })
  if (
    pendingAttempt?.status === 'success' &&
    pendingAttempt.channelTxnNo === pendingTxn &&
    pendingOrder?.payStatus === 'paying' &&
    pendingOrder.refundReason === ONLINE_PAID_PENDING_REFUND_REASON &&
    pendingOrder.paidAt == null &&
    pendingOrder.pickupCode == null &&
    pendingOrder.paymentSource == null
  ) {
    deps.pass('queryPayment paid after the pickup window records a pending refund instead of marking the order paid')
  } else {
    deps.fail(`pending-refund query mismatch: attempt=${JSON.stringify(pendingAttempt)} order=${JSON.stringify(pendingOrder)}`)
  }
}

async function verifyClosedWindowSuccessIsRefundable(deps: PaymentCallbackRaceDeps): Promise<void> {
  const orderId = await deps.makeOrder(230, 'closed')
  await deps.prisma.order.update({
    where: { id: orderId },
    data: {
      pickupStatus: 'expired',
      pickupCodeHash: `hash_late_failed_${deps.suffix}`,
      pickupCodeExpiresAt: new Date(Date.now() - 60_000),
    },
  })
  const created = await deps.prisma.paymentAttempt.create({
    data: {
      orderId,
      channel: deps.channel,
      amountCents: 230,
      status: 'failed',
      failReason: '支付未完成，请重新发起支付',
      expiresAt: new Date(Date.now() - 60_000),
    },
  })
  const txn = `sbx_txn_${deps.suffix}_late_failed`
  const first = deps.buildCallback({
    payload: {
      channel: deps.channel,
      attemptId: created.id,
      prepayId: created.id,
      orderId,
      amountCents: 230,
      result: 'success',
      channelTxnNo: txn,
    },
  })
  const accepted = await deps.payment.processCallback(deps.channel, first.rawBody, first.headers)
  const row = await deps.prisma.paymentAttempt.findUnique({ where: { id: created.id } })
  const closed = await deps.prisma.order.findUnique({ where: { id: orderId } })
  if (
    accepted.ok !== true ||
    row?.status !== 'success' ||
    row.channelTxnNo !== txn ||
    closed?.payStatus !== 'closed' ||
    closed.refundReason !== ONLINE_PAID_PENDING_REFUND_REASON ||
    closed.paidAt != null ||
    closed.pickupCode != null ||
    closed.paymentSource != null
  ) {
    deps.fail(
      `closed-window failed-to-success precondition mismatch: ok=${accepted.ok} attempt=${JSON.stringify(row)} order=${JSON.stringify(closed)}`,
    )
  }
  deps.pass('failed attempt plus closed pickup window persists success without turning the order paid')

  const replay = deps.buildCallback({
    nonce: `late_failed_replay_${deps.suffix}`,
    payload: {
      channel: deps.channel,
      attemptId: created.id,
      prepayId: created.id,
      orderId,
      amountCents: 230,
      result: 'success',
      channelTxnNo: txn,
    },
  })
  const replayed = await deps.payment.processCallback(deps.channel, replay.rawBody, replay.headers)
  const successes = await deps.prisma.paymentAttempt.count({
    where: { orderId, status: 'success', channelTxnNo: txn },
  })
  if (replayed.idempotent === true && successes === 1) {
    deps.pass('closed-window failed-to-success callback replays idempotently')
  } else {
    deps.fail(`late failed replay mismatch: ${JSON.stringify(replayed)} successes=${successes}`)
  }

  const refunds = new RefundService(deps.prisma, deps.audit, new PaymentProviderRegistry([deps.provider]))
  const refunded = await refunds.refund(orderId, {
    reason: '取件窗口已关，沙箱原路退回',
    operatorId: 'verify-callback-race',
  })
  const refundedOrder = await deps.prisma.order.findUnique({ where: { id: orderId } })
  const refundRow = await deps.prisma.refund.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } })
  const successCount = await deps.prisma.paymentAttempt.count({ where: { orderId, status: 'success' } })
  if (
    refunded.refund.status === 'success' &&
    refunded.refund.channel === 'sandbox' &&
    refunded.refund.channelRefundNo?.startsWith('sbx_refund_') &&
    refunded.refund.amountCents === 230 &&
    refunded.order.payStatus === 'refunded' &&
    refundedOrder?.payStatus === 'refunded' &&
    refundedOrder.refundedAmountCents === 230 &&
    refundRow?.status === 'success' &&
    refundRow.channel === 'sandbox' &&
    successCount === 1
  ) {
    deps.pass('canonical RefundService refunds the closed-window success attempt through sandbox')
  } else {
    deps.fail(
      `sandbox refund mismatch: view=${JSON.stringify(refunded)} order=${JSON.stringify(refundedOrder)} refund=${JSON.stringify(refundRow)} successes=${successCount}`,
    )
  }
  const again = await refunds.refund(orderId, {
    reason: '取件窗口已关，沙箱原路退回',
    operatorId: 'verify-callback-race',
  })
  if (again.idempotent === true && again.refund.refundNo === refunded.refund.refundNo) {
    deps.pass('repeating the sandbox refund returns the same refund without a second provider call')
  } else {
    deps.fail(`sandbox refund replay mismatch: ${JSON.stringify(again)}`)
  }
}

async function verifyBlockedSuccessWriteRetries(deps: PaymentCallbackRaceDeps): Promise<void> {
  const orderId = await deps.makeOrder(250, 'closed')
  await deps.prisma.order.update({
    where: { id: orderId },
    data: { pickupStatus: 'cancelled', pickupCodeHash: `hash_blocked_write_${deps.suffix}` },
  })
  const created = await deps.prisma.paymentAttempt.create({
    data: {
      orderId,
      channel: deps.channel,
      amountCents: 250,
      status: 'failed',
      failReason: '支付未完成，请重新发起支付',
    },
  })
  const attemptWrites = deps.prisma.paymentAttempt as unknown as {
    updateMany: (args: { where?: { id?: string }; data?: { status?: string } }) => Promise<{ count: number }>
  }
  const originalUpdateMany = attemptWrites.updateMany.bind(deps.prisma.paymentAttempt)
  const txn = `sbx_txn_${deps.suffix}_blocked_write`
  const payload = {
    channel: deps.channel,
    attemptId: created.id,
    prepayId: created.id,
    orderId,
    amountCents: 250,
    result: 'success' as const,
    channelTxnNo: txn,
  }
  attemptWrites.updateMany = async (args) => {
    if (args.data?.status === 'success' && args.where?.id === created.id) return { count: 0 }
    return originalUpdateMany(args)
  }
  const blockedCallback = deps.buildCallback({ nonce: `blocked_${deps.suffix}`, payload })
  try {
    await deps.expectCode(
      'verified success that cannot persist a success row is rejected, not acknowledged',
      'CALLBACK_STATE_CONFLICT',
      () => deps.payment.processCallback(deps.channel, blockedCallback.rawBody, blockedCallback.headers),
    )
  } finally {
    attemptWrites.updateMany = originalUpdateMany
  }
  const blocked = await deps.prisma.paymentAttempt.findUnique({ where: { id: created.id } })
  if (blocked?.status === 'failed' && blocked.channelTxnNo == null) {
    deps.pass('failed late success without a durable success row stays failed and is not silently acknowledged')
  } else {
    deps.fail(`blocked success write left ${JSON.stringify(blocked)}`)
  }

  const retryCallback = deps.buildCallback({ nonce: `blocked_retry_${deps.suffix}`, payload })
  const retried = await deps.payment.processCallback(deps.channel, retryCallback.rawBody, retryCallback.headers)
  const recovered = await deps.prisma.paymentAttempt.findUnique({ where: { id: created.id } })
  const recoveredOrder = await deps.prisma.order.findUnique({ where: { id: orderId } })
  if (
    retried.ok === true &&
    recovered?.status === 'success' &&
    recovered.channelTxnNo === txn &&
    recoveredOrder?.payStatus === 'closed' &&
    recoveredOrder.refundReason === ONLINE_PAID_PENDING_REFUND_REASON &&
    recoveredOrder.paidAt == null
  ) {
    deps.pass('after the success write is restored, a new nonce persists the same verified callback')
  } else {
    deps.fail(
      `restored success write mismatch: ok=${retried.ok} attempt=${JSON.stringify(recovered)} order=${JSON.stringify(recoveredOrder)}`,
    )
  }
}

async function verifyAcceptanceOrderings(
  deps: PaymentCallbackRaceDeps,
  originalCreateQr: SandboxPaymentProvider['createQrPayment'],
): Promise<void> {
  const openId = await deps.makeOrder(240, 'unpaid')
  const openAttempt = await deps.prisma.paymentAttempt.create({
    data: {
      orderId: openId,
      channel: deps.channel,
      amountCents: 240,
      status: 'failed',
      failReason: '支付未完成，请重新发起支付',
    },
  })
  const openTxn = `sbx_txn_${deps.suffix}_open_failed`
  const openCallback = deps.buildCallback({
    payload: {
      channel: deps.channel,
      attemptId: openAttempt.id,
      prepayId: openAttempt.id,
      orderId: openId,
      amountCents: 240,
      result: 'success',
      channelTxnNo: openTxn,
    },
  })
  const openResult = await deps.payment.processCallback(deps.channel, openCallback.rawBody, openCallback.headers)
  const openRow = await deps.prisma.paymentAttempt.findUnique({ where: { id: openAttempt.id } })
  const openOrder = await deps.prisma.order.findUnique({ where: { id: openId } })
  const openAudits = await deps.prisma.auditLog.count({
    where: { action: 'order.mark_paid_online', targetType: 'order', targetId: openId },
  })
  if (
    openResult.ok === true &&
    openRow?.status === 'success' &&
    openRow.channelTxnNo === openTxn &&
    openOrder?.payStatus === 'paid' &&
    openOrder.paymentSource === deps.channel &&
    openAudits === 1
  ) {
    deps.pass('failed attempt with an open pickup window becomes paid and a single success row')
  } else {
    deps.fail(
      `open failed-success mismatch: ok=${openResult.ok} attempt=${openRow?.status} pay=${openOrder?.payStatus} audits=${openAudits}`,
    )
  }

  const callbackFirstId = await deps.makeOrder(260, 'unpaid')
  const callbackFirstSession = await deps.paymentSessionFor(callbackFirstId)
  const callbackFirstTxn = `sbx_txn_${deps.suffix}_callback_first`
  let callbackFirstCalls = 0
  deps.provider.createQrPayment = async (input) => {
    callbackFirstCalls += 1
    const early = deps.buildCallback({
      payload: {
        channel: deps.channel,
        attemptId: input.attemptId,
        prepayId: input.attemptId,
        orderId: input.orderId,
        amountCents: input.amountCents,
        result: 'success',
        channelTxnNo: callbackFirstTxn,
      },
    })
    await deps.payment.processCallback(deps.channel, early.rawBody, early.headers)
    return { prepayId: input.attemptId, qrCodeContent: `sandboxpay://callback-first-${input.attemptId}` }
  }
  try {
    await deps.payment.createPayAttempt(callbackFirstId, callbackFirstSession)
    const callbackFirstAttempt = await deps.prisma.paymentAttempt.findFirst({
      where: { orderId: callbackFirstId },
      orderBy: { createdAt: 'desc' },
    })
    const callbackFirstOrder = await deps.prisma.order.findUnique({ where: { id: callbackFirstId } })
    if (
      callbackFirstCalls === 1 &&
      callbackFirstAttempt?.status === 'success' &&
      callbackFirstAttempt.channelTxnNo === callbackFirstTxn &&
      callbackFirstAttempt.qrCodeContent?.includes('callback-first') &&
      callbackFirstOrder?.payStatus === 'paid'
    ) {
      deps.pass('callback that lands before QR backfill stays success and is not rewritten to pending')
    } else {
      deps.fail(
        `callback-first mismatch: calls=${callbackFirstCalls} attempt=${JSON.stringify(callbackFirstAttempt)} pay=${callbackFirstOrder?.payStatus}`,
      )
    }
  } finally {
    deps.provider.createQrPayment = originalCreateQr
  }

  const backfillFirstId = await deps.makeOrder(270, 'unpaid')
  const backfillFirstSession = await deps.paymentSessionFor(backfillFirstId)
  const backfillFirst = await deps.payment.createPayAttempt(backfillFirstId, backfillFirstSession)
  const backfillAttempt = await deps.prisma.paymentAttempt.findUnique({ where: { id: backfillFirst.attemptId } })
  if (backfillAttempt?.status !== 'pending' || !backfillAttempt.qrCodeContent || !backfillAttempt.prepayId) {
    deps.fail(`backfill-first QR did not reach pending: ${JSON.stringify(backfillAttempt)}`)
  }
  const backfillTxn = `sbx_txn_${deps.suffix}_backfill_first`
  const backfillCallback = deps.buildCallback({
    payload: {
      channel: deps.channel,
      attemptId: backfillFirst.attemptId,
      prepayId: backfillAttempt.prepayId,
      orderId: backfillFirstId,
      amountCents: 270,
      result: 'success',
      channelTxnNo: backfillTxn,
    },
  })
  const backfillResult = await deps.payment.processCallback(deps.channel, backfillCallback.rawBody, backfillCallback.headers)
  const backfillRow = await deps.prisma.paymentAttempt.findUnique({ where: { id: backfillFirst.attemptId } })
  const backfillOrder = await deps.prisma.order.findUnique({ where: { id: backfillFirstId } })
  if (
    backfillResult.ok === true &&
    backfillRow?.status === 'success' &&
    backfillRow.channelTxnNo === backfillTxn &&
    backfillRow.qrCodeContent === backfillAttempt.qrCodeContent &&
    backfillOrder?.payStatus === 'paid'
  ) {
    deps.pass('backfill-first QR then signed callback promotes pending to success without dropping the code')
  } else {
    deps.fail(`backfill-first mismatch: ${JSON.stringify(backfillRow)} pay=${backfillOrder?.payStatus}`)
  }

  const concurrentId = await deps.makeOrder(280, 'unpaid')
  const concurrentSession = await deps.paymentSessionFor(concurrentId)
  const concurrentCreated = await deps.payment.createPayAttempt(concurrentId, concurrentSession)
  const concurrentAttempt = await deps.prisma.paymentAttempt.findUnique({ where: { id: concurrentCreated.attemptId } })
  if (!concurrentAttempt?.prepayId) deps.fail('concurrent fixture missing prepayId')
  const concurrentTxn = `sbx_txn_${deps.suffix}_concurrent`
  const concurrentCallbacks = [1, 2].map((n) =>
    deps.buildCallback({
      nonce: `concurrent_${deps.suffix}_${n}`,
      payload: {
        channel: deps.channel,
        attemptId: concurrentCreated.attemptId,
        prepayId: concurrentAttempt.prepayId,
        orderId: concurrentId,
        amountCents: 280,
        result: 'success',
        channelTxnNo: concurrentTxn,
      },
    }),
  )
  const concurrentResults = await Promise.allSettled(
    concurrentCallbacks.map((callback) => deps.payment.processCallback(deps.channel, callback.rawBody, callback.headers)),
  )
  const concurrentRow = await deps.prisma.paymentAttempt.findUnique({ where: { id: concurrentCreated.attemptId } })
  const concurrentOrder = await deps.prisma.order.findUnique({ where: { id: concurrentId } })
  const concurrentSuccesses = await deps.prisma.paymentAttempt.count({
    where: { orderId: concurrentId, status: 'success', channelTxnNo: concurrentTxn },
  })
  const concurrentRejections = concurrentResults.filter((result) => result.status === 'rejected')
  const concurrentRejectionOk = concurrentRejections.every((result) => {
    const reason = result.reason as { message?: string }
    return (reason?.message ?? String(result.reason)).includes('CALLBACK_')
  })
  if (
    concurrentRow?.status === 'success' &&
    concurrentRow.channelTxnNo === concurrentTxn &&
    concurrentOrder?.payStatus === 'paid' &&
    concurrentOrder.paymentSource === deps.channel &&
    concurrentSuccesses === 1 &&
    concurrentRejectionOk &&
    concurrentResults.some((result) => result.status === 'fulfilled' && result.value.ok === true)
  ) {
    deps.pass('concurrent same-txn callbacks leave one success row and one paid order')
  } else {
    deps.fail(
      `concurrent callback mismatch: successes=${concurrentSuccesses} pay=${concurrentOrder?.payStatus} attempt=${concurrentRow?.status} results=${concurrentResults.map((result) => result.status).join(',')}`,
    )
  }
}

