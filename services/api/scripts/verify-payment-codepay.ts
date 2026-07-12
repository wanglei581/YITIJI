/** 付款码支付状态机验收：内存夹具，不连接真实渠道或数据库。 */
import { generateKeyPairSync, randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { createPaymentSessionToken } from '../src/payment/payment-session-token'
import { SandboxPaymentProvider } from '../src/payment/providers/sandbox-payment.provider'
import { WechatPayProvider } from '../src/payment/providers/wechat-pay.provider'

const SESSION_SECRET = 'verify-payment-codepay-secret-0123456789'
const AUTH_CODE = '123456789012345678'

type Order = {
  id: string
  orderNo: string
  terminalId: string
  amountCents: number
  printTaskId: string | null
  payStatus: string
  paymentSource: string | null
  paymentChannel: string | null
  expiresAt: Date | null
}

type Attempt = {
  id: string
  orderId: string
  channel: string
  amountCents: number
  status: string
  expiresAt: Date
  prepayId: string | null
  qrCodeContent: string | null
  channelTxnNo: string | null
  failReason: string | null
}

function fail(message: string): never {
  throw new Error(`VERIFY_FAILED: ${message}`)
}

function pass(message: string): void {
  console.log(`PASS: ${message}`)
}

async function expectCode(label: string, code: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
    fail(`${label}: expected ${code}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(code)) fail(`${label}: expected ${code}, got ${message}`)
    pass(label)
  }
}

function createFixture(provider = new SandboxPaymentProvider(SESSION_SECRET)): {
  payment: OnlinePaymentService
  makeOrder: (amountCents: number) => { order: Order; token: string }
  attempts: Map<string, Attempt>
  audits: Array<Record<string, unknown>>
  findManyCalls: Array<Record<string, unknown>>
} {
  const orders = new Map<string, Order>()
  const attempts = new Map<string, Attempt>()
  const audits: Array<Record<string, unknown>> = []
  const findManyCalls: Array<Record<string, unknown>> = []

  const prisma = {
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => orders.get(where.id) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; payStatus?: string | { in: string[] } }; data: Partial<Order> }) => {
        const order = orders.get(where.id)
        if (!order) return { count: 0 }
        const expected = where.payStatus
        const allowed =
          expected === undefined ||
          (typeof expected === 'string' ? order.payStatus === expected : expected.in.includes(order.payStatus))
        if (!allowed) return { count: 0 }
        Object.assign(order, data)
        return { count: 1 }
      },
    },
    paymentAttempt: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const candidates = [...attempts.values()].filter((attempt) => {
          if (typeof where['orderId'] === 'string' && attempt.orderId !== where['orderId']) return false
          if (typeof where['channel'] === 'string' && attempt.channel !== where['channel']) return false
          if (typeof where['channelTxnNo'] === 'string' && attempt.channelTxnNo !== where['channelTxnNo']) return false
          const status = where['status'] as { in?: string[] } | string | undefined
          if (typeof status === 'string' && attempt.status !== status) return false
          if (status && typeof status !== 'string' && status.in && !status.in.includes(attempt.status)) return false
          return true
        })
        return candidates.at(-1) ?? null
      },
      create: async ({ data }: { data: Omit<Attempt, 'id' | 'prepayId' | 'qrCodeContent' | 'channelTxnNo' | 'failReason'> }) => {
        const attempt: Attempt = {
          ...data,
          id: `pa_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          prepayId: null,
          qrCodeContent: null,
          channelTxnNo: null,
          failReason: null,
        }
        attempts.set(attempt.id, attempt)
        return attempt
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Attempt> }) => {
        const attempt = attempts.get(where.id)
        if (!attempt) throw new Error('attempt missing')
        Object.assign(attempt, data)
        return attempt
      },
      updateMany: async ({ where, data }: { where: { id?: string }; data: Partial<Attempt> }) => {
        const attempt = where.id ? attempts.get(where.id) : undefined
        if (!attempt) return { count: 0 }
        Object.assign(attempt, data)
        return { count: 1 }
      },
      findUnique: async ({ where }: { where: { id: string } }) => attempts.get(where.id) ?? null,
      findMany: async ({ where, take, ...rest }: { where: Record<string, unknown>; take?: number; [key: string]: unknown }) => {
        findManyCalls.push({ where, take, ...rest })
        const status = where['status'] as { in?: string[] } | undefined
        return [...attempts.values()]
          .filter((attempt) => {
            if (status?.in && !status.in.includes(attempt.status)) return false
            if (where['qrCodeContent'] === null && attempt.qrCodeContent !== null) return false
            if (where['prepayId']?.['not'] === null && attempt.prepayId === null) return false
            if (where['channel']?.['not'] === 'sandbox' && attempt.channel === 'sandbox') return false
            return true
          })
          .slice(0, take)
          .map((attempt) => ({ orderId: attempt.orderId }))
      },
      count: async ({ where }: { where: Record<string, unknown> }) => {
        return [...attempts.values()].filter((attempt) => {
          if (typeof where['orderId'] === 'string' && attempt.orderId !== where['orderId']) return false
          const status = where['status'] as { in?: string[] } | string | undefined
          if (typeof status === 'string' && attempt.status !== status) return false
          if (status && typeof status !== 'string' && status.in && !status.in.includes(attempt.status)) return false
          const expiresAt = where['expiresAt'] as { gt?: Date } | undefined
          if (expiresAt?.gt && attempt.expiresAt <= expiresAt.gt) return false
          const id = where['id'] as { not?: string } | string | undefined
          if (typeof id === 'string' && attempt.id !== id) return false
          if (id && typeof id !== 'string' && id.not && attempt.id === id.not) return false
          return true
        }).length
      },
    },
  }
  const transactionalPrisma = {
    ...prisma,
    $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> => fn(prisma),
  }
  const audit = { write: async (entry: Record<string, unknown>) => void audits.push(entry) }
  const orderStatus = {
    markPaidOnline: async (orderId: string, input: { channel: string; channelTxnNo: string }) => {
      const order = orders.get(orderId)
      if (!order) throw new Error('order missing')
      order.payStatus = 'paid'
      order.paymentSource = input.channel
      order.paymentChannel = input.channel
    },
  }
  const payment = new OnlinePaymentService(
    transactionalPrisma as never,
    audit as never,
    orderStatus as never,
    new PaymentProviderRegistry([provider]),
  )
  const makeOrder = (amountCents: number) => {
    const order: Order = {
      id: `ord_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      orderNo: `ORD-CODEPAY-${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      terminalId: 'terminal-codepay-verify',
      amountCents,
      printTaskId: null,
      payStatus: 'unpaid',
      paymentSource: null,
      paymentChannel: null,
      expiresAt: null,
    }
    orders.set(order.id, order)
    return {
      order,
      token: createPaymentSessionToken({
        orderId: order.id,
        orderNo: order.orderNo,
        terminalId: order.terminalId,
        amountCents: order.amountCents,
        printTaskId: order.printTaskId,
      }),
    }
  }
  return { payment, makeOrder, attempts, audits, findManyCalls }
}

