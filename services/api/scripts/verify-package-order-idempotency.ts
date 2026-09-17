/**
 * POST /orders/package 耐久幂等（service）：隔离 SQLite + 真 PackageOrderService。
 * 不连生产。由 verify:package-order-fulfillment 串行拉起。
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { AuditService } from '../src/audit/audit.service'
import { encryptSecret } from '../src/common/crypto/secret-cipher'
import type { RedisService } from '../src/common/redis/redis.service'
import { hashPickupCode, randomPickupCode } from '../src/common/pickup-code'
import { assertMemberPrintOrderIdempotencyKey } from '../src/member-print-orders/member-print-order-create.service'
import {
  fingerprintPackageOrderPayload,
  PackageOrderService,
} from '../src/member-print-orders/package-order.service'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import { isPickupWindowClosed, OrderStatusService } from '../src/payment/order-status.service'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PickupOrderService } from '../src/print-jobs/pickup-order.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'
import { setPrintScanCapabilityModeForTest, TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

const apiRoot = path.resolve(__dirname, '..')
const dbPath = path.join('/tmp', `verify-package-order-idem-${randomUUID().slice(0, 8)}.db`)
process.env['DATABASE_URL'] = `file:${dbPath}`
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
process.env['NODE_ENV'] = 'test'
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_SIGNING_SECRET'] = 'verify-file-signing-secret-0123456789abcdef'
process.env['PAYMENT_SESSION_SECRET'] = 'verify-payment-session-secret-0123456789abcdef'
process.env['SECRET_ENCRYPTION_KEY'] = 'verify-secret-encryption-key-0123456789abcdef'
process.env['TERMINAL_ADMIN_SECRET'] = 'verify-terminal-admin-secret-0123456789abcdef'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] = 'verify-terminal-action-token-secret-0123456789abcdef'

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

function codeOf(error: unknown): string {
  const ex = error as { getResponse?: () => unknown; response?: unknown; message?: string }
  const response = typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response
  if (typeof response === 'string' && response) return response
  const body = response as { error?: { code?: string }; message?: string } | undefined
  return body?.error?.code ?? body?.message ?? ex.message ?? 'UNKNOWN'
}

class FakeRedis {
  private readonly values = new Map<string, string>()

  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null }
  async setEx(key: string, _ttl: number, value: string): Promise<void> { this.values.set(key, value) }
  async del(key: string): Promise<number> { return this.values.delete(key) ? 1 : 0 }
  async incrWithTtl(key: string, _ttl: number): Promise<number> {
    const value = Number(this.values.get(key) ?? '0') + 1
    this.values.set(key, String(value))
    return value
  }
}

async function capture(action: () => Promise<unknown>): Promise<{
  thrown: boolean
  code: string | null
  body: unknown
}> {
  try {
    const value = await action()
    return { thrown: false, code: null, body: value }
  } catch (error) {
    const ex = error as { getResponse?: () => unknown }
    const body = typeof ex.getResponse === 'function' ? ex.getResponse() : error
    return { thrown: true, code: codeOf(error), body }
  }
}

function assertNoLeak(blob: unknown, secrets: Array<string | null | undefined>, label: string): void {
  const text = JSON.stringify(blob)
  for (const secret of secrets) {
    if (secret && text.includes(secret)) fail(`${label}: leaked ${JSON.stringify(secret)}`)
  }
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

type PackageDto = {
  terminalId: string
  files: Array<{ fileId: string; pageRange?: string }>
  params: { copies: number; colorMode: 'bw' | 'black_white' | 'color'; duplex: 'single' | 'simplex' | 'duplex_long_edge' | 'duplex_short_edge' }
}

type PackageView = {
  orderId: string
  orderNo: string
  pickupCode: string | null
  pickupStatus: string
  payStatus: string
  taskStatus: string
  amountCents: number
  paymentSessionToken?: string
  items: Array<{ fileId: string; copies: number; colorMode: string; duplex: string; pageRange: string | null }>
}

function assertKeyFormat(): void {
  const good = randomUUID()
  if (assertMemberPrintOrderIdempotencyKey(good) !== good) fail('合法 UUID 应原样返回')
  for (const raw of ['', '   ', null, undefined]) {
    try {
      assertMemberPrintOrderIdempotencyKey(raw)
      fail(`缺 key 应拒绝: ${JSON.stringify(raw)}`)
    } catch (error) {
      if (codeOf(error) !== 'IDEMPOTENCY_KEY_REQUIRED') fail(`缺 key 错误码: ${codeOf(error)}`)
    }
  }
  for (const raw of ['nope', '123', good.slice(0, 8), 'g'.repeat(36), good.toUpperCase()]) {
    try {
      assertMemberPrintOrderIdempotencyKey(raw)
      fail(`非法 key 应拒绝: ${raw}`)
    } catch (error) {
      if (codeOf(error) !== 'IDEMPOTENCY_KEY_INVALID') fail(`非法 key 错误码: ${codeOf(error)}`)
    }
  }
  pass('缺/非法 Idempotency-Key 分别是 REQUIRED / INVALID；大写 UUID 为 INVALID')
}

function assertCanonicalFingerprint(): void {
  const files = [{ fileId: 'f1' }, { fileId: 'f2' }]
  const base: PackageDto = {
    terminalId: 'term-1',
    files,
    params: { copies: 1, colorMode: 'black_white', duplex: 'simplex' },
  }
  const aliased: PackageDto = {
    ...base,
    params: { copies: 1, colorMode: 'bw', duplex: 'single' },
  }
  if (fingerprintPackageOrderPayload(base) !== fingerprintPackageOrderPayload(aliased)) {
    fail('bw/single 必须与 black_white/simplex 同一指纹')
  }
  const swapped: PackageDto = { ...base, files: [{ fileId: 'f2' }, { fileId: 'f1' }] }
  if (fingerprintPackageOrderPayload(base) === fingerprintPackageOrderPayload(swapped)) {
    fail('文件顺序必须进入指纹')
  }
  const copies: PackageDto = { ...base, params: { ...base.params, copies: 2 } }
  if (fingerprintPackageOrderPayload(base) === fingerprintPackageOrderPayload(copies)) {
    fail('copies 必须进入指纹')
  }
  const emptyRange: PackageDto = {
    ...base,
    files: [{ fileId: 'f1', pageRange: '' }, { fileId: 'f2', pageRange: '' }],
  }
  if (fingerprintPackageOrderPayload(base) !== fingerprintPackageOrderPayload(emptyRange)) {
    fail('缺 pageRange 与空串必须同一指纹（报价同样省略）')
  }
  const ranged: PackageDto = {
    ...base,
    files: [{ fileId: 'f1', pageRange: '1' }, { fileId: 'f2' }],
  }
  if (fingerprintPackageOrderPayload(base) === fingerprintPackageOrderPayload(ranged)) {
    fail('有序 pageRange 必须进入指纹')
  }
  const otherRange: PackageDto = {
    ...base,
    files: [{ fileId: 'f1', pageRange: '1-2' }, { fileId: 'f2' }],
  }
  if (fingerprintPackageOrderPayload(ranged) === fingerprintPackageOrderPayload(otherRange)) {
    fail('不同 pageRange 必须是不同指纹')
  }
  pass('指纹含 terminalId + 有序 fileIds/pageRanges + copies/colorMode/duplex，别名归一')
}

async function main(): Promise<void> {
  console.log('\n=== 材料包建单耐久幂等（service） ===')
  assertKeyFormat()
  assertCanonicalFingerprint()
  cleanupDb()
  prepareDb()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const capabilities = new TerminalCapabilitiesService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const quotes = new OrderQuoteService(new PrintPageCountService(prisma, storage), new PricingService(prisma), capabilities, prisma)
  const packages = new PackageOrderService(prisma, quotes, capabilities, audit, orderStatus)
  const pickup = new PickupOrderService(prisma, capabilities, audit, new FakeRedis() as unknown as RedisService, storage)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const userA = `eu_pkg_idem_a_${suffix}`
  const userB = `eu_pkg_idem_b_${suffix}`
  const terminalId = `terminal_pkg_idem_${suffix}`
  const fileA1 = `file_pkg_a1_${suffix}`
  const fileA2 = `file_pkg_a2_${suffix}`
  const fileB1 = `file_pkg_b1_${suffix}`
  const storageKeys: string[] = []
  const dtoA: PackageDto = {
    terminalId,
    files: [{ fileId: fileA1 }, { fileId: fileA2 }],
    params: { copies: 1, colorMode: 'black_white', duplex: 'simplex' },
  }

  type OrderMut = {
    create: typeof prisma.order.create
    findFirst: typeof prisma.order.findFirst
    updateMany: typeof prisma.order.updateMany
  }
  const orderMut = prisma.order as unknown as OrderMut

  async function withOrderMutations<T>(
    apply: (delegate: OrderMut, original: OrderMut) => void,
    run: () => Promise<T>,
  ): Promise<T> {
    const original: OrderMut = { create: orderMut.create, findFirst: orderMut.findFirst, updateMany: orderMut.updateMany }
    try {
      apply(orderMut, original)
      return await run()
    } finally {
      orderMut.create = original.create
      orderMut.findFirst = original.findFirst
    }
  }

  function skipIdempotencyLookupOnce(key: string, original: OrderMut): void {
    let skipped = false
    orderMut.findFirst = ((args?: Parameters<typeof prisma.order.findFirst>[0]) => {
      const where = args?.where as { idempotencyKey?: string } | undefined
      if (!skipped && where?.idempotencyKey === key) {
        skipped = true
        return Promise.resolve(null)
      }
      return original.findFirst(args)
    }) as typeof prisma.order.findFirst
  }

  async function seedUser(id: string): Promise<void> {
    await prisma.endUser.create({ data: { id, phoneHash: `hash-${id}`, phoneEnc: `enc-${id}` } })
  }

  async function seedFile(id: string, ownerId: string, label: string): Promise<void> {
    const storageKey = `verify/package-idem/${id}.pdf`
    const pdf = buildRealPdf(2)
    await storage.putObject(storageKey, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    storageKeys.push(storageKey)
    await prisma.fileObject.create({
      data: {
        id, storageKey, bucket: LOCAL_BUCKET_SENTINEL, region: 'local', filename: `${label}.pdf`,
        mimeType: 'application/pdf', sizeBytes: pdf.length,
        sha256: createHash('sha256').update(pdf).digest('hex'), endUserId: ownerId, ownerType: 'user', ownerId,
        purpose: 'print_doc', status: 'active', expiresAt: new Date(Date.now() + 30 * 60 * 60 * 1000),
      },
    })
    const task = await prisma.documentProcessTask.create({
      data: {
        kind: 'pii_scan', status: 'completed', requesterMode: 'member', sourceFileId: id,
        endUserId: ownerId, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        paramsJson: JSON.stringify({ sourceSha256: createHash('sha256').update(pdf).digest('hex') }),
      },
    })
    await prisma.piiFinding.create({ data: { taskId: task.id, type: 'phone', label: '手机号', action: 'keep' } })
  }

  async function createAuditCount(orderId: string): Promise<number> {
    return prisma.auditLog.count({ where: { action: 'member.package_order.create', targetId: orderId } })
  }

  async function insertPackageOrder(opts: {
    id: string
    orderNo: string
    key: string
    code: string
    ownerId: string
    dto: PackageDto
    amountCents?: number
    pickupCodeExpiresAt?: Date
    pickupStatus?: string
    pickupClaimedAt?: Date | null
    payStatus?: string
    paymentSource?: string | null
    paidAt?: Date | null
    taskStatus?: string
  }): Promise<void> {
    const now = new Date()
    const amountCents = opts.amountCents ?? 80
    await prisma.order.create({
      data: {
        id: opts.id,
        orderNo: opts.orderNo,
        type: 'print',
        channel: 'miniapp_cloud',
        endUserId: opts.ownerId,
        terminalId,
        amountCents,
        billablePages: 4,
        itemsJson: '[]',
        payStatus: opts.payStatus ?? 'unpaid',
        paymentSource: opts.paymentSource ?? null,
        paidAt: opts.paidAt ?? null,
        taskStatus: opts.taskStatus ?? 'pending_release',
        pickupCodeHash: hashPickupCode(opts.code),
        pickupCodeEnc: encryptSecret(opts.code),
        pickupCodeCreatedAt: now,
        pickupCodeExpiresAt: opts.pickupCodeExpiresAt ?? new Date(now.getTime() + 60 * 60 * 1000),
        pickupStatus: opts.pickupStatus ?? 'pending',
        pickupClaimedAt: opts.pickupClaimedAt ?? null,
        idempotencyKey: opts.key,
        idempotencyPayloadHash: fingerprintPackageOrderPayload(opts.dto),
        orderItems: {
          create: opts.dto.files.map((file, seq) => ({
            seq,
            fileId: file.fileId,
            colorMode: 'black_white',
            duplex: 'simplex',
            copies: opts.dto.params.copies,
            pageRange: file.pageRange ? file.pageRange : null,
            billablePages: 2,
            amountCents: Math.floor(amountCents / Math.max(opts.dto.files.length, 1)),
          })),
        },
      },
    })
  }

  async function markPaidAuditCount(orderId: string): Promise<number> {
    return prisma.auditLog.count({ where: { action: 'order.mark_paid', targetId: orderId } })
  }

  try {
    setPrintScanCapabilityModeForTest('strict')
    await seedUser(userA)
    await seedUser(userB)
    await prisma.terminal.create({
      data: {
        id: terminalId, terminalCode: `PKGIDEM-${suffix}`, agentToken: `token-${terminalId}`,
        deviceFingerprint: `fp-${terminalId}`, displayName: '材料包幂等终端', locationLabel: '验证点',
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId, status: 'online', localTaskDatabaseAvailable: true, createdAt: new Date() },
    })
    await prisma.terminalCapability.create({
      data: { terminalId, capabilityKey: 'document_print', status: 'available' },
    })
    await seedDevDefaultPriceConfig(prisma)
    await seedFile(fileA1, userA, 'A简历')
    await seedFile(fileA2, userA, 'A附件')
    await seedFile(fileB1, userB, 'B简历')
    pass('隔离库与双用户夹具已建立')

    const missing = await capture(() => packages.create(userA, dtoA))
    if (!missing.thrown || missing.code !== 'IDEMPOTENCY_KEY_REQUIRED') {
      fail(`缺 key 应为 IDEMPOTENCY_KEY_REQUIRED，实际 ${JSON.stringify(missing)}`)
    }
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 0) fail('缺 key 不得建单')
    const invalid = await capture(() => packages.create(userA, dtoA, 'not-a-uuid'))
    if (!invalid.thrown || invalid.code !== 'IDEMPOTENCY_KEY_INVALID') {
      fail(`非法 key 应为 IDEMPOTENCY_KEY_INVALID，实际 ${JSON.stringify(invalid)}`)
    }
    const upperOnly = randomUUID().toUpperCase()
    const upperMissing = await capture(() => packages.create(userA, dtoA, upperOnly))
    if (!upperMissing.thrown || upperMissing.code !== 'IDEMPOTENCY_KEY_INVALID') {
      fail(`大写 UUID 应为 IDEMPOTENCY_KEY_INVALID，实际 ${JSON.stringify(upperMissing)}`)
    }
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 0) fail('大写 key 不得建单')
    pass('T1 缺/非法 key → 400，零行 Order')

    const keyReplay = randomUUID()
    const first = await packages.create(userA, dtoA, keyReplay) as PackageView
    const second = await packages.create(userA, dtoA, keyReplay) as PackageView
    if (second.orderId !== first.orderId || second.pickupCode !== first.pickupCode) {
      fail(`顺序回放必须同一订单同一到机码: ${first.orderId} vs ${second.orderId}`)
    }
    if (second.items.length !== first.items.length || first.items.length !== 2) fail('回放必须带回原文件行')
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 1) fail('顺序回放不得第二张单')
    if (await prisma.orderItem.count({ where: { orderId: first.orderId } }) !== 2) fail('回放不得新增 OrderItem')
    if (await prisma.printTask.count({ where: { orderId: first.orderId } }) !== 0) fail('建单/回放都不得预建 PrintTask')
    if (await createAuditCount(first.orderId) !== 1) fail('顺序回放不得重复 member.package_order.create 审计')
    const upperReplay = await capture(() => packages.create(userA, dtoA, keyReplay.toUpperCase()))
    if (!upperReplay.thrown || upperReplay.code !== 'IDEMPOTENCY_KEY_INVALID') {
      fail(`已有小写 key 后再打大写应为 INVALID，实际 ${JSON.stringify(upperReplay)}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: keyReplay } }) !== 1) fail('大写重试不得改小写那一行')
    if (await prisma.order.count({ where: { idempotencyKey: keyReplay.toUpperCase() } }) !== 0) {
      fail('大写 UUID 不得另建一行')
    }
    pass('T2 同 key 同 payload 顺序回放：一行、同码、同 items、审计 1')
    pass('T2b 大写 UUID 拒绝且零额外 Order')

    const keyConcurrent = randomUUID()
    const raced = await Promise.all([
      packages.create(userA, dtoA, keyConcurrent) as Promise<PackageView>,
      packages.create(userA, dtoA, keyConcurrent) as Promise<PackageView>,
    ])
    if (raced[0].orderId !== raced[1].orderId || raced[0].pickupCode !== raced[1].pickupCode) {
      fail(`并发必须收敛到同一订单: ${raced[0].orderId} vs ${raced[1].orderId}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: keyConcurrent } }) !== 1) fail('并发不得两行')
    if (await prisma.orderItem.count({ where: { orderId: raced[0].orderId } }) !== 2) fail('并发不得复制行')
    if (await createAuditCount(raced[0].orderId) !== 1) fail('并发 loser 回放不得再写 create 审计')
    pass('T3 Promise.all 同 key 收敛到一行且审计 1')

    const keyLost = randomUUID()
    const lost = await packages.create(userA, dtoA, keyLost) as PackageView
    const recovered = await packages.create(userA, dtoA, keyLost) as PackageView
    if (recovered.orderId !== lost.orderId || recovered.pickupCode !== lost.pickupCode) fail('响应丢失后回放必须拿到原单')
    if (await prisma.order.count({ where: { idempotencyKey: keyLost } }) !== 1) fail('丢失回放不得新增行')
    pass('T4 丢掉返回值后再打同 key → 原单原码')

    const keyMismatch = randomUUID()
    const original = await packages.create(userA, dtoA, keyMismatch) as PackageView
    const mismatchCopies = await capture(() => packages.create(userA, { ...dtoA, params: { ...dtoA.params, copies: 2 } }, keyMismatch))
    if (!mismatchCopies.thrown || mismatchCopies.code !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 不同 copies 应为 409 IDEMPOTENCY_KEY_REUSED，实际 ${JSON.stringify(mismatchCopies)}`)
    }
    assertNoLeak(mismatchCopies.body, [original.orderId, original.pickupCode, original.orderNo], 'T5 copies 409')
    const mismatchOrder = await capture(() => packages.create(userA, {
      ...dtoA,
      files: [{ fileId: fileA2 }, { fileId: fileA1 }],
    }, keyMismatch))
    if (!mismatchOrder.thrown || mismatchOrder.code !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 不同文件顺序应为 409，实际 ${JSON.stringify(mismatchOrder)}`)
    }
    const mismatchColor = await capture(() => packages.create(userA, {
      ...dtoA,
      params: { ...dtoA.params, colorMode: 'color' },
    }, keyMismatch))
    if (!mismatchColor.thrown || mismatchColor.code !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 不同 colorMode 应为 409，实际 ${JSON.stringify(mismatchColor)}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: keyMismatch } }) !== 1) fail('payload 冲突不得第二张单')
    pass('T5 同 key 不同 copies/文件顺序/colorMode → 409 且不泄露 id/code')

    const keyAlias = randomUUID()
    const aliased = await packages.create(userA, {
      ...dtoA,
      params: { copies: 1, colorMode: 'bw', duplex: 'single' },
    }, keyAlias) as PackageView
    const canonicalReplay = await packages.create(userA, dtoA, keyAlias) as PackageView
    if (canonicalReplay.orderId !== aliased.orderId || canonicalReplay.pickupCode !== aliased.pickupCode) {
      fail('bw/single 与 black_white/simplex 必须回放到同一张单')
    }
    if (await prisma.order.count({ where: { idempotencyKey: keyAlias } }) !== 1) fail('别名回放不得第二张单')
    pass('T5b bw/single 与 canonical 同指纹回放')

    const keyRange = randomUUID()
    const rangedDto: PackageDto = {
      ...dtoA,
      files: [{ fileId: fileA1, pageRange: '1' }, { fileId: fileA2 }],
    }
    const ranged = await packages.create(userA, rangedDto, keyRange) as PackageView
    const rangedReplay = await packages.create(userA, rangedDto, keyRange) as PackageView
    if (rangedReplay.orderId !== ranged.orderId || rangedReplay.pickupCode !== ranged.pickupCode) {
      fail('同 pageRange 必须回放原单原码')
    }
    if (ranged.items[0]?.pageRange !== '1') fail('建单必须落下 pageRange=1')
    const mismatchRange = await capture(() => packages.create(userA, {
      ...dtoA,
      files: [{ fileId: fileA1, pageRange: '1-2' }, { fileId: fileA2 }],
    }, keyRange))
    if (!mismatchRange.thrown || mismatchRange.code !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 不同 pageRange 应为 409，实际 ${JSON.stringify(mismatchRange)}`)
    }
    assertNoLeak(mismatchRange.body, [ranged.orderId, ranged.pickupCode], 'T5c pageRange 409')
    const mismatchOmitted = await capture(() => packages.create(userA, dtoA, keyRange))
    if (!mismatchOmitted.thrown || mismatchOmitted.code !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 省略 pageRange 应为 409，实际 ${JSON.stringify(mismatchOmitted)}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: keyRange } }) !== 1) fail('pageRange 冲突不得第二张单')
    const emptyReplay = await packages.create(userA, {
      ...dtoA,
      files: dtoA.files.map((file) => ({ ...file, pageRange: '' })),
    }, keyReplay) as PackageView
    if (emptyReplay.orderId !== first.orderId) fail('空串 pageRange 必须与省略同指纹回放')
    pass('T5c 同 key 改 pageRange → 409；精确 replay 仍是原单；空串=省略')

    const sharedKey = randomUUID()
    const aOwned = await packages.create(userA, dtoA, sharedKey) as PackageView
    const bOwned = await packages.create(userB, {
      terminalId,
      files: [{ fileId: fileB1 }],
      params: dtoA.params,
    }, sharedKey) as PackageView
    if (bOwned.orderId === aOwned.orderId) fail('不同用户同 key 不得落到同一张单')
    if (bOwned.pickupCode === aOwned.pickupCode) fail('B 的 view 不得带 A 的到机码')
    assertNoLeak(bOwned, [aOwned.orderId, aOwned.pickupCode], 'T6 B view')
    if (await prisma.order.count({ where: { idempotencyKey: sharedKey } }) !== 2) fail('不同用户同 key 应各有一行')
    pass('T6 不同用户同 key → 各建各的，B 看不到 A 的码')

    const steal = await capture(() => packages.create(userB, dtoA, randomUUID()))
    if (!steal.thrown || steal.code !== 'PRINT_FILE_NOT_FOUND') {
      fail(`B 拿 A 的 fileId 应为 PRINT_FILE_NOT_FOUND，实际 ${JSON.stringify(steal)}`)
    }
    assertNoLeak(steal.body, [aOwned.pickupCode], 'T7')
    pass('T7 B 拿 A 的 fileId → PRINT_FILE_NOT_FOUND，不泄露 A 的码')

    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    const offlineReplay = await packages.create(userA, dtoA, keyReplay) as PackageView
    if (offlineReplay.orderId !== first.orderId || offlineReplay.pickupCode !== first.pickupCode) {
      fail('终端离线后同 key 仍必须回放原单，不得重跑终端检查')
    }
    await prisma.terminalHeartbeat.create({
      data: { terminalId, status: 'online', localTaskDatabaseAvailable: true, createdAt: new Date() },
    })
    pass('T8 终端离线后同 key 仍回放原单')

    const lateKey = randomUUID()
    const lateCode = randomPickupCode()
    const lateId = `ord_pkg_late_${suffix}`
    const lateHash = hashPickupCode(lateCode)
    await insertPackageOrder({
      id: lateId, orderNo: `ORD-PKG-LATE-${suffix}`, key: lateKey, code: lateCode,
      ownerId: userA, dto: dtoA, amountCents: 0, pickupCodeExpiresAt: new Date(Date.now() - 60 * 1000),
    })
    const lateReplay = await capture(() => packages.create(userA, dtoA, lateKey))
    if (lateReplay.thrown) fail(`截止后免费半完成不得抛错: ${JSON.stringify(lateReplay)}`)
    const lateView = lateReplay.body as PackageView & { pickupStatus: string }
    if (lateView.orderId !== lateId) fail('截止后免费半完成必须回放原单')
    if (lateView.pickupStatus !== 'expired' || lateView.payStatus !== 'closed') {
      fail(`截止后免费半完成应为 expired/closed，实际 ${lateView.pickupStatus}/${lateView.payStatus}`)
    }
    if (lateView.pickupCode) fail('截止后免费半完成不得再露出到机码')
    const lateRow = await prisma.order.findUniqueOrThrow({ where: { id: lateId } })
    if (lateRow.pickupCodeHash !== lateHash) fail('截止后免费半完成不得另铸到机码')
    if (lateRow.payStatus !== 'closed' || lateRow.paymentSource) fail('截止后免费半完成不得入账')
    if (await prisma.order.count({ where: { idempotencyKey: lateKey } }) !== 1) fail('截止后免费半完成不得第二张单')
    pass('T8b 截止后免费半完成 → expired/closed，无新码、无第二张单')

    const halfKey = randomUUID()
    const halfCode = randomPickupCode()
    const halfId = `ord_pkg_half_${suffix}`
    await insertPackageOrder({
      id: halfId, orderNo: `ORD-PKG-HALF-${suffix}`, key: halfKey, code: halfCode,
      ownerId: userA, dto: dtoA, amountCents: 0,
    })
    await prisma.auditLog.create({
      data: {
        actorRole: 'system',
        action: 'member.package_order.create',
        targetType: 'order',
        targetId: halfId,
        payloadJson: '{}',
      },
    })
    const halfCreateBefore = await createAuditCount(halfId)
    const halfPaidBefore = await markPaidAuditCount(halfId)
    const halfView = await packages.create(userA, dtoA, halfKey) as PackageView
    if (halfView.orderId !== halfId) fail('截止前免费半完成必须回放原单')
    if (halfView.payStatus !== 'paid' || halfView.pickupCode !== halfCode) {
      fail(`截止前免费半完成应为 paid 且同码，实际 ${halfView.payStatus}/${halfView.pickupCode}`)
    }
    const halfRow = await prisma.order.findUniqueOrThrow({ where: { id: halfId } })
    if (halfRow.payStatus !== 'paid' || halfRow.paymentSource !== 'free') fail('截止前免费半完成必须经 markPaid 收敛')
    if (await createAuditCount(halfId) !== halfCreateBefore) fail('截止前免费半完成回放不得补写 create 审计')
    if (await markPaidAuditCount(halfId) !== halfPaidBefore + 1) fail('截止前免费半完成必须写一笔 order.mark_paid')
    if (await prisma.order.count({ where: { idempotencyKey: halfKey } }) !== 1) fail('截止前免费半完成不得第二张单')
    pass('T8c 截止前免费半完成 unpaid/0 → paid/free，create 审计仍为 1')

    const detailKey = randomUUID()
    const detailCode = randomPickupCode()
    const detailId = `ord_pkg_detail_${suffix}`
    await insertPackageOrder({
      id: detailId, orderNo: `ORD-PKG-DETAIL-${suffix}`, key: detailKey, code: detailCode,
      ownerId: userA, dto: dtoA, amountCents: 80,
      pickupCodeExpiresAt: new Date(Date.now() - 60 * 1000),
    })
    const detailed = await packages.detail(userA, detailId) as PackageView
    if (detailed.orderId !== detailId) fail('过期详情必须回同一张单')
    if (detailed.pickupStatus !== 'expired' || detailed.payStatus !== 'closed') {
      fail(`过期详情应为 expired/closed，实际 ${detailed.pickupStatus}/${detailed.payStatus}`)
    }
    if (detailed.pickupCode) fail('过期详情不得再露出到机码')
    const detailRow = await prisma.order.findUniqueOrThrow({ where: { id: detailId } })
    if (detailRow.pickupStatus !== 'expired' || detailRow.payStatus !== 'closed') {
      fail('过期详情必须把终态落库，不能只在 view 里藏码')
    }

    const listKey = randomUUID()
    const listCode = randomPickupCode()
    const listId = `ord_pkg_list_${suffix}`
    await insertPackageOrder({
      id: listId, orderNo: `ORD-PKG-LIST-${suffix}`, key: listKey, code: listCode,
      ownerId: userA, dto: dtoA, amountCents: 80,
      pickupCodeExpiresAt: new Date(Date.now() - 60 * 1000),
    })
    const listed = await packages.list(userA, { cursor: null, pageSize: 20 })
    const listedRow = listed.items.find((row) => row.orderId === listId)
    if (!listedRow) fail('过期列表必须仍能找回该单')
    if (listedRow.pickupStatus !== 'expired' || listedRow.payStatus !== 'closed') {
      fail(`过期列表应为 expired/closed，实际 ${listedRow.pickupStatus}/${listedRow.payStatus}`)
    }
    if (listedRow.pickupCode) fail('过期列表不得再露出到机码')
    const listDb = await prisma.order.findUniqueOrThrow({ where: { id: listId } })
    if (listDb.pickupStatus !== 'expired' || listDb.payStatus !== 'closed') {
      fail('过期列表必须把终态落库')
    }
    pass('T8d 过期详情/列表与回放同一终态 expired/closed，无活码')

    const casKey = randomUUID()
    const casCode = randomPickupCode()
    const casId = `ord_pkg_cas_${suffix}`
    await insertPackageOrder({
      id: casId, orderNo: `ORD-PKG-CAS-${suffix}`, key: casKey, code: casCode,
      ownerId: userA, dto: dtoA, amountCents: 80,
      pickupCodeExpiresAt: new Date(Date.now() - 60 * 1000),
    })
    type UpdateMany = typeof prisma.order.updateMany
    const originalUpdateMany = orderMut.updateMany.bind(prisma.order) as UpdateMany
    let paidBeforeExpire = false
    orderMut.updateMany = (async (args: Parameters<UpdateMany>[0]) => {
      const where = args?.where as { id?: string; payStatus?: { in?: string[] } } | undefined
      if (!paidBeforeExpire && where?.id === casId && Array.isArray(where.payStatus?.in) && where.payStatus.in.includes('unpaid')) {
        paidBeforeExpire = true
        await originalUpdateMany({
          where: { id: casId, payStatus: 'unpaid' },
          data: { payStatus: 'paid', paymentSource: 'offline', paidAt: new Date(), paidBy: 'system' },
        })
      }
      return originalUpdateMany(args)
    }) as UpdateMany
    try {
      const casReplay = await packages.create(userA, dtoA, casKey) as PackageView
      if (casReplay.orderId !== casId) fail('过期回放并发入账必须仍是原单')
      if (casReplay.pickupStatus !== 'expired') fail(`并发入账后 pickup 应为 expired，实际 ${casReplay.pickupStatus}`)
      if (casReplay.pickupCode) fail('并发入账后过期回放不得再露出到机码')
      const casRow = await prisma.order.findUniqueOrThrow({ where: { id: casId } })
      if (casRow.payStatus !== 'paid' || casRow.paymentSource !== 'offline') {
        fail(`并发 unpaid→paid 不得被过期写成 closed，实际 ${casRow.payStatus}/${casRow.paymentSource}`)
      }
      if (casRow.pickupStatus !== 'expired' || casRow.taskStatus !== 'expired') {
        fail('并发入账后仍应过期 pickup/task')
      }
      if (!paidBeforeExpire) fail('T8e 必须先打到「过期写 unpaid 之前已被入账」这条竞态')
      if (await prisma.order.count({ where: { idempotencyKey: casKey } }) !== 1) fail('并发入账过期不得第二张单')
    } finally {
      orderMut.updateMany = originalUpdateMany
    }
    pass('T8e 过期 CAS：并发 unpaid→paid 保留 paid，只过期 pickup/task')

    const claimedKey = randomUUID()
    const claimedCode = randomPickupCode()
    const claimedId = `ord_pkg_claimed_${suffix}`
    await insertPackageOrder({
      id: claimedId, orderNo: `ORD-PKG-CLAIMED-${suffix}`, key: claimedKey, code: claimedCode,
      ownerId: userA, dto: dtoA, pickupStatus: 'claimed',
    })
    const claimedView = await packages.create(userA, dtoA, claimedKey) as PackageView
    if (claimedView.orderId !== claimedId) fail('claimed 回放必须原单')
    if (claimedView.pickupStatus !== 'claimed') fail(`claimed 回放应保持 claimed，实际 ${claimedView.pickupStatus}`)
    if (claimedView.pickupCode) fail('claimed 回放不得再露出活码')
    if (await prisma.order.count({ where: { idempotencyKey: claimedKey } }) !== 1) fail('claimed 回放不得第二张单')
    pass('T8f claimed 回放原单、无第二张、无活码')

    const leaseUnpaidKey = randomUUID()
    const leaseUnpaidCode = randomPickupCode()
    const leaseUnpaidId = `ord_pkg_lease_unpaid_${suffix}`
    const claimedAt = new Date(Date.now() - 30 * 1000)
    const pastExpiry = new Date(Date.now() - 60 * 1000)
    await insertPackageOrder({
      id: leaseUnpaidId, orderNo: `ORD-PKG-LEASE-U-${suffix}`, key: leaseUnpaidKey, code: leaseUnpaidCode,
      ownerId: userA, dto: dtoA, amountCents: 80,
      pickupStatus: 'claimed', pickupClaimedAt: claimedAt, taskStatus: 'awaiting_payment',
      pickupCodeExpiresAt: pastExpiry,
    })
    const leaseUnpaidReplay = await packages.create(userA, dtoA, leaseUnpaidKey) as PackageView
    if (leaseUnpaidReplay.orderId !== leaseUnpaidId) fail('过期窗口内已认领回放必须原单')
    if (leaseUnpaidReplay.pickupStatus !== 'claimed') fail(`已认领不得被手机过期写成 expired，实际 ${leaseUnpaidReplay.pickupStatus}`)
    if (leaseUnpaidReplay.payStatus !== 'unpaid') fail(`已认领未付不得被关单，实际 ${leaseUnpaidReplay.payStatus}`)
    if (leaseUnpaidReplay.pickupCode) fail('已认领回放不得再露出活码')
    if (!leaseUnpaidReplay.paymentSessionToken) fail('已认领回放仍须签发 paymentSessionToken，一体机才能继续收款/释放')
    const leaseUnpaidDetail = await packages.detail(userA, leaseUnpaidId) as PackageView
    if (leaseUnpaidDetail.pickupStatus !== 'claimed' || leaseUnpaidDetail.payStatus !== 'unpaid' || leaseUnpaidDetail.pickupCode) {
      fail('已认领详情不得过期关单或露出活码')
    }
    if (!leaseUnpaidDetail.paymentSessionToken) fail('已认领详情仍须签发 paymentSessionToken')
    const leaseUnpaidListed = (await packages.list(userA, { cursor: null, pageSize: 20 })).items.find((row) => row.orderId === leaseUnpaidId)
    if (!leaseUnpaidListed) fail('已认领过期窗口订单必须仍能在列表找回')
    if (leaseUnpaidListed.pickupStatus !== 'claimed' || leaseUnpaidListed.payStatus !== 'unpaid' || leaseUnpaidListed.pickupCode) {
      fail('已认领列表不得过期关单或露出活码')
    }
    const leaseUnpaidRow = await prisma.order.findUniqueOrThrow({ where: { id: leaseUnpaidId } })
    if (leaseUnpaidRow.pickupStatus !== 'claimed' || leaseUnpaidRow.payStatus !== 'unpaid' || leaseUnpaidRow.printTaskId) {
      fail('已认领落库必须仍是 claimed/unpaid、printTaskId null（release 前置条件）')
    }
    if (!leaseUnpaidRow.pickupClaimedAt) fail('已认领落库必须保留 pickupClaimedAt')
    if (await prisma.order.count({ where: { idempotencyKey: leaseUnpaidKey } }) !== 1) fail('已认领过期窗口回放不得第二张单')
    if (isPickupWindowClosed(leaseUnpaidRow)) {
      fail('claimed 是一体机履约租约：预认领窗口已过也不得判定窗口关闭')
    }

    const unclaimedExpireKey = randomUUID()
    const unclaimedExpireCode = randomPickupCode()
    const unclaimedExpireId = `ord_pkg_unclaimed_exp_${suffix}`
    await insertPackageOrder({
      id: unclaimedExpireId, orderNo: `ORD-PKG-UNCLAIMED-EXP-${suffix}`, key: unclaimedExpireKey,
      code: unclaimedExpireCode, ownerId: userA, dto: dtoA, amountCents: 80,
      pickupCodeExpiresAt: pastExpiry,
    })
    const unclaimedExpireRow = await prisma.order.findUniqueOrThrow({ where: { id: unclaimedExpireId } })
    if (!isPickupWindowClosed(unclaimedExpireRow)) fail('未认领且窗口已过必须判定关闭（资损防线）')
    const unclaimedPay = await capture(() => orderStatus.markPaid(unclaimedExpireId, { paymentSource: 'offline' }))
    if (!unclaimedPay.thrown || unclaimedPay.code !== 'ORDER_PICKUP_WINDOW_CLOSED') {
      fail(`未认领过期窗口 markPaid 必须拒绝，实际 ${JSON.stringify(unclaimedPay)}`)
    }
    const unclaimedOnline = await capture(() => orderStatus.markPaidOnline(unclaimedExpireId, {
      channel: 'sandbox', attemptId: `pa_unclaimed_${suffix}`, channelTxnNo: `txn_unclaimed_${suffix}`, late: false,
    }))
    if (!unclaimedOnline.thrown || unclaimedOnline.code !== 'ORDER_PICKUP_WINDOW_CLOSED') {
      fail(`未认领过期窗口 markPaidOnline 必须拒绝，实际 ${JSON.stringify(unclaimedOnline)}`)
    }
    const unclaimedClaim = await capture(() => pickup.claim(unclaimedExpireCode, terminalId))
    if (!unclaimedClaim.thrown || unclaimedClaim.code !== 'PICKUP_CODE_EXPIRED') {
      fail(`未认领过期码 re-claim 必须 PICKUP_CODE_EXPIRED，实际 ${JSON.stringify(unclaimedClaim)}`)
    }
    const unclaimedAfterClaim = await prisma.order.findUniqueOrThrow({ where: { id: unclaimedExpireId } })
    if (unclaimedAfterClaim.pickupStatus !== 'expired' || unclaimedAfterClaim.payStatus !== 'closed') {
      fail(`未认领过期 re-claim 必须落 expired/closed，实际 ${unclaimedAfterClaim.pickupStatus}/${unclaimedAfterClaim.payStatus}`)
    }

    const reclaimUnpaid = await pickup.claim(leaseUnpaidCode, terminalId)
    if (reclaimUnpaid.released !== false || reclaimUnpaid.orderId !== leaseUnpaidId || !reclaimUnpaid.paymentSessionToken) {
      fail('已认领过期窗口同机再 claim 必须走幂等租约，不得过期，必须仍给付款令牌')
    }
    const afterReclaim = await prisma.order.findUniqueOrThrow({ where: { id: leaseUnpaidId } })
    if (afterReclaim.pickupStatus !== 'claimed' || afterReclaim.payStatus !== 'unpaid' || afterReclaim.printTaskId) {
      fail(`已认领再 claim 不得拆租约，实际 ${afterReclaim.pickupStatus}/${afterReclaim.payStatus}`)
    }
    const leasePaidOffline = await orderStatus.markPaid(leaseUnpaidId, { paymentSource: 'offline', operatorId: 'verify-t8h' })
    if (leasePaidOffline.payStatus !== 'paid' || leasePaidOffline.paymentSource !== 'offline') {
      fail(`已认领过期窗口必须能线下入账，实际 ${leasePaidOffline.payStatus}/${leasePaidOffline.paymentSource}`)
    }
    if (leasePaidOffline.pickupStatus !== 'claimed') fail('线下入账不得把 claimed 租约写成 expired')
    const releasedLease = await pickup.release(leaseUnpaidId, terminalId, reclaimUnpaid.paymentSessionToken)
    if (!releasedLease.taskId) fail('已认领过期窗口入账后必须能 release')
    const releasedLeaseRow = await prisma.order.findUniqueOrThrow({ where: { id: leaseUnpaidId } })
    if (releasedLeaseRow.pickupStatus !== 'used' || releasedLeaseRow.printTaskId !== releasedLease.taskId) {
      fail(`release 后必须 used 且挂任务，实际 ${releasedLeaseRow.pickupStatus}/${releasedLeaseRow.printTaskId}`)
    }

    const leaseOnlineKey = randomUUID()
    const leaseOnlineCode = randomPickupCode()
    const leaseOnlineId = `ord_pkg_lease_online_${suffix}`
    await insertPackageOrder({
      id: leaseOnlineId, orderNo: `ORD-PKG-LEASE-ON-${suffix}`, key: leaseOnlineKey, code: leaseOnlineCode,
      ownerId: userA, dto: dtoA, amountCents: 80,
      pickupStatus: 'claimed', pickupClaimedAt: claimedAt, taskStatus: 'awaiting_payment',
      pickupCodeExpiresAt: pastExpiry,
    })
    const leaseOnlinePaid = await orderStatus.markPaidOnline(leaseOnlineId, {
      channel: 'sandbox', attemptId: `pa_lease_${suffix}`, channelTxnNo: `txn_lease_${suffix}`, late: false,
    })
    if (leaseOnlinePaid.payStatus !== 'paid' || leaseOnlinePaid.paymentSource !== 'sandbox') {
      fail(`已认领过期窗口必须能线上入账，实际 ${leaseOnlinePaid.payStatus}/${leaseOnlinePaid.paymentSource}`)
    }
    if (leaseOnlinePaid.pickupStatus !== 'claimed' || leaseOnlinePaid.printTaskId) {
      fail('线上入账不得拆 claimed 租约')
    }

    const leasePaidKey = randomUUID()
    const leasePaidCode = randomPickupCode()
    const leasePaidId = `ord_pkg_lease_paid_${suffix}`
    await insertPackageOrder({
      id: leasePaidId, orderNo: `ORD-PKG-LEASE-P-${suffix}`, key: leasePaidKey, code: leasePaidCode,
      ownerId: userA, dto: dtoA, amountCents: 80,
      pickupStatus: 'claimed', pickupClaimedAt: claimedAt, taskStatus: 'awaiting_payment',
      payStatus: 'paid', paymentSource: 'offline', paidAt: new Date(),
      pickupCodeExpiresAt: pastExpiry,
    })
    const leasePaidReplay = await packages.create(userA, dtoA, leasePaidKey) as PackageView
    if (leasePaidReplay.pickupStatus !== 'claimed' || leasePaidReplay.payStatus !== 'paid') {
      fail(`已认领已付必须保持 claimed/paid 才能 release，实际 ${leasePaidReplay.pickupStatus}/${leasePaidReplay.payStatus}`)
    }
    if (leasePaidReplay.pickupCode) fail('已认领已付回放不得再露出活码')
    if (!leasePaidReplay.paymentSessionToken) fail('已认领已付回放仍须签发 paymentSessionToken 给 release')
    const leasePaidRow = await prisma.order.findUniqueOrThrow({ where: { id: leasePaidId } })
    if (leasePaidRow.pickupStatus !== 'claimed' || leasePaidRow.payStatus !== 'paid' || leasePaidRow.paymentSource !== 'offline' || leasePaidRow.printTaskId) {
      fail('已认领已付落库必须仍满足 release：claimed + paid + printTaskId null')
    }
    if (await prisma.order.count({ where: { idempotencyKey: leasePaidKey } }) !== 1) fail('已认领已付回放不得第二张单')
    const paidReclaim = await pickup.claim(leasePaidCode, terminalId)
    if (!paidReclaim.released || !paidReclaim.taskId) fail('已认领已付过期窗口同机再 claim 必须直接 release，不得先写成 expired')
    const paidReclaimRow = await prisma.order.findUniqueOrThrow({ where: { id: leasePaidId } })
    if (paidReclaimRow.pickupStatus !== 'used' || paidReclaimRow.printTaskId !== paidReclaim.taskId) {
      fail(`已认领已付再 claim 必须 used，实际 ${paidReclaimRow.pickupStatus}/${paidReclaimRow.printTaskId}`)
    }
    pass('T8h claimed+过期窗口：认领租约不被手机过期；同机可 markPaid/release；未认领过期仍拒绝入账')

    const usedKey = randomUUID()
    const usedCode = randomPickupCode()
    const usedId = `ord_pkg_used_${suffix}`
    await insertPackageOrder({
      id: usedId, orderNo: `ORD-PKG-USED-${suffix}`, key: usedKey, code: usedCode,
      ownerId: userA, dto: dtoA, pickupStatus: 'used', taskStatus: 'pending',
      payStatus: 'paid', paymentSource: 'offline', paidAt: new Date(),
    })
    const usedPaidBefore = await markPaidAuditCount(usedId)
    const usedView = await packages.create(userA, dtoA, usedKey) as PackageView
    if (usedView.orderId !== usedId) fail('used 回放必须原单')
    if (usedView.pickupStatus !== 'used') fail(`used 回放应保持 used，实际 ${usedView.pickupStatus}`)
    if (usedView.payStatus !== 'paid') fail('used 回放不得改写已付')
    if (usedView.pickupCode) fail('used 回放不得再露出活码')
    if (await markPaidAuditCount(usedId) !== usedPaidBefore) fail('used 回放不得再 markPaid')
    if (await prisma.order.count({ where: { idempotencyKey: usedKey } }) !== 1) fail('used 回放不得第二张单')
    pass('T8g used 回放原单、无第二张、无活码')

    const collideKey = randomUUID()
    const collideCode = randomPickupCode()
    const collideId = `ord_pkg_collide_${suffix}`
    await insertPackageOrder({
      id: collideId, orderNo: `ORD-PKG-COLLIDE-${suffix}`, key: collideKey, code: collideCode,
      ownerId: userA, dto: dtoA,
    })
    let seenSqliteP2002: { code?: string; meta?: unknown } | null = null
    const collideView = await withOrderMutations((delegate, original) => {
      skipIdempotencyLookupOnce(collideKey, original)
      delegate.create = (async (args: Parameters<typeof prisma.order.create>[0]) => {
        try {
          return await original.create(args)
        } catch (error) {
          seenSqliteP2002 = error as { code?: string; meta?: unknown }
          throw error
        }
      }) as typeof prisma.order.create
    }, () => packages.create(userA, dtoA, collideKey)) as PackageView
    if (!seenSqliteP2002 || seenSqliteP2002.code !== 'P2002') {
      fail(`T13 必须打到真实 SQLite P2002，实际 ${JSON.stringify(seenSqliteP2002)}`)
    }
    if (collideView.orderId !== collideId) fail('真实 P2002 必须 scoped lookup 后回放原单')
    if (collideView.pickupCode !== collideCode) fail('真实 P2002 回放必须同一到机码')
    if (await prisma.order.count({ where: { idempotencyKey: collideKey } }) !== 1) fail('真实 P2002 回放不得第二张单')
    pass('T13 真实 SQLite (endUserId,key) 冲突 → scoped lookup 回放')

    const metaKey = randomUUID()
    const metaCode = randomPickupCode()
    const metaId = `ord_pkg_meta_${suffix}`
    await insertPackageOrder({
      id: metaId, orderNo: `ORD-PKG-META-${suffix}`, key: metaKey, code: metaCode,
      ownerId: userA, dto: dtoA,
    })
    let missingMetaCreateCalls = 0
    const metaView = await withOrderMutations((delegate, original) => {
      skipIdempotencyLookupOnce(metaKey, original)
      delegate.create = (async () => {
        missingMetaCreateCalls += 1
        throw { code: 'P2002' }
      }) as typeof prisma.order.create
    }, () => packages.create(userA, dtoA, metaKey)) as PackageView
    if (missingMetaCreateCalls !== 1) fail('缺 meta 的 P2002 必须走过 create catch')
    if (metaView.orderId !== metaId) fail('缺 meta P2002 有 scoped 行时必须回放')
    pass('T13b P2002 缺 meta + scoped 行存在 → 回放（不靠 matcher）')

    const foreignKey = randomUUID()
    const foreignCode = randomPickupCode()
    const foreignId = `ord_pkg_foreign_${suffix}`
    await insertPackageOrder({
      id: foreignId, orderNo: `ORD-PKG-FOREIGN-${suffix}`, key: foreignKey, code: foreignCode,
      ownerId: userB, dto: { terminalId, files: [{ fileId: fileB1 }], params: dtoA.params },
    })
    let foreignCreateCalls = 0
    const foreignRace = await withOrderMutations((delegate, original) => {
      skipIdempotencyLookupOnce(foreignKey, original)
      delegate.create = (async () => {
        foreignCreateCalls += 1
        throw { code: 'P2002' }
      }) as typeof prisma.order.create
    }, () => capture(() => packages.create(userA, dtoA, foreignKey)))
    if (foreignCreateCalls !== 1) fail('跨成员 P2002 必须走过 create catch')
    if (!foreignRace.thrown) fail('跨成员 P2002 不得把 B 的单回放给 A')
    assertNoLeak(foreignRace.body, [foreignId, foreignCode], 'T13c 跨成员 P2002')
    if (await prisma.order.count({ where: { idempotencyKey: foreignKey, endUserId: userA } }) !== 0) {
      fail('跨成员 P2002 不得给 A 留下一行')
    }
    pass('T13c 跨成员同 key 的 P2002 → 不回放 B 的单')

    const orderNoKey = randomUUID()
    let originalError: unknown
    try {
      await withOrderMutations((delegate, original) => {
        delegate.create = (async (args: Parameters<typeof prisma.order.create>[0]) => {
          const data = { ...(args.data as Record<string, unknown>), orderNo: `ORD-PKG-COLLIDE-${suffix}` }
          try {
            return await original.create({ ...args, data } as Parameters<typeof prisma.order.create>[0])
          } catch (error) {
            originalError = error
            throw error
          }
        }) as typeof prisma.order.create
      }, () => packages.create(userA, dtoA, orderNoKey))
      fail('orderNo P2002 应抛出原错误')
    } catch (error) {
      if (error !== originalError) fail('orderNo P2002 必须原样 rethrow，不能包一层')
      if ((error as { code?: string }).code !== 'P2002') fail(`orderNo 应为 P2002，实际 ${(error as { code?: string }).code}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: orderNoKey } }) !== 0) {
      fail('orderNo P2002 不得留下带该 key 的行')
    }
    pass('T13d orderNo P2002 无 scoped 行 → 原样抛出')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    const orderIds = (await prisma.order.findMany({
      where: { endUserId: { in: [userA, userB] } },
      select: { id: true },
    })).map((row) => row.id)
    if (orderIds.length) {
      await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
      await prisma.order.updateMany({ where: { id: { in: orderIds } }, data: { printTaskId: null } })
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
      await prisma.printTaskStatusLog.deleteMany({ where: { task: { endUserId: { in: [userA, userB] } } } }).catch(() => undefined)
      await prisma.printTask.deleteMany({ where: { endUserId: { in: [userA, userB] } } })
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
