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
import { hashPickupCode, randomPickupCode } from '../src/common/pickup-code'
import {
  assertMemberPrintOrderIdempotencyKey,
  fingerprintMemberPrintOrderPayload,
  isMemberPrintOrderIdempotencyConflict,
  MemberPrintOrderCreateService,
} from '../src/member-print-orders/member-print-order-create.service'
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
  const response = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string }; message?: string } | undefined
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
  const quote = new OrderQuoteService(pageCount, pricing)
  const memberOrders = new MemberPrintOrderCreateService(prisma, quote, capabilities, orderStatus, audit)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const userA = `eu_idem_a_${suffix}`
  const userB = `eu_idem_b_${suffix}`
  const terminalId = `terminal_idem_${suffix}`
  const fileA = `file_idem_a_${suffix}`
  const fileB = `file_idem_b_${suffix}`
  const storageKeys: string[] = []

  const dtoA = { fileId: fileA, terminalId, copies: 1, colorMode: 'black_white' as const, duplex: 'simplex' as const }

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
    const halfHash = fingerprintMemberPrintOrderPayload(dtoA)
    const halfCode = randomPickupCode()
    const halfId = `ord_half_${suffix}`
    await prisma.order.create({
      data: {
        id: halfId, orderNo: `ORD-HALF-${suffix}`, type: 'print', channel: 'miniapp_cloud',
        endUserId: userA, terminalId, sourceFileId: fileA, sourceFileName: 'A简历.pdf',
        printParamsJson: JSON.stringify({ copies: 1, colorMode: 'black_white', duplex: 'simplex' }),
        amountCents: 0, billablePages: 2, itemsJson: '[]', payStatus: 'unpaid', taskStatus: 'pending_release',
        pickupCodeHash: hashPickupCode(halfCode), pickupCodeEnc: encryptSecret(halfCode),
        pickupCodeCreatedAt: new Date(), pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        pickupStatus: 'pending', idempotencyKey: halfKey, idempotencyPayloadHash: halfHash,
      },
    })
    const halfView = await memberOrders.create(userA, dtoA, halfKey)
    if (halfView.id !== halfId) fail('半完成免费单必须回放到原行')
    const halfRow = await prisma.order.findUniqueOrThrow({ where: { id: halfId } })
    if (halfRow.payStatus !== 'paid' || halfRow.paymentSource !== 'free') fail('半完成免费单必须经 markPaid 收敛')
    if (halfView.pickupCode !== halfCode) fail('回放必须解出同一到机码')
    if (await prisma.order.count({ where: { idempotencyKey: halfKey } }) !== 1) fail('半完成收敛不得第二张单')
    pass('T8 免费半完成 unpaid/0 → markPaid 收敛，同码')

    const paidKey = randomUUID()
    const paidHash = fingerprintMemberPrintOrderPayload(dtoA)
    const paidCode = randomPickupCode()
    const paidId = `ord_paid_${suffix}`
    await prisma.order.create({
      data: {
        id: paidId, orderNo: `ORD-PAID-${suffix}`, type: 'print', channel: 'miniapp_cloud',
        endUserId: userA, terminalId, sourceFileId: fileA, sourceFileName: 'A简历.pdf',
        printParamsJson: JSON.stringify({ copies: 1, colorMode: 'black_white', duplex: 'simplex' }),
        amountCents: 0, billablePages: 2, itemsJson: '[]', payStatus: 'paid', paymentSource: 'free',
        paidAt: new Date(), taskStatus: 'pending_release',
        pickupCodeHash: hashPickupCode(paidCode), pickupCodeEnc: encryptSecret(paidCode),
        pickupCodeCreatedAt: new Date(), pickupCodeExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        pickupStatus: 'pending', idempotencyKey: paidKey, idempotencyPayloadHash: paidHash,
      },
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

    pass('T11 M2 直调已全部显式给 key（本文件缺 key 用例覆盖 400）')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    const orderIds = (await prisma.order.findMany({
      where: { endUserId: { in: [userA, userB] } },
      select: { id: true },
    })).map((row) => row.id)
    if (orderIds.length) await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
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
