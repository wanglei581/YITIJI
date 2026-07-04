/**
 * C5-2 线上扫码支付沙箱底座 verification（verify:payment-flow）。
 *
 * 直接调用生产 service（不走 HTTP），断言全表：
 * - 建单落 itemsJson 计费明细快照（只存 PricingService 输出，不引入商品体系）。
 * - 出码：attempt pending + sandboxpay:// 动态码 + 订单 paying + 超时时间；重复出码幂等复用。
 * - 回调成功：验签 + 防重放 + 全字段匹配 + 金额一致 → paid + paymentSource=sandbox +
 *   payChannel + pickupCode + 审计 order.mark_paid_online（late 标记可审计）。
 * - 幂等：同流水号重放不重复入账/审计；同 nonce 重放 401；过期 timestamp 401；
 *   错签名 / 篡改报文 / 跨路径签名复用 401；金额篡改 400 且订单不动。
 * - 伪造回调不可能入账：attemptId 不存在 / prepayId / orderId 不匹配一律拒绝，
 *   closed 订单只有「已存在 PaymentAttempt 的有效迟到回调」可转 paid（late=true 审计）。
 * - 失败回调：安全文案（渠道原始错误只进审计）+ 订单回 unpaid 可重试出码。
 * - 惰性过期：attempt 过期 / 订单超时 closed / closed 拒绝新出码。
 * - 回归：markPaid 线下三来源不变，sandbox/wechat/alipay/benefit 按名拒绝；
 *   Admin 端点拒绝 sandbox；markPaidOnline 拒绝非白名单渠道；支付回调不改 PrintTask.status。
 * - fail-closed：sandbox 缺密钥 / 生产配 sandbox / 未知 Provider → 启动即拒绝；
 *   Provider 未配置 → ONLINE_PAYMENT_DISABLED，不伪装可支付。
 */
import 'dotenv/config'
import { randomBytes, randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { assertProductionRuntimeGates } from '../src/config/production-runtime-gates'
import { signFileUrl } from '../src/files/signing'
import { AdminOrderActionsController } from '../src/payment/admin-order-actions.controller'
import type { AdminMarkPaidDto } from '../src/payment/dto/order-action.dto'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { createPaymentSessionToken } from '../src/payment/payment-session-token'
import { resolvePaymentProvider } from '../src/payment/payment-provider.factory'
import { buildPaymentCallbackPath } from '../src/payment/payment-provider.types'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import {
  SANDBOX_NONCE_HEADER,
  SANDBOX_SIGNATURE_HEADER,
  SANDBOX_TIMESTAMP_HEADER,
  SandboxPaymentProvider,
  signSandboxCallback,
} from '../src/payment/providers/sandbox-payment.provider'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'

const VERIFY_SECRET = 'verify-sandbox-payment-secret-0001'
const CHANNEL = 'sandbox'
const CALLBACK_PATH = buildPaymentCallbackPath(CHANNEL)

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if (msg.includes(code)) {
      pass(label)
      return
    }
    fail(`${label} — expected error ${code}, got: ${msg}`)
  }
  fail(`${label} — expected error ${code}, but resolved`)
}

function expectThrowSync(label: string, code: string, fn: () => unknown): void {
  try {
    fn()
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if (msg.includes(code)) {
      pass(label)
      return
    }
    fail(`${label} — expected error ${code}, got: ${msg}`)
  }
  fail(`${label} — expected error ${code}, but resolved`)
}

/** 构造签名合法（或指定篡改点）的回调请求。 */
function buildCallback(input: {
  payload: Record<string, unknown>
  path?: string
  timestampMs?: number
  nonce?: string
  secret?: string
  breakSignature?: boolean
}): { rawBody: Buffer; headers: Record<string, string> } {
  const rawBody = Buffer.from(JSON.stringify(input.payload), 'utf8')
  const timestamp = String(input.timestampMs ?? Date.now())
  const nonce = input.nonce ?? randomBytes(16).toString('hex')
  let signature = signSandboxCallback(
    { method: 'POST', path: input.path ?? CALLBACK_PATH, timestamp, nonce, rawBody },
    input.secret ?? VERIFY_SECRET,
  )
  if (input.breakSignature) signature = signature.replace(/^./, signature.startsWith('0') ? '1' : '0')
  return {
    rawBody,
    headers: {
      [SANDBOX_TIMESTAMP_HEADER]: timestamp,
      [SANDBOX_NONCE_HEADER]: nonce,
      [SANDBOX_SIGNATURE_HEADER]: signature,
    },
  }
}

