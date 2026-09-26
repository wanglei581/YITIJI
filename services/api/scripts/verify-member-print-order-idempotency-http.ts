/**
 * POST /me/print-orders Idempotency-Key HTTP 契约：进程内 Nest + 隔离 SQLite。
 * 不连生产。由 verify:miniapp-cloud-print-m2 串行拉起。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  BadRequestException,
  Module,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { EndUserAuthGuard, memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { fingerprintMemberPrintOrderPayload, MemberPrintOrderCreateService } from '../src/member-print-orders/member-print-order-create.service'
import { MemberPrintOrdersController } from '../src/member-print-orders/member-print-orders.controller'
import { PickupCodeReissueService } from '../src/member-print-orders/pickup-code-reissue.service'
import { MemberPrintOrdersService } from '../src/member-print-orders/member-print-orders.service'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'
import { setPrintScanCapabilityModeForTest, TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

const apiRoot = path.resolve(__dirname, '..')
const dbName = `verify-print-order-idem-http-${randomUUID().slice(0, 8)}.db`
const dbPath = path.join('/tmp', dbName)
process.env['DATABASE_URL'] = `file:${dbPath}`
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
process.env['NODE_ENV'] = 'test'
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_SIGNING_SECRET'] = 'verify-file-signing-secret-0123456789abcdef'
process.env['PAYMENT_SESSION_SECRET'] = 'verify-payment-session-secret-0123456789abcdef'
process.env['SECRET_ENCRYPTION_KEY'] = 'verify-secret-encryption-key-0123456789abcdef'
process.env['TERMINAL_ADMIN_SECRET'] = 'verify-terminal-admin-secret-0123456789abcdef'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] = 'verify-terminal-action-token-secret-0123456789abcdef'
process.env['JWT_SECRET'] ||= 'verify-idem-http-jwt-secret-32chars!!'

type Json = Record<string, unknown>
interface HttpResult { status: number; json: Json }

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

function flatten(errors: ValidationError[], parent = ''): string[] {
  const output: string[] = []
  for (const error of errors) {
    const pathLabel = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) {
      output.push(...Object.values(error.constraints).map((message) => `${pathLabel}: ${message}`))
    }
    if (error.children?.length) output.push(...flatten(error.children, pathLabel))
  }
  return output
}

function errorCode(result: HttpResult): string | undefined {
  return (result.json['error'] as { code?: string } | undefined)?.code
}

function errorDetails(result: HttpResult): string[] {
  const details = (result.json['error'] as { details?: unknown } | undefined)?.details
  return Array.isArray(details) ? details.filter((item): item is string => typeof item === 'string') : []
}

function envelopeData<T>(result: HttpResult): T {
  if (result.json['success'] !== true) fail(`期望 success 信封，实际 ${JSON.stringify(result.json)}`)
  return result.json['data'] as T
}

function cleanupDb(): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
}

function prepareDb(): void {
  assertIsolatedVerificationDatabase()
  const migrationsRoot = path.join(apiRoot, 'prisma', 'migrations')
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(migrationsRoot, entry.name, 'migration.sql'))
    .sort()
  for (const migration of migrations) {
    execFileSync('sqlite3', [dbPath], { input: readFileSync(migration), stdio: ['pipe', 'pipe', 'pipe'] })
  }
}

let cloudOrdersRef: MemberPrintOrderCreateService | null = null
let prismaRef: PrismaService | null = null
const sessionStore = new Map<string, string>()
const redisStub = {
  get: async (key: string) => sessionStore.get(key) ?? null,
  unregisterMemberSession: async () => undefined,
  touchMemberSession: async () => 1800,
}

@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'],
      signOptions: { expiresIn: '30m', audience: 'enduser' },
    }),
  ],
  controllers: [MemberPrintOrdersController],
  providers: [
    {
      provide: MemberPrintOrderCreateService,
      useFactory: () => {
        if (!cloudOrdersRef) throw new Error('cloudOrdersRef missing')
        return cloudOrdersRef
      },
    },
    { provide: MemberPrintOrdersService, useValue: { list: async () => ({ items: [], nextCursor: null, total: 0 }) } },
    { provide: PickupCodeReissueService, useValue: { reissue: async () => ({}) } },
    {
      provide: PrismaService,
      useFactory: () => {
        if (!prismaRef) throw new Error('prismaRef missing')
        return prismaRef
      },
    },
    { provide: RedisService, useValue: redisStub },
    EndUserAuthGuard,
  ],
})
class IdempotencyHttpModule {}

async function main(): Promise<void> {
  console.log('\n=== POST /me/print-orders Idempotency-Key HTTP 契约 ===')
  cleanupDb()
  prepareDb()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const capabilities = new TerminalCapabilitiesService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const quote = new OrderQuoteService(pageCount, pricing, capabilities, prisma)
  const cloudOrders = new MemberPrintOrderCreateService(prisma, quote, capabilities, orderStatus, audit)
  cloudOrdersRef = cloudOrders
  prismaRef = prisma
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const userA = `eu_idem_http_${suffix}`
  const terminalId = `terminal_idem_http_${suffix}`
  const fileA = `file_idem_http_${suffix}`
  const storageKeys: string[] = []
  const dto = { fileId: fileA, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' }
  const jwt = new JwtService({
    secret: process.env['JWT_SECRET'],
    signOptions: { expiresIn: '30m', audience: 'enduser' },
  })
  const sessionId = randomUUID()
  const accessToken = jwt.sign({ sub: userA }, { jwtid: sessionId, audience: 'enduser' })
  sessionStore.set(memberSessionKey(sessionId), userA)

  const app = await NestFactory.create(IdempotencyHttpModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const details = flatten(errors)
      return new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details },
      })
    },
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  if (!address || typeof address === 'string') fail('无法取得监听地址')
  const base = `http://127.0.0.1:${address.port}/api/v1`

  async function request(init: {
    headers?: Record<string, string>
    body?: unknown
  }): Promise<HttpResult> {
    const response = await fetch(`${base}/me/print-orders`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      body: JSON.stringify(init.body ?? dto),
    })
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Json }
  }

  try {
    setPrintScanCapabilityModeForTest('strict')
    await prisma.endUser.create({ data: { id: userA, phoneHash: `hash-${userA}`, phoneEnc: `enc-${userA}` } })
    await prisma.terminal.create({
      data: {
        id: terminalId, terminalCode: `IDEMH-${suffix}`, agentToken: `token-${terminalId}`,
        deviceFingerprint: `fp-${terminalId}`, displayName: '幂等HTTP终端', locationLabel: '验证点',
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId, status: 'online', localTaskDatabaseAvailable: true, createdAt: new Date() },
    })
    await prisma.terminalCapability.create({
      data: { terminalId, capabilityKey: 'document_print', status: 'available' },
    })
    await seedDevDefaultPriceConfig(prisma)
    const storageKey = `verify/print-idem-http/${fileA}.pdf`
    const pdf = buildRealPdf(2)
    await storage.putObject(storageKey, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    storageKeys.push(storageKey)
    await prisma.fileObject.create({
      data: {
        id: fileA, storageKey, bucket: LOCAL_BUCKET_SENTINEL, region: 'local', filename: 'A简历.pdf',
        mimeType: 'application/pdf', sizeBytes: pdf.length,
        sha256: createHash('sha256').update(pdf).digest('hex'), endUserId: userA, ownerType: 'user', ownerId: userA,
        purpose: 'print_doc', status: 'active', expiresAt: new Date(Date.now() + 30 * 60 * 60 * 1000),
      },
    })
    const task = await prisma.documentProcessTask.create({
      data: {
        kind: 'pii_scan', status: 'completed', requesterMode: 'member', sourceFileId: fileA,
        endUserId: userA, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        paramsJson: JSON.stringify({ sourceSha256: createHash('sha256').update(pdf).digest('hex') }),
      },
    })
    await prisma.piiFinding.create({ data: { taskId: task.id, type: 'phone', label: '手机号', action: 'keep' } })
    pass('隔离库与 HTTP 夹具已建立')

    const missing = await request({})
    if (missing.status !== 400 || errorCode(missing) !== 'IDEMPOTENCY_KEY_REQUIRED') {
      fail(`缺 header 应为 400 IDEMPOTENCY_KEY_REQUIRED，实际 ${JSON.stringify(missing)}`)
    }
    const blank = await request({ headers: { 'idempotency-key': '   ' } })
    if (blank.status !== 400 || errorCode(blank) !== 'IDEMPOTENCY_KEY_REQUIRED') {
      fail(`空白 header 应为 400 IDEMPOTENCY_KEY_REQUIRED，实际 ${JSON.stringify(blank)}`)
    }
    const invalid = await request({ headers: { 'idempotency-key': 'not-a-uuid' } })
    if (invalid.status !== 400 || errorCode(invalid) !== 'IDEMPOTENCY_KEY_INVALID') {
      fail(`非法 header 应为 400 IDEMPOTENCY_KEY_INVALID，实际 ${JSON.stringify(invalid)}`)
    }
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 0) fail('缺/空白/非法 key 不得建单')
    const upperMissing = randomUUID().toUpperCase()
    const upperCreate = await request({ headers: { 'idempotency-key': upperMissing } })
    if (upperCreate.status !== 400 || errorCode(upperCreate) !== 'IDEMPOTENCY_KEY_INVALID') {
      fail(`大写 UUID 应为 400 IDEMPOTENCY_KEY_INVALID，实际 ${JSON.stringify(upperCreate)}`)
    }
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 0) fail('大写 key 不得建单')
    pass('H1 缺/空白/非法 Idempotency-Key → 400，零行 Order')

    const bodyOnlyKey = randomUUID()
    const bodyOnly = await request({ body: { ...dto, idempotencyKey: bodyOnlyKey } })
    if (bodyOnly.status !== 400 || errorCode(bodyOnly) !== 'VALIDATION_FAILED') {
      fail(`body-only key 应为 VALIDATION_FAILED，实际 ${JSON.stringify(bodyOnly)}`)
    }
    if (!errorDetails(bodyOnly).some((line) => line.includes('idempotencyKey'))) {
      fail(`body-only 校验细节必须点名 idempotencyKey: ${JSON.stringify(bodyOnly.json)}`)
    }
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 0) fail('body-only key 不得建单')
    if (await prisma.order.count({ where: { idempotencyKey: bodyOnlyKey } }) !== 0) {
      fail('body 里的 key 不得代替 header')
    }
    pass('H2 body-only idempotencyKey → VALIDATION_FAILED，不能代替 header')

    const mixedKey = randomUUID()
    const created = await request({ headers: { 'Idempotency-Key': mixedKey } })
    if (created.status !== 200 && created.status !== 201) fail(`混合大小写 header 应建单，实际 ${JSON.stringify(created)}`)
    const createdView = envelopeData<{ id: string; pickupCode: string | null }>(created)
    if (!createdView.id || !createdView.pickupCode) fail('建单必须返回 id 与到机码')
    const replayUpper = await request({ headers: { 'IDEMPOTENCY-KEY': mixedKey } })
    const replayLower = await request({ headers: { 'idempotency-key': mixedKey } })
    const upperView = envelopeData<{ id: string; pickupCode: string | null }>(replayUpper)
    const lowerView = envelopeData<{ id: string; pickupCode: string | null }>(replayLower)
    if (upperView.id !== createdView.id || lowerView.id !== createdView.id) fail('混合大小写必须打到同一张单')
    if (upperView.pickupCode !== createdView.pickupCode || lowerView.pickupCode !== createdView.pickupCode) {
      fail('混合大小写回放必须同一到机码')
    }
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 1) fail('混合大小写回放不得第二张单')
    pass('H3 Idempotency-Key / IDEMPOTENCY-KEY / idempotency-key 都到达 controller')

    const lostKey = randomUUID()
    const lost = await request({ headers: { 'idempotency-key': lostKey } })
    const lostView = envelopeData<{ id: string; pickupCode: string | null }>(lost)
    const recovered = await request({ headers: { 'idempotency-key': lostKey } })
    const recoveredView = envelopeData<{ id: string; pickupCode: string | null }>(recovered)
    if (recoveredView.id !== lostView.id || recoveredView.pickupCode !== lostView.pickupCode) {
      fail('响应丢失重试必须回放原单原码')
    }
    if (await prisma.order.count({ where: { idempotencyKey: lostKey } }) !== 1) fail('丢失重试不得新增行')
    pass('H4 同 header/payload 丢响应再 POST → 同一张单')

    const mismatchKey = randomUUID()
    const original = await request({ headers: { 'idempotency-key': mismatchKey } })
    const originalView = envelopeData<{ id: string; pickupCode: string | null }>(original)
    const mismatch = await request({
      headers: { 'idempotency-key': mismatchKey },
      body: { ...dto, copies: 2 },
    })
    if (mismatch.status !== 409 || errorCode(mismatch) !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 不同 payload 应为 409 IDEMPOTENCY_KEY_REUSED，实际 ${JSON.stringify(mismatch)}`)
    }
    const leaked = JSON.stringify(mismatch.json)
    if (originalView.id && leaked.includes(originalView.id)) fail('409 不得泄露 order id')
    if (originalView.pickupCode && leaked.includes(originalView.pickupCode)) fail('409 不得泄露到机码')
    if (await prisma.order.count({ where: { idempotencyKey: mismatchKey } }) !== 1) fail('payload 冲突不得第二张单')
    pass('H5 同 header 不同 payload → 409，不泄露 id/code')

    async function resolveRequest(init: {
      token?: string
      body?: unknown
    }): Promise<HttpResult> {
      const response = await fetch(`${base}/me/print-orders/submissions/resolve`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${init.token ?? accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(init.body ?? { keys: [] }),
      })
      return { status: response.status, json: (await response.json().catch(() => ({}))) as Json }
    }

    const createdKey = mixedKey
    const createdResolve = await resolveRequest({ body: { keys: [createdKey] } })
    if (createdResolve.status !== 200) fail(`已建单 resolve 应为 200，实际 ${JSON.stringify(createdResolve)}`)
    const createdItems = envelopeData<{ items: Array<{ key: string; outcome: string; orderId?: string; orderKind?: string }> }>(createdResolve).items
    if (createdItems[0]?.outcome !== 'created' || createdItems[0].orderId !== createdView.id || createdItems[0].orderKind !== 'print') {
      fail(`已建单 resolve 必须 created/print，实际 ${JSON.stringify(createdResolve.json)}`)
    }
    pass('H6 resolve 已建单 → created + orderKind=print')

    const tombHttpKey = randomUUID()
    const tombHttp = await resolveRequest({ body: { keys: [tombHttpKey] } })
    const tombItems = envelopeData<{ items: Array<{ outcome: string; orderId?: string }> }>(tombHttp).items
    if (tombHttp.status !== 200 || tombItems[0]?.outcome !== 'not_created' || tombItems[0].orderId) {
      fail(`未知 key resolve 必须 not_created，实际 ${JSON.stringify(tombHttp)}`)
    }
    const lateHttp = await request({ headers: { 'idempotency-key': tombHttpKey } })
    if (lateHttp.status !== 409 || errorCode(lateHttp) !== 'IDEMPOTENCY_KEY_ABANDONED') {
      fail(`墓碑后 POST 必须 409 ABANDONED，实际 ${JSON.stringify(lateHttp)}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: tombHttpKey } }) !== 0) fail('HTTP 墓碑后不得建单')
    pass('H7 resolve 墓碑后迟到 POST → 409 ABANDONED')

    const procHttpKey = randomUUID()
    await prisma.orderSubmissionLedger.create({
      data: {
        endUserId: userA,
        idempotencyKey: procHttpKey,
        orderKind: 'print',
        payloadHash: fingerprintMemberPrintOrderPayload(dto),
        status: 'processing',
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    })
    const procHttp = await request({ headers: { 'idempotency-key': procHttpKey } })
    if (procHttp.status !== 409 || errorCode(procHttp) !== 'IDEMPOTENCY_IN_PROGRESS') {
      fail(`活租约 POST 必须 409 IN_PROGRESS，实际 ${JSON.stringify(procHttp)}`)
    }
    const procResolveHttp = await resolveRequest({ body: { keys: [procHttpKey] } })
    const procItems = envelopeData<{ items: Array<{ outcome: string }> }>(procResolveHttp).items
    if (procItems[0]?.outcome !== 'processing') fail(`活租约 resolve 必须 processing，实际 ${JSON.stringify(procResolveHttp)}`)
    const procLedger = await prisma.orderSubmissionLedger.findFirst({ where: { endUserId: userA, idempotencyKey: procHttpKey } })
    if (!procLedger || procLedger.status !== 'processing') fail('活租约 resolve 不得把 processing 清成 abandoned')
    pass('H8 活租约 POST IN_PROGRESS，resolve=processing 且不清键')

    const priceLiveKey = randomUUID()
    await prisma.orderSubmissionLedger.create({
      data: {
        endUserId: userA,
        idempotencyKey: priceLiveKey,
        orderKind: 'print',
        payloadHash: fingerprintMemberPrintOrderPayload(dto),
        status: 'processing',
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    })
    const priceLive = await request({
      headers: { 'idempotency-key': priceLiveKey },
      body: { ...dto, quotedAmountCents: 1 },
    })
    const priceLiveLedger = await prisma.orderSubmissionLedger.findFirst({ where: { endUserId: userA, idempotencyKey: priceLiveKey } })
    if (priceLive.status !== 409 || errorCode(priceLive) !== 'IDEMPOTENCY_IN_PROGRESS' || errorCode(priceLive) === 'PRICE_CHANGED') {
      fail(`活租约即使报价不一致也必须 IN_PROGRESS，实际 ${JSON.stringify(priceLive)}`)
    }
    if (!priceLiveLedger || priceLiveLedger.status !== 'processing') fail('价格拒绝不得改写别人的活租约')
    if (await prisma.order.count({ where: { idempotencyKey: priceLiveKey } }) !== 0) fail('活租约不得建单')
    pass('H10 活租约优先于报价比对：IN_PROGRESS，不是 PRICE_CHANGED')

    const priceAbandonedKey = randomUUID()
    await prisma.orderSubmissionLedger.create({
      data: {
        endUserId: userA,
        idempotencyKey: priceAbandonedKey,
        orderKind: 'print',
        payloadHash: fingerprintMemberPrintOrderPayload(dto),
        status: 'abandoned',
      },
    })
    const priceAbandoned = await request({
      headers: { 'idempotency-key': priceAbandonedKey },
      body: { ...dto, quotedAmountCents: 1 },
    })
    if (priceAbandoned.status !== 409 || errorCode(priceAbandoned) !== 'IDEMPOTENCY_KEY_ABANDONED') {
      fail(`已废弃键即使报价不一致也必须 ABANDONED，实际 ${JSON.stringify(priceAbandoned)}`)
    }
    pass('H11 废弃键优先于报价比对')

    async function priceFootprint(): Promise<string> {
      const [orders, items, tasks, attempts, audits, ledgers] = await Promise.all([
        prisma.order.count(),
        prisma.orderItem.count(),
        prisma.printTask.count(),
        prisma.paymentAttempt.count(),
        prisma.auditLog.count({ where: { action: 'member.print_order.create' } }),
        prisma.orderSubmissionLedger.count(),
      ])
      return JSON.stringify({ orders, items, tasks, attempts, audits, ledgers })
    }
    const setBw = (unitCents: number) => prisma.priceConfig.update({ where: { serviceKey: 'print_bw_page' }, data: { unitCents } })
    const seedBw = await prisma.priceConfig.findUniqueOrThrow({ where: { serviceKey: 'print_bw_page' } })
    if (seedBw.unitCents !== 20) fail(`夹具黑白单价应为 20 分，实际 ${seedBw.unitCents}`)
    const memberLine = (unitCents: number) => `line=print_bw_page:${unitCents}:2:${unitCents * 2}`
    function assertPriceDetails(result: HttpResult, current: number, unitCents: number): void {
      const raw = (result.json['error'] as { details?: unknown } | undefined)?.details
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
        fail(`PRICE_CHANGED details 必须是 string[]，实际 ${JSON.stringify(result.json)}`)
      }
      const details = raw as string[]
      const body = JSON.stringify(result.json)
      if (
        result.status !== 409 || result.json['success'] !== false || errorCode(result) !== 'PRICE_CHANGED'
        || !details.includes(`currentAmountCents=${current}`) || !details.includes('billablePages=2')
        || !details.includes(memberLine(unitCents)) || body.includes('paymentSessionToken') || body.includes('更换标识')
      ) {
        fail(`期望 409 PRICE_CHANGED current=${current}，实际 ${body}`)
      }
    }
    async function expectMemberPriceChanged(label: string, quotedAmountCents: number, current: number, unitCents: number): Promise<void> {
      const before = await priceFootprint()
      const key = randomUUID()
      const result = await request({ headers: { 'idempotency-key': key }, body: { ...dto, quotedAmountCents } })
      assertPriceDetails(result, current, unitCents)
      if (await priceFootprint() !== before) fail(`${label} 产生了建单副作用`)
      if (await prisma.orderSubmissionLedger.findFirst({ where: { endUserId: userA, idempotencyKey: key } })) {
        fail(`${label} 必须释放临时租约，不能墓碑`)
      }
      pass(label)
    }

    await expectMemberPriceChanged('H12 0→付费：确认 0、现价 40 分 → 409，零订单/支付令牌/审计', 0, 40, 20)
    const reuseKey = randomUUID()
    const reuseReject = await request({ headers: { 'idempotency-key': reuseKey }, body: { ...dto, quotedAmountCents: 0 } })
    assertPriceDetails(reuseReject, 40, 20)
    const reuseOk = await request({ headers: { 'idempotency-key': reuseKey }, body: { ...dto, quotedAmountCents: 40 } })
    const reuseView = envelopeData<{ id: string; amountCents: number; payStatus: string }>(reuseOk)
    const reuseRow = await prisma.order.findUnique({ where: { id: reuseView.id } })
    if (reuseView.amountCents !== 40 || reuseView.payStatus !== 'unpaid' || reuseRow?.amountCents !== 40 || reuseRow.payStatus !== 'unpaid') {
      fail(`同一键在 409 后按现价再确认应建成 40 分未支付单，实际 ${JSON.stringify({ reuseView, reuseRow })}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: reuseKey } }) !== 1) fail('409 后的再确认只能有一张单')
    pass('H13 409 释放租约后，原 Idempotency-Key 按现价再确认可以建单')

    await setBw(30)
    await expectMemberPriceChanged('H14 涨价：确认 40、现价 60 → 409', 40, 60, 30)
    await setBw(10)
    await expectMemberPriceChanged('H15 降价：确认 40、现价 20 → 409', 40, 20, 10)
    await setBw(0)
    await expectMemberPriceChanged('H16 付费→0：确认 40、现价 0 → 409，不走免费 markPaid', 40, 0, 0)
    const freeKey = randomUUID()
    const free = await request({ headers: { 'idempotency-key': freeKey }, body: { ...dto, quotedAmountCents: 0 } })
    const freeView = envelopeData<{ id: string; amountCents: number; payStatus: string }>(free)
    const freeRow = await prisma.order.findUnique({ where: { id: freeView.id } })
    if (freeView.amountCents !== 0 || freeView.payStatus !== 'paid' || freeRow?.payStatus !== 'paid' || freeRow.paymentSource !== 'free') {
      fail(`确认 0 且现价 0 必须 paid+free，实际 ${JSON.stringify({ freeView, freeRow })}`)
    }
    const legacyFreeKey = randomUUID()
    const legacyFree = await request({ headers: { 'idempotency-key': legacyFreeKey } })
    const legacyFreeView = envelopeData<{ id: string; amountCents: number; payStatus: string }>(legacyFree)
    const legacyFreeRow = await prisma.order.findUnique({ where: { id: legacyFreeView.id } })
    if (legacyFreeView.amountCents !== 0 || legacyFreeView.payStatus !== 'paid' || legacyFreeRow?.paymentSource !== 'free') {
      fail(`旧客户端在现价 0 时仍应免费建单，实际 ${JSON.stringify({ legacyFreeView, legacyFreeRow })}`)
    }
    pass('H17 现价 0：确认 0 与缺省字段都是 paid+free')

    await setBw(20)
    const legacyKey = randomUUID()
    const legacy = await request({ headers: { 'idempotency-key': legacyKey } })
    const legacyView = envelopeData<{ id: string; amountCents: number; payStatus: string }>(legacy)
    if (legacyView.amountCents !== 40 || legacyView.payStatus !== 'unpaid') {
      fail(`旧客户端缺省 quotedAmountCents 应按现价 40 分建未支付单，实际 ${JSON.stringify(legacyView)}`)
    }
    const matchedKey = randomUUID()
    const matched = await request({ headers: { 'idempotency-key': matchedKey }, body: { ...dto, quotedAmountCents: 40 } })
    const matchedView = envelopeData<{ id: string; amountCents: number; payStatus: string }>(matched)
    if (matchedView.amountCents !== 40 || matchedView.payStatus !== 'unpaid') {
      fail(`报价一致应建成 40 分未支付单，实际 ${JSON.stringify(matchedView)}`)
    }
    pass('H18 缺省字段与报价一致都按服务端 40 分建单')

    await setBw(50)
    const frozenReplayQuoted = await request({ headers: { 'idempotency-key': matchedKey }, body: { ...dto, quotedAmountCents: 100 } })
    const frozenReplayStale = await request({ headers: { 'idempotency-key': matchedKey }, body: { ...dto, quotedAmountCents: 1 } })
    const frozenQuotedView = envelopeData<{ id: string; amountCents: number; payStatus: string }>(frozenReplayQuoted)
    const frozenStaleView = envelopeData<{ id: string; amountCents: number; payStatus: string }>(frozenReplayStale)
    const frozenRow = await prisma.order.findUnique({ where: { id: matchedView.id } })
    if (
      frozenQuotedView.id !== matchedView.id || frozenStaleView.id !== matchedView.id
      || frozenQuotedView.amountCents !== 40 || frozenStaleView.amountCents !== 40
      || frozenRow?.amountCents !== 40 || frozenRow.payStatus !== 'unpaid'
      || await prisma.order.count({ where: { idempotencyKey: matchedKey } }) !== 1
    ) {
      fail(`已建订单必须回放冻结的 40 分，实际 ${JSON.stringify({ frozenQuotedView, frozenStaleView, frozenRow })}`)
    }
    const freshStale = await request({ headers: { 'idempotency-key': randomUUID() }, body: { ...dto, quotedAmountCents: 40 } })
    assertPriceDetails(freshStale, 100, 50)
    const repricedKey = randomUUID()
    const repriced = await request({ headers: { 'idempotency-key': repricedKey }, body: { ...dto, quotedAmountCents: 100 } })
    const repricedView = envelopeData<{ id: string; amountCents: number }>(repriced)
    const repricedReplay = await request({ headers: { 'idempotency-key': repricedKey }, body: { ...dto, quotedAmountCents: 40 } })
    const repricedReplayView = envelopeData<{ id: string; amountCents: number }>(repricedReplay)
    if (repricedView.amountCents !== 100 || repricedReplayView.id !== repricedView.id || repricedReplayView.amountCents !== 100) {
      fail(`新价建单后换一份确认金额仍应回放 100 分原单，实际 ${JSON.stringify({ repricedView, repricedReplayView })}`)
    }
    pass('H19 已建订单不因后续改价或确认金额变化而重算')

    const payloadKey = randomUUID()
    const payloadCreated = await request({ headers: { 'idempotency-key': payloadKey }, body: { ...dto, quotedAmountCents: 100 } })
    if (payloadCreated.status !== 200 && payloadCreated.status !== 201) fail(`同价确认应建单，实际 ${JSON.stringify(payloadCreated)}`)
    const payloadConflict = await request({
      headers: { 'idempotency-key': payloadKey },
      body: { ...dto, copies: 2, quotedAmountCents: 200 },
    })
    if (payloadConflict.status !== 409 || errorCode(payloadConflict) !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同键改份数必须 IDEMPOTENCY_KEY_REUSED，实际 ${JSON.stringify(payloadConflict)}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: payloadKey } }) !== 1) fail('参数冲突不得第二张单')
    pass('H20 同键改业务参数仍是 IDEMPOTENCY_KEY_REUSED，确认金额不进指纹')

    const beforeInvalid = await priceFootprint()
    for (const bad of [-1, 1.5, '40', null, 100_000_001]) {
      const result = await request({
        headers: { 'idempotency-key': randomUUID() },
        body: { ...dto, quotedAmountCents: bad },
      })
      if (result.status !== 400 || errorCode(result) !== 'VALIDATION_FAILED') {
        fail(`quotedAmountCents=${JSON.stringify(bad)} 应 400 VALIDATION_FAILED，实际 ${JSON.stringify(result)}`)
      }
    }
    if (await priceFootprint() !== beforeInvalid) fail('非法 quotedAmountCents 不得建单或留下租约')
    pass('H21 quotedAmountCents 为负数 / 小数 / 字符串 / null / 超上限 → 400，零副作用')
    await setBw(20)

    const oversize = await resolveRequest({ body: { keys: Array.from({ length: 21 }, () => randomUUID()) } })
    if (oversize.status !== 400 || errorCode(oversize) !== 'VALIDATION_FAILED') {
      fail(`21 个 key 必须 400 VALIDATION_FAILED，实际 ${JSON.stringify(oversize)}`)
    }
    pass('H9 resolve 最多 20 个 key')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    await app.close()
    const orderIds = (await prisma.order.findMany({ where: { endUserId: userA }, select: { id: true } })).map((row) => row.id)
    if (orderIds.length) await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
    await prisma.orderSubmissionLedger.deleteMany({ where: { endUserId: userA } })
    await prisma.order.deleteMany({ where: { endUserId: userA } })
    await prisma.piiFinding.deleteMany({ where: { task: { endUserId: userA } } })
    await prisma.documentProcessTask.deleteMany({ where: { endUserId: userA } })
    await prisma.fileObject.deleteMany({ where: { endUserId: userA } })
    await prisma.endUser.deleteMany({ where: { id: userA } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminalCapability.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.priceConfig.deleteMany({ where: { serviceKey: { in: ['print_bw_page', 'print_color_page'] } } })
    for (const key of storageKeys) await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await prisma.onModuleDestroy()
    cleanupDb()
  }
  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFAIL', error instanceof Error ? error.stack : error)
  cleanupDb()
  process.exit(1)
})