async function verifyWechatProvider(): Promise<void> {
  const merchantKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  let calls = 0
  let body: Record<string, unknown> | null = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_url, init) => {
    calls += 1
    body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        trade_state: 'SUCCESS',
        transaction_id: '42000000000000000000000000000001',
        amount: { total: 100, currency: 'CNY' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  try {
    const config = {
      mchid: '1900000001',
      appid: 'wx0000000000000001',
      mchSerialNo: 'MCH_SERIAL_VERIFY_0001',
      privateKeyPem: merchantKeys.privateKey,
      apiV3Key: '12345678901234567890123456789012',
      platformPublicKeyPem: merchantKeys.publicKey,
      platformPublicKeyId: 'PUB_KEY_ID_VERIFY_0001',
      notifyBaseUrl: 'https://kiosk-pay.verify.test',
      apiBaseUrl: 'https://wechat-gateway.verify.test',
      codePayStoreOutId: 'KIOSK001',
    }
    const wechat = new WechatPayProvider(config)
    const result = await wechat.createCodePayment({
      orderId: 'order-codepay-verify',
      orderNo: 'ORD-CODEPAY-VERIFY',
      attemptId: 'attempt-codepay-verify',
      terminalId: 'terminal-codepay-verify',
      amountCents: 100,
      authCode: AUTH_CODE,
    })
    const scene = body?.['scene_info'] as { device_id?: string; store_info?: { out_id?: string } } | undefined
    const payer = body?.['payer'] as { auth_code?: string } | undefined
    if (
      result.status === 'success' &&
      result.amountCents === 100 &&
      calls === 1 &&
      payer?.auth_code === AUTH_CODE &&
      scene?.device_id === 'terminal-codepay-verify' &&
      scene.store_info?.out_id === 'KIOSK001'
    ) {
      pass('wechat codepay sends required terminal/store scene information and verifies returned amount')
    } else {
      fail('wechat codepay request or response mapping mismatch')
    }

    const unconfigured = new WechatPayProvider({ ...config, codePayStoreOutId: undefined })
    const rejected = await unconfigured.createCodePayment({
      orderId: 'order-codepay-verify-2',
      orderNo: 'ORD-CODEPAY-VERIFY-2',
      attemptId: 'attempt-codepay-verify-2',
      terminalId: 'terminal-codepay-verify',
      amountCents: 100,
      authCode: AUTH_CODE,
    })
    if (rejected.status === 'failed' && calls === 1) pass('wechat codepay refuses missing store configuration before a channel request')
    else fail('wechat codepay attempted a request without store configuration')

    const priorNodeEnv = process.env['NODE_ENV']
    const priorAutoConverge = process.env['PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED']
    process.env['NODE_ENV'] = 'production'
    delete process.env['PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED']
    try {
      const productionRejected = await wechat.createCodePayment({
        orderId: 'order-codepay-verify-3',
        orderNo: 'ORD-CODEPAY-VERIFY-3',
        attemptId: 'attempt-codepay-verify-3',
        terminalId: 'terminal-codepay-verify',
        amountCents: 100,
        authCode: AUTH_CODE,
      })
      if (productionRejected.status === 'failed' && calls === 1) {
        pass('production codepay refuses to charge until automatic convergence is explicitly enabled')
      } else {
        fail('production codepay attempted a request without automatic convergence')
      }
    } finally {
      if (priorNodeEnv === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = priorNodeEnv
      if (priorAutoConverge === undefined) delete process.env['PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED']
      else process.env['PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED'] = priorAutoConverge
    }
  } finally {
    globalThis.fetch = originalFetch
  }
}

function verifyKioskContract(): void {
  const repoRoot = resolve(__dirname, '../../..')
  const controller = readFileSync(join(repoRoot, 'services/api/src/payment/payment.controller.ts'), 'utf8')
  const paymentApi = readFileSync(join(repoRoot, 'apps/kiosk/src/services/print/paymentApi.ts'), 'utf8')
  const cashier = readFileSync(join(repoRoot, 'apps/kiosk/src/pages/print/PrintCashierPage.tsx'), 'utf8')
  const panel = readFileSync(join(repoRoot, 'apps/kiosk/src/pages/print/CashierPaymentPanel.tsx'), 'utf8')
  const convergenceTask = readFileSync(join(repoRoot, 'services/api/src/payment/code-payment-convergence.task.ts'), 'utf8')
  const paymentModule = readFileSync(join(repoRoot, 'services/api/src/payment/payment.module.ts'), 'utf8')
  const paymentService = readFileSync(join(repoRoot, 'services/api/src/payment/online-payment.service.ts'), 'utf8')
  if (
    /@Post\('orders\/:id\/code-pay'\)/.test(controller) &&
    /createCodePayAttempt/.test(paymentApi) &&
    /x-payment-session-token/.test(paymentApi)
  ) {
    pass('Kiosk payment-code API uses the existing session-token authorization contract')
  } else {
    fail('Kiosk payment-code API contract missing')
  }
  if (
    /屏上收款码/.test(cashier) &&
    /扫付款码/.test(cashier) &&
    /CODE_PAY_RECONCILE_INTERVAL_MS/.test(cashier) &&
    /onSubmitCode\(\)/.test(panel) &&
    /maxLength=\{18\}/.test(panel)
  ) {
    pass('cashier exposes mutually exclusive QR/code-pay controls, auto-reconciles USERPAYING, and submits scanner Enter through a form')
  } else {
    fail('cashier code-pay controls missing')
  }
  if (
    /PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED/.test(convergenceTask) &&
    /CronExpression\.EVERY_MINUTE/.test(convergenceTask) &&
    /convergeStaleCodePayments/.test(convergenceTask) &&
    /CodePaymentConvergenceTask/.test(paymentModule)
  ) {
    pass('server-side code-payment convergence task is env-gated and registered in the payment module')
  } else {
    fail('server-side code-payment convergence task missing')
  }
  const reservationTransactions = paymentService.match(
    /this\.prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?tx\.order\.updateMany\([\s\S]*?tx\.paymentAttempt\.create\(/g,
  ) ?? []
  if (reservationTransactions.length >= 2) {
    pass('QR and code-payment reserve Order and create PaymentAttempt in one transaction, leaving no empty paying window')
  } else {
    fail('payment reservation must atomically create the PaymentAttempt with the Order paying CAS')
  }
}

async function main(): Promise<void> {
  console.log('\n=== payment codepay verification ===')
  const priorSecret = process.env['PAYMENT_SESSION_SECRET']
  process.env['PAYMENT_SESSION_SECRET'] = SESSION_SECRET
  try {
    const { payment, makeOrder, attempts, audits } = createFixture()
    const valid = makeOrder(100)
    await expectCode('missing payment session is rejected', 'PAYMENT_SESSION_REQUIRED', () =>
      payment.createCodePayAttempt(valid.order.id, undefined, AUTH_CODE),
    )
    await expectCode('invalid auth code is rejected before provider call', 'AUTH_CODE_INVALID', () =>
      payment.createCodePayAttempt(valid.order.id, valid.token, 'not-a-payment-code'),
    )
    const other = makeOrder(200)
    await expectCode('payment session cannot be reused for another order', 'PAYMENT_SESSION_MISMATCH', () =>
      payment.createCodePayAttempt(other.order.id, valid.token, AUTH_CODE),
    )

    const result = await payment.createCodePayAttempt(valid.order.id, valid.token, AUTH_CODE)
    const attempt = attempts.get(result.attemptId)
    if (
      result.status === 'success' &&
      valid.order.payStatus === 'paid' &&
      valid.order.paymentSource === 'sandbox' &&
      attempt?.status === 'success' &&
      attempt.channelTxnNo
    ) {
      pass('18-digit sandbox payment code marks the order paid through the normal online-payment state path')
    } else {
      fail(`sandbox codepay result mismatch: ${JSON.stringify({ result, order: valid.order, attempt })}`)
    }

    const persisted = JSON.stringify([...attempts.values()])
    const auditPayloads = JSON.stringify(audits)
    if (!persisted.includes(AUTH_CODE) && !auditPayloads.includes(AUTH_CODE)) {
      pass('payment code is neither persisted on PaymentAttempt nor written to audit payloads')
    } else {
      fail('payment code leaked into persistence or audit records')
    }

    const concurrent = makeOrder(100)
    const concurrentResults = await Promise.allSettled([
      payment.createCodePayAttempt(concurrent.order.id, concurrent.token, AUTH_CODE),
      payment.createCodePayAttempt(concurrent.order.id, concurrent.token, '223456789012345678'),
    ])
    const fulfilled = concurrentResults.filter((entry): entry is PromiseFulfilledResult<{ attemptId: string }> => entry.status === 'fulfilled')
    const concurrentAttempts = [...attempts.values()].filter((entry) => entry.orderId === concurrent.order.id)
    if (fulfilled.length === 1 && concurrentAttempts.length === 1) {
      pass('concurrent code-payment submissions reserve one order and create at most one payable attempt')
    } else {
      fail(`concurrent code-payment submissions created multiple payable attempts: ${JSON.stringify(concurrentResults)}`)
    }

    let releaseCodeProvider: (() => void) | undefined
    let enteredCodeProvider: (() => void) | undefined
    const codeProviderEntered = new Promise<void>((resolve) => { enteredCodeProvider = resolve })
    const codeProviderRelease = new Promise<void>((resolve) => { releaseCodeProvider = resolve })
    class GatedCodePaymentSandboxProvider extends SandboxPaymentProvider {
      override async createCodePayment(input: Parameters<SandboxPaymentProvider['createCodePayment']>[0]) {
        enteredCodeProvider?.()
        await codeProviderRelease
        return super.createCodePayment(input)
      }
    }
    const reservationFixture = createFixture(new GatedCodePaymentSandboxProvider(SESSION_SECRET))
    const reservationOrder = reservationFixture.makeOrder(100)
    const reservationAttempt = reservationFixture.payment.createCodePayAttempt(
      reservationOrder.order.id,
      reservationOrder.token,
      AUTH_CODE,
    )
    try {
      await codeProviderEntered
      const createdAttempts = [...reservationFixture.attempts.values()]
        .filter((entry) => entry.orderId === reservationOrder.order.id)
      await expectCode('second code-payment request during Provider gate remains blocked without releasing the reservation', 'PAYMENT_ATTEMPT_PENDING', () =>
        reservationFixture.payment.createCodePayAttempt(reservationOrder.order.id, reservationOrder.token, '223456789012345678'),
      )
      if (reservationOrder.order.payStatus === 'paying' && createdAttempts.length === 1 && createdAttempts[0]?.status === 'created') {
        pass('code-payment reserves order as paying before provider processing, so other settlement paths cannot consume it')
      } else {
        fail(`code-payment did not reserve before provider processing: ${JSON.stringify({ order: reservationOrder.order, createdAttempts })}`)
      }
    } finally {
      releaseCodeProvider?.()
      await reservationAttempt
    }

    const active = makeOrder(100)
    const qrAttempt = await payment.createPayAttempt(active.order.id, active.token, 'sandbox')
    await expectCode('active QR attempt blocks a concurrent code payment', 'PAYMENT_ATTEMPT_PENDING', () =>
      payment.createCodePayAttempt(active.order.id, active.token, AUTH_CODE, 'sandbox'),
    )
    pass('existing QR payment capability remains available on the sandbox provider')

    const expired = attempts.get(qrAttempt.attemptId)
    if (!expired) fail('missing QR attempt fixture')
    expired.status = 'expired'
    await expectCode('expired attempt must be reconciled before another code payment can start', 'PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED', () =>
      payment.createCodePayAttempt(active.order.id, active.token, AUTH_CODE, 'sandbox'),
    )

    class MismatchedAmountSandboxProvider extends SandboxPaymentProvider {
      override async createCodePayment(input: Parameters<SandboxPaymentProvider['createCodePayment']>[0]) {
        const result = await super.createCodePayment(input)
        return result.status === 'success' ? { ...result, amountCents: input.amountCents + 1 } : result
      }
    }
    const mismatchFixture = createFixture(new MismatchedAmountSandboxProvider(SESSION_SECRET))
    const mismatch = mismatchFixture.makeOrder(100)
    const mismatchResult = await mismatchFixture.payment.createCodePayAttempt(mismatch.order.id, mismatch.token, AUTH_CODE)
    const mismatchAttempt = mismatchFixture.attempts.get(mismatchResult.attemptId)
    if (
      mismatchResult.status === 'paying' &&
      mismatch.order.payStatus === 'paying' &&
      mismatchAttempt?.status === 'pending' &&
      mismatchFixture.audits.some((entry) => entry['action'] === 'payment.code_attempt_amount_mismatch')
    ) {
      pass('success response with an amount mismatch remains pending for reconciliation instead of reverting to unpaid')
    } else {
      fail('amount mismatch must remain pending for reconciliation')
    }

    class UnknownResultSandboxProvider extends SandboxPaymentProvider {
      override async createCodePayment(): Promise<never> {
        throw new Error('network timeout')
      }
    }
    const unknownFixture = createFixture(new UnknownResultSandboxProvider(SESSION_SECRET))
    const unknown = unknownFixture.makeOrder(100)
    const unknownResult = await unknownFixture.payment.createCodePayAttempt(unknown.order.id, unknown.token, AUTH_CODE)
    const unknownAttempt = unknownFixture.attempts.get(unknownResult.attemptId)
    if (unknownResult.status === 'paying' && unknown.order.payStatus === 'paying' && unknownAttempt?.status === 'pending') {
      pass('unknown channel result remains pending instead of allowing a second charge')
    } else {
      fail('unknown channel result must remain pending')
    }
    unknownAttempt!.status = 'expired'
    await expectCode('expired code payment blocks QR issuance until reconciliation', 'PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED', () =>
      unknownFixture.payment.createPayAttempt(unknown.order.id, unknown.token, 'sandbox'),
    )

    class ClosedCodePaySandboxProvider extends SandboxPaymentProvider {
      override async createCodePayment(input: Parameters<SandboxPaymentProvider['createCodePayment']>[0]) {
        return { status: 'paying' as const, channelTxnNo: null, prepayId: input.attemptId, amountCents: null, failReason: null }
      }

      override async queryPayment() {
        return { status: 'closed' as const, channelTxnNo: null, amountCents: null }
      }
    }
    class ClosedCodePayWechatProvider extends ClosedCodePaySandboxProvider {
      override readonly channel = 'wechat' as const
    }
    const closedFixture = createFixture(new ClosedCodePaySandboxProvider(SESSION_SECRET))
    const closed = closedFixture.makeOrder(100)
    const closedCreated = await closedFixture.payment.createCodePayAttempt(closed.order.id, closed.token, AUTH_CODE)
    const closedStatus = await closedFixture.payment.reconcilePayment(closed.order.id, closed.token)
    const closedAttempt = closedFixture.attempts.get(closedCreated.attemptId)
    if (closedStatus.payStatus === 'unpaid' && closedAttempt?.status === 'failed') {
      pass('terminal channel non-payment releases a pending code-payment attempt for a new scan')
    } else {
      fail('terminal channel non-payment must release the code-payment attempt')
    }

    const cronFixture = createFixture(new ClosedCodePayWechatProvider(SESSION_SECRET))
    const cronOrder = cronFixture.makeOrder(100)
    const cronCreated = await cronFixture.payment.createCodePayAttempt(cronOrder.order.id, cronOrder.token, AUTH_CODE)
    const qrOnlyOrder = cronFixture.makeOrder(100)
    await cronFixture.payment.createPayAttempt(qrOnlyOrder.order.id, qrOnlyOrder.token, 'wechat')
    const cronResult = await cronFixture.payment.convergeStaleCodePayments({ limit: 10 })
    const cronAttempt = cronFixture.attempts.get(cronCreated.attemptId)
    const cronQuery = cronFixture.findManyCalls.at(-1)
    if (
      cronResult.scanned === 1 &&
      cronResult.released === 1 &&
      cronAttempt?.status === 'failed' &&
      cronOrder.order.payStatus === 'unpaid' &&
      cronQuery?.['distinct'] === undefined &&
      JSON.stringify(cronQuery?.['orderBy']) === JSON.stringify({ createdAt: 'asc' })
    ) {
      pass('server-side code-payment convergence releases a terminal non-payment without a Kiosk session')
    } else {
      fail(`code-payment convergence mismatch: ${JSON.stringify({ cronResult, cronOrder: cronOrder.order, cronAttempt })}`)
    }

    class SuccessPersistenceFailureSandboxProvider extends SandboxPaymentProvider {
      override async createCodePayment(input: Parameters<SandboxPaymentProvider['createCodePayment']>[0]) {
        return super.createCodePayment(input)
      }
    }
    const persistenceFixture = createFixture(new SuccessPersistenceFailureSandboxProvider(SESSION_SECRET))
    const persistenceOrder = persistenceFixture.makeOrder(100)
    const originalHandleSuccess = (persistenceFixture.payment as unknown as { handleSuccess: unknown }).handleSuccess
    ;(persistenceFixture.payment as unknown as { handleSuccess: unknown }).handleSuccess = async () => {
      throw new Error('database unavailable after channel success')
    }
    const persistenceResult = await persistenceFixture.payment.createCodePayAttempt(
      persistenceOrder.order.id,
      persistenceOrder.token,
      AUTH_CODE,
    )
    const persistenceAttempt = persistenceFixture.attempts.get(persistenceResult.attemptId)
    if (persistenceResult.status === 'paying' && persistenceOrder.order.payStatus === 'paying' && persistenceAttempt?.status === 'pending') {
      pass('local persistence failure after channel success remains pending for reconciliation')
    } else {
      fail('local persistence failure after channel success must remain pending')
    }
    ;(persistenceFixture.payment as unknown as { handleSuccess: unknown }).handleSuccess = originalHandleSuccess
    await verifyWechatProvider()
    verifyKioskContract()
    console.log('\nAll payment-codepay assertions passed.\n')
  } finally {
    if (priorSecret === undefined) delete process.env['PAYMENT_SESSION_SECRET']
    else process.env['PAYMENT_SESSION_SECRET'] = priorSecret
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
