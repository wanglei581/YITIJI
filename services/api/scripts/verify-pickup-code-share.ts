/**
 * F-02 到机码：可分享、一次性、付款起 7 天、作废重发、终端/来源限流，
 * 以及小程序付款满 7 天未取的整单自动退。
 *
 * 接在 verify:print-jobs 后面，因此 CI 的 SQLite 与 postgres-readiness 都会跑到。
 * 不连远程库。Redis 用进程内替身；调用方若注入 REDIS_URL，本脚本不 FLUSH。
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const callerUrl = process.env.DATABASE_URL ?? ''
const callerIsolated = process.env.VERIFICATION_DATABASE_TARGET === 'isolated'
  && (callerUrl.startsWith('file:') || callerUrl.startsWith('postgres://') || callerUrl.startsWith('postgresql://'))
if (!callerIsolated) {
  process.env.DATABASE_URL = 'file:/private/tmp/claude-501/-Users-wanglei-AI----------claude-worktrees-qingxu-51-page-migration-a4d688/7eff7052-a11a-47ac-a4e4-a7e1cc1baa5a/scratchpad/pickup-verify.db'
  process.env.VERIFICATION_DATABASE_TARGET = 'isolated'
}
process.env.NODE_ENV = 'test'
process.env.FILE_STORAGE_DRIVER = 'local'
process.env.FILE_STORAGE_DIR = process.env.FILE_STORAGE_DIR || '/tmp/pickup-verify-files'
process.env.FILE_SIGNING_SECRET = process.env.FILE_SIGNING_SECRET || 'verify-file-signing-secret-0123456789abcdef'
process.env.PAYMENT_SESSION_SECRET = process.env.PAYMENT_SESSION_SECRET || 'verify-payment-session-secret-0123456789abcdef'
process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || 'verify-secret-encryption-key-0123456789abcdef'
process.env.TERMINAL_ADMIN_SECRET = process.env.TERMINAL_ADMIN_SECRET || 'verify-terminal-admin-secret-0123456789abcdef'
process.env.TERMINAL_ACTION_TOKEN_SECRET = process.env.TERMINAL_ACTION_TOKEN_SECRET || 'verify-terminal-action-token-secret-0123456789abcdef'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-jwt-secret-0123456789abcdef'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/14'

import { AuditService } from '../src/audit/audit.service'
import { resetRedisCooldownForTests } from '../src/common/redis/redis-degradation'
import type { RedisService } from '../src/common/redis/redis.service'
import { PICKUP_REISSUE_STUCK_CLAIM_MS, PickupCodeReissueService } from '../src/member-print-orders/pickup-code-reissue.service'
import { MemberPrintOrderCreateService } from '../src/member-print-orders/member-print-order-create.service'
import { PackageOrderService } from '../src/member-print-orders/package-order.service'
import { PickupExpiryRefundService } from '../src/payment/pickup-expiry-refund.service'
import { PICKUP_VALIDITY_FROM_PAYMENT_MS } from '../src/payment/pickup-validity'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { RefundService } from '../src/payment/refund.service'
import { PICKUP_LOCKOUT_FAILURE_THRESHOLD } from '../src/print-jobs/pickup-claim-lockout'
import { PICKUP_CLAIM_SOURCE_RATE_LIMIT } from '../src/print-jobs/pickup-claim-rate-limit'
import {
  PICKUP_CLAIM_MEMORY_MAX_KEYS,
  memoryHas,
  memoryIncrement,
  memorySet,
  resetPickupClaimMemoryFallbackForTests,
} from '../src/print-jobs/pickup-claim-memory'
import { PICKUP_RELEASED_REPLAY_MS, PickupOrderService } from '../src/print-jobs/pickup-order.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'
import { setPrintScanCapabilityModeForTest, TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

const apiRoot = path.resolve(__dirname, '..')
const DAY = 24 * 60 * 60 * 1000

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

function codeOf(error: unknown): string {
  const ex = error as { getResponse?: () => unknown; response?: unknown; message?: string }
  const response = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string }; message?: string } | undefined
  return response?.error?.code ?? response?.message ?? ex.message ?? 'UNKNOWN'
}

async function capture(action: () => Promise<unknown>): Promise<{ thrown: boolean; status: number | null; code: string | null; message: string | null }> {
  try {
    await action()
    return { thrown: false, status: null, code: null, message: null }
  } catch (error) {
    const ex = error as { getStatus?: () => number; getResponse?: () => unknown }
    const status = typeof ex.getStatus === 'function' ? ex.getStatus() : null
    const body = typeof ex.getResponse === 'function' ? ex.getResponse() : null
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error
    return { thrown: true, status, code: err?.code ?? null, message: err?.message ?? null }
  }
}

class FakeRedis {
  private store = new Map<string, string>()
  failing = false
  private guard(): void { if (this.failing) throw new Error('FakeRedis: simulated outage') }
  async get(key: string): Promise<string | null> { this.guard(); return this.store.get(key) ?? null }
  async setEx(key: string, _ttl: number, value: string): Promise<void> { this.guard(); this.store.set(key, value) }
  async del(key: string): Promise<number> { this.guard(); return this.store.delete(key) ? 1 : 0 }
  async incrWithTtl(key: string, _ttl: number): Promise<number> {
    this.guard()
    const next = Number(this.store.get(key) ?? '0') + 1
    this.store.set(key, String(next))
    return next
  }
  reset(): void { this.store.clear() }
}

function assertStaticWiring(): void {
  const controller = readFileSync(path.join(apiRoot, 'src/member-print-orders/member-print-orders.controller.ts'), 'utf8')
  const task = readFileSync(path.join(apiRoot, 'src/payment/pickup-expiry-refund.task.ts'), 'utf8')
  const paymentModule = readFileSync(path.join(apiRoot, 'src/payment/payment.module.ts'), 'utf8')
  if (!controller.includes("@Post(':orderId/reissue-pickup-code')")) fail('作废重发必须挂在现有会员订单路由上')
  if (!task.includes("PICKUP_EXPIRY_AUTO_REFUND_ENABLED'] === 'true'")) fail('自动退清扫必须沿用 env 门控')
  if (!task.includes('CronExpression.EVERY_10_MINUTES') || !paymentModule.includes('PickupExpiryRefundTask')) {
    fail('自动退清扫必须注册成 10 分钟 cron')
  }
  pass('作废重发路由与到期自动退 cron 已接到现有模块')
}

function sqlitePath(): string {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.startsWith('file:')) return ''
  return url.slice('file:'.length).split(/[?#]/, 1)[0] ?? ''
}

function applySqliteMigrations(dbPath: string): void {
  const migrationsRoot = path.join(apiRoot, 'prisma', 'migrations')
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(migrationsRoot, entry.name, 'migration.sql'))
    .sort()
  for (const migration of migrations) {
    execFileSync('sqlite3', [dbPath], { input: readFileSync(migration), stdio: ['pipe', 'pipe', 'pipe'] })
  }
}

async function main(): Promise<void> {
  console.log('\n=== F-02 到机码分享 / 7 天 / 作废重发 / 限流 / 到期整单退 ===')
  assertIsolatedVerificationDatabase()
  assertStaticWiring()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    await prisma.order.findFirst({ select: { id: true } })
  } catch {
    const dbPath = sqlitePath()
    if (!dbPath) fail('PostgreSQL 验证库缺少 Order 表，请先 migrate deploy')
    applySqliteMigrations(dbPath)
  }

  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const capabilities = new TerminalCapabilitiesService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const quote = new OrderQuoteService(pageCount, pricing, capabilities, prisma)
  const memberOrders = new MemberPrintOrderCreateService(prisma, quote, capabilities, orderStatus, audit)
  const packages = new PackageOrderService(prisma, quote, capabilities, audit, orderStatus)
  const reissue = new PickupCodeReissueService(prisma, audit, memberOrders, packages)
  const redis = new FakeRedis()
  const pickup = new PickupOrderService(prisma, capabilities, audit, redis as unknown as RedisService, storage)
  const refunds = new RefundService(prisma, audit, new PaymentProviderRegistry([]))
  const sweep = new PickupExpiryRefundService(prisma, refunds, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const userId = `eu_f02_${suffix}`
  const otherUserId = `eu_f02_other_${suffix}`
  const terminalId = `terminal_f02_${suffix}`
  const otherTerminalId = `terminal_f02_b_${suffix}`
  const fileId = `file_f02_${suffix}`
  const fileName = `简历-张三-机密-${suffix}.pdf`
  const storageKey = `verify/pickup-share/${fileId}.pdf`
  const storageKeys = [storageKey]

  async function seedTerminal(id: string, code: string, displayName: string): Promise<void> {
    await prisma.terminal.create({
      data: {
        id,
        terminalCode: code,
        agentToken: `token-${id}`,
        deviceFingerprint: `fp-${id}`,
        displayName,
        locationLabel: '验证网点',
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId: id, status: 'online', localTaskDatabaseAvailable: true },
    })
    await prisma.terminalCapability.create({
      data: { terminalId: id, capabilityKey: 'document_print', status: 'available' },
    })
  }

  try {
    setPrintScanCapabilityModeForTest('strict')
    await prisma.endUser.create({ data: { id: userId, phoneHash: `hash-${userId}`, phoneEnc: `enc-${userId}` } })
    await prisma.endUser.create({ data: { id: otherUserId, phoneHash: `hash-${otherUserId}`, phoneEnc: `enc-${otherUserId}` } })
    await seedTerminal(terminalId, `F02-${suffix}`, '青序验证大厅')
    await seedTerminal(otherTerminalId, `F02B-${suffix}`, '另一网点')
    await seedDevDefaultPriceConfig(prisma)
    const pdf = buildRealPdf(2)
    await storage.putObject(storageKey, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    const sha = createHash('sha256').update(pdf).digest('hex')
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: 'local',
        filename: fileName,
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
        sha256: sha,
        endUserId: userId,
        ownerType: 'user',
        ownerId: userId,
        purpose: 'print_doc',
        status: 'active',
        expiresAt: new Date(Date.now() + 30 * 60 * 60 * 1000),
      },
    })
    const scan = await prisma.documentProcessTask.create({
      data: {
        kind: 'pii_scan',
        status: 'completed',
        requesterMode: 'member',
        sourceFileId: fileId,
        endUserId: userId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        paramsJson: JSON.stringify({ sourceSha256: sha }),
      },
    })
    await prisma.piiFinding.create({ data: { taskId: scan.id, type: 'phone', label: '手机号', action: 'keep' } })

    const created = await memberOrders.create(
      userId,
      { fileId, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' },
      randomUUID(),
    )
    const createdRow = await prisma.order.findUniqueOrThrow({ where: { id: created.id } })
    const fileRow = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } })
    if (!created.pickupCode || !created.share) fail('建单必须返回到机码和分享载荷')
    const shareKeys = Object.keys(created.share).sort().join(',')
    if (shareKeys !== 'outletName,pickupCode') fail(`分享载荷只能有码和网点名，实际 ${shareKeys}`)
    if (created.share.pickupCode !== created.pickupCode || created.share.outletName !== '青序验证大厅') {
      fail(`分享内容应为 8 位码 + 网点名，实际 ${JSON.stringify(created.share)}`)
    }
    if ('fileName' in created.share || 'amountCents' in created.share || created.share.outletName.includes('简历')) {
      fail('分享载荷不得含文件名或金额')
    }
    if (!fileRow.expiresAt || !createdRow.pickupCodeExpiresAt || createdRow.pickupCodeExpiresAt.getTime() > fileRow.expiresAt.getTime()) {
      fail('未付款到机码仍不得超过源文件有效期')
    }
    pass('未付款分享载荷只有 8 位码和网点名；截止被源文件夹取')

    const wrongTerminal = await capture(() => pickup.claim(created.pickupCode!, otherTerminalId, 'cross-src'))
    const unknownCode = await capture(() => pickup.claim('00000000', otherTerminalId, 'cross-src'))
    if (!wrongTerminal.thrown || !unknownCode.thrown || JSON.stringify(wrongTerminal) !== JSON.stringify(unknownCode)) {
      fail(`跨网点/终端必须与不存在的码同一响应。错终端 ${JSON.stringify(wrongTerminal)} 未知 ${JSON.stringify(unknownCode)}`)
    }
    if (wrongTerminal.code !== 'PICKUP_CODE_INVALID') fail(`跨终端应是 PICKUP_CODE_INVALID，实际 ${wrongTerminal.code}`)
    pass('跨网点/终端与未知码返回同一拒绝，不泄露码是否存在')

    redis.reset()
    await orderStatus.markPaid(created.id, { paymentSource: 'offline', operatorId: 'verify-f02' })
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: created.id } })
    const paidFile = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } })
    if (!paid.paidAt || !paid.pickupCodeExpiresAt) fail('付款后缺少 paidAt 或到机码截止')
    const anchored = paid.pickupCodeExpiresAt.getTime() - paid.paidAt.getTime()
    if (Math.abs(anchored - PICKUP_VALIDITY_FROM_PAYMENT_MS) > 5_000) {
      fail(`付款后有效期必须是 7 天，偏差 ${anchored - PICKUP_VALIDITY_FROM_PAYMENT_MS}ms`)
    }
    if (!paidFile.expiresAt || paidFile.expiresAt.getTime() + 1_000 < paid.pickupCodeExpiresAt.getTime()) {
      fail('付款后源文件必须覆盖到机码截止')
    }
    pass('付款后到机码从 paidAt 起 7 天，源文件延长到同一截止')

    const previousExpiry = paid.pickupCodeExpiresAt.getTime()
    const reissued = await reissue.reissue(userId, created.id)
    if (!reissued.pickupCode || reissued.pickupCode === created.pickupCode) fail('重发必须换成新的 8 位码')
    if (!reissued.share || reissued.share.pickupCode !== reissued.pickupCode || reissued.share.outletName !== '青序验证大厅') {
      fail(`重发后的分享载荷不对：${JSON.stringify(reissued.share)}`)
    }
    if ('fileName' in reissued.share || 'amountCents' in reissued.share) fail('重发分享载荷不得含文件名或金额')
    const reissuedRow = await prisma.order.findUniqueOrThrow({ where: { id: created.id } })
    if (reissuedRow.pickupCodeExpiresAt?.getTime() !== previousExpiry) fail('重发不得顺延 7 天截止')
    const oldClaim = await capture(() => pickup.claim(created.pickupCode!, terminalId, 'owner'))
    if (!oldClaim.thrown || oldClaim.code !== 'PICKUP_CODE_INVALID') {
      fail(`作废后的旧码必须拒绝，实际 ${JSON.stringify(oldClaim)}`)
    }
    const foreign = await capture(() => reissue.reissue(otherUserId, created.id))
    if (!foreign.thrown || foreign.code !== 'PRINT_ORDER_NOT_FOUND') fail(`他人不得重发，实际 ${JSON.stringify(foreign)}`)
    const reissueAudit = await prisma.auditLog.findFirst({
      where: { action: 'print_order.pickup_code_reissued', targetId: created.id },
    })
    if (!reissueAudit || reissueAudit.payloadJson.includes(reissued.pickupCode!)) fail('重发审计不得写下明文码')
    pass('作废重发：旧码立即无效，截止不变，分享仍只有码和网点名')

    const packageOrder = await packages.create(userId, {
      terminalId,
      files: [{ fileId }],
      params: { copies: 1, colorMode: 'black_white', duplex: 'simplex' },
    }, randomUUID())
    const packageBefore = await prisma.order.findUniqueOrThrow({ where: { id: packageOrder.orderId } })
    if (packageBefore.sourceFileId !== null || !packageBefore.pickupCodeHash) fail('材料包主单必须没有 sourceFileId，且已签发到机码')
    const packageReissued = await reissue.reissue(userId, packageOrder.orderId)
    if (!packageReissued.pickupCode || packageReissued.pickupCode === packageOrder.pickupCode) {
      fail(`材料包必须重发成新码，实际 ${packageReissued.pickupCode ?? 'missing'}`)
    }
    const packageAfter = await prisma.order.findUniqueOrThrow({ where: { id: packageOrder.orderId } })
    if (packageAfter.pickupCodeHash === packageBefore.pickupCodeHash) fail('材料包重发必须换掉旧哈希')
    const packageOld = await capture(() => pickup.claim(packageOrder.pickupCode!, terminalId, 'pkg-old'))
    if (!packageOld.thrown || packageOld.code !== 'PICKUP_CODE_INVALID') {
      fail(`材料包旧码必须立即失效，实际 ${JSON.stringify(packageOld)}`)
    }
    const packageNew = await pickup.claim(packageReissued.pickupCode, terminalId, 'pkg-new')
    if (packageNew.orderId !== packageOrder.orderId || packageNew.released) {
      fail(`材料包新码必须认领同一张未付款单，实际 ${JSON.stringify(packageNew)}`)
    }
    pass('材料包可以作废重发：新码可认领，旧码立即失效')

    if (PICKUP_REISSUE_STUCK_CLAIM_MS !== 15 * 60 * 1000) fail('卡死认领的重发门槛必须是 15 分钟')
    redis.reset()
    const liveOrder = await memberOrders.create(
      userId,
      { fileId, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' },
      randomUUID(),
    )
    const liveClaim = await pickup.claim(liveOrder.pickupCode!, terminalId, 'live-claim')
    if (liveClaim.released) fail('未付款认领不得直接出纸')
    const liveHash = (await prisma.order.findUniqueOrThrow({ where: { id: liveOrder.id } })).pickupCodeHash
    const blockedReissue = await capture(() => reissue.reissue(userId, liveOrder.id))
    if (!blockedReissue.thrown || blockedReissue.code !== 'PICKUP_CODE_NOT_REISSUABLE') {
      fail(`认领中不得重发，实际 ${JSON.stringify(blockedReissue)}`)
    }
    const stillLive = await prisma.order.findUniqueOrThrow({ where: { id: liveOrder.id } })
    if (stillLive.pickupStatus !== 'claimed' || stillLive.pickupCodeHash !== liveHash) fail('认领中的重发不得改状态或换码')
    const stillCode = await pickup.claim(liveOrder.pickupCode!, terminalId, 'live-claim')
    if (stillCode.released || stillCode.orderId !== liveOrder.id) fail('认领中的原码必须仍然有效')
    await prisma.order.update({
      where: { id: liveOrder.id },
      data: { pickupClaimedAt: new Date(Date.now() - PICKUP_REISSUE_STUCK_CLAIM_MS - 1000) },
    })
    const stuck = await reissue.reissue(userId, liveOrder.id)
    if (!stuck.pickupCode || stuck.pickupCode === liveOrder.pickupCode) fail('卡死超过 15 分钟必须重发新码')
    const stuckOld = await capture(() => pickup.claim(liveOrder.pickupCode!, terminalId, 'stuck-old'))
    if (!stuckOld.thrown || stuckOld.code !== 'PICKUP_CODE_INVALID') {
      fail(`卡死重发后旧码必须失效，实际 ${JSON.stringify(stuckOld)}`)
    }
    const stuckRow = await prisma.order.findUniqueOrThrow({ where: { id: liveOrder.id } })
    if (stuckRow.pickupStatus !== 'pending' || stuckRow.pickupClaimedAt) fail('卡死重发必须回到未认领')
    pass('认领中不可重发；卡死超过 15 分钟可以重发并作废旧码')

    await prisma.order.update({
      where: { id: created.id },
      data: { paidAt: new Date(Date.now() - 8 * DAY), pickupCodeExpiresAt: new Date(Date.now() + 30 * DAY) },
    })
    const tampered = await capture(() => pickup.claim(reissued.pickupCode!, terminalId, 'owner'))
    if (!tampered.thrown || tampered.code !== 'PICKUP_CODE_EXPIRED') {
      fail(`付款已满 7 天必须拒绝，即使截止被改到未来。实际 ${JSON.stringify(tampered)}`)
    }
    await prisma.order.update({
      where: { id: created.id },
      data: {
        payStatus: 'paid',
        pickupStatus: 'pending',
        taskStatus: 'pending_release',
        paidAt: paid.paidAt,
        pickupCodeExpiresAt: paid.pickupCodeExpiresAt,
      },
    })
    pass('过期码（付款满 7 天）拒绝，且不因改写截止而放行')

    redis.reset()
    const released = await pickup.claim(reissued.pickupCode!, terminalId, 'owner')
    if (!released.released || !released.taskId) fail('付款后的新码必须一次核销并释放任务')
    const releasedJson = JSON.stringify(released)
    if (!released.fileName || released.fileName === fileName || !released.fileName.endsWith('.pdf') || !released.fileName.startsWith('简')) {
      fail(`核销回执文件名必须打码，实际 ${released.fileName}`)
    }
    if (released.billablePages !== created.billablePages) fail(`核销回执必须带页数，实际 ${released.billablePages}`)
    if ('amountCents' in released || releasedJson.includes(fileName)) fail('核销回执不得带金额或完整文件名')
    if (PICKUP_RELEASED_REPLAY_MS !== 10 * 60 * 1000) fail('同机重试窗口必须是核销后 10 分钟')
    const beforeReplay = await prisma.order.findUniqueOrThrow({ where: { id: created.id } })
    const tasksBeforeReplay = await prisma.printTask.count({ where: { endUserId: userId } })
    const releasedReplay = await pickup.claim(reissued.pickupCode!, terminalId, 'owner')
    if (!releasedReplay.released || releasedReplay.taskId !== released.taskId || releasedReplay.orderId !== created.id) {
      fail(`同机 10 分钟内再输码必须交回原任务视图，实际 ${JSON.stringify(releasedReplay)}`)
    }
    const afterReplay = await prisma.order.findUniqueOrThrow({ where: { id: created.id } })
    const tasksAfterReplay = await prisma.printTask.count({ where: { endUserId: userId } })
    if (
      afterReplay.updatedAt.getTime() !== beforeReplay.updatedAt.getTime()
      || afterReplay.pickupStatus !== beforeReplay.pickupStatus
      || afterReplay.printTaskId !== beforeReplay.printTaskId
      || afterReplay.taskStatus !== beforeReplay.taskStatus
      || tasksAfterReplay !== tasksBeforeReplay
    ) {
      fail('同机重试不得建任务、出纸或改订单状态')
    }
    const otherTerminalReplay = await capture(() => pickup.claim(reissued.pickupCode!, otherTerminalId, 'owner-other'))
    if (!otherTerminalReplay.thrown || otherTerminalReplay.code !== 'PICKUP_CODE_INVALID') {
      fail(`其它终端再输已核销码必须拒绝，实际 ${JSON.stringify(otherTerminalReplay)}`)
    }
    await prisma.printTask.update({
      where: { id: released.taskId! },
      data: { createdAt: new Date(Date.now() - PICKUP_RELEASED_REPLAY_MS - 1000) },
    })
    const lateReplay = await capture(() => pickup.claim(reissued.pickupCode!, terminalId, 'owner-late'))
    if (!lateReplay.thrown || lateReplay.code !== 'PICKUP_CODE_ALREADY_USED') {
      fail(`超过 10 分钟必须拒绝，实际 ${JSON.stringify(lateReplay)}`)
    }
    const afterLate = await prisma.order.findUniqueOrThrow({ where: { id: created.id } })
    if (afterLate.printTaskId !== beforeReplay.printTaskId || await prisma.printTask.count({ where: { endUserId: userId } }) !== tasksBeforeReplay) {
      fail('超时拒绝不得再建任务')
    }
    const usedRow = await prisma.order.findUniqueOrThrow({ where: { id: created.id } })
    const taskCount = await prisma.printTask.count({ where: { endUserId: userId } })
    if (!usedRow.printTaskId || taskCount !== 1) fail(`重复核销不得再创建打印任务，实际任务数 ${taskCount}`)
    const usedReissue = await capture(() => reissue.reissue(userId, created.id))
    if (!usedReissue.thrown || usedReissue.code !== 'PICKUP_CODE_NOT_REISSUABLE') {
      fail(`已核销不得重发，实际 ${JSON.stringify(usedReissue)}`)
    }
    pass('同机 10 分钟内再输已核销码交回原任务且不改状态；其它终端或超过 10 分钟拒绝，事后重发也拒绝')

    redis.reset()
    for (let i = 0; i < PICKUP_LOCKOUT_FAILURE_THRESHOLD; i += 1) {
      await capture(() => pickup.claim(`1000000${i}`.slice(0, 8), otherTerminalId, 'lock-src'))
    }
    const locked = await capture(() => pickup.claim('10000099', otherTerminalId, 'lock-src'))
    if (locked.code !== 'PICKUP_CLAIM_LOCKED') fail(`多次输错后必须锁定该终端，实际 ${JSON.stringify(locked)}`)
    const otherOpen = await capture(() => pickup.claim('10000098', terminalId, 'lock-src'))
    if (otherOpen.code === 'PICKUP_CLAIM_LOCKED') fail('锁定不得蔓延到其它终端')
    pass('多次输错仍按终端锁定，其它终端不受影响')

    redis.reset()
    const rateOrder = await memberOrders.create(
      userId,
      { fileId, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' },
      randomUUID(),
    )
    await prisma.order.update({
      where: { id: rateOrder.id },
      data: { pickupCodeExpiresAt: new Date(Date.now() - 60_000) },
    })
    for (let i = 0; i < PICKUP_CLAIM_SOURCE_RATE_LIMIT; i += 1) {
      const hit = await capture(() => pickup.claim(rateOrder.pickupCode!, terminalId, 'source-a'))
      if (hit.code !== 'PICKUP_CODE_EXPIRED') fail(`限流前过期码应拒绝为过期，第 ${i + 1} 次 ${JSON.stringify(hit)}`)
    }
    const limited = await capture(() => pickup.claim(rateOrder.pickupCode!, terminalId, 'source-a'))
    if (limited.status !== 429 || limited.code !== 'PICKUP_CLAIM_RATE_LIMITED') {
      fail(`同一来源超过 ${PICKUP_CLAIM_SOURCE_RATE_LIMIT} 次必须限流，实际 ${JSON.stringify(limited)}`)
    }
    const otherSource = await capture(() => pickup.claim(rateOrder.pickupCode!, terminalId, 'source-b'))
    if (otherSource.code !== 'PICKUP_CODE_EXPIRED') {
      fail(`其它来源不应被这个来源的限额拖死，实际 ${JSON.stringify(otherSource)}`)
    }
    const sameSourceOtherTerminal = await capture(() => pickup.claim('20000000', otherTerminalId, 'source-a'))
    if (sameSourceOtherTerminal.code !== 'PICKUP_CLAIM_RATE_LIMITED') {
      fail(`来源限额跨终端仍然有效，实际 ${JSON.stringify(sameSourceOtherTerminal)}`)
    }
    pass('限流按来源与终端分别计数：打满来源后换来源仍可试，换终端躲不掉来源限额')

    resetPickupClaimMemoryFallbackForTests()
    const memoryNow = 1_700_000_000_000
    if (memoryIncrement('exp', 10, memoryNow) !== 1 || memoryIncrement('exp', 10, memoryNow + 9_999) !== 2) {
      fail('进程内计数必须在窗口内累加')
    }
    if (memoryIncrement('exp', 10, memoryNow + 10_000) !== 1) fail('进程内计数必须在窗口结束后重新从 1 开始')
    if (!memorySet('lock-exp', 15, memoryNow) || !memoryHas('lock-exp', memoryNow + 14_999) || memoryHas('lock-exp', memoryNow + 15_000)) {
      fail('进程内锁定必须在 TTL 后自动消失')
    }
    resetPickupClaimMemoryFallbackForTests()
    for (let i = 0; i < PICKUP_CLAIM_MEMORY_MAX_KEYS; i += 1) {
      if (memoryIncrement(`cap-${i}`, 60, memoryNow) !== 1) fail('容量内的新键必须能写入')
    }
    if (memoryIncrement('cap-overflow', 60, memoryNow) !== null) fail('进程内计数达到容量后必须拒绝新键')
    resetRedisCooldownForTests()
    redis.failing = false
    redis.reset()
    const ignoredMemory = await capture(() => pickup.claim(rateOrder.pickupCode!, terminalId, 'memory-ignored'))
    if (ignoredMemory.code !== 'PICKUP_CODE_EXPIRED') {
      fail(`Redis 正常时不得被进程内兜底拖死，实际 ${JSON.stringify(ignoredMemory)}`)
    }
    pass('进程内兜底有上限且自动过期；Redis 正常时不看这份内存')

    resetPickupClaimMemoryFallbackForTests()
    resetRedisCooldownForTests()
    redis.reset()
    redis.failing = true
    for (let i = 0; i < PICKUP_CLAIM_SOURCE_RATE_LIMIT; i += 1) {
      const hit = await capture(() => pickup.claim(rateOrder.pickupCode!, terminalId, 'redis-down-src'))
      if (hit.code !== 'PICKUP_CODE_EXPIRED') fail(`Redis 故障时限流前仍应判过期，第 ${i + 1} 次 ${JSON.stringify(hit)}`)
    }
    const downLimited = await capture(() => pickup.claim(rateOrder.pickupCode!, terminalId, 'redis-down-src'))
    if (downLimited.status !== 429 || downLimited.code !== 'PICKUP_CLAIM_RATE_LIMITED') {
      fail(`Redis 故障时来源限额必须仍生效，实际 ${JSON.stringify(downLimited)}`)
    }
    for (let i = 0; i < PICKUP_LOCKOUT_FAILURE_THRESHOLD; i += 1) {
      await capture(() => pickup.claim(`3000000${i}`.slice(0, 8), otherTerminalId, 'redis-down-lock'))
    }
    const downLocked = await capture(() => pickup.claim('30000099', otherTerminalId, 'redis-down-lock'))
    if (downLocked.code !== 'PICKUP_CLAIM_LOCKED') {
      fail(`Redis 故障时失败锁定必须仍生效，实际 ${JSON.stringify(downLocked)}`)
    }
    for (let i = 0; i < PICKUP_LOCKOUT_FAILURE_THRESHOLD - 1; i += 1) {
      await capture(() => pickup.claim(`4000000${i}`.slice(0, 8), terminalId, 'redis-down-clear'))
    }
    const clearDuringOutage = await memberOrders.create(
      userId,
      { fileId, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' },
      randomUUID(),
    )
    await pickup.claim(clearDuringOutage.pickupCode!, terminalId, 'redis-down-clear')
    await capture(() => pickup.claim('40000098', terminalId, 'redis-down-clear'))
    const afterOutageClear = await capture(() => pickup.claim('40000097', terminalId, 'redis-down-clear'))
    if (afterOutageClear.code !== 'PICKUP_CODE_INVALID') {
      fail(`Redis 故障时成功认领仍须清零失败计数，实际 ${JSON.stringify(afterOutageClear)}`)
    }
    redis.failing = false
    redis.reset()
    resetPickupClaimMemoryFallbackForTests()
    resetRedisCooldownForTests()
    pass('Redis 不可用时按进程内兜底严格限流和锁定')

    const now = new Date()
    const eightDaysAgo = new Date(now.getTime() - 8 * DAY)
    const sixDaysAgo = new Date(now.getTime() - 6 * DAY)
    async function insertPaid(id: string, extra: Record<string, unknown>): Promise<void> {
      await prisma.order.create({
        data: {
          id,
          orderNo: `ORD-F02-${id}`,
          type: 'print',
          channel: 'miniapp_cloud',
          endUserId: userId,
          terminalId,
          amountCents: 640,
          payStatus: 'paid',
          paymentSource: 'offline',
          paidAt: eightDaysAgo,
          pickupStatus: 'pending',
          taskStatus: 'pending_release',
          ...extra,
        },
      })
    }

    const eligibleId = `ord_f02_ok_${suffix}`
    const youngId = `ord_f02_young_${suffix}`
    const kioskId = `ord_f02_kiosk_${suffix}`
    const printingId = `ord_f02_printing_${suffix}`
    const printedId = `ord_f02_printed_${suffix}`
    const queuedId = `ord_f02_queued_${suffix}`
    await insertPaid(eligibleId, {})
    await insertPaid(youngId, { paidAt: sixDaysAgo })
    await insertPaid(kioskId, { channel: 'kiosk' })
    await insertPaid(printingId, {})
    await insertPaid(printedId, {})
    await insertPaid(queuedId, {})
    await prisma.printTask.create({
      data: {
        id: `ptask_f02_printing_${suffix}`,
        terminalId,
        endUserId: userId,
        orderId: printingId,
        fileUrl: 'memory://unused',
        fileMd5: 'abc',
        status: 'printing',
      },
    })
    await prisma.printTask.create({
      data: {
        id: `ptask_f02_printed_${suffix}`,
        terminalId,
        endUserId: userId,
        orderId: printedId,
        fileUrl: 'memory://unused',
        fileMd5: 'abc',
        status: 'completed',
        printOutcome: 'printed',
      },
    })
    const queuedTaskId = `ptask_f02_queued_${suffix}`
    await prisma.printTask.create({
      data: {
        id: queuedTaskId,
        terminalId,
        endUserId: userId,
        orderId: queuedId,
        fileUrl: 'memory://unused',
        fileMd5: 'abc',
        status: 'pending',
      },
    })
    await prisma.order.update({
      where: { id: queuedId },
      data: { printTaskId: queuedTaskId, pickupStatus: 'used', taskStatus: 'pending' },
    })

    const first = await sweep.sweep({ now, limit: 50 })
    const eligible = await prisma.order.findUniqueOrThrow({ where: { id: eligibleId } })
    const eligibleRefunds = await prisma.refund.findMany({ where: { orderId: eligibleId } })
    if (eligible.payStatus !== 'refunded' || eligible.refundedAmountCents !== 640 || eligibleRefunds.length !== 1) {
      fail(`未取件满 7 天必须整单退一笔，实际 pay=${eligible.payStatus} refunded=${eligible.refundedAmountCents} rows=${eligibleRefunds.length}`)
    }
    if (eligible.pickupStatus !== 'expired') fail('自动退后到机码应标为过期')
    const autoAudit = await prisma.auditLog.findFirst({
      where: { action: 'order.pickup_expired_auto_refund', targetId: eligibleId },
    })
    if (!autoAudit) fail('自动退必须留审计')
    for (const id of [youngId, kioskId, printingId, printedId, queuedId]) {
      const row = await prisma.order.findUniqueOrThrow({ where: { id } })
      if (row.payStatus !== 'paid') fail(`${id} 不应被自动退，实际 ${row.payStatus}`)
    }
    pass('到期自动退只退未出纸、未开始打印的小程序单；现场单、未满 7 天、已出纸/已开始/已核销都不退')

    const second = await sweep.sweep({ now, limit: 50 })
    const refundCount = await prisma.refund.count({ where: { orderId: eligibleId } })
    const replay = await refunds.refund(eligibleId, { reason: 'pickup_expired_unpicked' })
    if (second.refunded !== 0 || refundCount !== 1 || !replay.idempotent) {
      fail(`重复清扫必须幂等。second=${JSON.stringify(second)} rows=${refundCount} replay=${replay.idempotent} firstRefunded=${first.refunded}`)
    }
    pass('到期自动退可重复跑：退款单仍是一笔，再次调用退款服务命中幂等')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    const orderIds = (await prisma.order.findMany({ where: { endUserId: userId }, select: { id: true } })).map((row) => row.id)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } }).catch(() => undefined)
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => undefined)
    await prisma.order.updateMany({ where: { endUserId: userId }, data: { printTaskId: null } }).catch(() => undefined)
    await prisma.printTask.deleteMany({ where: { endUserId: userId } }).catch(() => undefined)
    await prisma.orderItem.deleteMany({ where: { order: { endUserId: userId } } }).catch(() => undefined)
    await prisma.order.deleteMany({ where: { endUserId: userId } }).catch(() => undefined)
    await prisma.piiFinding.deleteMany({ where: { task: { endUserId: userId } } }).catch(() => undefined)
    await prisma.documentProcessTask.deleteMany({ where: { endUserId: userId } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { endUserId: userId } }).catch(() => undefined)
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: [terminalId, otherTerminalId] } } }).catch(() => undefined)
    await prisma.terminalCapability.deleteMany({ where: { terminalId: { in: [terminalId, otherTerminalId] } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: [terminalId, otherTerminalId] } } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: { in: [userId, otherUserId] } } }).catch(() => undefined)
    for (const key of storageKeys) await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(`  FAIL ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
