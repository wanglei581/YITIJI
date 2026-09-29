/**
 * POST /orders/package Idempotency-Key HTTP 契约：进程内 Nest + 隔离 SQLite。
 * 不连生产。由 verify:package-order-fulfillment 串行拉起。
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
import { fingerprintPackageOrderPayload, PackageOrderService } from '../src/member-print-orders/package-order.service'
import { PackageOrdersController } from '../src/member-print-orders/package-orders.controller'
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
const dbPath = path.join('/tmp', `verify-package-order-idem-http-${randomUUID().slice(0, 8)}.db`)
process.env['DATABASE_URL'] = `file:${dbPath}`
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
process.env['NODE_ENV'] = 'test'
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_SIGNING_SECRET'] = 'verify-file-signing-secret-0123456789abcdef'
process.env['PAYMENT_SESSION_SECRET'] = 'verify-payment-session-secret-0123456789abcdef'
process.env['SECRET_ENCRYPTION_KEY'] = 'verify-secret-encryption-key-0123456789abcdef'
process.env['TERMINAL_ADMIN_SECRET'] = 'verify-terminal-admin-secret-0123456789abcdef'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] = 'verify-terminal-action-token-secret-0123456789abcdef'
process.env['JWT_SECRET'] ||= 'verify-pkg-idem-http-jwt-secret-32chars!!'

type Json = Record<string, unknown>
interface HttpResult { status: number; json: Json }
type PackageDto = {
  terminalId: string
  files: Array<{ fileId: string; pageRange?: string }>
  params: { copies: number; colorMode: string; duplex: string }
}
type PackageView = {
  orderId: string
  orderNo: string
  pickupCode: string | null
  items: Array<{ fileId: string; pageRange: string | null }>
}

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

let packageOrdersRef: PackageOrderService | null = null
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
  controllers: [PackageOrdersController],
  providers: [
    {
      provide: PackageOrderService,
      useFactory: () => {
        if (!packageOrdersRef) throw new Error('packageOrdersRef missing')
        return packageOrdersRef
      },
    },
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
class PackageIdempotencyHttpModule {}

async function main(): Promise<void> {
  console.log('\n=== POST /orders/package Idempotency-Key HTTP 契约 ===')
  cleanupDb()
  prepareDb()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const capabilities = new TerminalCapabilitiesService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const quotes = new OrderQuoteService(new PrintPageCountService(prisma, storage), new PricingService(prisma), capabilities, prisma)
  const packageOrders = new PackageOrderService(prisma, quotes, capabilities, audit, orderStatus)
  packageOrdersRef = packageOrders
  prismaRef = prisma
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const userA = `eu_pkg_http_a_${suffix}`
  const userB = `eu_pkg_http_b_${suffix}`
  const terminalId = `terminal_pkg_http_${suffix}`
  const fileA1 = `file_pkg_http_a1_${suffix}`
  const fileA2 = `file_pkg_http_a2_${suffix}`
  const fileB1 = `file_pkg_http_b1_${suffix}`
  const storageKeys: string[] = []
  const dtoA: PackageDto = {
    terminalId,
    files: [{ fileId: fileA1 }, { fileId: fileA2 }],
    params: { copies: 1, colorMode: 'black_white', duplex: 'simplex' },
  }
  const jwt = new JwtService({
    secret: process.env['JWT_SECRET'],
    signOptions: { expiresIn: '30m', audience: 'enduser' },
  })
  function tokenFor(userId: string): string {
    const sessionId = randomUUID()
    sessionStore.set(memberSessionKey(sessionId), userId)
    return jwt.sign({ sub: userId }, { jwtid: sessionId, audience: 'enduser' })
  }
  const tokenA = tokenFor(userA)
  const tokenB = tokenFor(userB)

  const app = await NestFactory.create(PackageIdempotencyHttpModule, { logger: false })
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
    token?: string
    headers?: Record<string, string>
    body?: unknown
  }): Promise<HttpResult> {
    const response = await fetch(`${base}/orders/package`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${init.token ?? tokenA}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      body: JSON.stringify(init.body ?? dtoA),
    })
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Json }
  }

  try {
    setPrintScanCapabilityModeForTest('strict')
    await prisma.endUser.create({ data: { id: userA, phoneHash: `hash-${userA}`, phoneEnc: `enc-${userA}` } })
    await prisma.endUser.create({ data: { id: userB, phoneHash: `hash-${userB}`, phoneEnc: `enc-${userB}` } })
    await prisma.terminal.create({
      data: {
        id: terminalId, terminalCode: `PKGHTTP-${suffix}`, agentToken: `token-${terminalId}`,
        deviceFingerprint: `fp-${terminalId}`, displayName: '材料包幂等HTTP终端', locationLabel: '验证点',
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId, status: 'online', localTaskDatabaseAvailable: true, createdAt: new Date() },
    })
    await prisma.terminalCapability.create({
      data: { terminalId, capabilityKey: 'document_print', status: 'available' },
    })
    await seedDevDefaultPriceConfig(prisma)
    for (const [fileId, ownerId, label] of [
      [fileA1, userA, 'A简历'],
      [fileA2, userA, 'A附件'],
      [fileB1, userB, 'B简历'],
    ] as const) {
      const storageKey = `verify/package-idem-http/${fileId}.pdf`
      const pdf = buildRealPdf(2)
      await storage.putObject(storageKey, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
      storageKeys.push(storageKey)
      await prisma.fileObject.create({
        data: {
          id: fileId, storageKey, bucket: LOCAL_BUCKET_SENTINEL, region: 'local', filename: `${label}.pdf`,
          mimeType: 'application/pdf', sizeBytes: pdf.length,
          sha256: createHash('sha256').update(pdf).digest('hex'), endUserId: ownerId, ownerType: 'user', ownerId,
          purpose: 'print_doc', status: 'active', expiresAt: new Date(Date.now() + 30 * 60 * 60 * 1000),
        },
      })
      const task = await prisma.documentProcessTask.create({
        data: {
          kind: 'pii_scan', status: 'completed', requesterMode: 'member', sourceFileId: fileId,
          endUserId: ownerId, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          paramsJson: JSON.stringify({ sourceSha256: createHash('sha256').update(pdf).digest('hex') }),
        },
      })
      await prisma.piiFinding.create({ data: { taskId: task.id, type: 'phone', label: '手机号', action: 'keep' } })
    }
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
    const bodyOnly = await request({ body: { ...dtoA, idempotencyKey: bodyOnlyKey } })
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
    const createdView = envelopeData<PackageView>(created)
    if (!createdView.orderId || !createdView.pickupCode) fail('建单必须返回 orderId 与到机码')
    const replayUpper = await request({ headers: { 'IDEMPOTENCY-KEY': mixedKey } })
    const replayLower = await request({ headers: { 'idempotency-key': mixedKey } })
    const upperView = envelopeData<PackageView>(replayUpper)
    const lowerView = envelopeData<PackageView>(replayLower)
    if (upperView.orderId !== createdView.orderId || lowerView.orderId !== createdView.orderId) {
      fail('混合大小写必须打到同一张单')
    }
    if (upperView.pickupCode !== createdView.pickupCode || lowerView.pickupCode !== createdView.pickupCode) {
      fail('混合大小写回放必须同一到机码')
    }
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 1) fail('混合大小写回放不得第二张单')
    pass('H3 Idempotency-Key / IDEMPOTENCY-KEY / idempotency-key 都到达 controller')

    const caseKey = randomUUID()
    const caseCreated = await request({ headers: { 'idempotency-key': caseKey } })
    if (caseCreated.status !== 200 && caseCreated.status !== 201) fail(`小写 key 应建单，实际 ${JSON.stringify(caseCreated)}`)
    const caseUpper = await request({ headers: { 'idempotency-key': caseKey.toUpperCase() } })
    if (caseUpper.status !== 400 || errorCode(caseUpper) !== 'IDEMPOTENCY_KEY_INVALID') {
      fail(`已有小写 key 后再打大写应为 400 INVALID，实际 ${JSON.stringify(caseUpper)}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: caseKey } }) !== 1) fail('大写重试不得改小写那一行')
    if (await prisma.order.count({ where: { idempotencyKey: caseKey.toUpperCase() } }) !== 0) {
      fail('大写 UUID 不得另建一行')
    }
    pass('H3b 大写 UUID 值拒绝且零额外 Order（header 名大小写仍不敏感）')

    const lostKey = randomUUID()
    const lost = await request({ headers: { 'idempotency-key': lostKey } })
    const lostView = envelopeData<PackageView>(lost)
    const recovered = await request({ headers: { 'idempotency-key': lostKey } })
    const recoveredView = envelopeData<PackageView>(recovered)
    if (recoveredView.orderId !== lostView.orderId || recoveredView.pickupCode !== lostView.pickupCode) {
      fail('响应丢失重试必须回放原单原码')
    }
    if (await prisma.order.count({ where: { idempotencyKey: lostKey } }) !== 1) fail('丢失重试不得新增行')
    pass('H4 同 header/payload 丢响应再 POST → 同一张单')

    const mismatchKey = randomUUID()
    const original = await request({ headers: { 'idempotency-key': mismatchKey } })
    const originalView = envelopeData<PackageView>(original)
    const mismatch = await request({
      headers: { 'idempotency-key': mismatchKey },
      body: { ...dtoA, params: { ...dtoA.params, copies: 2 } },
    })
    if (mismatch.status !== 409 || errorCode(mismatch) !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 不同 payload 应为 409 IDEMPOTENCY_KEY_REUSED，实际 ${JSON.stringify(mismatch)}`)
    }
    const leaked = JSON.stringify(mismatch.json)
    if (originalView.orderId && leaked.includes(originalView.orderId)) fail('409 不得泄露 order id')
    if (originalView.pickupCode && leaked.includes(originalView.pickupCode)) fail('409 不得泄露到机码')
    if (await prisma.order.count({ where: { idempotencyKey: mismatchKey } }) !== 1) fail('payload 冲突不得第二张单')
    pass('H5 同 header 不同 payload → 409，不泄露 id/code')

    const rangeKey = randomUUID()
    const rangedBody = {
      ...dtoA,
      files: [{ fileId: fileA1, pageRange: '1' }, { fileId: fileA2 }],
    }
    const ranged = await request({ headers: { 'idempotency-key': rangeKey }, body: rangedBody })
    const rangedView = envelopeData<PackageView>(ranged)
    const rangedReplay = await request({ headers: { 'idempotency-key': rangeKey }, body: rangedBody })
    const rangedReplayView = envelopeData<PackageView>(rangedReplay)
    if (rangedReplayView.orderId !== rangedView.orderId || rangedReplayView.pickupCode !== rangedView.pickupCode) {
      fail('同 pageRange 必须回放原单原码')
    }
    if (rangedView.items[0]?.pageRange !== '1') fail('HTTP 建单必须落下 pageRange=1')
    const rangeMismatch = await request({
      headers: { 'idempotency-key': rangeKey },
      body: { ...dtoA, files: [{ fileId: fileA1, pageRange: '1-2' }, { fileId: fileA2 }] },
    })
    if (rangeMismatch.status !== 409 || errorCode(rangeMismatch) !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 不同 pageRange 应为 409，实际 ${JSON.stringify(rangeMismatch)}`)
    }
    const rangeOmitted = await request({ headers: { 'idempotency-key': rangeKey }, body: dtoA })
    if (rangeOmitted.status !== 409 || errorCode(rangeOmitted) !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 省略 pageRange 应为 409，实际 ${JSON.stringify(rangeOmitted)}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: rangeKey } }) !== 1) fail('pageRange 冲突不得第二张单')
    pass('H5b 同 header 改 pageRange → 409；精确 replay 仍是原单')

    const sharedKey = randomUUID()
    const aCreated = await request({ headers: { 'idempotency-key': sharedKey } })
    const aView = envelopeData<PackageView>(aCreated)
    const bCreated = await request({
      token: tokenB,
      headers: { 'idempotency-key': sharedKey },
      body: { terminalId, files: [{ fileId: fileB1 }], params: dtoA.params },
    })
    const bView = envelopeData<PackageView>(bCreated)
    if (bView.orderId === aView.orderId) fail('HTTP 不同用户同 key 不得同一张单')
    if (bView.pickupCode === aView.pickupCode) fail('HTTP B 不得拿到 A 的到机码')
    if (await prisma.order.count({ where: { idempotencyKey: sharedKey } }) !== 2) fail('HTTP 不同用户同 key 应各有一行')
    pass('H6 不同用户同 header → 各建各的')

    const packageLiveKey = randomUUID()
    await prisma.orderSubmissionLedger.create({
      data: {
        endUserId: userA,
        idempotencyKey: packageLiveKey,
        orderKind: 'package',
        payloadHash: fingerprintPackageOrderPayload(dtoA),
        status: 'processing',
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    })
    const packageLive = await request({
      headers: { 'idempotency-key': packageLiveKey },
      body: { ...dtoA, quotedAmountCents: 1 },
    })
    const packageLiveLedger = await prisma.orderSubmissionLedger.findFirst({ where: { endUserId: userA, idempotencyKey: packageLiveKey } })
    if (packageLive.status !== 409 || errorCode(packageLive) !== 'IDEMPOTENCY_IN_PROGRESS') {
      fail(`材料包活租约即使报价不一致也必须 IN_PROGRESS，实际 ${JSON.stringify(packageLive)}`)
    }
    if (!packageLiveLedger || packageLiveLedger.status !== 'processing') fail('材料包价格拒绝不得改写活租约')
    if (await prisma.order.count({ where: { idempotencyKey: packageLiveKey } }) !== 0) fail('材料包活租约不得建单')
    pass('H7 活租约优先于报价比对')

    const packageAbandonedKey = randomUUID()
    await prisma.orderSubmissionLedger.create({
      data: {
        endUserId: userA,
        idempotencyKey: packageAbandonedKey,
        orderKind: 'package',
        payloadHash: fingerprintPackageOrderPayload(dtoA),
        status: 'abandoned',
      },
    })
    const packageAbandoned = await request({
      headers: { 'idempotency-key': packageAbandonedKey },
      body: { ...dtoA, quotedAmountCents: 1 },
    })
    if (packageAbandoned.status !== 409 || errorCode(packageAbandoned) !== 'IDEMPOTENCY_KEY_ABANDONED') {
      fail(`材料包废弃键即使报价不一致也必须 ABANDONED，实际 ${JSON.stringify(packageAbandoned)}`)
    }
    pass('H8 废弃键优先于报价比对')

    type PackagePriceView = PackageView & { amountCents: number; payStatus: string; paymentSessionToken?: string }
    async function packageFootprint(): Promise<string> {
      const [orders, items, tasks, attempts, audits, ledgers] = await Promise.all([
        prisma.order.count(),
        prisma.orderItem.count(),
        prisma.printTask.count(),
        prisma.paymentAttempt.count(),
        prisma.auditLog.count({ where: { action: 'member.package_order.create' } }),
        prisma.orderSubmissionLedger.count(),
      ])
      return JSON.stringify({ orders, items, tasks, attempts, audits, ledgers })
    }
    const setBw = (unitCents: number) => prisma.priceConfig.update({ where: { serviceKey: 'print_bw_page' }, data: { unitCents } })
    const seedBw = await prisma.priceConfig.findUniqueOrThrow({ where: { serviceKey: 'print_bw_page' } })
    if (seedBw.unitCents !== 20) fail(`夹具黑白单价应为 20 分，实际 ${seedBw.unitCents}`)
    const packageLine = (unitCents: number) => `line=print_bw_page:${unitCents}:2:${unitCents * 2}`
    function assertPackageDetails(result: HttpResult, current: number, pages: number, lines: string[]): void {
      const raw = (result.json['error'] as { details?: unknown } | undefined)?.details
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
        fail(`PRICE_CHANGED details 必须是 string[]，实际 ${JSON.stringify(result.json)}`)
      }
      const details = raw as string[]
      const body = JSON.stringify(result.json)
      const lineOk = lines.every((line) => details.filter((item) => item === line).length === lines.filter((item) => item === line).length)
      if (
        result.status !== 409 || result.json['success'] !== false || errorCode(result) !== 'PRICE_CHANGED'
        || !details.includes(`currentAmountCents=${current}`) || !details.includes(`billablePages=${pages}`)
        || !lineOk || body.includes('paymentSessionToken') || body.includes('更换标识')
      ) {
        fail(`期望 409 PRICE_CHANGED current=${current} lines=${lines.join(',')}，实际 ${body}`)
      }
    }
    async function expectPackagePriceChanged(
      label: string,
      body: unknown,
      current: number,
      pages: number,
      lines: string[],
    ): Promise<void> {
      const before = await packageFootprint()
      const key = randomUUID()
      const result = await request({ headers: { 'idempotency-key': key }, body })
      assertPackageDetails(result, current, pages, lines)
      if (await packageFootprint() !== before) fail(`${label} 产生了订单、明细、支付令牌或审计`)
      if (await prisma.orderSubmissionLedger.findFirst({ where: { endUserId: userA, idempotencyKey: key } })) {
        fail(`${label} 必须释放临时租约，不能墓碑`)
      }
      pass(label)
    }

    await expectPackagePriceChanged('H9 0→付费：确认 0、两份文件现价 80 分 → 409，明细不合并', { ...dtoA, quotedAmountCents: 0 }, 80, 4, [packageLine(20), packageLine(20)])
    const priceRangedBody = {
      ...dtoA,
      files: [{ fileId: fileA1, pageRange: '1' }, { fileId: fileA2 }],
      quotedAmountCents: 1,
    }
    await expectPackagePriceChanged(
      'H10 页码范围按 /orders/quote 逐行展开：1 页 + 2 页 = 60 分',
      priceRangedBody,
      60,
      3,
      ['line=print_bw_page:20:1:20', 'line=print_bw_page:20:2:40'],
    )
    const packageReuseKey = randomUUID()
    const packageReuseReject = await request({ headers: { 'idempotency-key': packageReuseKey }, body: { ...dtoA, quotedAmountCents: 0 } })
    assertPackageDetails(packageReuseReject, 80, 4, [packageLine(20), packageLine(20)])
    const packageReuseOk = await request({ headers: { 'idempotency-key': packageReuseKey }, body: { ...dtoA, quotedAmountCents: 80 } })
    const packageReuseView = envelopeData<PackagePriceView>(packageReuseOk)
    const packageReuseItems = await prisma.orderItem.count({ where: { orderId: packageReuseView.orderId } })
    if (
      packageReuseView.amountCents !== 80 || packageReuseView.payStatus !== 'unpaid'
      || typeof packageReuseView.paymentSessionToken !== 'string' || packageReuseItems !== 2
    ) {
      fail(`409 后原键按现价再确认应建成 80 分材料包，实际 ${JSON.stringify(packageReuseView)}`)
    }
    pass('H11 409 释放租约后，原键可以按现价建成材料包')

    await setBw(30)
    await expectPackagePriceChanged('H12 涨价：确认 80、现价 120 → 409', { ...dtoA, quotedAmountCents: 80 }, 120, 4, [packageLine(30), packageLine(30)])
    await setBw(10)
    await expectPackagePriceChanged('H13 降价：确认 80、现价 40 → 409', { ...dtoA, quotedAmountCents: 80 }, 40, 4, [packageLine(10), packageLine(10)])
    await setBw(0)
    await expectPackagePriceChanged('H14 付费→0：确认 80、现价 0 → 409，不免费落单', { ...dtoA, quotedAmountCents: 80 }, 0, 4, [packageLine(0), packageLine(0)])
    const packageFreeKey = randomUUID()
    const packageFree = await request({ headers: { 'idempotency-key': packageFreeKey }, body: { ...dtoA, quotedAmountCents: 0 } })
    const packageFreeView = envelopeData<PackagePriceView>(packageFree)
    const packageFreeRow = await prisma.order.findUnique({ where: { id: packageFreeView.orderId } })
    if (packageFreeView.amountCents !== 0 || packageFreeView.payStatus !== 'paid' || packageFreeRow?.paymentSource !== 'free') {
      fail(`材料包确认 0 且现价 0 必须 paid+free，实际 ${JSON.stringify({ packageFreeView, packageFreeRow })}`)
    }
    const packageLegacyFree = await request({ headers: { 'idempotency-key': randomUUID() } })
    const packageLegacyFreeView = envelopeData<PackagePriceView>(packageLegacyFree)
    const packageLegacyFreeRow = await prisma.order.findUnique({ where: { id: packageLegacyFreeView.orderId } })
    if (packageLegacyFreeView.amountCents !== 0 || packageLegacyFreeView.payStatus !== 'paid' || packageLegacyFreeRow?.paymentSource !== 'free') {
      fail(`材料包旧客户端在现价 0 时仍应免费建单，实际 ${JSON.stringify({ packageLegacyFreeView, packageLegacyFreeRow })}`)
    }
    pass('H15 材料包现价 0：确认 0 与缺省字段都是 paid+free')

    await setBw(20)
    const packageLegacy = await request({ headers: { 'idempotency-key': randomUUID() } })
    const packageLegacyView = envelopeData<PackagePriceView>(packageLegacy)
    if (packageLegacyView.amountCents !== 80 || packageLegacyView.payStatus !== 'unpaid' || typeof packageLegacyView.paymentSessionToken !== 'string') {
      fail(`材料包旧客户端应按 80 分建未支付单并给出支付令牌，实际 ${JSON.stringify(packageLegacyView)}`)
    }
    const packageMatchedKey = randomUUID()
    const packageMatched = await request({ headers: { 'idempotency-key': packageMatchedKey }, body: { ...dtoA, quotedAmountCents: 80 } })
    const packageMatchedView = envelopeData<PackagePriceView>(packageMatched)
    if (packageMatchedView.amountCents !== 80 || packageMatchedView.payStatus !== 'unpaid') {
      fail(`材料包报价一致应建成 80 分，实际 ${JSON.stringify(packageMatchedView)}`)
    }
    pass('H16 材料包缺省字段与报价一致都按服务端 80 分建单')

    await setBw(50)
    const packageFrozenNew = await request({ headers: { 'idempotency-key': packageMatchedKey }, body: { ...dtoA, quotedAmountCents: 200 } })
    const packageFrozenOld = await request({ headers: { 'idempotency-key': packageMatchedKey }, body: { ...dtoA, quotedAmountCents: 1 } })
    const packageFrozenNewView = envelopeData<PackagePriceView>(packageFrozenNew)
    const packageFrozenOldView = envelopeData<PackagePriceView>(packageFrozenOld)
    const packageFrozenRow = await prisma.order.findUnique({ where: { id: packageMatchedView.orderId } })
    if (
      packageFrozenNewView.orderId !== packageMatchedView.orderId || packageFrozenOldView.orderId !== packageMatchedView.orderId
      || packageFrozenNewView.amountCents !== 80 || packageFrozenOldView.amountCents !== 80
      || packageFrozenRow?.amountCents !== 80
      || await prisma.order.count({ where: { idempotencyKey: packageMatchedKey } }) !== 1
    ) {
      fail(`已建材料包必须回放冻结的 80 分，实际 ${JSON.stringify({ packageFrozenNewView, packageFrozenOldView, packageFrozenRow })}`)
    }
    const packageFreshStale = await request({ headers: { 'idempotency-key': randomUUID() }, body: { ...dtoA, quotedAmountCents: 80 } })
    assertPackageDetails(packageFreshStale, 200, 4, [packageLine(50), packageLine(50)])
    const packageRepricedKey = randomUUID()
    const packageRepriced = await request({ headers: { 'idempotency-key': packageRepricedKey }, body: { ...dtoA, quotedAmountCents: 200 } })
    const packageRepricedView = envelopeData<PackagePriceView>(packageRepriced)
    const packageRepricedReplay = await request({ headers: { 'idempotency-key': packageRepricedKey }, body: { ...dtoA, quotedAmountCents: 80 } })
    const packageRepricedReplayView = envelopeData<PackagePriceView>(packageRepricedReplay)
    if (packageRepricedView.amountCents !== 200 || packageRepricedReplayView.orderId !== packageRepricedView.orderId || packageRepricedReplayView.amountCents !== 200) {
      fail(`材料包新价建单后换确认金额仍应回放 200 分原单，实际 ${JSON.stringify({ packageRepricedView, packageRepricedReplayView })}`)
    }
    pass('H17 已建材料包不因后续改价或确认金额变化而重算')

    const packagePayloadKey = randomUUID()
    const packagePayloadCreated = await request({
      headers: { 'idempotency-key': packagePayloadKey },
      body: { ...dtoA, quotedAmountCents: 200 },
    })
    if (packagePayloadCreated.status !== 200 && packagePayloadCreated.status !== 201) {
      fail(`材料包同价确认应建单，实际 ${JSON.stringify(packagePayloadCreated)}`)
    }
    const packagePayloadConflict = await request({
      headers: { 'idempotency-key': packagePayloadKey },
      body: { ...dtoA, params: { ...dtoA.params, copies: 2 }, quotedAmountCents: 400 },
    })
    if (packagePayloadConflict.status !== 409 || errorCode(packagePayloadConflict) !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`材料包同键改份数必须 IDEMPOTENCY_KEY_REUSED，实际 ${JSON.stringify(packagePayloadConflict)}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: packagePayloadKey } }) !== 1) fail('材料包参数冲突不得第二张单')
    pass('H18 材料包同键改业务参数仍是 IDEMPOTENCY_KEY_REUSED，确认金额不进指纹')

    const beforePackageInvalid = await packageFootprint()
    for (const bad of [-1, 1.5, '80', null, 100_000_001]) {
      const result = await request({
        headers: { 'idempotency-key': randomUUID() },
        body: { ...dtoA, quotedAmountCents: bad },
      })
      if (result.status !== 400 || errorCode(result) !== 'VALIDATION_FAILED') {
        fail(`材料包 quotedAmountCents=${JSON.stringify(bad)} 应 400 VALIDATION_FAILED，实际 ${JSON.stringify(result)}`)
      }
    }
    if (await packageFootprint() !== beforePackageInvalid) fail('材料包非法 quotedAmountCents 不得建单或留下租约')
    pass('H19 quotedAmountCents 为负数 / 小数 / 字符串 / null / 超上限 → 400，零副作用')
    await setBw(20)
  } finally {
    setPrintScanCapabilityModeForTest(null)
    await app.close()
    const orderIds = (await prisma.order.findMany({
      where: { endUserId: { in: [userA, userB] } },
      select: { id: true },
    })).map((row) => row.id)
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
      await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
    }
    await prisma.order.deleteMany({ where: { endUserId: { in: [userA, userB] } } })
    await prisma.piiFinding.deleteMany({ where: { task: { endUserId: { in: [userA, userB] } } } })
    await prisma.documentProcessTask.deleteMany({ where: { endUserId: { in: [userA, userB] } } })
    await prisma.fileObject.deleteMany({ where: { endUserId: { in: [userA, userB] } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB] } } })
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
