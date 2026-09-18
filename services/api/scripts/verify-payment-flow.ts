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
 * - 安全过期：订单可按自身截止时间 closed；未获渠道确认的屏上二维码仍保持 pending
 *   互斥锁，不能仅因本地时间伪造 expired；closed 订单拒绝新出码。
 * - 回归：markPaid 线下三来源不变，sandbox/wechat/alipay/benefit 按名拒绝；
 *   Admin 端点拒绝 sandbox；markPaidOnline 拒绝非白名单渠道；支付回调不改 PrintTask.status。
 * - fail-closed：sandbox 缺密钥 / 生产配 sandbox / 未知 Provider → 启动即拒绝；
 *   Provider 未配置 → ONLINE_PAYMENT_DISABLED，不伪装可支付。
 * - 渠道已受理但本地回填失败：留下 CHANNEL_ACCEPTED_UNCONFIRMED / created+空标识，
 *   禁止第二笔出码，对账与 Admin opsAttention 可见；金额不对的签名回调不得补写 prepayId。
 */
import 'dotenv/config'
import { randomBytes, randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'
import { assertProductionRuntimeGates } from '../src/config/production-runtime-gates'
import { signFileUrl } from '../src/files/signing'
import { AdminOrdersReadonlyService } from '../src/admin-orders-readonly/admin-orders-readonly.service'
import { AdminOrderActionsController } from '../src/payment/admin-order-actions.controller'
import { CHANNEL_ACCEPTED_UNCONFIRMED_REASON } from '../src/payment/channel-accepted-signal'
import type { AdminMarkPaidDto } from '../src/payment/dto/order-action.dto'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { ReconciliationService } from '../src/payment/reconciliation.service'
import { ONLINE_PAID_PENDING_REFUND_REASON, OrderStatusService } from '../src/payment/order-status.service'
import { createPaymentSessionToken, paymentSessionTtlMs } from '../src/payment/payment-session-token'
import { PaymentProviderRegistry, resolvePaymentProvider } from '../src/payment/payment-provider.factory'
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
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

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

function errorCode(error: unknown): string {
  const exception = error as { getResponse?: () => unknown; message?: string }
  const response = typeof exception.getResponse === 'function' ? exception.getResponse() : undefined
  const code = (response as { error?: { code?: string } } | undefined)?.error?.code
  return code ?? exception.message ?? String(error)
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

  assertIsolatedVerificationDatabase()
  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus, new TerminalCapabilitiesService(prisma))
  const provider = new SandboxPaymentProvider(VERIFY_SECRET)
  const payment = new OnlinePaymentService(prisma, audit, orderStatus, new PaymentProviderRegistry([provider]))
  const paymentDisabled = new OnlinePaymentService(prisma, audit, orderStatus, new PaymentProviderRegistry([]))
  const redemption = new BenefitRedemptionService(prisma, audit, orderStatus)
  const adminCtl = new AdminOrderActionsController(orderStatus)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_payflow_${suffix}`
  const endUserId = `eu_payflow_${suffix}`
  const taskIds: string[] = []
  const orderIds: string[] = []
  const grantIds: string[] = []
  const fixtureFileIds: string[] = []
  const fixtureStorageKeys: string[] = []
  let orderSeq = 0

  async function seedPdfFixture(label: string, pages: number): Promise<string> {
    const fileId = `f_payflow_${suffix}_${label}`
    const storageKey = `verify/payment-flow/${fileId}.pdf`
    const pdfBytes = buildRealPdf(pages)
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
  async function makeOrder(amountCents: number, payStatus = 'unpaid', ownerId: string | null = null): Promise<string> {
    orderSeq += 1
    const order = await prisma.order.create({
      data: {
        orderNo: `ORD-PAYFLOW-${suffix}-${orderSeq}`,
        type: 'print',
        amountCents,
        payStatus,
        taskStatus: 'pending',
        terminalId,
        endUserId: ownerId,
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
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...allOrderIds, ...grantIds] } } })
    await prisma.auditLog.deleteMany({ where: { targetType: 'payment_attempt', targetId: { in: attempts.map((a) => a.id) } } })
    await prisma.auditLog.deleteMany({ where: { targetType: 'order', targetId: { in: allOrderIds } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: taskIds }, action: 'print_job.create' } })
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: allOrderIds } } })
    await prisma.redemptionRecord.deleteMany({ where: { OR: [{ orderId: { in: allOrderIds } }, { endUserId }] } })
    await prisma.order.deleteMany({ where: { id: { in: allOrderIds } } })
    await prisma.benefitGrant.deleteMany({ where: { OR: [{ id: { in: grantIds } }, { endUserId }] } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
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
    await prisma.endUser.create({
      data: { id: endUserId, phoneHash: `hash_${suffix}`, phoneEnc: `enc_${suffix}` },
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
          colorMode: 'black_white' as const,
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
      items[0]?.['serviceKey'] === 'print_bw_page' &&
      items[0]?.['quantity'] === 4 &&
      items[0]?.['subtotalCents'] === orderA.amountCents &&
      orderA.amountCents === 80
    ) {
      pass('order creation snapshots PricingService lines into itemsJson (1 line, black_white 2p×2c = 80 cents)')
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
      attemptViewA.amountCents === 80 &&
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

    // ── (3a) 预留事务：本地建 PaymentAttempt 失败必须一起回滚 Order→paying ─────
    const reservationRollbackOrderId = await makeOrder(100)
    const reservationRollbackSession = await paymentSessionFor(reservationRollbackOrderId)
    const transactionHost = prisma as unknown as {
      $transaction: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>
    }
    const originalTransaction = transactionHost.$transaction
    transactionHost.$transaction = async (callback) => originalTransaction.call(prisma, async (tx: unknown) => {
      const attemptDelegate = (tx as { paymentAttempt: { create: (...args: unknown[]) => Promise<unknown> } }).paymentAttempt
      const originalCreate = attemptDelegate.create.bind(attemptDelegate)
      attemptDelegate.create = async (...args: unknown[]) => {
        const orderId = (args[0] as { data?: { orderId?: string } } | undefined)?.data?.orderId
        if (orderId === reservationRollbackOrderId) throw new Error('VERIFY_FORCED_ATTEMPT_CREATE_FAILURE')
        return originalCreate(...args)
      }
      try {
        return await callback(tx)
      } finally {
        attemptDelegate.create = originalCreate
      }
    })
    try {
      await expectCode('PaymentAttempt create failure rolls back the Order reservation (VERIFY_FORCED_ATTEMPT_CREATE_FAILURE)', 'VERIFY_FORCED_ATTEMPT_CREATE_FAILURE', () =>
        payment.createPayAttempt(reservationRollbackOrderId, reservationRollbackSession),
      )
      const rollbackOrder = await prisma.order.findUnique({ where: { id: reservationRollbackOrderId } })
      const rollbackAttempts = await prisma.paymentAttempt.count({ where: { orderId: reservationRollbackOrderId } })
      if (rollbackOrder?.payStatus === 'unpaid' && rollbackOrder.expiresAt === null && rollbackAttempts === 0) {
        pass('PaymentAttempt create failure leaves no paying reservation or half-created attempt')
      } else {
        fail(`payment reservation rollback mismatch: ${JSON.stringify({ order: rollbackOrder, attempts: rollbackAttempts })}`)
      }
    } finally {
      transactionHost.$transaction = originalTransaction
    }

    // ── (3b) QR 出码期间：订单必须已预留，不能再被权益核销 ─────────────────
    const qrRaceOrderId = await makeOrder(100, 'unpaid', endUserId)
    const qrRaceSession = await paymentSessionFor(qrRaceOrderId)
    const qrRaceGrant = await prisma.benefitGrant.create({
      data: {
        id: `bg_payflow_${suffix}`,
        endUserId,
        benefitType: 'free_quota',
        title: '付款码竞争权益',
        quantityTotal: 1,
        quantityRemaining: 1,
        status: 'active',
      },
    })
    grantIds.push(qrRaceGrant.id)
    let releaseQr: (() => void) | undefined
    let enteredQr: (() => void) | undefined
    const qrEntered = new Promise<void>((resolve) => { enteredQr = resolve })
    const qrRelease = new Promise<void>((resolve) => { releaseQr = resolve })
    const originalCreateQrPayment = provider.createQrPayment.bind(provider)
    provider.createQrPayment = async (input) => {
      enteredQr?.()
      await qrRelease
      return originalCreateQrPayment(input)
    }

    const qrPaymentAttempt = payment.createPayAttempt(qrRaceOrderId, qrRaceSession)
    try {
      await qrEntered
      await expectCode('second QR request during Provider gate remains blocked without releasing the reservation (PAYMENT_ATTEMPT_PENDING)', 'PAYMENT_ATTEMPT_PENDING', () =>
        payment.createPayAttempt(qrRaceOrderId, qrRaceSession),
      )
      let redemptionError: unknown
      try {
        await redemption.redeemForOrder({
          endUserId,
          orderId: qrRaceOrderId,
          benefitGrantId: qrRaceGrant.id,
        })
      } catch (error) {
        redemptionError = error
      }
      const redeemCode = redemptionError ? errorCode(redemptionError) : 'RESOLVED'
      const grantBeforeQrRelease = await prisma.benefitGrant.findUnique({ where: { id: qrRaceGrant.id } })
      const recordCountBeforeQrRelease = await prisma.redemptionRecord.count({ where: { orderId: qrRaceOrderId } })
      if (
        redeemCode.includes('ORDER_NOT_REDEEMABLE') &&
        grantBeforeQrRelease?.quantityRemaining === 1 &&
        recordCountBeforeQrRelease === 0
      ) {
        pass('QR Provider gate blocks redemption: ORDER_NOT_REDEEMABLE, grant unchanged, no order_redeem record')
      } else {
        throw new Error(
          `QR reservation race is inconsistent: redeem=${redeemCode}, ` +
          `quantityRemaining=${grantBeforeQrRelease?.quantityRemaining ?? 'null'}, records=${recordCountBeforeQrRelease}`,
        )
      }

      releaseQr?.()
      const qrAttemptView = await qrPaymentAttempt
      const qrRaceOrder = await prisma.order.findUnique({ where: { id: qrRaceOrderId } })
      const qrRaceAttempt = await prisma.paymentAttempt.findUnique({ where: { id: qrAttemptView.attemptId } })
      if (qrAttemptView.status === 'pending' && qrRaceOrder?.payStatus === 'paying' && qrRaceAttempt?.status === 'pending') {
        pass('releasing QR Provider gate leaves order paying and payment attempt pending')
      } else {
        throw new Error(
          `QR reservation did not hold: order=${qrRaceOrder?.payStatus ?? 'null'}, ` +
          `view=${qrAttemptView.status}, attempt=${qrRaceAttempt?.status ?? 'null'}`,
        )
      }
    } finally {
      releaseQr?.()
      await qrPaymentAttempt.catch(() => undefined)
      provider.createQrPayment = originalCreateQrPayment
    }

    // ── (4) 回调成功入账（验签 + 全字段匹配 + 金额一致）────────────────────
    const attemptA = await prisma.paymentAttempt.findUnique({ where: { id: attemptViewA.attemptId } })
    if (!attemptA?.prepayId) fail('attempt A missing prepayId')
    const txnA = `sbx_txn_${suffix}_a`
    const successPayload = {
      channel: CHANNEL,
      attemptId: attemptA.id,
      prepayId: attemptA.prepayId,
      orderId: orderA.id,
      amountCents: orderA.amountCents,
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

    // ── (8) 安全过期：订单可关闭，但屏上二维码待渠道确认前仍保持 pending ─────
    const past = new Date(Date.now() - 60_000)
    await prisma.paymentAttempt.update({ where: { id: attemptViewB2.attemptId }, data: { expiresAt: past } })
    await prisma.order.update({ where: { id: orderBId }, data: { expiresAt: past } })
    const statusViewB = await payment.getPayStatus(orderBId, paymentSessionB)
    const attemptB2AfterLazyExpiry = await prisma.paymentAttempt.findUnique({ where: { id: attemptViewB2.attemptId } })
    if (
      statusViewB.payStatus === 'closed' &&
      attemptB2AfterLazyExpiry?.status === 'pending' &&
      attemptB2AfterLazyExpiry.qrCodeContent?.startsWith('sandboxpay://qr?')
    ) {
      pass('order TTL closes the order without falsely expiring an unconfirmed screen QR')
    } else {
      fail(`safe lazy expiry mismatch: order=${statusViewB.payStatus} attempt=${attemptB2AfterLazyExpiry?.status}`)
    }
    await expectCode('closed order refuses new pay attempts (ORDER_CLOSED)', 'ORDER_CLOSED', () =>
      payment.createPayAttempt(orderBId, paymentSessionB),
    )

    // ── (9) closed → paid：仅「已存在 attempt 的有效迟到回调」可入账 ────────
    const cbLate = buildCallback({
      payload: {
        channel: CHANNEL,
        attemptId: attemptViewB2.attemptId,
        prepayId: attemptB2AfterLazyExpiry!.prepayId,
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
    // C5-6 起 wechat / alipay 进入 markPaidOnline 白名单（仅回调/查单确认路径调用）；
    // benefit / offline / 未知通道继续按名拒绝。
    for (const badChannel of ['benefit', 'offline', 'voucher', 'free']) {
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
    // C5-6：真实通道取值合法，但缺关键配置必须 fail-closed（绝不带残缺配置跑真实资金通道）。
    expectThrowSync('wechat without notify base fails closed', 'PAYMENT_NOTIFY_BASE_URL_MISSING', () =>
      resolvePaymentProvider({ PAYMENT_PROVIDER: 'wechat' } as NodeJS.ProcessEnv),
    )
    expectThrowSync('wechat with notify base but missing merchant config fails closed', 'WECHAT_PAY_CONFIG_INVALID', () =>
      resolvePaymentProvider({
        PAYMENT_PROVIDER: 'wechat',
        PAYMENT_NOTIFY_BASE_URL: 'https://pay.example.com',
      } as NodeJS.ProcessEnv),
    )
    expectThrowSync('alipay missing merchant config fails closed', 'ALIPAY_CONFIG_INVALID', () =>
      resolvePaymentProvider({
        PAYMENT_PROVIDER: 'alipay',
        PAYMENT_NOTIFY_BASE_URL: 'https://pay.example.com',
      } as NodeJS.ProcessEnv),
    )
    expectThrowSync('unknown provider value refused (PAYMENT_PROVIDER_INVALID)', 'PAYMENT_PROVIDER_INVALID', () =>
      resolvePaymentProvider({ PAYMENT_PROVIDER: 'paypal' } as NodeJS.ProcessEnv),
    )
    expectThrowSync('sandbox must not mix with real channels', 'PAYMENT_PROVIDER_SANDBOX_EXCLUSIVE', () =>
      resolvePaymentProvider({
        PAYMENT_PROVIDER: 'sandbox,wechat',
        SANDBOX_PAYMENT_SECRET: VERIFY_SECRET,
      } as NodeJS.ProcessEnv),
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
      FILE_SIGNING_SECRET: 'a-strong-file-signing-secret-0123456789',
      SECRET_ENCRYPTION_KEY: 'a-strong-secret-encryption-key-01234567',
      PAYMENT_SESSION_SECRET: 'payment-session-secret-0123456789',
      TERMINAL_ADMIN_SECRET: 'a-strong-terminal-admin-secret-01234567',
      TERMINAL_ACTION_TOKEN_SECRET: 'a-strong-terminal-action-secret-0123456',
      TERMINAL_LEGACY_REGISTER_ENABLED: 'false',
      TERMINAL_PLANNED_PROVISIONING_ENABLED: 'true',
      PRINT_REQUIRE_PII_SCAN: 'true', // 商用生产必须阻断未完成 PII 检查的原始材料
      PRINT_REQUIRE_PRINTER_ONLINE: 'true', // PRT-03：打印机离线不得建单收款
      PRINT_SCAN_CAPABILITY_MODE: 'managed', // Task 11：生产必须显式声明能力开关模式
      TRUST_PROXY_HOPS: '1',
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

    // ── (13) API-07：取件窗口已关拒绝入账并记待退；云打印单不铸幽灵码 ─────
    const expiredCloudId = await makeOrder(220, 'closed')
    await prisma.order.update({
      where: { id: expiredCloudId },
      data: {
        pickupStatus: 'expired',
        pickupCodeHash: `hash_expired_${suffix}`,
        pickupCodeExpiresAt: new Date(Date.now() - 60_000),
      },
    })
    await expectCode(
      'markPaidOnline refuses expired pickup window (ORDER_PICKUP_WINDOW_CLOSED)',
      'ORDER_PICKUP_WINDOW_CLOSED',
      () =>
        orderStatus.markPaidOnline(expiredCloudId, {
          channel: CHANNEL,
          attemptId: 'pa_expired_window',
          channelTxnNo: `txn_expired_${suffix}`,
          late: true,
        }),
    )
    const expiredCloud = await prisma.order.findUnique({ where: { id: expiredCloudId } })
    const pendingRefundAudit = await prisma.auditLog.findFirst({
      where: { action: 'order.online_payment_pending_refund', targetType: 'order', targetId: expiredCloudId },
    })
    if (
      expiredCloud?.payStatus === 'closed' &&
      expiredCloud.pickupCode == null &&
      expiredCloud.refundReason === ONLINE_PAID_PENDING_REFUND_REASON &&
      pendingRefundAudit
    ) {
      pass('expired pickup window stays closed, records ONLINE_PAID_PENDING_REFUND, no ghost pickupCode')
    } else {
      fail(
        `pending-refund mismatch: pay=${expiredCloud?.payStatus} reason=${expiredCloud?.refundReason} code=${expiredCloud?.pickupCode} audit=${pendingRefundAudit?.payloadJson}`,
      )
    }

    const pendingClockClosedId = await makeOrder(210, 'unpaid')
    await prisma.order.update({
      where: { id: pendingClockClosedId },
      data: {
        pickupStatus: 'pending',
        pickupCodeHash: `hash_pending_clock_${suffix}`,
        pickupCodeExpiresAt: new Date(Date.now() - 60_000),
      },
    })
    await expectCode(
      'markPaidOnline refuses unclaimed clock-expired pickup (ORDER_PICKUP_WINDOW_CLOSED)',
      'ORDER_PICKUP_WINDOW_CLOSED',
      () =>
        orderStatus.markPaidOnline(pendingClockClosedId, {
          channel: CHANNEL,
          attemptId: 'pa_pending_clock',
          channelTxnNo: `txn_pending_clock_${suffix}`,
          late: false,
        }),
    )

    const claimedLeaseId = await makeOrder(200, 'unpaid')
    await prisma.order.update({
      where: { id: claimedLeaseId },
      data: {
        pickupStatus: 'claimed',
        pickupClaimedAt: new Date(),
        pickupCodeHash: `hash_claimed_lease_${suffix}`,
        pickupCodeExpiresAt: new Date(Date.now() - 60_000),
        taskStatus: 'awaiting_payment',
      },
    })
    const claimedLeasePaid = await orderStatus.markPaidOnline(claimedLeaseId, {
      channel: CHANNEL,
      attemptId: 'pa_claimed_lease',
      channelTxnNo: `txn_claimed_lease_${suffix}`,
      late: false,
    })
    if (claimedLeasePaid.payStatus !== 'paid' || claimedLeasePaid.paymentSource !== CHANNEL || claimedLeasePaid.pickupStatus !== 'claimed') {
      fail(`claimed lease must still accept online payment: pay=${claimedLeasePaid.payStatus} source=${claimedLeasePaid.paymentSource} pickup=${claimedLeasePaid.pickupStatus}`)
    }
    pass('markPaidOnline accepts claimed kiosk lease after pickupCodeExpiresAt')

    const expiredClaimedId = await makeOrder(190, 'unpaid')
    await prisma.order.update({
      where: { id: expiredClaimedId },
      data: {
        pickupStatus: 'claimed',
        pickupClaimedAt: new Date(Date.now() - paymentSessionTtlMs() - 1000),
        pickupCodeHash: `hash_claimed_expired_lease_${suffix}`,
        pickupCodeExpiresAt: new Date(Date.now() - 60_000),
        taskStatus: 'awaiting_payment',
      },
    })
    await expectCode(
      'markPaidOnline refuses claimed unpaid after kiosk lease TTL (ORDER_PICKUP_WINDOW_CLOSED)',
      'ORDER_PICKUP_WINDOW_CLOSED',
      () =>
        orderStatus.markPaidOnline(expiredClaimedId, {
          channel: CHANNEL,
          attemptId: 'pa_claimed_expired_lease',
          channelTxnNo: `txn_claimed_expired_lease_${suffix}`,
          late: true,
        }),
    )
    const expiredClaimed = await prisma.order.findUnique({ where: { id: expiredClaimedId } })
    const expiredClaimedRefundAudit = await prisma.auditLog.findFirst({
      where: { action: 'order.online_payment_pending_refund', targetType: 'order', targetId: expiredClaimedId },
    })
    if (
      expiredClaimed?.payStatus === 'unpaid'
      && expiredClaimed.refundReason === ONLINE_PAID_PENDING_REFUND_REASON
      && expiredClaimedRefundAudit
    ) {
      pass('claimed unpaid past lease online late payment records ONLINE_PAID_PENDING_REFUND, does not turn paid')
    } else {
      fail(
        `claimed-lease pending-refund mismatch: pay=${expiredClaimed?.payStatus} reason=${expiredClaimed?.refundReason} audit=${expiredClaimedRefundAudit?.payloadJson}`,
      )
    }

    const cancelledCloudId = await makeOrder(180, 'unpaid')
    await prisma.order.update({
      where: { id: cancelledCloudId },
      data: { pickupStatus: 'cancelled', pickupCodeHash: `hash_cancelled_${suffix}` },
    })
    await expectCode(
      'markPaidOnline refuses cancelled pickup (ORDER_PICKUP_WINDOW_CLOSED)',
      'ORDER_PICKUP_WINDOW_CLOSED',
      () =>
        orderStatus.markPaidOnline(cancelledCloudId, {
          channel: CHANNEL,
          attemptId: 'pa_cancelled_window',
          channelTxnNo: `txn_cancelled_${suffix}`,
          late: false,
        }),
    )

    const hashedCloudId = await makeOrder(160, 'unpaid')
    await prisma.order.update({
      where: { id: hashedCloudId },
      data: { pickupStatus: 'pending', pickupCodeHash: `hash_live_${suffix}` },
    })
    const hashedPaid = await orderStatus.markPaidOnline(hashedCloudId, {
      channel: CHANNEL,
      attemptId: 'pa_hashed',
      channelTxnNo: `txn_hashed_${suffix}`,
      late: false,
    })
    if (hashedPaid.payStatus === 'paid' && hashedPaid.pickupCode == null) {
      pass('cloud print markPaidOnline does not mint a ghost plaintext pickupCode')
    } else {
      fail(`ghost pickupCode minted: pay=${hashedPaid.payStatus} code=${hashedPaid.pickupCode}`)
    }
    const hashedReplay = await orderStatus.markPaidOnline(hashedCloudId, {
      channel: CHANNEL,
      attemptId: 'pa_hashed_replay',
      channelTxnNo: `txn_hashed_replay_${suffix}`,
      late: true,
    })
    if (hashedReplay.payStatus !== 'paid' || hashedReplay.paymentSource !== CHANNEL) {
      fail(`same-channel replay must stay paid: pay=${hashedReplay.payStatus} source=${hashedReplay.paymentSource}`)
    }
    pass('repeat markPaidOnline on a live paid order is idempotent')

    type UpdateMany = typeof prisma.order.updateMany
    const orderMut = prisma.order as unknown as { updateMany: UpdateMany }
    async function withPaidWriteRace(orderId: string, mutate: () => Promise<void>): Promise<boolean> {
      const originalUpdateMany = orderMut.updateMany.bind(prisma.order) as UpdateMany
      let raced = false
      orderMut.updateMany = (async (args: Parameters<UpdateMany>[0]) => {
        const data = args?.data as { payStatus?: string } | undefined
        const where = args?.where as { id?: string } | undefined
        if (!raced && where?.id === orderId && data?.payStatus === 'paid') {
          raced = true
          await mutate()
        }
        return originalUpdateMany(args)
      }) as UpdateMany
      try {
        await expectCode(
          `markPaidOnline CAS 0 after race on ${orderId} (ORDER_PICKUP_WINDOW_CLOSED)`,
          'ORDER_PICKUP_WINDOW_CLOSED',
          () =>
            orderStatus.markPaidOnline(orderId, {
              channel: CHANNEL,
              attemptId: `pa_race_${orderId.slice(-8)}`,
              channelTxnNo: `txn_race_${orderId.slice(-8)}`,
              late: true,
            }),
        )
        return raced
      } finally {
        orderMut.updateMany = originalUpdateMany
      }
    }

    const raceClosedId = await makeOrder(175, 'unpaid')
    await prisma.order.update({
      where: { id: raceClosedId },
      data: {
        pickupStatus: 'pending',
        pickupCodeHash: `hash_race_closed_${suffix}`,
        pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    const racedClosed = await withPaidWriteRace(raceClosedId, async () => {
      await prisma.order.update({
        where: { id: raceClosedId },
        data: { pickupStatus: 'expired', taskStatus: 'expired', payStatus: 'closed' },
      })
    })
    if (!racedClosed) fail('sweeper race must intercept the paid write, not skip it')
    const raceClosedRow = await prisma.order.findUnique({ where: { id: raceClosedId } })
    const raceClosedAudit = await prisma.auditLog.findFirst({
      where: { action: 'order.online_payment_pending_refund', targetType: 'order', targetId: raceClosedId },
    })
    if (
      raceClosedRow?.payStatus === 'closed'
      && raceClosedRow.pickupStatus === 'expired'
      && raceClosedRow.refundReason === ONLINE_PAID_PENDING_REFUND_REASON
      && raceClosedAudit
    ) {
      pass('snapshot-open then sweeper expired+closed: CAS 0, does not turn paid, pending-refund')
    } else {
      fail(
        `sweeper race mismatch: pay=${raceClosedRow?.payStatus} pickup=${raceClosedRow?.pickupStatus} reason=${raceClosedRow?.refundReason}`,
      )
    }

    const raceLeaseId = await makeOrder(165, 'unpaid')
    await prisma.order.update({
      where: { id: raceLeaseId },
      data: {
        pickupStatus: 'claimed',
        pickupClaimedAt: new Date(),
        pickupCodeHash: `hash_race_lease_${suffix}`,
        pickupCodeExpiresAt: new Date(Date.now() - 60_000),
        taskStatus: 'awaiting_payment',
      },
    })
    const racedLease = await withPaidWriteRace(raceLeaseId, async () => {
      await prisma.order.update({
        where: { id: raceLeaseId },
        data: { pickupClaimedAt: new Date(Date.now() - paymentSessionTtlMs() - 1000) },
      })
    })
    if (!racedLease) fail('claimed-lease TTL race must intercept the paid write')
    const raceLeaseRow = await prisma.order.findUnique({ where: { id: raceLeaseId } })
    const raceLeaseAudit = await prisma.auditLog.findFirst({
      where: { action: 'order.online_payment_pending_refund', targetType: 'order', targetId: raceLeaseId },
    })
    if (
      raceLeaseRow?.payStatus === 'unpaid'
      && raceLeaseRow.pickupStatus === 'claimed'
      && raceLeaseRow.refundReason === ONLINE_PAID_PENDING_REFUND_REASON
      && raceLeaseAudit
    ) {
      pass('snapshot-live claimed then lease crosses TTL: CAS 0, not paid, pending-refund')
    } else {
      fail(
        `lease TTL race mismatch: pay=${raceLeaseRow?.payStatus} pickup=${raceLeaseRow?.pickupStatus} reason=${raceLeaseRow?.refundReason}`,
      )
    }

    async function withOfflinePaidWriteRace(orderId: string, mutate: () => Promise<void>): Promise<boolean> {
      const originalUpdateMany = orderMut.updateMany.bind(prisma.order) as UpdateMany
      let raced = false
      orderMut.updateMany = (async (args: Parameters<UpdateMany>[0]) => {
        const data = args?.data as { payStatus?: string } | undefined
        const where = args?.where as { id?: string } | undefined
        if (!raced && where?.id === orderId && data?.payStatus === 'paid') {
          raced = true
          await mutate()
        }
        return originalUpdateMany(args)
      }) as UpdateMany
      try {
        await expectCode(
          `offline markPaid CAS 0 after race on ${orderId} (ORDER_PICKUP_WINDOW_CLOSED)`,
          'ORDER_PICKUP_WINDOW_CLOSED',
          () => orderStatus.markPaid(orderId, { paymentSource: 'offline', operatorId: 'verify-offline-race' }),
        )
        return raced
      } finally {
        orderMut.updateMany = originalUpdateMany
      }
    }

    const offlineRaceId = await makeOrder(155, 'unpaid')
    await prisma.order.update({
      where: { id: offlineRaceId },
      data: {
        pickupStatus: 'pending',
        pickupCodeHash: `hash_offline_race_${suffix}`,
        pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    const racedOffline = await withOfflinePaidWriteRace(offlineRaceId, async () => {
      await prisma.order.update({
        where: { id: offlineRaceId },
        data: { pickupStatus: 'expired', taskStatus: 'expired', payStatus: 'closed' },
      })
    })
    if (!racedOffline) fail('offline sweeper race must intercept the paid write, not skip it')
    const offlineRaceRow = await prisma.order.findUnique({ where: { id: offlineRaceId } })
    const offlinePendingRefund = await prisma.auditLog.findFirst({
      where: { action: 'order.online_payment_pending_refund', targetType: 'order', targetId: offlineRaceId },
    })
    if (
      offlineRaceRow?.payStatus === 'closed'
      && offlineRaceRow.pickupStatus === 'expired'
      && offlineRaceRow.paidAt == null
      && !offlinePendingRefund
    ) {
      pass('offline markPaid snapshot-open then sweeper expired+closed: CAS 0, stays closed, no pending-refund')
    } else {
      fail(
        `offline sweeper race mismatch: pay=${offlineRaceRow?.payStatus} pickup=${offlineRaceRow?.pickupStatus} paidAt=${offlineRaceRow?.paidAt?.toISOString() ?? 'null'} refundAudit=${Boolean(offlinePendingRefund)}`,
      )
    }

    // ── (14) API-08：关单后 claimed 回滚 pending，不再卡死 ──────────────────
    const claimedCloseId = await makeOrder(300, 'paying')
    await prisma.order.update({
      where: { id: claimedCloseId },
      data: {
        pickupStatus: 'claimed',
        expiresAt: new Date(Date.now() - 1_000),
      },
    })
    const claimedCloseSession = await paymentSessionFor(claimedCloseId)
    const claimedCloseStatus = await payment.getPayStatus(claimedCloseId, claimedCloseSession)
    const claimedCloseOrder = await prisma.order.findUnique({ where: { id: claimedCloseId } })
    if (
      claimedCloseStatus.payStatus === 'closed' &&
      claimedCloseOrder?.pickupStatus === 'pending' &&
      claimedCloseOrder.pickupStatus !== 'claimed'
    ) {
      pass('closing unpaid claimed order rolls pickupStatus back to pending')
    } else {
      fail(
        `claimed close mismatch: pay=${claimedCloseStatus.payStatus} pickup=${claimedCloseOrder?.pickupStatus}`,
      )
    }

    // ── (15) API-09：渠道出码抛错 → 尝试 failed、订单回 unpaid、503 ────────
    const qrFailId = await makeOrder(140, 'unpaid')
    const qrFailSession = await paymentSessionFor(qrFailId)
    const originalCreateQr = provider.createQrPayment.bind(provider)
    provider.createQrPayment = async () => {
      throw new Error('channel 5xx')
    }
    try {
      let qrFailCode = 'RESOLVED'
      try {
        await payment.createPayAttempt(qrFailId, qrFailSession)
      } catch (error) {
        qrFailCode = errorCode(error)
      }
      const qrFailOrder = await prisma.order.findUnique({ where: { id: qrFailId } })
      const qrFailAttempt = await prisma.paymentAttempt.findFirst({
        where: { orderId: qrFailId },
        orderBy: { createdAt: 'desc' },
      })
      if (
        qrFailCode.includes('PAY_CHANNEL_UNAVAILABLE') &&
        qrFailOrder?.payStatus === 'unpaid' &&
        qrFailAttempt?.status === 'failed'
      ) {
        pass('channel QR throw marks attempt failed, order unpaid, and returns PAY_CHANNEL_UNAVAILABLE')
      } else {
        fail(
          `QR throw mismatch: code=${qrFailCode} pay=${qrFailOrder?.payStatus} attempt=${qrFailAttempt?.status}`,
        )
      }
    } finally {
      provider.createQrPayment = originalCreateQr
    }

    // ── (16) 渠道已受理、本地回填失败：不得第二笔扣款，对账/Admin/回调必须看见 ─
    const recon = new ReconciliationService(prisma)
    const adminOrders = new AdminOrdersReadonlyService(prisma)
    const attemptDelegate = prisma.paymentAttempt as unknown as {
      update: (...args: unknown[]) => Promise<unknown>
      updateMany: (...args: unknown[]) => Promise<unknown>
    }
    const originalAttemptUpdate = attemptDelegate.update.bind(attemptDelegate)
    const originalAttemptUpdateMany = attemptDelegate.updateMany.bind(attemptDelegate)

    const finalizeUnconfirmedId = await makeOrder(160, 'unpaid')
    const finalizeUnconfirmedSession = await paymentSessionFor(finalizeUnconfirmedId)
    let issuedQr: { prepayId: string; qrCodeContent: string } | null = null
    let qrCreateCalls = 0
    const originalCreateQrForUnconfirmed = provider.createQrPayment.bind(provider)
    provider.createQrPayment = async (input) => {
      qrCreateCalls += 1
      issuedQr = await originalCreateQrForUnconfirmed(input)
      return issuedQr
    }
    attemptDelegate.update = async (...args: unknown[]) => {
      const data = (args[0] as { data?: { qrCodeContent?: string; status?: string } } | undefined)?.data
      if (data?.qrCodeContent && data.status === 'pending') {
        throw new Error('VERIFY_FORCED_FINALIZE_FAILURE')
      }
      return originalAttemptUpdate(...args)
    }
    attemptDelegate.updateMany = async (...args: unknown[]) => {
      const data = (args[0] as { data?: { prepayId?: string; qrCodeContent?: string } } | undefined)?.data
      if (data?.prepayId || data?.qrCodeContent) {
        throw new Error('VERIFY_FORCED_IDENTIFIER_WRITE_FAILURE')
      }
      return originalAttemptUpdateMany(...args)
    }
    try {
      let unconfirmedCode = 'RESOLVED'
      try {
        await payment.createPayAttempt(finalizeUnconfirmedId, finalizeUnconfirmedSession)
      } catch (error) {
        unconfirmedCode = errorCode(error)
      }
      const unconfirmedOrder = await prisma.order.findUnique({ where: { id: finalizeUnconfirmedId } })
      const unconfirmedAttempt = await prisma.paymentAttempt.findFirst({
        where: { orderId: finalizeUnconfirmedId },
        orderBy: { createdAt: 'desc' },
      })
      if (
        unconfirmedCode.includes('PAY_CHANNEL_ACCEPTANCE_UNCONFIRMED') &&
        unconfirmedOrder?.payStatus === 'paying' &&
        unconfirmedAttempt &&
        unconfirmedAttempt.status !== 'failed' &&
        unconfirmedAttempt.status !== 'success' &&
        (unconfirmedAttempt.failReason === CHANNEL_ACCEPTED_UNCONFIRMED_REASON
          || (!unconfirmedAttempt.prepayId && !unconfirmedAttempt.qrCodeContent && !unconfirmedAttempt.channelTxnNo))
      ) {
        pass('QR channel success + local finalize failure keeps paying and a durable unconfirmed signal')
      } else {
        fail(
          `unconfirmed QR mismatch: code=${unconfirmedCode} pay=${unconfirmedOrder?.payStatus} attempt=${JSON.stringify(unconfirmedAttempt)}`,
        )
      }
      const attemptsBeforeRetry = await prisma.paymentAttempt.count({ where: { orderId: finalizeUnconfirmedId } })
      await expectCode(
        'unconfirmed QR blocks a second channel create (PAYMENT_ATTEMPT_PENDING)',
        'PAYMENT_ATTEMPT_PENDING',
        () => payment.createPayAttempt(finalizeUnconfirmedId, finalizeUnconfirmedSession),
      )
      const attemptsAfterRetry = await prisma.paymentAttempt.count({ where: { orderId: finalizeUnconfirmedId } })
      if (attemptsBeforeRetry === 1 && attemptsAfterRetry === 1 && qrCreateCalls === 1) {
        pass('retry after unconfirmed finalize does not create a second PaymentAttempt or call the provider again')
      } else {
        fail(`second attempt/provider: before=${attemptsBeforeRetry} after=${attemptsAfterRetry} qrCalls=${qrCreateCalls}`)
      }

      const reconReport = await recon.report({ nowMs: Date.now() })
      const unconfirmedHit = reconReport.attention.unconfirmedCollections.some(
        (row) => row.orderId === finalizeUnconfirmedId && row.code === CHANNEL_ACCEPTED_UNCONFIRMED_REASON,
      )
      if (unconfirmedHit && reconReport.summary.unconfirmedCollectionCount >= 1) {
        pass('reconciliation attention lists CHANNEL_ACCEPTED_UNCONFIRMED (not paid)')
      } else {
        fail(`recon missed unconfirmed collection: ${JSON.stringify(reconReport.attention.unconfirmedCollections)}`)
      }
      const adminHit = (await adminOrders.list({
        opsAttention: true,
        search: unconfirmedOrder?.orderNo,
        page: 1,
        pageSize: 10,
      })).items[0]
      if (
        adminHit?.id === finalizeUnconfirmedId &&
        adminHit.opsAttention === true &&
        adminHit.opsAttentionCode === 'channel_accepted_unconfirmed' &&
        adminHit.payStatus === 'paying' &&
        adminHit.refundRequired === false
      ) {
        pass('admin opsAttention lists channel-accepted-unconfirmed without faking paid/refund')
      } else {
        fail(`admin missed unconfirmed: ${JSON.stringify(adminHit)}`)
      }

      attemptDelegate.update = originalAttemptUpdate
      attemptDelegate.updateMany = originalAttemptUpdateMany

      if (!issuedQr) fail('provider createQrPayment did not return identifiers')
      const cbBadAmount = buildCallback({
        payload: {
          channel: CHANNEL,
          attemptId: unconfirmedAttempt!.id,
          prepayId: issuedQr.prepayId,
          orderId: finalizeUnconfirmedId,
          amountCents: 1,
          result: 'success',
          channelTxnNo: `sbx_txn_${suffix}_badamt`,
        },
      })
      await expectCode(
        'signed callback with wrong amount is rejected before binding prepayId (CALLBACK_AMOUNT_MISMATCH)',
        'CALLBACK_AMOUNT_MISMATCH',
        () => payment.processCallback(CHANNEL, cbBadAmount.rawBody, cbBadAmount.headers),
      )
      const afterBadAmount = await prisma.paymentAttempt.findUnique({ where: { id: unconfirmedAttempt!.id } })
      if (afterBadAmount?.prepayId || afterBadAmount?.channelTxnNo) {
        fail(`amount-mismatch callback must not bind identifiers: ${JSON.stringify(afterBadAmount)}`)
      } else {
        pass('amount-mismatch signed callback does not persist prepayId/channelTxnNo')
      }
      const cbUnconfirmed = buildCallback({
        payload: {
          channel: CHANNEL,
          attemptId: unconfirmedAttempt!.id,
          prepayId: issuedQr.prepayId,
          orderId: finalizeUnconfirmedId,
          amountCents: 160,
          result: 'success',
          channelTxnNo: `sbx_txn_${suffix}_unconfirmed`,
        },
      })
      let resUnconfirmed: { ok: true; idempotent?: boolean }
      try {
        resUnconfirmed = await payment.processCallback(CHANNEL, cbUnconfirmed.rawBody, cbUnconfirmed.headers)
      } catch (error) {
        fail(`unconfirmed signed callback threw: ${errorCode(error)} ${(error as Error).message}`)
      }
      const paidUnconfirmed = await prisma.order.findUnique({ where: { id: finalizeUnconfirmedId } })
      if (resUnconfirmed.ok && paidUnconfirmed?.payStatus === 'paid' && paidUnconfirmed.paymentSource === 'sandbox') {
        pass('signed callback binds merchant order id when local prepayId was missing, then marks paid')
      } else {
        fail(`unconfirmed callback mismatch: ok=${resUnconfirmed.ok} pay=${paidUnconfirmed?.payStatus}`)
      }
    } finally {
      attemptDelegate.update = originalAttemptUpdate
      attemptDelegate.updateMany = originalAttemptUpdateMany
      provider.createQrPayment = originalCreateQrForUnconfirmed
    }

    const codePayUnconfirmedId = await makeOrder(180, 'unpaid')
    const codePayUnconfirmedSession = await paymentSessionFor(codePayUnconfirmedId)
    let codePayCalls = 0
    const originalCreateCode = provider.createCodePayment!.bind(provider)
    provider.createCodePayment = async (input) => {
      codePayCalls += 1
      return originalCreateCode(input)
    }
    attemptDelegate.update = async (...args: unknown[]) => {
      const data = (args[0] as { data?: { prepayId?: string; qrCodeContent?: string; status?: string } } | undefined)?.data
      if (data?.status === 'pending' && data.prepayId && !data.qrCodeContent) {
        throw new Error('VERIFY_FORCED_CODEPAY_FINALIZE_FAILURE')
      }
      return originalAttemptUpdate(...args)
    }
    attemptDelegate.updateMany = async (...args: unknown[]) => {
      const data = (args[0] as { data?: { prepayId?: string; qrCodeContent?: string; status?: string } } | undefined)?.data
      if (data?.prepayId || data?.qrCodeContent) {
        throw new Error('VERIFY_FORCED_CODEPAY_IDENTIFIER_WRITE_FAILURE')
      }
      return originalAttemptUpdateMany(...args)
    }
    try {
      const codePayResult = await payment.createCodePayAttempt(
        codePayUnconfirmedId,
        codePayUnconfirmedSession,
        '123456789012345678',
      )
      const codePayOrder = await prisma.order.findUnique({ where: { id: codePayUnconfirmedId } })
      const codePayAttempt = await prisma.paymentAttempt.findFirst({
        where: { orderId: codePayUnconfirmedId },
        orderBy: { createdAt: 'desc' },
      })
      if (
        (codePayResult.status === 'success' || codePayResult.status === 'paying') &&
        codePayOrder?.payStatus !== 'unpaid' &&
        codePayAttempt &&
        codePayAttempt.status !== 'failed'
      ) {
        pass('code-pay channel success survives local identifier write failure without releasing unpaid')
      } else {
        fail(
          `code-pay unconfirmed mismatch: result=${JSON.stringify(codePayResult)} pay=${codePayOrder?.payStatus} attempt=${JSON.stringify(codePayAttempt)}`,
        )
      }
      const codePayAttempts = await prisma.paymentAttempt.count({ where: { orderId: codePayUnconfirmedId } })
      const retryCode = codePayOrder?.payStatus === 'paid' ? 'ORDER_ALREADY_PAID' : 'PAYMENT_ATTEMPT_PENDING'
      await expectCode(
        `code-pay unconfirmed blocks a second charge (${retryCode})`,
        retryCode,
        () => payment.createCodePayAttempt(codePayUnconfirmedId, codePayUnconfirmedSession, '123456789012345678'),
      )
      const codePayAttemptsAfter = await prisma.paymentAttempt.count({ where: { orderId: codePayUnconfirmedId } })
      if (codePayAttempts === 1 && codePayAttemptsAfter === 1 && codePayCalls === 1) {
        pass('code-pay retry after finalize failure does not create a second attempt or call the provider again')
      } else {
        fail(`code-pay second attempt: before=${codePayAttempts} after=${codePayAttemptsAfter} calls=${codePayCalls}`)
      }
    } finally {
      attemptDelegate.update = originalAttemptUpdate
      attemptDelegate.updateMany = originalAttemptUpdateMany
      provider.createCodePayment = originalCreateCode
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
