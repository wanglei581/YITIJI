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
import { hashPickupCode, randomPickupCode } from '../src/common/pickup-code'
import { assertMemberPrintOrderIdempotencyKey } from '../src/member-print-orders/member-print-order-create.service'
import {
  fingerprintPackageOrderPayload,
  PackageOrderService,
} from '../src/member-print-orders/package-order.service'
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
  const response = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string }; message?: string }
    | undefined
  return response?.error?.code ?? response?.message ?? ex.message ?? 'UNKNOWN'
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
  payStatus: string
  amountCents: number
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
  for (const raw of ['nope', '123', good.slice(0, 8), 'g'.repeat(36)]) {
    try {
      assertMemberPrintOrderIdempotencyKey(raw)
      fail(`非法 key 应拒绝: ${raw}`)
    } catch (error) {
      if (codeOf(error) !== 'IDEMPOTENCY_KEY_INVALID') fail(`非法 key 错误码: ${codeOf(error)}`)
    }
  }
  pass('缺/非法 Idempotency-Key 分别是 REQUIRED / INVALID')
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
  }
  const orderMut = prisma.order as unknown as OrderMut

  async function withOrderMutations<T>(
    apply: (delegate: OrderMut, original: OrderMut) => void,
    run: () => Promise<T>,
  ): Promise<T> {
    const original: OrderMut = { create: orderMut.create, findFirst: orderMut.findFirst }
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
  }): Promise<void> {
    const now = new Date()
    await prisma.order.create({
      data: {
        id: opts.id,
        orderNo: opts.orderNo,
        type: 'print',
        channel: 'miniapp_cloud',
        endUserId: opts.ownerId,
        terminalId,
        amountCents: 80,
        billablePages: 4,
        itemsJson: '[]',
        payStatus: 'unpaid',
        taskStatus: 'pending_release',
        pickupCodeHash: hashPickupCode(opts.code),
        pickupCodeEnc: encryptSecret(opts.code),
        pickupCodeCreatedAt: now,
        pickupCodeExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        pickupStatus: 'pending',
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
            amountCents: 40,
          })),
        },
      },
    })
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
    pass('T2 同 key 同 payload 顺序回放：一行、同码、同 items、审计 1')

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
