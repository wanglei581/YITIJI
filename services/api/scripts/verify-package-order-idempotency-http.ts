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
import { PackageOrderService } from '../src/member-print-orders/package-order.service'
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
