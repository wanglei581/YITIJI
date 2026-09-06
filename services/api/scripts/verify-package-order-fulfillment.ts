/**
 * 材料包 v1：三行逐份履约验证。
 *
 * 覆盖：建单只建 OrderItem；release 只建 seq=0；completed 派生下一行；
 * failed 停在当前行；Agent 在存在已完成行时不回领旧任务。
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { AuditService } from '../src/audit/audit.service'
import type { RedisService } from '../src/common/redis/redis.service'
import { PackageOrderService } from '../src/member-print-orders/package-order.service'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { verifyPaymentSessionToken } from '../src/payment/payment-session-token'
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
const dbPath = path.join('/tmp', `verify-package-order-${randomUUID().slice(0, 8)}.db`)
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

function cleanupDb(): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
}

function prepareDb(): void {
  assertIsolatedVerificationDatabase()
  const root = path.join(apiRoot, 'prisma', 'migrations')
  const migrations = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'migration.sql'))
    .sort()
  for (const migration of migrations) {
    execFileSync('sqlite3', [dbPath], { input: readFileSync(migration), stdio: ['pipe', 'pipe', 'pipe'] })
  }
}

async function main(): Promise<void> {
  console.log('\n=== 材料包逐份履约 v1 验证 ===')
  cleanupDb()
  prepareDb()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const capabilities = new TerminalCapabilitiesService(prisma)
  const quotes = new OrderQuoteService(new PrintPageCountService(prisma, storage), new PricingService(prisma), capabilities, prisma)
  const packages = new PackageOrderService(prisma, quotes, capabilities, audit)
  const statuses = new OrderStatusService(prisma, audit)
  const pickup = new PickupOrderService(prisma, capabilities, audit, new FakeRedis() as unknown as RedisService)
  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')
  const agent = new TerminalAgentService(prisma, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const userId = `eu_package_${suffix}`
  const terminalId = `terminal_package_${suffix}`
  const fileIds = [0, 1, 2].map((seq) => `file_package_${seq}_${suffix}`)
  const storageKeys: string[] = []

  async function seedFile(fileId: string, seq: number): Promise<void> {
    const storageKey = `verify/package-order/${fileId}.pdf`
    const pdf = buildRealPdf(2)
    await storage.putObject(storageKey, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    storageKeys.push(storageKey)
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: 'local',
        filename: `材料包第${seq + 1}份.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
        sha256: 'a'.repeat(63) + seq,
        endUserId: userId,
        ownerType: 'user',
        ownerId: userId,
        purpose: 'print_doc',
        status: 'active',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
    const task = await prisma.documentProcessTask.create({
      data: {
        kind: 'pii_scan', status: 'completed', requesterMode: 'member', sourceFileId: fileId,
        endUserId: userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    await prisma.piiFinding.create({ data: { taskId: task.id, type: 'phone', label: '手机号', action: 'keep' } })
  }

  try {
    setPrintScanCapabilityModeForTest('strict')
    await prisma.endUser.create({ data: { id: userId, phoneHash: `hash-${userId}`, phoneEnc: `enc-${userId}` } })
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `PACKAGE-${suffix}`,
        agentToken: `token-${terminalId}`,
        deviceFingerprint: `fp-${terminalId}`,
        displayName: '材料包验证终端',
        locationLabel: '验证点',
      },
    })
    await prisma.terminalHeartbeat.create({ data: { terminalId, status: 'online', localTaskDatabaseAvailable: true } })
    await prisma.terminalCapability.create({ data: { terminalId, capabilityKey: 'document_print', status: 'available' } })
    await seedDevDefaultPriceConfig(prisma)
    await Promise.all(fileIds.map(seedFile))

    const created = await packages.create(userId, {
      terminalId,
      files: fileIds.map((fileId) => ({ fileId })),
      params: { copies: 1, colorMode: 'black_white', duplex: 'simplex' },
    })
    const beforeRelease = await prisma.order.findUnique({
      where: { id: created.orderId }, include: { orderItems: { orderBy: { seq: 'asc' } } },
    })
    if (
      !beforeRelease || beforeRelease.sourceFileId !== null || beforeRelease.printTaskId !== null ||
      beforeRelease.itemsJson !== '[]' || beforeRelease.orderItems.length !== 3 ||
      beforeRelease.orderItems.some((item, seq) => item.seq !== seq || item.printTaskId !== null || item.status !== 'pending')
    ) {
      fail('三行材料包建单必须只落 OrderItem，不能预建任务或复用 itemsJson 存行')
    }
    if (!created.paymentSessionToken || !verifyPaymentSessionToken(created.paymentSessionToken, {
      orderId: created.orderId,
      orderNo: created.orderNo,
      terminalId,
      amountCents: created.amountCents,
      printTaskId: null,
    }).ok) {
      fail('材料包建单必须返回可用于既有支付 API 的 paymentSessionToken')
    }
    pass('三行材料包建单只落 OrderItem；Order.sourceFileId 为空且 itemsJson 未存履约行')
    pass('材料包建单返回既有支付 API 可验证的 paymentSessionToken')

    const claim = await pickup.claim(created.pickupCode!, terminalId)
    await statuses.markPaid(created.orderId, { paymentSource: 'offline', operatorId: 'verify-package' })
    const released = await pickup.release(created.orderId, terminalId, claim.paymentSessionToken)
    const afterRelease = await prisma.order.findUnique({
      where: { id: created.orderId }, include: { orderItems: { orderBy: { seq: 'asc' } } },
    })
    if (
      !afterRelease || afterRelease.printTaskId !== released.taskId ||
      afterRelease.orderItems[0]?.printTaskId !== released.taskId ||
      afterRelease.orderItems[1]?.printTaskId || afterRelease.orderItems[2]?.printTaskId ||
      await prisma.printTask.count({ where: { orderId: created.orderId } }) !== 1
    ) {
      fail('release 必须仅为 seq=0 创建一条 PrintTask')
    }
    pass('release 只创建 seq=0 PrintTask，Order.printTaskId 指向当前任务')

    const authorization = `Bearer token-${terminalId}`
    const firstClaim = await agent.claimTasks(terminalId, { maxTasks: 1 }, authorization)
    if (firstClaim.length !== 1 || firstClaim[0]?.taskId !== released.taskId) {
      fail('Agent 必须先领取 seq=0 当前任务')
    }
    await agent.patchTaskStatus(released.taskId, { status: 'completed' }, authorization, terminalId)
    const afterCompleted = await prisma.order.findUnique({
      where: { id: created.orderId }, include: { orderItems: { orderBy: { seq: 'asc' } } },
    })
    const secondTaskId = afterCompleted?.orderItems[1]?.printTaskId
    if (
      !afterCompleted || !secondTaskId || afterCompleted.printTaskId !== secondTaskId ||
      afterCompleted.taskStatus !== 'pending' || afterCompleted.orderItems[0]?.status !== 'completed' ||
      afterCompleted.orderItems[1]?.status !== 'pending' || afterCompleted.orderItems[2]?.printTaskId
    ) {
      fail('seq=0 completed 后必须仅派生 seq=1 pending 并前移 Order.printTaskId')
    }
    pass('seq=0 completed 后只派生 seq=1 pending，Order.printTaskId 已前移')

    // 弱网重传：同一条 seq=0 的 completed 再报一次，整条链必须是空操作 ——
    // 不得把整单误判成完成、不得再派生任务、不得抛错打断一体机。
    // 实际挡住它的是上游 terminals-agent 的终态幂等（:540），不是履约内部；
    // 本用例钉的是**对外行为**，删掉履约里的幂等短路不会让它转红（已变异验证）。
    await agent.patchTaskStatus(released.taskId, { status: 'completed' }, authorization, terminalId)
    const afterReplay = await prisma.order.findUnique({
      where: { id: created.orderId }, include: { orderItems: { orderBy: { seq: 'asc' } } },
    })
    if (
      !afterReplay || afterReplay.printTaskId !== secondTaskId || afterReplay.taskStatus !== 'pending' ||
      afterReplay.orderItems[1]?.printTaskId !== secondTaskId ||
      afterReplay.orderItems[2]?.printTaskId ||
      await prisma.printTask.count({ where: { orderId: created.orderId } }) !== 2
    ) {
      fail('重传同一条 completed 必须是空操作：整单不得判完成、不得多派任务')
    }
    pass('重传同一条 completed 对外是空操作：订单指针、行状态、任务数都不变')

    const secondClaim = await agent.claimTasks(terminalId, { maxTasks: 1 }, authorization)
    if (secondClaim.length !== 1 || secondClaim[0]?.taskId !== secondTaskId || secondClaim[0]?.taskId === released.taskId) {
      fail('已有 completed 行时 Agent 只能领取当前 seq=1，不得领回旧任务')
    }
    await agent.patchTaskStatus(secondTaskId, { status: 'failed', errorCode: 'PRINT_COMMAND_FAILED' }, authorization, terminalId)
    const afterFailed = await prisma.order.findUnique({
      where: { id: created.orderId }, include: { orderItems: { orderBy: { seq: 'asc' } } },
    })
    if (
      !afterFailed || afterFailed.taskStatus !== 'failed' || afterFailed.orderItems[1]?.status !== 'failed' ||
      afterFailed.orderItems[2]?.printTaskId || await prisma.printTask.count({ where: { orderId: created.orderId } }) !== 2
    ) {
      fail('seq=1 failed 后整单必须停单，seq=2 不得创建任务')
    }
    const afterFailureClaim = await agent.claimTasks(terminalId, { maxTasks: 1 }, authorization)
    if (afterFailureClaim.some((task) => task.taskId === released.taskId || task.taskId === secondTaskId)) {
      fail('失败停单后 Agent claim 不得领取已完成或失败的旧任务')
    }
    pass('seq=1 failed 后整单停在该行、seq=2 未建；Agent 不会领取已完成旧任务')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    const orderIds = (await prisma.order.findMany({ where: { endUserId: userId }, select: { id: true } })).map((row) => row.id)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
    await prisma.order.updateMany({ where: { id: { in: orderIds } }, data: { printTaskId: null } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { task: { endUserId: userId } } })
    await prisma.printTask.deleteMany({ where: { endUserId: userId } })
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
    await prisma.piiFinding.deleteMany({ where: { task: { endUserId: userId } } })
    await prisma.documentProcessTask.deleteMany({ where: { endUserId: userId } })
    await prisma.fileObject.deleteMany({ where: { endUserId: userId } })
    await prisma.endUser.deleteMany({ where: { id: userId } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
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