async function main(): Promise<void> {
  console.log('\n=== C5-2 online sandbox payment flow verification ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus)
  const provider = new SandboxPaymentProvider(VERIFY_SECRET)
  const payment = new OnlinePaymentService(prisma, audit, orderStatus, provider)
  const paymentDisabled = new OnlinePaymentService(prisma, audit, orderStatus, null)
  const adminCtl = new AdminOrderActionsController(orderStatus)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_payflow_${suffix}`
  const taskIds: string[] = []
  const orderIds: string[] = []
  const fixtureFileIds: string[] = []
  const fixtureStorageKeys: string[] = []
  let orderSeq = 0

  async function seedPdfFixture(label: string, pages: number): Promise<string> {
    const fileId = `f_payflow_${suffix}_${label}`
    const storageKey = `verify/payment-flow/${fileId}.pdf`
    const pdfBytes = Buffer.from(`%PDF-1.4\n${'1 0 obj\n<< /Type /Page >>\nendobj\n'.repeat(pages)}%%EOF\n`)
    await storage.putObject(storageKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey,
        filename: `${label}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        sha256: '',
        purpose: 'print_source',
        bucket: LOCAL_BUCKET_SENTINEL,
      },
    })
    fixtureFileIds.push(fileId)
    fixtureStorageKeys.push(storageKey)
    return signFileUrl(fileId, 60_000).url
  }

  /** 直接落库的独立订单 fixture（隔离各场景，不依赖打印链路）。 */
  async function makeOrder(amountCents: number, payStatus = 'unpaid'): Promise<string> {
    orderSeq += 1
    const order = await prisma.order.create({
      data: {
        orderNo: `ORD-PAYFLOW-${suffix}-${orderSeq}`,
        type: 'print',
        amountCents,
        payStatus,
        taskStatus: 'pending',
        terminalId,
      },
    })
    orderIds.push(order.id)
    return order.id
  }

  async function paymentSessionFor(orderId: string): Promise<string> {
    const order = await prisma.order.findUnique({ where: { id: orderId } })
    if (!order) fail(`missing order ${orderId}`)
    return createPaymentSessionToken({
      orderId: order.id,
      orderNo: order.orderNo,
      terminalId: order.terminalId,
      amountCents: order.amountCents,
      printTaskId: order.printTaskId,
    })
  }

  async function cleanup(): Promise<void> {
    const printOrders = await prisma.order.findMany({ where: { printTaskId: { in: taskIds } }, select: { id: true } })
    const allOrderIds = [...orderIds, ...printOrders.map((o) => o.id)]
    const attempts = await prisma.paymentAttempt.findMany({ where: { orderId: { in: allOrderIds } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { targetType: 'payment_attempt', targetId: { in: attempts.map((a) => a.id) } } })
    await prisma.auditLog.deleteMany({ where: { targetType: 'order', targetId: { in: allOrderIds } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: taskIds }, action: 'print_job.create' } })
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: allOrderIds } } })
    await prisma.order.deleteMany({ where: { id: { in: allOrderIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.fileObject.deleteMany({ where: { id: { in: fixtureFileIds } } })
    for (const key of fixtureStorageKeys) {
      await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    }
    await prisma.priceConfig.deleteMany({ where: { serviceKey: { in: ['print_bw_page', 'print_color_page'] } } })
  }

  try {
    await cleanup()
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `KSK-PAY-${suffix}`,
        agentToken: randomBytes(16).toString('hex'),
        deviceFingerprint: 'verify-payment-flow',
      },
    })
    await seedDevDefaultPriceConfig(prisma)
    pass('test fixtures created')

    // ── (1) 真实建单链路：itemsJson 计费明细快照 ────────────────────────────
    const printed = await printJobs.create(
      {
        fileUrl: await seedPdfFixture('flow', 2),
        fileMd5: 'sha256-payment-flow',
        fileName: '支付闭环.pdf',
        params: {
          copies: 2,
          colorMode: 'color' as const,
          duplex: 'simplex' as const,
          paperSize: 'A4' as const,
          orientation: 'auto' as const,
          quality: 'standard' as const,
          scale: 'fit' as const,
          pagesPerSheet: 1 as const,
        },
      },
      { endUserId: null, terminalId },
    )
    taskIds.push(printed.taskId)
    const paymentSessionA = printed.paymentSessionToken
    const orderA = await prisma.order.findUnique({ where: { printTaskId: printed.taskId } })
    if (!orderA) fail('print flow did not create Order')
    if (typeof paymentSessionA === 'string' && paymentSessionA.startsWith('pst_v1.')) {
      pass('print job creation returns short-lived payment session token')
    } else {
      fail(`print job did not return payment session token: ${JSON.stringify(printed)}`)
    }
    const items = JSON.parse(orderA.itemsJson) as Array<Record<string, unknown>>
    if (
      Array.isArray(items) &&
      items.length === 1 &&
      items[0]?.['serviceKey'] === 'print_color_page' &&
      items[0]?.['quantity'] === 4 &&
      items[0]?.['subtotalCents'] === orderA.amountCents &&
      orderA.amountCents === 200
    ) {
      pass('order creation snapshots PricingService lines into itemsJson (1 line, color 2p×2c = 200 cents)')
    } else {
      fail(`itemsJson snapshot mismatch: ${orderA.itemsJson}`)
    }

    // ── (2) 出码：attempt pending + 动态码 + 订单 paying + 幂等复用 ─────────
    await expectCode('pay attempt rejects missing payment session token (PAYMENT_SESSION_REQUIRED)', 'PAYMENT_SESSION_REQUIRED', () =>
      payment.createPayAttempt(orderA.id, ''),
    )
    const wrongOrderId = await makeOrder(999)
    const wrongPaymentSession = await paymentSessionFor(wrongOrderId)
    await expectCode('pay attempt rejects another order payment session token (PAYMENT_SESSION_MISMATCH)', 'PAYMENT_SESSION_MISMATCH', () =>
      payment.createPayAttempt(orderA.id, wrongPaymentSession),
    )
    const wrongPrintTaskSession = createPaymentSessionToken({
      orderId: orderA.id,
      orderNo: orderA.orderNo,
      terminalId: orderA.terminalId,
      amountCents: orderA.amountCents,
      printTaskId: `ptask_wrong_${suffix}`,
    })
    await expectCode('pay attempt rejects same-order session with wrong printTask binding (PAYMENT_SESSION_MISMATCH)', 'PAYMENT_SESSION_MISMATCH', () =>
      payment.createPayAttempt(orderA.id, wrongPrintTaskSession),
    )

    const attemptViewA = await payment.createPayAttempt(orderA.id, paymentSessionA)
    if (
      attemptViewA.status === 'pending' &&
      attemptViewA.qrCodeContent?.startsWith('sandboxpay://qr?') &&
      attemptViewA.amountCents === 200 &&
      attemptViewA.expiresAt &&
      attemptViewA.orderPayStatus === 'paying' &&
      attemptViewA.orderExpiresAt
    ) {
      pass('pay attempt issues sandboxpay:// QR, snapshots amount, moves order to paying with close deadline')
    } else {
      fail(`unexpected attempt view: ${JSON.stringify(attemptViewA)}`)
    }
    const attemptViewA2 = await payment.createPayAttempt(orderA.id, paymentSessionA)
    if (attemptViewA2.attemptId === attemptViewA.attemptId) {
      pass('repeated pay request reuses the pending unexpired attempt (idempotent issuing)')
    } else {
      fail('repeated pay request created a duplicate attempt')
    }
    const attemptCreatedAudit = await prisma.auditLog.count({
      where: { action: 'payment.attempt_created', targetType: 'payment_attempt', targetId: attemptViewA.attemptId },
    })
    if (attemptCreatedAudit === 1) pass('attempt creation is audited exactly once')
    else fail(`payment.attempt_created audit count = ${attemptCreatedAudit}`)

    // ── (3) 免费单拒绝出码 + Provider 未配置拒绝 ────────────────────────────
    const freeOrderId = await makeOrder(0)
    const freePaymentSession = await paymentSessionFor(freeOrderId)
    await expectCode('zero-amount order cannot issue a pay QR (PAY_NOT_REQUIRED)', 'PAY_NOT_REQUIRED', () =>
      payment.createPayAttempt(freeOrderId, freePaymentSession),
    )
    await expectCode('provider-disabled service refuses to issue QR (ONLINE_PAYMENT_DISABLED)', 'ONLINE_PAYMENT_DISABLED', () =>
      paymentDisabled.createPayAttempt(orderA.id, paymentSessionA),
    )

    // ── (4) 回调成功入账（验签 + 全字段匹配 + 金额一致）────────────────────
    const attemptA = await prisma.paymentAttempt.findUnique({ where: { id: attemptViewA.attemptId } })
    if (!attemptA?.prepayId) fail('attempt A missing prepayId')
    const txnA = `sbx_txn_${suffix}_a`
    const successPayload = {
      channel: CHANNEL,
      attemptId: attemptA.id,
      prepayId: attemptA.prepayId,
      orderId: orderA.id,
      amountCents: 200,
      result: 'success',
      channelTxnNo: txnA,
    }
    const cbA = buildCallback({ payload: successPayload })
    const resA = await payment.processCallback(CHANNEL, cbA.rawBody, cbA.headers)
    const paidA = await prisma.order.findUnique({ where: { id: orderA.id } })
    const attemptADone = await prisma.paymentAttempt.findUnique({ where: { id: attemptA.id } })
    if (
      resA.ok &&
      paidA?.payStatus === 'paid' &&
      paidA.paymentSource === 'sandbox' &&
      paidA.payChannel === 'sandbox' &&
      paidA.paidBy === 'online_callback' &&
      paidA.paidAt &&
      paidA.pickupCode &&
      attemptADone?.status === 'success' &&
      attemptADone.channelTxnNo === txnA
    ) {
      pass('valid signed callback credits order: paid + paymentSource=sandbox + payChannel + pickupCode + txn backfill')
    } else {
      fail(`success callback state mismatch: order=${JSON.stringify(paidA)} attempt=${JSON.stringify(attemptADone)}`)
    }
    const task = await prisma.printTask.findUnique({ where: { id: printed.taskId } })
    if (task?.status === 'pending') pass('payment callback never touches PrintTask.status (fulfillment decoupled)')
    else fail(`PrintTask.status changed by payment callback: ${task?.status}`)

    const paidAudits = await prisma.auditLog.findMany({
      where: { action: 'order.mark_paid_online', targetType: 'order', targetId: orderA.id },
    })
    if (paidAudits.length === 1 && JSON.parse(paidAudits[0]!.payloadJson)['late'] === false) {
      pass('online credit is audited once with late=false')
    } else {
      fail(`mark_paid_online audit unexpected: ${JSON.stringify(paidAudits.map((a) => a.payloadJson))}`)
    }

    await expectCode('pay-status rejects missing payment session token (PAYMENT_SESSION_REQUIRED)', 'PAYMENT_SESSION_REQUIRED', () =>
      payment.getPayStatus(orderA.id, ''),
    )
    await expectCode('pay-status rejects another order payment session token (PAYMENT_SESSION_MISMATCH)', 'PAYMENT_SESSION_MISMATCH', () =>
      payment.getPayStatus(orderA.id, wrongPaymentSession),
    )
    const statusViewA = await payment.getPayStatus(orderA.id, paymentSessionA)
    if (statusViewA.payStatus === 'paid' && statusViewA.pickupCode === paidA.pickupCode && statusViewA.attempt?.status === 'success') {
      pass('pay-status view exposes paid state and gated pickupCode')
    } else {
      fail(`pay-status view mismatch: ${JSON.stringify(statusViewA)}`)
    }

    // ── (5) 幂等与防重放 ────────────────────────────────────────────────────
    const cbA2 = buildCallback({ payload: successPayload })
    const resA2 = await payment.processCallback(CHANNEL, cbA2.rawBody, cbA2.headers)
    const paidAuditsAfter = await prisma.auditLog.count({
      where: { action: 'order.mark_paid_online', targetType: 'order', targetId: orderA.id },
    })
    if (resA2.ok && resA2.idempotent === true && paidAuditsAfter === 1) {
      pass('same-txn callback replay (fresh nonce) is idempotent — no double credit, no extra audit')
    } else {
      fail(`same-txn replay not idempotent: ${JSON.stringify(resA2)}, audits=${paidAuditsAfter}`)
    }
    await expectCode('same-nonce replay is rejected (CALLBACK_REPLAY)', 'CALLBACK_REPLAY', () =>
      payment.processCallback(CHANNEL, cbA.rawBody, cbA.headers),
    )
    const cbExpired = buildCallback({ payload: successPayload, timestampMs: Date.now() - 6 * 60 * 1000 })
    await expectCode('stale timestamp is rejected (CALLBACK_TIMESTAMP_EXPIRED)', 'CALLBACK_TIMESTAMP_EXPIRED', () =>
      payment.processCallback(CHANNEL, cbExpired.rawBody, cbExpired.headers),
    )
    const cbBadSig = buildCallback({ payload: successPayload, breakSignature: true })
    await expectCode('broken signature is rejected (CALLBACK_SIGNATURE_INVALID)', 'CALLBACK_SIGNATURE_INVALID', () =>
      payment.processCallback(CHANNEL, cbBadSig.rawBody, cbBadSig.headers),
    )
    const cbWrongPath = buildCallback({ payload: successPayload, path: '/api/v1/payment/callback/other-channel' })
    await expectCode('signature bound to another path cannot be reused (CALLBACK_SIGNATURE_INVALID)', 'CALLBACK_SIGNATURE_INVALID', () =>
      payment.processCallback(CHANNEL, cbWrongPath.rawBody, cbWrongPath.headers),
    )
    const cbWrongSecret = buildCallback({ payload: successPayload, secret: 'attacker-guessed-secret-000000' })
    await expectCode('signature from wrong secret is rejected (CALLBACK_SIGNATURE_INVALID)', 'CALLBACK_SIGNATURE_INVALID', () =>
      payment.processCallback(CHANNEL, cbWrongSecret.rawBody, cbWrongSecret.headers),
    )

    // ── (6) 金额篡改与字段不匹配（伪造回调不可能入账）──────────────────────
    const orderBId = await makeOrder(300)
    const paymentSessionB = await paymentSessionFor(orderBId)
    const attemptViewB = await payment.createPayAttempt(orderBId, paymentSessionB)
    const attemptB = await prisma.paymentAttempt.findUnique({ where: { id: attemptViewB.attemptId } })
    if (!attemptB?.prepayId) fail('attempt B missing prepayId')
    const basePayloadB = {
      channel: CHANNEL,
      attemptId: attemptB.id,
      prepayId: attemptB.prepayId,
      orderId: orderBId,
      amountCents: 300,
      result: 'success',
      channelTxnNo: `sbx_txn_${suffix}_b`,
    }
    const cbTamper = buildCallback({ payload: { ...basePayloadB, amountCents: 301 } })
    await expectCode('amount-tampered callback is rejected (CALLBACK_AMOUNT_MISMATCH)', 'CALLBACK_AMOUNT_MISMATCH', () =>
      payment.processCallback(CHANNEL, cbTamper.rawBody, cbTamper.headers),
    )
    const cbWrongPrepay = buildCallback({ payload: { ...basePayloadB, prepayId: 'sbx_forged_prepay' } })
    await expectCode('prepayId mismatch is rejected (CALLBACK_FIELD_MISMATCH)', 'CALLBACK_FIELD_MISMATCH', () =>
      payment.processCallback(CHANNEL, cbWrongPrepay.rawBody, cbWrongPrepay.headers),
    )
    const cbWrongOrder = buildCallback({ payload: { ...basePayloadB, orderId: orderA.id } })
    await expectCode('orderId mismatch is rejected (CALLBACK_FIELD_MISMATCH)', 'CALLBACK_FIELD_MISMATCH', () =>
      payment.processCallback(CHANNEL, cbWrongOrder.rawBody, cbWrongOrder.headers),
    )
    const cbGhost = buildCallback({ payload: { ...basePayloadB, attemptId: `pa_ghost_${suffix}` } })
    await expectCode('unknown attemptId is rejected (CALLBACK_ATTEMPT_NOT_FOUND)', 'CALLBACK_ATTEMPT_NOT_FOUND', () =>
      payment.processCallback(CHANNEL, cbGhost.rawBody, cbGhost.headers),
    )
    const orderBAfterAttacks = await prisma.order.findUnique({ where: { id: orderBId } })
    if (orderBAfterAttacks?.payStatus === 'paying' && orderBAfterAttacks.paymentSource === null) {
      pass('order stays untouched after tamper/mismatch attacks')
    } else {
      fail(`order B mutated by rejected callbacks: ${JSON.stringify(orderBAfterAttacks)}`)
    }

    // ── (7) 失败回调：安全文案 + 回 unpaid 可重试 ───────────────────────────
    const cbFail = buildCallback({
      payload: { ...basePayloadB, result: 'failed', failReason: 'raw-channel-error-should-not-leak', channelTxnNo: undefined },
    })
    const resFail = await payment.processCallback(CHANNEL, cbFail.rawBody, cbFail.headers)
    const attemptBFailed = await prisma.paymentAttempt.findUnique({ where: { id: attemptB.id } })
    const orderBFailed = await prisma.order.findUnique({ where: { id: orderBId } })
    if (
      resFail.ok &&
      attemptBFailed?.status === 'failed' &&
      attemptBFailed.failReason &&
      !attemptBFailed.failReason.includes('raw-channel-error') &&
      orderBFailed?.payStatus === 'unpaid'
    ) {
      pass('failed callback stores safe user-facing text only and returns order to unpaid for retry')
    } else {
      fail(`failure handling mismatch: attempt=${JSON.stringify(attemptBFailed)} order=${orderBFailed?.payStatus}`)
    }
    const failAudit = await prisma.auditLog.findFirst({
      where: { action: 'payment.attempt_failed', targetType: 'payment_attempt', targetId: attemptB.id },
    })
    if (failAudit && JSON.parse(failAudit.payloadJson)['reasonRaw'] === 'raw-channel-error-should-not-leak') {
      pass('raw channel failure reason goes to audit payload only')
    } else {
      fail(`attempt_failed audit missing/incomplete: ${failAudit?.payloadJson}`)
    }
    const attemptViewB2 = await payment.createPayAttempt(orderBId, paymentSessionB)
    if (attemptViewB2.attemptId !== attemptB.id && attemptViewB2.status === 'pending') {
      pass('order can re-issue a fresh attempt after failure')
    } else {
      fail('re-issue after failure did not create a fresh attempt')
    }

    // ── (8) 惰性过期：attempt expired + 订单 closed + closed 拒绝新出码 ─────
    const past = new Date(Date.now() - 60_000)
    await prisma.paymentAttempt.update({ where: { id: attemptViewB2.attemptId }, data: { expiresAt: past } })
    await prisma.order.update({ where: { id: orderBId }, data: { expiresAt: past } })
    const statusViewB = await payment.getPayStatus(orderBId, paymentSessionB)
    const attemptB2Expired = await prisma.paymentAttempt.findUnique({ where: { id: attemptViewB2.attemptId } })
    if (statusViewB.payStatus === 'closed' && attemptB2Expired?.status === 'expired') {
      pass('lazy expiry marks stale attempt expired and times the order out to closed')
    } else {
      fail(`lazy expiry mismatch: order=${statusViewB.payStatus} attempt=${attemptB2Expired?.status}`)
    }
    await expectCode('closed order refuses new pay attempts (ORDER_CLOSED)', 'ORDER_CLOSED', () =>
      payment.createPayAttempt(orderBId, paymentSessionB),
    )

    // ── (9) closed → paid：仅「已存在 attempt 的有效迟到回调」可入账 ────────
    const cbLate = buildCallback({
      payload: {
        channel: CHANNEL,
        attemptId: attemptViewB2.attemptId,
        prepayId: attemptB2Expired!.prepayId,
        orderId: orderBId,
        amountCents: 300,
        result: 'success',
        channelTxnNo: `sbx_txn_${suffix}_late`,
      },
    })
    const resLate = await payment.processCallback(CHANNEL, cbLate.rawBody, cbLate.headers)
    const orderBLate = await prisma.order.findUnique({ where: { id: orderBId } })
    const lateAudit = await prisma.auditLog.findFirst({
      where: { action: 'order.mark_paid_online', targetType: 'order', targetId: orderBId },
    })
    if (
      resLate.ok &&
      orderBLate?.payStatus === 'paid' &&
      orderBLate.paymentSource === 'sandbox' &&
      lateAudit &&
      JSON.parse(lateAudit.payloadJson)['late'] === true
    ) {
      pass('valid late callback of an existing attempt credits a closed order, audited with late=true')
    } else {
      fail(`late credit mismatch: order=${orderBLate?.payStatus} audit=${lateAudit?.payloadJson}`)
    }
    // 无 attempt 的 closed 订单：伪造回调绝不可能入账。
    const orderEId = await makeOrder(500, 'closed')
    const cbForgeClosed = buildCallback({
      payload: {
        channel: CHANNEL,
        attemptId: `pa_forged_${suffix}`,
        prepayId: 'sbx_forged',
        orderId: orderEId,
        amountCents: 500,
        result: 'success',
        channelTxnNo: `sbx_txn_${suffix}_forged`,
      },
    })
    await expectCode('closed order without attempts cannot be forged to paid (CALLBACK_ATTEMPT_NOT_FOUND)', 'CALLBACK_ATTEMPT_NOT_FOUND', () =>
      payment.processCallback(CHANNEL, cbForgeClosed.rawBody, cbForgeClosed.headers),
    )
    const orderEAfter = await prisma.order.findUnique({ where: { id: orderEId } })
    if (orderEAfter?.payStatus === 'closed') pass('forged callback leaves closed order closed')
    else fail(`closed order mutated: ${orderEAfter?.payStatus}`)

    // ── (10) 沙箱模拟端点：走同一验签路径；生产 404 ─────────────────────────
    const orderHId = await makeOrder(120)
    const paymentSessionH = await paymentSessionFor(orderHId)
    const attemptViewH = await payment.createPayAttempt(orderHId, paymentSessionH)
    const resSim = await payment.simulateSandboxCallback({ attemptId: attemptViewH.attemptId, result: 'success' })
    const orderH = await prisma.order.findUnique({ where: { id: orderHId } })
    if (resSim.ok && orderH?.payStatus === 'paid' && orderH.paymentSource === 'sandbox') {
      pass('sandbox simulate endpoint drives the full signed-callback path to paid')
    } else {
      fail(`simulate flow mismatch: ${orderH?.payStatus}`)
    }
    const envBackup = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    try {
      await expectCode('simulate endpoint does not exist in production (Not Found)', 'Not Found', () =>
        payment.simulateSandboxCallback({ attemptId: attemptViewH.attemptId, result: 'success' }),
      )
    } finally {
      if (envBackup === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = envBackup
    }

    // ── (11) 回归：线下状态机 + Admin 端点 + 渠道白名单 ─────────────────────
    const orderFId = await makeOrder(80)
    for (const bad of ['sandbox', 'wechat', 'alipay', 'benefit']) {
      await expectCode(`offline markPaid rejects paymentSource=${bad} by name`, 'PAYMENT_SOURCE_INVALID', () =>
        orderStatus.markPaid(orderFId, { paymentSource: bad }),
      )
    }
    const offlinePaid = await orderStatus.markPaid(orderFId, { paymentSource: 'offline', operatorId: 'verify' })
    if (offlinePaid.payStatus === 'paid' && offlinePaid.paymentSource === 'offline' && offlinePaid.pickupCode) {
      pass('offline markPaid path is unchanged (unpaid→paid + pickupCode)')
    } else {
      fail(`offline markPaid regression: ${JSON.stringify(offlinePaid)}`)
    }
    const refunded = await orderStatus.refund(orderFId, { reason: '验证退款', operatorId: 'verify' })
    if (refunded.payStatus === 'refunded') pass('refund path is unchanged (paid→refunded)')
    else fail(`refund regression: ${refunded.payStatus}`)

    for (const bad of ['sandbox', 'free', 'wechat', 'alipay', 'benefit']) {
      await expectCode(`Admin mark-paid endpoint rejects paymentSource=${bad}`, 'PAYMENT_SOURCE_NOT_ADMIN_ALLOWED', () =>
        adminCtl.markPaid(orderFId, { paymentSource: bad } as unknown as AdminMarkPaidDto, {
          userId: 'verify-admin',
          role: 'admin',
        } as never),
      )
    }
    const orderF2Id = await makeOrder(80)
    for (const badChannel of ['wechat', 'alipay', 'benefit', 'offline']) {
      await expectCode(`markPaidOnline rejects channel=${badChannel} by name`, 'PAYMENT_CHANNEL_INVALID', () =>
        orderStatus.markPaidOnline(orderF2Id, {
          channel: badChannel as never,
          attemptId: 'pa_none',
          channelTxnNo: 'txn_none',
          late: false,
        }),
      )
    }

    // ── (12) fail-closed：Provider 工厂 + 生产运行时门禁 ────────────────────
    expectThrowSync('sandbox provider without secret fails closed', 'SANDBOX_PAYMENT_SECRET_INVALID', () =>
      resolvePaymentProvider({ PAYMENT_PROVIDER: 'sandbox' } as NodeJS.ProcessEnv),
    )
    expectThrowSync('sandbox provider with short secret fails closed', 'SANDBOX_PAYMENT_SECRET_INVALID', () =>
      resolvePaymentProvider({ PAYMENT_PROVIDER: 'sandbox', SANDBOX_PAYMENT_SECRET: 'short' } as NodeJS.ProcessEnv),
    )
    expectThrowSync('live channel values are refused before C5-6 (PAYMENT_PROVIDER_INVALID)', 'PAYMENT_PROVIDER_INVALID', () =>
      resolvePaymentProvider({ PAYMENT_PROVIDER: 'wechat' } as NodeJS.ProcessEnv),
    )
    expectThrowSync('production + sandbox provider refuses to start (factory guard)', 'PAYMENT_PROVIDER_SANDBOX_FORBIDDEN_IN_PRODUCTION', () =>
      resolvePaymentProvider({
        PAYMENT_PROVIDER: 'sandbox',
        SANDBOX_PAYMENT_SECRET: VERIFY_SECRET,
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    )
    if (
      resolvePaymentProvider({} as NodeJS.ProcessEnv) === null &&
      resolvePaymentProvider({ PAYMENT_PROVIDER: 'disabled' } as NodeJS.ProcessEnv) === null
    ) {
      pass('unset/disabled provider resolves to null (online payment off, never faked)')
    } else {
      fail('unset/disabled provider did not resolve to null')
    }

    const prodEnvBase = {
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(32),
      FILE_STORAGE_DRIVER: 'cos',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/verify',
      REDIS_URL: 'redis://localhost:6379',
      SMS_PROVIDER: 'tencent',
      TENCENT_SMS_SECRET_ID: 'x',
      TENCENT_SMS_SECRET_KEY: 'x',
      TENCENT_SMS_SDK_APP_ID: 'x',
      TENCENT_SMS_SIGN_NAME: 'x',
      TENCENT_SMS_TEMPLATE_ID: 'x',
      OCR_PROVIDER: 'baidu',
      BAIDU_OCR_API_KEY: 'x',
      BAIDU_OCR_SECRET_KEY: 'x',
      AI_PROVIDER: 'llm',
      AI_LLM_API_KEY: 'x',
      PAYMENT_SESSION_SECRET: 'payment-session-secret-0123456789',
    }
    expectThrowSync('production runtime gates reject missing PAYMENT_SESSION_SECRET', 'PRODUCTION_PAYMENT_SESSION_SECRET_INVALID', () =>
      assertProductionRuntimeGates({ ...prodEnvBase, PAYMENT_SESSION_SECRET: undefined }),
    )
    expectThrowSync('production runtime gates reject PAYMENT_PROVIDER=sandbox', 'PRODUCTION_PAYMENT_PROVIDER_SANDBOX_FORBIDDEN', () =>
      assertProductionRuntimeGates({ ...prodEnvBase, PAYMENT_PROVIDER: 'sandbox' }),
    )
    try {
      assertProductionRuntimeGates({ ...prodEnvBase })
      assertProductionRuntimeGates({ ...prodEnvBase, PAYMENT_PROVIDER: 'disabled' })
      pass('production runtime gates pass with payment provider unset/disabled')
    } catch (e) {
      fail(`production gates unexpectedly rejected unset/disabled payment provider: ${(e as Error).message}`)
    }

    console.log('\nAll payment-flow assertions passed.\n')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
