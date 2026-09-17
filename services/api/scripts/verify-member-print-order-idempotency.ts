/**
 * POST /me/print-orders 耐久幂等：隔离 SQLite + 真 MemberPrintOrderCreateService。
 * 不连生产。由 verify:miniapp-cloud-print-m2 串行拉起，进入现有 CI 闭包。
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
import {
  assertMemberPrintOrderIdempotencyKey,
  fingerprintMemberPrintOrderPayload,
  isMemberPrintOrderIdempotencyConflict,
  MemberPrintOrderCreateService,
} from '../src/member-print-orders/member-print-order-create.service'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import { isLiveKioskPickupLease, isPickupWindowClosed, OrderStatusService } from '../src/payment/order-status.service'
import { paymentSessionTtlMs } from '../src/payment/payment-session-token'
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
const dbName = `verify-print-order-idem-${randomUUID().slice(0, 8)}.db`
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

function p2002(target: unknown): { code: string; meta: { target: unknown } } {
  return { code: 'P2002', meta: { target } }
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

function assertMatcher(): void {
  if (!isMemberPrintOrderIdempotencyConflict(p2002('Order_endUserId_idempotencyKey_key'))) {
    fail('constraint 名必须识别为幂等冲突')
  }
  if (!isMemberPrintOrderIdempotencyConflict(p2002(['endUserId', 'idempotencyKey']))) {
    fail('字段数组必须识别为幂等冲突')
  }
  if (isMemberPrintOrderIdempotencyConflict(p2002(['orderNo']))) fail('orderNo P2002 不得当幂等回放')
  if (isMemberPrintOrderIdempotencyConflict(p2002(['pickupCodeHash']))) fail('pickupCodeHash P2002 不得当幂等回放')
  if (isMemberPrintOrderIdempotencyConflict(p2002('Order_orderNo_key'))) fail('orderNo 约束名不得当幂等回放')
  if (isMemberPrintOrderIdempotencyConflict(p2002(['pickupCode']))) fail('pickupCode P2002 不得当幂等回放')
  if (isMemberPrintOrderIdempotencyConflict(p2002(['printTaskId']))) fail('printTaskId P2002 不得当幂等回放')
  if (isMemberPrintOrderIdempotencyConflict(p2002('Order_printTaskId_key'))) fail('printTaskId 约束名不得当幂等回放')
  if (isMemberPrintOrderIdempotencyConflict({ code: 'P2002' })) fail('缺 meta.target 不得吞掉唯一冲突')
  if (isMemberPrintOrderIdempotencyConflict({ code: 'P2003', meta: { target: ['idempotencyKey'] } })) {
    fail('非 P2002 不得当幂等冲突')
  }
  const adapterShape = {
    code: 'P2002',
    meta: {
      modelName: 'Order',
      driverAdapterError: {
        cause: { constraint: { fields: ['endUserId', 'idempotencyKey'] } },
      },
    },
  }
  if (!isMemberPrintOrderIdempotencyConflict(adapterShape)) {
    fail('Prisma 7 SQLite adapter 的 constraint.fields 必须识别为幂等冲突')
  }
  const orderNoAdapter = {
    code: 'P2002',
    meta: { driverAdapterError: { cause: { constraint: { fields: ['orderNo'] } } } },
  }
  if (isMemberPrintOrderIdempotencyConflict(orderNoAdapter)) fail('adapter orderNo 不得当幂等回放')
  pass('P2002 只认 Order_endUserId_idempotencyKey_key，不吞 orderNo/pickupCodeHash')
}

function assertKeyFormat(): void {
  const good = randomUUID()
  if (assertMemberPrintOrderIdempotencyKey(good) !== good) fail('合法 UUID 应原样返回')
  const missing = ['', '   ', null, undefined]
  for (const raw of missing) {
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

async function main(): Promise<void> {
  console.log('\n=== 小程序单件建单耐久幂等 ===')
  assertMatcher()
  assertKeyFormat()
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
  const memberOrders = new MemberPrintOrderCreateService(prisma, quote, capabilities, orderStatus, audit)
  const pickup = new PickupOrderService(prisma, capabilities, audit, new FakeRedis() as unknown as RedisService, storage)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const userA = `eu_idem_a_${suffix}`
  const userB = `eu_idem_b_${suffix}`
  const terminalId = `terminal_idem_${suffix}`
  const fileA = `file_idem_a_${suffix}`
  const fileB = `file_idem_b_${suffix}`
  const storageKeys: string[] = []
  const extraPrintTaskIds: string[] = []

  const dtoA = { fileId: fileA, terminalId, copies: 1, colorMode: 'black_white' as const, duplex: 'simplex' as const }
  const futureExpiry = (): Date => new Date(Date.now() + 60 * 60 * 1000)
  const pastExpiry = (): Date => new Date(Date.now() - 60 * 1000)

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
    const storageKey = `verify/print-idem/${id}.pdf`
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
    return prisma.auditLog.count({ where: { action: 'member.print_order.create', targetId: orderId } })
  }
  async function markPaidAuditCount(orderId: string): Promise<number> {
    return prisma.auditLog.count({ where: { action: 'order.mark_paid', targetId: orderId } })
  }

  async function insertCloudOrder(opts: {
    id: string
    orderNo: string
    key: string
    code: string
    expiresAt: Date
    amountCents?: number
    payStatus?: string
    paymentSource?: string | null
    paidAt?: Date | null
    pickupStatus?: string
    pickupClaimedAt?: Date | null
    taskStatus?: string
    printTaskId?: string | null
    pickupCodeHash?: string
  }): Promise<void> {
    await prisma.order.create({
      data: {
        id: opts.id,
        orderNo: opts.orderNo,
        type: 'print',
        channel: 'miniapp_cloud',
        endUserId: userA,
        terminalId,
        sourceFileId: fileA,
        sourceFileName: 'A简历.pdf',
        printParamsJson: JSON.stringify({ copies: 1, colorMode: 'black_white', duplex: 'simplex' }),
        amountCents: opts.amountCents ?? 0,
        billablePages: 2,
        itemsJson: '[]',
        payStatus: opts.payStatus ?? 'unpaid',
        paymentSource: opts.paymentSource ?? null,
        paidAt: opts.paidAt ?? null,
        pickupCodeHash: opts.pickupCodeHash ?? hashPickupCode(opts.code),
        pickupCodeEnc: encryptSecret(opts.code),
        pickupCodeCreatedAt: new Date(),
        pickupCodeExpiresAt: opts.expiresAt,
        pickupStatus: opts.pickupStatus ?? 'pending',
        pickupClaimedAt: opts.pickupClaimedAt ?? null,
        taskStatus: opts.taskStatus ?? 'pending_release',
        printTaskId: opts.printTaskId ?? null,
        idempotencyKey: opts.key,
        idempotencyPayloadHash: fingerprintMemberPrintOrderPayload(dtoA),
      },
    })
  }

  try {
    setPrintScanCapabilityModeForTest('strict')
    await seedUser(userA)
    await seedUser(userB)
    await prisma.terminal.create({
      data: {
        id: terminalId, terminalCode: `IDEM-${suffix}`, agentToken: `token-${terminalId}`,
        deviceFingerprint: `fp-${terminalId}`, displayName: '幂等验证终端', locationLabel: '验证点',
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId, status: 'online', localTaskDatabaseAvailable: true, createdAt: new Date() },
    })
    await prisma.terminalCapability.create({
      data: { terminalId, capabilityKey: 'document_print', status: 'available' },
    })
    await seedDevDefaultPriceConfig(prisma)
    await seedFile(fileA, userA, 'A简历')
    await seedFile(fileB, userB, 'B简历')
    pass('隔离库与双用户夹具已建立')

    const missing = await capture(() => memberOrders.create(userA, dtoA))
    if (!missing.thrown || missing.code !== 'IDEMPOTENCY_KEY_REQUIRED') {
      fail(`缺 key 应为 IDEMPOTENCY_KEY_REQUIRED，实际 ${JSON.stringify(missing)}`)
    }
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 0) fail('缺 key 不得建单')
    const invalid = await capture(() => memberOrders.create(userA, dtoA, 'not-a-uuid'))
    if (!invalid.thrown || invalid.code !== 'IDEMPOTENCY_KEY_INVALID') {
      fail(`非法 key 应为 IDEMPOTENCY_KEY_INVALID，实际 ${JSON.stringify(invalid)}`)
    }
    pass('T1 缺/非法 key → 400，零行 Order')

    const keyReplay = randomUUID()
    const first = await memberOrders.create(userA, dtoA, keyReplay)
    const second = await memberOrders.create(userA, dtoA, keyReplay)
    if (second.id !== first.id || second.pickupCode !== first.pickupCode) {
      fail(`顺序回放必须同一订单同一到机码: ${first.id} vs ${second.id}`)
    }
    if (await prisma.order.count({ where: { endUserId: userA } }) !== 1) fail('顺序回放不得第二张单')
    if (await createAuditCount(first.id) !== 1) fail('顺序回放不得重复 member.print_order.create 审计')
    pass('T2 同 key 同 payload 顺序回放：一行、同码、审计 1')

    const keyConcurrent = randomUUID()
    const raced = await Promise.all([
      memberOrders.create(userA, dtoA, keyConcurrent),
      memberOrders.create(userA, dtoA, keyConcurrent),
    ])
    if (raced[0].id !== raced[1].id || raced[0].pickupCode !== raced[1].pickupCode) {
      fail(`并发必须收敛到同一订单: ${raced[0].id} vs ${raced[1].id}`)
    }
    if (await prisma.order.count({ where: { idempotencyKey: keyConcurrent } }) !== 1) fail('并发不得两行')
    if (await createAuditCount(raced[0].id) !== 1) fail('并发 loser 回放不得再写 create 审计')
    pass('T3 Promise.all 同 key 收敛到一行且审计 1')

    const keyLost = randomUUID()
    const lost = await memberOrders.create(userA, dtoA, keyLost)
    const recovered = await memberOrders.create(userA, dtoA, keyLost)
    if (recovered.id !== lost.id || recovered.pickupCode !== lost.pickupCode) fail('响应丢失后回放必须拿到原单')
    if (await prisma.order.count({ where: { idempotencyKey: keyLost } }) !== 1) fail('丢失回放不得新增行')
    pass('T4 丢掉返回值后再打同 key → 原单')

    const keyMismatch = randomUUID()
    const original = await memberOrders.create(userA, dtoA, keyMismatch)
    const mismatch = await capture(() => memberOrders.create(userA, { ...dtoA, copies: 2 }, keyMismatch))
    if (!mismatch.thrown || mismatch.code !== 'IDEMPOTENCY_KEY_REUSED') {
      fail(`同 key 不同 payload 应为 409 IDEMPOTENCY_KEY_REUSED，实际 ${JSON.stringify(mismatch)}`)
    }
    assertNoLeak(mismatch.body, [original.id, original.pickupCode], 'T5 409')
    if (await prisma.order.count({ where: { idempotencyKey: keyMismatch } }) !== 1) fail('payload 冲突不得第二张单')
    pass('T5 同 key 不同 payload → 409 且不泄露 id/code')

    const sharedKey = randomUUID()
    const aOwned = await memberOrders.create(userA, dtoA, sharedKey)
    const bOwned = await memberOrders.create(userB, { ...dtoA, fileId: fileB }, sharedKey)
    if (bOwned.id === aOwned.id) fail('不同用户同 key 不得落到同一张单')
    if (bOwned.pickupCode === aOwned.pickupCode) fail('B 的 view 不得带 A 的到机码')
    assertNoLeak(bOwned, [aOwned.id, aOwned.pickupCode], 'T6 B view')
    if (await prisma.order.count({ where: { idempotencyKey: sharedKey } }) !== 2) fail('不同用户同 key 应各有一行')
    pass('T6 不同用户同 key → 各建各的，B 看不到 A 的码')

    const steal = await capture(() => memberOrders.create(userB, dtoA, randomUUID()))
    if (!steal.thrown || steal.code !== 'PRINT_FILE_NOT_FOUND') {
      fail(`B 拿 A 的 fileId 应为 PRINT_FILE_NOT_FOUND，实际 ${JSON.stringify(steal)}`)
    }
    assertNoLeak(steal.body, [aOwned.pickupCode], 'T7')
    pass('T7 B 拿 A 的 fileId → PRINT_FILE_NOT_FOUND，不泄露 A 的码')

    const halfKey = randomUUID()
    const halfCode = randomPickupCode()
    const halfId = `ord_half_${suffix}`
    await insertCloudOrder({
      id: halfId, orderNo: `ORD-HALF-${suffix}`, key: halfKey, code: halfCode, expiresAt: futureExpiry(),
    })
    const halfView = await memberOrders.create(userA, dtoA, halfKey)
    if (halfView.id !== halfId) fail('半完成免费单必须回放到原行')
    const halfRow = await prisma.order.findUniqueOrThrow({ where: { id: halfId } })
    if (halfRow.payStatus !== 'paid' || halfRow.paymentSource !== 'free') fail('半完成免费单必须经 markPaid 收敛')
    if (halfView.pickupCode !== halfCode) fail('回放必须解出同一到机码')
    if (await prisma.order.count({ where: { idempotencyKey: halfKey } }) !== 1) fail('半完成收敛不得第二张单')
    pass('T8 截止前免费半完成 unpaid/0 → markPaid 收敛，同码')

    const lateKey = randomUUID()
    const lateCode = randomPickupCode()
    const lateId = `ord_late_${suffix}`
    const lateHash = hashPickupCode(lateCode)
    await insertCloudOrder({
      id: lateId, orderNo: `ORD-LATE-${suffix}`, key: lateKey, code: lateCode, expiresAt: pastExpiry(),
    })
    const latePaidBefore = await markPaidAuditCount(lateId)
    const lateReplay = await capture(() => memberOrders.create(userA, dtoA, lateKey))
    if (lateReplay.thrown) fail(`截止后半完成不得抛错: ${JSON.stringify(lateReplay)}`)
    const lateView = lateReplay.body as { id: string; pickupStatus: string; payStatus: string; pickupCode: string | null }
    if (lateView.id !== lateId) fail('截止后半完成必须回放原单')
    if (lateView.pickupStatus !== 'expired' || lateView.payStatus !== 'closed') {
      fail(`截止后半完成应为 expired/closed，实际 ${lateView.pickupStatus}/${lateView.payStatus}`)
    }
    if (lateView.pickupCode) fail('截止后半完成不得再露出到机码')
    const lateRow = await prisma.order.findUniqueOrThrow({ where: { id: lateId } })
    if (lateRow.pickupCodeHash !== lateHash) fail('截止后半完成不得另铸到机码')
    if (lateRow.payStatus !== 'closed' || lateRow.paymentSource) fail('截止后半完成不得入账')
    if (await markPaidAuditCount(lateId) !== latePaidBefore) fail('截止后半完成不得写 order.mark_paid')
    if (await prisma.order.count({ where: { idempotencyKey: lateKey } }) !== 1) fail('截止后半完成不得第二张单')
    pass('T8b 截止后免费半完成 → expired/closed，无支付副作用、无新码')

    const unclaimedList = await memberOrders.listCloud(userA)
    const unclaimedListed = unclaimedList.find((row) => row.id === lateId)
    if (!unclaimedListed) fail('未认领过期单必须仍能在 listCloud 找回')
    if (unclaimedListed.pickupStatus !== 'expired' || unclaimedListed.payStatus !== 'closed' || unclaimedListed.pickupCode) {
      fail(`listCloud 未认领过期必须 expired/closed/无码，实际 ${unclaimedListed.pickupStatus}/${unclaimedListed.payStatus}`)
    }
    const unclaimedDetail = await memberOrders.detail(userA, lateId)
    if (unclaimedDetail.pickupStatus !== 'expired' || unclaimedDetail.payStatus !== 'closed' || unclaimedDetail.pickupCode) {
      fail('detail 未认领过期必须 expired/closed/无码')
    }

    const claimedAt = new Date(Date.now() - 30 * 1000)
    const claimedKey = randomUUID()
    const claimedCode = randomPickupCode()
    const claimedId = `ord_claimed_${suffix}`
    await insertCloudOrder({
      id: claimedId, orderNo: `ORD-CLAIMED-${suffix}`, key: claimedKey, code: claimedCode,
      expiresAt: pastExpiry(), pickupStatus: 'claimed', pickupClaimedAt: claimedAt,
      taskStatus: 'awaiting_payment', amountCents: 80,
    })
    const claimedReplay = await capture(() => memberOrders.create(userA, dtoA, claimedKey))
    if (claimedReplay.thrown) fail(`已认领过期窗口回放不得抛错: ${JSON.stringify(claimedReplay)}`)
    const claimedView = claimedReplay.body as { id: string; pickupStatus: string; payStatus: string; pickupCode: string | null }
    if (claimedView.id !== claimedId) fail('已认领过期窗口必须回放原单')
    if (claimedView.pickupStatus !== 'claimed' || claimedView.payStatus !== 'unpaid') {
      fail(`已认领租约必须仍是 claimed/unpaid，实际 ${claimedView.pickupStatus}/${claimedView.payStatus}`)
    }
    if (claimedView.pickupCode) fail('已认领回放不得再露出到机码')
    if (await markPaidAuditCount(claimedId) !== 0) fail('已认领回放不得由手机 markPaid')
    const claimedRow = await prisma.order.findUniqueOrThrow({ where: { id: claimedId } })
    if (isPickupWindowClosed(claimedRow)) fail('claimed 活租约不得判定窗口关闭')
    if (claimedRow.printTaskId) fail('已认领回放不得预建 PrintTask')
    const claimedDetail = await memberOrders.detail(userA, claimedId)
    if (claimedDetail.pickupStatus !== 'claimed' || claimedDetail.payStatus !== 'unpaid' || claimedDetail.pickupCode) {
      fail('detail 不得把活租约过期或露出到机码')
    }
    const claimedListed = (await memberOrders.listCloud(userA)).find((row) => row.id === claimedId)
    if (!claimedListed) fail('已认领过期窗口订单必须仍能在 listCloud 找回')
    if (claimedListed.pickupStatus !== 'claimed' || claimedListed.payStatus !== 'unpaid' || claimedListed.pickupCode) {
      fail('listCloud 不得把活租约过期或露出到机码')
    }

    const liveCodeKey = randomUUID()
    const liveCode = randomPickupCode()
    const liveCodeId = `ord_claimed_livecode_${suffix}`
    await insertCloudOrder({
      id: liveCodeId, orderNo: `ORD-CLAIMED-LIVE-${suffix}`, key: liveCodeKey, code: liveCode,
      expiresAt: futureExpiry(), pickupStatus: 'claimed', pickupClaimedAt: claimedAt,
      taskStatus: 'awaiting_payment', amountCents: 80,
    })
    const liveCodeView = await memberOrders.create(userA, dtoA, liveCodeKey)
    if (liveCodeView.pickupStatus !== 'claimed' || liveCodeView.pickupCode) {
      fail(`窗口未到的 claimed 也不得把到机码回给手机，实际 status=${liveCodeView.pickupStatus} code=${liveCodeView.pickupCode}`)
    }

    const reclaimUnpaid = await pickup.claim(claimedCode, terminalId)
    if (reclaimUnpaid.released !== false || reclaimUnpaid.orderId !== claimedId || !reclaimUnpaid.paymentSessionToken) {
      fail('已认领过期窗口同机再 claim 必须走幂等租约并仍给付款令牌')
    }
    const afterReclaim = await prisma.order.findUniqueOrThrow({ where: { id: claimedId } })
    if (afterReclaim.pickupStatus !== 'claimed' || afterReclaim.payStatus !== 'unpaid') {
      fail(`再 claim 不得拆租约，实际 ${afterReclaim.pickupStatus}/${afterReclaim.payStatus}`)
    }
    const claimedPaid = await orderStatus.markPaid(claimedId, { paymentSource: 'offline', operatorId: 'verify-t8c' })
    if (claimedPaid.payStatus !== 'paid' || claimedPaid.pickupStatus !== 'claimed') {
      fail(`已认领过期窗口必须能线下入账且保持 claimed，实际 ${claimedPaid.payStatus}/${claimedPaid.pickupStatus}`)
    }
    const releasedClaimed = await pickup.release(claimedId, terminalId, reclaimUnpaid.paymentSessionToken)
    if (!releasedClaimed.taskId) fail('已认领过期窗口入账后必须能 release')
    const releasedClaimedRow = await prisma.order.findUniqueOrThrow({ where: { id: claimedId } })
    if (releasedClaimedRow.pickupStatus !== 'used' || releasedClaimedRow.printTaskId !== releasedClaimed.taskId) {
      fail(`release 后必须 used，实际 ${releasedClaimedRow.pickupStatus}/${releasedClaimedRow.printTaskId}`)
    }

    const claimedPaidKey = randomUUID()
    const claimedPaidCode = randomPickupCode()
    const claimedPaidId = `ord_claimed_paid_${suffix}`
    await insertCloudOrder({
      id: claimedPaidId, orderNo: `ORD-CLAIMED-PAID-${suffix}`, key: claimedPaidKey, code: claimedPaidCode,
      expiresAt: pastExpiry(), pickupStatus: 'claimed', pickupClaimedAt: claimedAt,
      taskStatus: 'awaiting_payment', amountCents: 80,
      payStatus: 'paid', paymentSource: 'offline', paidAt: new Date(),
    })
    const claimedPaidView = await memberOrders.create(userA, dtoA, claimedPaidKey)
    if (claimedPaidView.pickupStatus !== 'claimed' || claimedPaidView.payStatus !== 'paid' || claimedPaidView.pickupCode) {
      fail(`已认领已付过期窗口必须保持 claimed/paid/无码，实际 ${claimedPaidView.pickupStatus}/${claimedPaidView.payStatus}`)
    }
    const paidReclaim = await pickup.claim(claimedPaidCode, terminalId)
    if (!paidReclaim.released || !paidReclaim.taskId) fail('已认领已付过期窗口同机再 claim 必须直接 release')
    pass('T8c claimed 活租约不被手机过期；无码；同机可 markPaid/release；未认领过期仍收敛')

    const ttlNow = new Date()
    const ttlMs = paymentSessionTtlMs()
    const liveUnpaid = {
      pickupStatus: 'claimed', printTaskId: null, payStatus: 'unpaid',
      pickupClaimedAt: new Date(ttlNow.getTime() - ttlMs + 1), pickupCodeExpiresAt: pastExpiry(),
    }
    if (!isLiveKioskPickupLease(liveUnpaid, ttlNow)) fail('TTL 内未付 claimed 必须 live')
    const edgeUnpaid = { ...liveUnpaid, pickupClaimedAt: new Date(ttlNow.getTime() - ttlMs) }
    if (isLiveKioskPickupLease(edgeUnpaid, ttlNow) || !isPickupWindowClosed(edgeUnpaid, ttlNow)) {
      fail('TTL 边界未付 claimed 必须关窗，不得退回原码截止')
    }
    const missingTs = {
      pickupStatus: 'claimed', printTaskId: null, payStatus: 'unpaid',
      pickupClaimedAt: null, pickupCodeExpiresAt: futureExpiry(),
    }
    if (isLiveKioskPickupLease(missingTs, ttlNow) || !isPickupWindowClosed(missingTs, ttlNow)) {
      fail('缺 pickupClaimedAt 不得永久活，即使原码截止未到')
    }
    const paidPastLease = {
      pickupStatus: 'claimed', printTaskId: null, payStatus: 'paid',
      pickupClaimedAt: new Date(ttlNow.getTime() - ttlMs * 3), pickupCodeExpiresAt: pastExpiry(),
    }
    if (!isLiveKioskPickupLease(paidPastLease, ttlNow) || isPickupWindowClosed(paidPastLease, ttlNow)) {
      fail('claimed+paid 跨 lease 仍须 live，允许 release')
    }
    const prevTtl = process.env['PAYMENT_SESSION_TTL_SECONDS']
    process.env['PAYMENT_SESSION_TTL_SECONDS'] = '60'
    try {
      if (paymentSessionTtlMs() !== 60_000) fail('PAYMENT_SESSION_TTL_SECONDS=60 必须生效')
      const envNow = new Date()
      const within = { pickupStatus: 'claimed', printTaskId: null, payStatus: 'unpaid', pickupClaimedAt: new Date(envNow.getTime() - 59_000) }
      const outside = { ...within, pickupClaimedAt: new Date(envNow.getTime() - 60_000) }
      if (!isLiveKioskPickupLease(within, envNow) || isLiveKioskPickupLease(outside, envNow)) {
        fail('租约 TTL 必须跟支付会话 env，不得另开一套时钟')
      }
    } finally {
      if (prevTtl === undefined) delete process.env['PAYMENT_SESSION_TTL_SECONDS']
      else process.env['PAYMENT_SESSION_TTL_SECONDS'] = prevTtl
    }

    const staleClaimedAt = new Date(Date.now() - paymentSessionTtlMs() - 1000)
    const missingKey = randomUUID()
    const missingCode = randomPickupCode()
    const missingId = `ord_claimed_missing_ts_${suffix}`
    await insertCloudOrder({
      id: missingId, orderNo: `ORD-CLAIMED-MISS-${suffix}`, key: missingKey, code: missingCode,
      expiresAt: futureExpiry(), pickupStatus: 'claimed', pickupClaimedAt: null,
      taskStatus: 'awaiting_payment', amountCents: 80,
    })
    const missingPay = await capture(() => orderStatus.markPaid(missingId, { paymentSource: 'offline' }))
    if (!missingPay.thrown || missingPay.code !== 'ORDER_PICKUP_WINDOW_CLOSED') {
      fail(`缺时间戳 claimed markPaid 必须拒绝，实际 ${JSON.stringify(missingPay)}`)
    }
    const missingReplay = await memberOrders.create(userA, dtoA, missingKey)
    if (missingReplay.pickupStatus !== 'expired' || missingReplay.payStatus !== 'closed') {
      fail(`缺时间戳 claimed 回放必须收敛 expired/closed，实际 ${missingReplay.pickupStatus}/${missingReplay.payStatus}`)
    }

    const outerKey = randomUUID()
    const outerCode = randomPickupCode()
    const outerId = `ord_claimed_outer_${suffix}`
    await insertCloudOrder({
      id: outerId, orderNo: `ORD-CLAIMED-OUTER-${suffix}`, key: outerKey, code: outerCode,
      expiresAt: pastExpiry(), pickupStatus: 'claimed', pickupClaimedAt: staleClaimedAt,
      taskStatus: 'awaiting_payment', amountCents: 80,
    })
    const outerPay = await capture(() => orderStatus.markPaid(outerId, { paymentSource: 'offline' }))
    if (!outerPay.thrown || outerPay.code !== 'ORDER_PICKUP_WINDOW_CLOSED') {
      fail(`lease 外未付 markPaid 必须拒绝，实际 ${JSON.stringify(outerPay)}`)
    }
    const outerReplay = await memberOrders.create(userA, dtoA, outerKey)
    if (outerReplay.pickupStatus !== 'expired' || outerReplay.payStatus !== 'closed' || outerReplay.pickupCode) {
      fail(`lease 外回放必须收敛 expired/closed/无码，实际 ${outerReplay.pickupStatus}/${outerReplay.payStatus}`)
    }
    const outerDetail = await memberOrders.detail(userA, outerId)
    if (outerDetail.pickupStatus !== 'expired' || outerDetail.payStatus !== 'closed') fail('lease 外 detail 必须收敛')
    const outerListed = (await memberOrders.listCloud(userA)).find((row) => row.id === outerId)
    if (!outerListed || outerListed.pickupStatus !== 'expired' || outerListed.payStatus !== 'closed') {
      fail('lease 外 listCloud 必须收敛')
    }
    const outerClaim = await capture(() => pickup.claim(outerCode, terminalId))
    if (!outerClaim.thrown || outerClaim.code !== 'PICKUP_CODE_EXPIRED') {
      fail(`lease 外同机 reclaim 必须拒绝，实际 ${JSON.stringify(outerClaim)}`)
    }
    const outerRow = await prisma.order.findUniqueOrThrow({ where: { id: outerId } })
    if (outerRow.pickupStatus !== 'expired' || outerRow.payStatus !== 'closed') {
      fail(`lease 外 reclaim 必须落 expired/closed，实际 ${outerRow.pickupStatus}/${outerRow.payStatus}`)
    }

    const paidOuterKey = randomUUID()
    const paidOuterCode = randomPickupCode()
    const paidOuterId = `ord_claimed_paid_outer_${suffix}`
    await insertCloudOrder({
      id: paidOuterId, orderNo: `ORD-CLAIMED-PAID-OUTER-${suffix}`, key: paidOuterKey, code: paidOuterCode,
      expiresAt: pastExpiry(), pickupStatus: 'claimed', pickupClaimedAt: staleClaimedAt,
      taskStatus: 'awaiting_payment', amountCents: 80,
      payStatus: 'paid', paymentSource: 'offline', paidAt: new Date(),
    })
    const paidOuterReplay = await memberOrders.create(userA, dtoA, paidOuterKey)
    if (paidOuterReplay.pickupStatus !== 'claimed' || paidOuterReplay.payStatus !== 'paid') {
      fail(`claimed+paid 跨 lease 回放不得关单，实际 ${paidOuterReplay.pickupStatus}/${paidOuterReplay.payStatus}`)
    }
    const paidOuterRelease = await pickup.claim(paidOuterCode, terminalId)
    if (!paidOuterRelease.released || !paidOuterRelease.taskId) fail('claimed+paid 跨 lease 同机仍须 release')
    pass('T8c2 claimed 租约 TTL：边界/缺时间戳/lease 外未付收敛；已付跨 lease 仍 release')

    const paidKey = randomUUID()
    const paidCode = randomPickupCode()
    const paidId = `ord_paid_${suffix}`
    await insertCloudOrder({
      id: paidId, orderNo: `ORD-PAID-${suffix}`, key: paidKey, code: paidCode, expiresAt: futureExpiry(),
      payStatus: 'paid', paymentSource: 'free', paidAt: new Date(),
    })
    const paidBefore = await markPaidAuditCount(paidId)
    const paidView = await memberOrders.create(userA, dtoA, paidKey)
    if (paidView.id !== paidId || paidView.pickupCode !== paidCode) fail('已 paid 免费单必须回放原单原码')
    if (await markPaidAuditCount(paidId) !== paidBefore) fail('已 paid 回放不得再写 order.mark_paid')
    if (await createAuditCount(paidId) !== 0) fail('已 paid 回放不得补写 create 审计')
    pass('T9 已 paid 免费回放：原单、不重复 mark_paid/create 审计')

    const cancelKey = randomUUID()
    const cancellable = await memberOrders.create(userA, dtoA, cancelKey)
    await memberOrders.cancel(userA, cancellable.id, { reason: 'idempotency replay' })
    const cancelledReplay = await memberOrders.create(userA, dtoA, cancelKey)
    if (cancelledReplay.id !== cancellable.id) fail('取消态必须回放原单')
    if (cancelledReplay.pickupStatus !== 'cancelled') fail('取消态回放应仍是 cancelled')
    if (cancelledReplay.pickupCode) fail('取消态不得再露出到机码')
    if (await prisma.order.count({ where: { idempotencyKey: cancelKey } }) !== 1) fail('取消后再打同 key 不得第二张单')
    pass('T10 取消态回放原单，不建第二张')

    const reorderAfterCancel = await memberOrders.create(userA, dtoA, randomUUID())
    if (reorderAfterCancel.id === cancellable.id) fail('取消后新 key 必须是新的商业意图')
    if (reorderAfterCancel.pickupStatus !== 'pending') fail('取消后新 key 应建出 pending 新单')
    pass('T10b 取消后新 key = 新单（前端清记录再铸键）')

    const expiredPaidKey = randomUUID()
    const expiredPaidCode = randomPickupCode()
    const expiredPaidId = `ord_exp_paid_${suffix}`
    const expiredPaidHash = hashPickupCode(expiredPaidCode)
    await insertCloudOrder({
      id: expiredPaidId, orderNo: `ORD-EXPPAID-${suffix}`, key: expiredPaidKey, code: expiredPaidCode,
      expiresAt: pastExpiry(), payStatus: 'paid', paymentSource: 'free', paidAt: new Date(),
    })
    const expiredPaidBefore = await markPaidAuditCount(expiredPaidId)
    const expiredPaidView = await memberOrders.create(userA, dtoA, expiredPaidKey)
    if (expiredPaidView.id !== expiredPaidId) fail('过期已付必须回放原单')
    if (expiredPaidView.pickupStatus !== 'expired') fail('过期已付回放应为 expired')
    if (expiredPaidView.pickupCode) fail('过期已付不得再露出到机码')
    const expiredPaidRow = await prisma.order.findUniqueOrThrow({ where: { id: expiredPaidId } })
    if (expiredPaidRow.pickupCodeHash !== expiredPaidHash) fail('过期已付不得另铸到机码')
    if (expiredPaidRow.payStatus !== 'paid') fail('过期已付不得改支付态')
    if (await markPaidAuditCount(expiredPaidId) !== expiredPaidBefore) fail('过期已付不得再 markPaid')
    pass('T12 过期已付回放原单终态，无新码、无支付副作用')

    const reorderAfterExpire = await memberOrders.create(userA, dtoA, randomUUID())
    if (reorderAfterExpire.id === expiredPaidId) fail('过期后新 key 必须是新单')
    pass('T12b 过期后新 key = 新单（前端清记录再铸键）')

    const collideKey = randomUUID()
    const collideCode = randomPickupCode()
    const collideId = `ord_collide_${suffix}`
    await insertCloudOrder({
      id: collideId, orderNo: `ORD-COLLIDE-${suffix}`, key: collideKey, code: collideCode,
      expiresAt: futureExpiry(), payStatus: 'paid', paymentSource: 'free', paidAt: new Date(),
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
    }, () => memberOrders.create(userA, dtoA, collideKey))
    if (!seenSqliteP2002 || seenSqliteP2002.code !== 'P2002') {
      fail(`T13 必须打到真实 SQLite P2002，实际 ${JSON.stringify(seenSqliteP2002)}`)
    }
    if (collideView.id !== collideId) fail('真实 P2002 必须 scoped lookup 后回放原单')
    if (await prisma.order.count({ where: { idempotencyKey: collideKey } }) !== 1) fail('真实 P2002 回放不得第二张单')
    pass(`T13 真实 SQLite (endUserId,key) 冲突 → scoped lookup 回放（meta=${JSON.stringify(seenSqliteP2002.meta ?? null)}）`)

    const metaKey = randomUUID()
    const metaCode = randomPickupCode()
    const metaId = `ord_meta_${suffix}`
    await insertCloudOrder({
      id: metaId, orderNo: `ORD-META-${suffix}`, key: metaKey, code: metaCode,
      expiresAt: futureExpiry(), payStatus: 'paid', paymentSource: 'free', paidAt: new Date(),
    })
    let missingMetaCreateCalls = 0
    const metaView = await withOrderMutations((delegate, original) => {
      skipIdempotencyLookupOnce(metaKey, original)
      delegate.create = (async () => {
        missingMetaCreateCalls += 1
        throw { code: 'P2002' }
      }) as typeof prisma.order.create
    }, () => memberOrders.create(userA, dtoA, metaKey))
    if (missingMetaCreateCalls !== 1) fail('缺 meta 的 P2002 必须走过 create catch')
    if (metaView.id !== metaId) fail('缺 meta P2002 有 scoped 行时必须回放')
    if (isMemberPrintOrderIdempotencyConflict({ code: 'P2002' })) fail('matcher 对缺 meta 仍须 false')
    pass('T13b P2002 缺 meta + scoped 行存在 → 回放（不靠 matcher）')

    async function assertUnrelatedUniqueRethrown(
      label: string,
      mutate: (data: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<void> {
      const newKey = randomUUID()
      let originalError: unknown
      try {
        await withOrderMutations((delegate, original) => {
          delegate.create = (async (args: Parameters<typeof prisma.order.create>[0]) => {
            const data = mutate({ ...(args.data as Record<string, unknown>) })
            try {
              return await original.create({ ...args, data } as Parameters<typeof prisma.order.create>[0])
            } catch (error) {
              originalError = error
              throw error
            }
          }) as typeof prisma.order.create
        }, () => memberOrders.create(userA, dtoA, newKey))
        fail(`${label} 应抛出原 P2002`)
      } catch (error) {
        if (error !== originalError) fail(`${label} 必须原样 rethrow，不能包一层`)
        if ((error as { code?: string }).code !== 'P2002') fail(`${label} 应为 P2002，实际 ${(error as { code?: string }).code}`)
      }
      if (await prisma.order.count({ where: { idempotencyKey: newKey } }) !== 0) {
        fail(`${label} 不得留下带该 key 的行`)
      }
      pass(label)
    }

    await assertUnrelatedUniqueRethrown('T13c orderNo P2002 无 scoped 行 → 原样抛出', (data) => ({
      ...data, orderNo: 'ORD-HALF-' + suffix,
    }))
    await assertUnrelatedUniqueRethrown('T13d pickupCodeHash P2002 无 scoped 行 → 原样抛出', (data) => ({
      ...data, pickupCodeHash: lateHash,
    }))

    const taskId = `ptask_idem_${suffix}`
    extraPrintTaskIds.push(taskId)
    await prisma.printTask.create({
      data: { id: taskId, fileUrl: 'sig://verify-idem', fileMd5: '0'.repeat(64), paramsJson: '{}' },
    })
    await prisma.order.create({
      data: {
        orderNo: `ORD-PTASK-${suffix}`, type: 'print', channel: 'miniapp_cloud',
        endUserId: userA, printTaskId: taskId, amountCents: 0, itemsJson: '[]', printParamsJson: '{}',
        payStatus: 'unpaid', taskStatus: 'pending',
      },
    })
    await assertUnrelatedUniqueRethrown('T13e printTaskId P2002 无 scoped 行 → 原样抛出', (data) => ({
      ...data, printTaskId: taskId,
    }))

    pass('T11 M2 直调已全部显式给 key（本文件缺 key 用例覆盖 400）')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    const orderIds = (await prisma.order.findMany({
      where: { endUserId: { in: [userA, userB] } },
      select: { id: true },
    })).map((row) => row.id)
    if (orderIds.length) {
      await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
      await prisma.order.updateMany({ where: { id: { in: orderIds } }, data: { printTaskId: null } })
    }
    await prisma.printTask.deleteMany({
      where: { OR: [{ id: { in: extraPrintTaskIds } }, { endUserId: { in: [userA, userB] } }] },
    })
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
