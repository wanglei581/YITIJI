/**
 * 到机码失败后续打：同一任务、同一终端、每单自助 2 次。
 * 凭证码明文列不再进入任何订单视图。权益全额核销不再写这一列。
 *
 * 接在 verify:print-jobs 里 pickup-code-share 之后，因此 CI 的 SQLite 与 postgres-readiness 都会跑到。
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const callerUrl = process.env.DATABASE_URL ?? ''
const callerIsolated = process.env.VERIFICATION_DATABASE_TARGET === 'isolated'
  && (callerUrl.startsWith('file:') || callerUrl.startsWith('postgres://') || callerUrl.startsWith('postgresql://'))
const ownDb = '/tmp/bh-g-pickup-code-resume.db'
if (!callerIsolated) {
  rmSync(ownDb, { force: true })
  rmSync(`${ownDb}-journal`, { force: true })
  process.env.DATABASE_URL = `file:${ownDb}`
  process.env.VERIFICATION_DATABASE_TARGET = 'isolated'
}
process.env.NODE_ENV = 'test'
process.env.FILE_STORAGE_DRIVER = 'local'
process.env.FILE_STORAGE_DIR = process.env.FILE_STORAGE_DIR || '/tmp/pickup-resume-verify-files'
process.env.FILE_SIGNING_SECRET = process.env.FILE_SIGNING_SECRET || 'verify-file-signing-secret-0123456789abcdef'
process.env.PAYMENT_SESSION_SECRET = process.env.PAYMENT_SESSION_SECRET || 'verify-payment-session-secret-0123456789abcdef'
process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || 'verify-secret-encryption-key-0123456789abcdef'
process.env.TERMINAL_ADMIN_SECRET = process.env.TERMINAL_ADMIN_SECRET || 'verify-terminal-admin-secret-0123456789abcdef'
process.env.TERMINAL_ACTION_TOKEN_SECRET = process.env.TERMINAL_ACTION_TOKEN_SECRET || 'verify-terminal-action-token-secret-0123456789abcdef'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-jwt-secret-0123456789abcdef'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/14'

import { AuditService } from '../src/audit/audit.service'
import type { RedisService } from '../src/common/redis/redis.service'
import { MemberPrintOrderCreateService } from '../src/member-print-orders/member-print-order-create.service'
import { parseTimelineQuery, MemberOrderTimelineService } from '../src/member-print-orders/member-order-timeline.service'
import { MemberPrintOrdersService } from '../src/member-print-orders/member-print-orders.service'
import { PackageOrderService } from '../src/member-print-orders/package-order.service'
import { AdminOrderActionsController } from '../src/payment/admin-order-actions.controller'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { createPaymentSessionToken } from '../src/payment/payment-session-token'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { isPaidUnfulfilledRefundRequired } from '../src/payment/pending-refund-signal'
import { PickupExpiryRefundService } from '../src/payment/pickup-expiry-refund.service'
import { RefundService } from '../src/payment/refund.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PickupOrderService } from '../src/print-jobs/pickup-order.service'
import { REPRINT_BLOCKED_MESSAGE } from '../src/print-jobs/paid-reprint-eligibility'
import {
  PICKUP_CODE_RESUME,
  PICKUP_RESUME_REFUND_PENDING_MESSAGE,
  UNCONFIRMED_SELF_SERVICE_COOLDOWN_MS,
  selfServiceAnomalyDecision,
  selfServiceReprintCount,
} from '../src/print-jobs/self-service-reprint'
import { PrismaService } from '../src/prisma/prisma.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'
import { AdminPrintScanService } from '../src/admin-print-scan/admin-print-scan.service'
import { setPrintScanCapabilityModeForTest, TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { TerminalSessionService } from '../src/terminals/terminal-session.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

const apiRoot = path.resolve(__dirname, '..')
const CANARY = 'VC-884422'

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

type ClaimBody = {
  released?: boolean
  taskId?: string
  orderId?: string
  paymentSessionToken?: string
  resumed?: boolean
  mayHavePrinted?: boolean
  partialOutput?: boolean
}

type RetryBody = {
  status?: string
  mayHavePrinted?: boolean
  partialOutput?: boolean
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
  async get(key: string): Promise<string | null> { return this.store.get(key) ?? null }
  async setEx(key: string, _ttl: number, value: string): Promise<void> { this.store.set(key, value) }
  async del(key: string): Promise<number> { return this.store.delete(key) ? 1 : 0 }
  async incrWithTtl(key: string, _ttl: number): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1
    this.store.set(key, String(next))
    return next
  }
  async decrementFloorKeepTtl(key: string): Promise<number> {
    const v = Number(this.store.get(key) ?? 'NaN')
    if (!Number.isFinite(v)) return 0
    if (v <= 1) { this.store.delete(key); return 0 }
    this.store.set(key, String(v - 1))
    return v - 1
  }
  reset(): void { this.store.clear() }
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

function assertNoCanary(label: string, payload: unknown): void {
  const raw = JSON.stringify(payload)
  if (raw.includes(CANARY)) fail(`${label} 的响应里出现了明文凭证码`)
}

async function main(): Promise<void> {
  console.log('\n=== 到机码续打 / 凭证码不再下发 ===')
  assertIsolatedVerificationDatabase()
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
  const cloudOrders = new MemberPrintOrderCreateService(prisma, quote, capabilities, orderStatus, audit)
  const packages = new PackageOrderService(prisma, quote, capabilities, audit, orderStatus)
  const redis = new FakeRedis()
  const pickup = new PickupOrderService(prisma, capabilities, audit, redis as unknown as RedisService, storage)
  const legacy = new MemberPrintOrdersService(prisma)
  const sessions = new TerminalSessionService(redis as unknown as RedisService, prisma, { validateTerminalToken: async () => undefined })
  const timeline = new MemberOrderTimelineService(prisma, cloudOrders, packages, sessions)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus, capabilities)
  const adminScan = new AdminPrintScanService(prisma, audit)
  const payments = new OnlinePaymentService(prisma, audit, orderStatus, new PaymentProviderRegistry([]))
  const adminOrders = new AdminOrderActionsController(orderStatus, new RefundService(prisma, audit, new PaymentProviderRegistry([])))

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const userId = `eu_zhou_${suffix}`
  const terminalId = `terminal_binjiang_${suffix}`
  const otherTerminalId = `terminal_chengxi_${suffix}`
  const storageKeys: string[] = []
  let src = 0
  const source = () => `zhou-ning-${(src += 1)}`

  async function seedTerminal(id: string, code: string, displayName: string, locationLabel: string): Promise<void> {
    await prisma.terminal.create({
      data: { id, terminalCode: code, agentToken: `token-${id}`, deviceFingerprint: `fp-${id}`, displayName, locationLabel },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId: id, status: 'online', localTaskDatabaseAvailable: true, createdAt: new Date() },
    })
    await prisma.terminalHeartbeat.create({
      data: {
        terminalId: id,
        status: 'online',
        localTaskDatabaseAvailable: true,
        agentVersion: '0.4.13',
        createdAt: new Date(Date.now() + 60_000),
      },
    })
    await prisma.terminalCapability.create({
      data: { terminalId: id, capabilityKey: 'document_print', status: 'available' },
    })
  }

  async function seedFile(label: string): Promise<string> {
    const id = `file_resume_${label}_${suffix}`
    const key = `verify/pickup-resume/${id}.pdf`
    storageKeys.push(key)
    const pdf = buildRealPdf(1)
    await storage.putObject(key, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    const sha = createHash('sha256').update(pdf).digest('hex')
    const title = label === 'letter' ? '求职信' : label === 'pack' ? '材料包' : '简历'
    await prisma.fileObject.create({
      data: {
        id, storageKey: key, bucket: LOCAL_BUCKET_SENTINEL, region: 'local', filename: `周宁-${title}.pdf`,
        mimeType: 'application/pdf', sizeBytes: pdf.length, sha256: sha, endUserId: userId, ownerType: 'user', ownerId: userId,
        purpose: 'print_doc', status: 'active', deletedAt: null, expiresAt: new Date(Date.now() + 30 * 3600_000),
      },
    })
    const scan = await prisma.documentProcessTask.create({
      data: {
        kind: 'pii_scan', status: 'completed', requesterMode: 'member', sourceFileId: id, endUserId: userId,
        expiresAt: new Date(Date.now() + 3600_000), paramsJson: JSON.stringify({ sourceSha256: sha }),
      },
    })
    await prisma.piiFinding.create({ data: { taskId: scan.id, type: 'phone', label: '手机号', action: 'keep' } })
    return id
  }

  async function createCloud(fileId: string, terminal: string) {
    const created = await cloudOrders.create(userId, {
      fileId, terminalId: terminal, copies: 1, colorMode: 'black_white', duplex: 'simplex',
    }, randomUUID())
    if (!created.pickupCode) fail('云打印建单必须返回到机码')
    return created
  }

  async function payAndRelease(orderId: string, code: string): Promise<{ taskId: string }> {
    const unpaid = await pickup.claim(code, terminalId, source()) as ClaimBody
    if (unpaid.released) fail('未付款不得放行')
    await orderStatus.markPaid(orderId, { paymentSource: 'offline', operatorId: 'verify-resume' })
    const released = await pickup.claim(code, terminalId, source()) as ClaimBody
    if (!released.released || !released.taskId || released.resumed === true) fail(`放行应建任务且不带 resumed，实际 ${JSON.stringify(released)}`)
    if (!released.paymentSessionToken) fail('放行视图必须带付款会话令牌')
    return { taskId: released.taskId }
  }

  async function failTask(taskId: string, orderId: string, errorCode = 'PAPER_EMPTY'): Promise<void> {
    await prisma.printTask.update({
      where: { id: taskId },
      data: { status: 'failed', errorCode, errorMessage: null, completedAt: new Date() },
    })
    await prisma.order.update({ where: { id: orderId }, data: { taskStatus: 'failed' } })
  }

  async function stamp(orderId: string): Promise<void> {
    await prisma.order.updateMany({ where: { pickupCode: CANARY }, data: { pickupCode: null } })
    await prisma.order.update({ where: { id: orderId }, data: { pickupCode: CANARY } })
  }

  async function payToken(orderId: string): Promise<string> {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    return createPaymentSessionToken({
      orderId: order.id,
      orderNo: order.orderNo,
      terminalId: order.terminalId,
      amountCents: order.amountCents,
      printTaskId: order.printTaskId,
    })
  }

  try {
    setPrintScanCapabilityModeForTest('strict')
    await prisma.endUser.create({ data: { id: userId, phoneHash: `hash-${userId}`, phoneEnc: `enc-${userId}` } })
    await seedTerminal(terminalId, `BJ-${suffix}`, '青序滨江服务厅', '滨江路 18 号')
    await seedTerminal(otherTerminalId, `CX-${suffix}`, '青序城西服务点', '城西银泰旁')
    await seedDevDefaultPriceConfig(prisma)
    const resumeFile = await seedFile('resume')
    const extraFile = await seedFile('letter')
    const packageFile = await seedFile('pack')

    const created = await createCloud(resumeFile, terminalId)
    const code = created.pickupCode!
    const freshCreated = await prisma.order.findUniqueOrThrow({ where: { id: created.id } })
    if (freshCreated.pickupCode !== null) fail('建单不得把到机码写入明文列')
    const { taskId } = await payAndRelease(created.id, code)
    const bornAt = (await prisma.printTask.findUniqueOrThrow({ where: { id: taskId } })).createdAt.getTime()

    const replayPending = await pickup.claim(code, terminalId, source()) as ClaimBody
    if (replayPending.resumed === true || replayPending.taskId !== taskId) fail('排队中的任务应回放，不得续打')
    await prisma.printTask.update({ where: { id: taskId }, data: { status: 'printing' } })
    await prisma.order.update({ where: { id: created.id }, data: { taskStatus: 'printing' } })
    const replayPrinting = await pickup.claim(code, terminalId, source()) as ClaimBody
    const printingRow = await prisma.printTask.findUniqueOrThrow({ where: { id: taskId } })
    if (replayPrinting.resumed === true || printingRow.status !== 'printing') fail('打印中再输码必须保持原任务')
    await prisma.printTask.update({ where: { id: taskId }, data: { status: 'completed', completedAt: new Date() } })
    await prisma.order.update({ where: { id: created.id }, data: { taskStatus: 'completed' } })
    const replayDone = await pickup.claim(code, terminalId, source()) as ClaimBody
    const doneRow = await prisma.printTask.findUniqueOrThrow({ where: { id: taskId } })
    if (replayDone.resumed === true || doneRow.status !== 'completed') fail('已完成的任务再输码必须保持完成')
    pass('排队、打印中、已完成仍走 10 分钟回放，不带 resumed')

    await failTask(taskId, created.id)
    const beforeResume = await cloudOrders.detail(userId, created.id)
    const memberBefore = (await legacy.list(userId, { cursor: null, pageSize: 50 })).items.find((item) => item.id === taskId)
    if (
      beforeResume.pickupCode !== code
      || beforeResume.reprintAllowed !== true
      || beforeResume.reprintRemaining !== 2
      || beforeResume.reprintNotice !== null
      || memberBefore?.pickupCode !== code
      || memberBefore.reprintAllowed !== true
      || memberBefore.reprintRemaining !== 2
      || memberBefore.reprintNotice !== null
    ) {
      fail(`可续打时应下发到机码且剩余 2 次，实际 detail=${JSON.stringify({ pickupCode: beforeResume.pickupCode, reprintAllowed: beforeResume.reprintAllowed, reprintRemaining: beforeResume.reprintRemaining })} list=${JSON.stringify(memberBefore)}`)
    }
    await stamp(created.id)
    const stampedList = await legacy.list(userId, { cursor: null, pageSize: 50 })
    const stampedDetail = await cloudOrders.detail(userId, created.id)
    const stampedTimeline = await timeline.list(userId, parseTimelineQuery({ pageSize: '50' }), null)
    const stampedPay = await payments.getPayStatus(created.id, await payToken(created.id))
    for (const [label, payload] of [
      ['我的打印订单', stampedList],
      ['云打印详情', stampedDetail],
      ['时间线', stampedTimeline],
      ['支付状态', stampedPay],
    ] as const) {
      assertNoCanary(label, payload)
    }
    const timelineRow = stampedTimeline.items.find((item) => item.id === taskId)
    if (stampedDetail.pickupCode !== code || stampedPay.pickupCode !== code || timelineRow?.pickupCode !== code) {
      fail('可续打时各视图的 pickupCode 必须是到机码')
    }
    pass('可续打的失败单下发到机码；明文凭证码不出现在列表、详情、时间线、支付状态')

    const tasksBefore = await prisma.printTask.count({ where: { endUserId: userId } })
    const ordersBefore = await prisma.order.count({ where: { endUserId: userId } })
    const amountBefore = freshCreated.amountCents
    const resumed = await pickup.claim(code, terminalId, source()) as ClaimBody
    const afterFirst = await prisma.printTask.findUniqueOrThrow({ where: { id: taskId } })
    const orderAfterFirst = await prisma.order.findUniqueOrThrow({ where: { id: created.id } })
    const resumeLogs = await prisma.printTaskStatusLog.count({ where: { taskId, errorCode: PICKUP_CODE_RESUME, fromStatus: 'failed', toStatus: 'pending' } })
    if (
      resumed.resumed !== true
      || resumed.released !== true
      || resumed.taskId !== taskId
      || !resumed.paymentSessionToken
      || afterFirst.status !== 'pending'
      || afterFirst.createdAt.getTime() !== bornAt
      || orderAfterFirst.amountCents !== amountBefore
      || orderAfterFirst.printTaskId !== taskId
      || (await prisma.printTask.count({ where: { endUserId: userId } })) !== tasksBefore
      || (await prisma.order.count({ where: { endUserId: userId } })) !== ordersBefore
      || resumeLogs !== 1
      || 'mayHavePrinted' in resumed
      || 'partialOutput' in resumed
    ) {
      fail(`第一次续打应把同一任务拉回 pending 并带 resumed，实际 ${JSON.stringify(resumed)} status=${afterFirst.status}`)
    }
    const remainingAfterFirst = (await cloudOrders.detail(userId, created.id)).reprintRemaining
    if (remainingAfterFirst !== 1) fail(`第一次续打后剩余次数应为 1，实际 ${remainingAfterFirst}`)
    pass('同一终端同码续打：同一任务回到 pending，不建新任务，resumed=true，剩余 2→1')

    await failTask(taskId, created.id)
    const second = await pickup.claim(code, terminalId, source()) as ClaimBody
    const remainingAfterSecond = (await legacy.list(userId, { cursor: null, pageSize: 50 })).items.find((item) => item.id === taskId)?.reprintRemaining
    if (second.resumed !== true || second.taskId !== taskId || remainingAfterSecond !== 0) {
      fail(`第二次续打后剩余应为 0，实际 resumed=${second.resumed} remaining=${remainingAfterSecond}`)
    }
    await failTask(taskId, created.id)
    const third = await capture(() => pickup.claim(code, terminalId, source()))
    const stillFailed = await prisma.printTask.findUniqueOrThrow({ where: { id: taskId } })
    if (third.status !== 409 || third.code !== 'PICKUP_RESUME_LIMIT_REACHED' || third.message !== '这单已经接着打过 2 次，不能再打了' || stillFailed.status !== 'failed') {
      fail(`第三次应 409 且任务保持失败，实际 ${JSON.stringify(third)} status=${stillFailed.status}`)
    }
    const exhausted = await cloudOrders.detail(userId, created.id)
    const exhaustedMember = (await legacy.list(userId, { cursor: null, pageSize: 50 })).items.find((item) => item.id === taskId)
    if (
      exhausted.reprintAllowed !== false
      || exhausted.reprintRemaining !== 0
      || exhausted.pickupCode !== null
      || exhaustedMember?.reprintAllowed !== false
      || exhaustedMember.reprintRemaining !== 0
      || exhaustedMember.pickupCode !== null
    ) {
      fail(`次数用完不得再下发到机码，实际 ${JSON.stringify({ detail: exhausted.reprintRemaining, list: exhaustedMember?.reprintRemaining })}`)
    }
    pass('第二次续打后剩余 0；第三次 409 PICKUP_RESUME_LIMIT_REACHED，不再下发到机码')

    redis.reset()
    const shared = await createCloud(extraFile, terminalId)
    const sharedCode = shared.pickupCode!
    const sharedRelease = await payAndRelease(shared.id, sharedCode)
    await failTask(sharedRelease.taskId, shared.id)
    await printJobs.retryPaidFailedJob(sharedRelease.taskId, { endUserId: userId })
    await failTask(sharedRelease.taskId, shared.id)
    const sharedResume = await pickup.claim(sharedCode, terminalId, source()) as ClaimBody
    if (sharedResume.resumed !== true) fail('重试一次后仍应能用到机码续打')
    await failTask(sharedRelease.taskId, shared.id)
    const retryBlocked = await capture(() => printJobs.retryPaidFailedJob(sharedRelease.taskId, { endUserId: userId }))
    if (retryBlocked.status !== 409 || retryBlocked.code !== 'PRINT_RETRY_LIMIT_REACHED' || retryBlocked.message !== '这单已经接着打过 2 次，不能再打了') {
      fail(`会员重试与续打共用上限，实际 ${JSON.stringify(retryBlocked)}`)
    }
    const countedBeforeAdmin = await selfServiceReprintCount(prisma, sharedRelease.taskId)
    await adminScan.applyAction('print', sharedRelease.taskId, 'retry')
    const countedAfterAdmin = await selfServiceReprintCount(prisma, sharedRelease.taskId)
    await failTask(sharedRelease.taskId, shared.id)
    const retryStillBlocked = await capture(() => printJobs.retryPaidFailedJob(sharedRelease.taskId, { endUserId: userId }))
    await adminScan.applyAction('print', sharedRelease.taskId, 'retry')
    const countedAfterSecondAdmin = await selfServiceReprintCount(prisma, sharedRelease.taskId)
    if (
      countedBeforeAdmin !== 2
      || countedAfterAdmin !== 2
      || countedAfterSecondAdmin !== 2
      || retryStillBlocked.status !== 409
      || retryStillBlocked.code !== 'PRINT_RETRY_LIMIT_REACHED'
    ) {
      fail(`管理员重试不得占次数。before=${countedBeforeAdmin} after=${countedAfterAdmin} second=${countedAfterSecondAdmin} retry=${JSON.stringify(retryStillBlocked)}`)
    }
    pass('会员重试与到机码续打共用 2 次；管理员重试不受限且不计数')

    redis.reset()
    const wrongTerminalOrder = await createCloud(resumeFile, terminalId)
    const wrongCode = wrongTerminalOrder.pickupCode!
    const wrongRelease = await payAndRelease(wrongTerminalOrder.id, wrongCode)
    await failTask(wrongRelease.taskId, wrongTerminalOrder.id)
    const otherTerminal = await capture(() => pickup.claim(wrongCode, otherTerminalId, source()))
    const wrongTask = await prisma.printTask.findUniqueOrThrow({ where: { id: wrongRelease.taskId } })
    if (otherTerminal.status !== 404 || otherTerminal.code !== 'PICKUP_CODE_INVALID' || wrongTask.status !== 'failed') {
      fail(`别的终端必须 404，实际 ${JSON.stringify(otherTerminal)} status=${wrongTask.status}`)
    }
    await prisma.printTask.update({
      where: { id: wrongRelease.taskId },
      data: { terminalId: otherTerminalId, createdAt: new Date(Date.now() - 11 * 60 * 1000) },
    })
    const otherTaskTerminal = await capture(() => pickup.claim(wrongCode, terminalId, source()))
    const movedTask = await prisma.printTask.findUniqueOrThrow({ where: { id: wrongRelease.taskId } })
    if (otherTaskTerminal.status !== 400 || otherTaskTerminal.code !== 'PICKUP_CODE_ALREADY_USED' || movedTask.status !== 'failed') {
      fail(`任务不在本机应维持已用拒绝，实际 ${JSON.stringify(otherTaskTerminal)} status=${movedTask.status}`)
    }
    pass('别的终端输同码被拒；任务终端不一致也不续打')

    if (
      REPRINT_BLOCKED_MESSAGE.unconfirmed !== '这单的出纸结果还没确认，请 5 分钟后再试'
      || REPRINT_BLOCKED_MESSAGE.partial_output !== '这单只出了一部分纸'
      || REPRINT_BLOCKED_MESSAGE.unconfirmed.includes('工作人员')
      || REPRINT_BLOCKED_MESSAGE.partial_output.includes('工作人员')
      || PICKUP_RESUME_REFUND_PENDING_MESSAGE !== '这单没有打完，费用会按原路退回，需要帮助请拨打服务电话'
    ) {
      fail(`两条阻断文案必须去掉工作人员，实际 ${JSON.stringify(REPRINT_BLOCKED_MESSAGE)}`)
    }
    const boundarySince = new Date('2026-10-06T08:00:00.000Z')
    const boundaryCooled = selfServiceAnomalyDecision({
      errorCode: 'PRINT_JOB_UNCONFIRMED',
      amountCents: 0,
      discountCents: 0,
      unconfirmedSince: boundarySince,
      now: new Date(boundarySince.getTime() + UNCONFIRMED_SELF_SERVICE_COOLDOWN_MS),
    })
    const boundaryEarly = selfServiceAnomalyDecision({
      errorCode: 'PRINT_JOB_UNCONFIRMED',
      amountCents: 0,
      discountCents: 0,
      unconfirmedSince: boundarySince,
      now: new Date(boundarySince.getTime() + UNCONFIRMED_SELF_SERVICE_COOLDOWN_MS - 1),
    })
    const boundaryMissing = selfServiceAnomalyDecision({
      errorCode: 'PRINT_JOB_UNCONFIRMED',
      amountCents: 0,
      discountCents: 0,
      unconfirmedSince: null,
      now: boundarySince,
    })
    if (
      boundaryCooled.action !== 'reprint'
      || (boundaryCooled.action === 'reprint' && boundaryCooled.notice !== 'may_have_printed')
      || boundaryEarly.action !== 'cooldown'
      || boundaryMissing.action !== 'cooldown'
    ) {
      fail(`未确认冷却期边界不对：满 ${JSON.stringify(boundaryCooled)} 差 1 毫秒 ${JSON.stringify(boundaryEarly)} 无完成时间 ${JSON.stringify(boundaryMissing)}`)
    }
    pass('未确认 / 部分出纸文案不含工作人员；免费未确认满 5 分钟才可续打')

    const expiryRefunds = new PickupExpiryRefundService(
      prisma,
      new RefundService(prisma, audit, new PaymentProviderRegistry([])),
      audit,
    )

    async function releaseFailed(
      errorCode: string,
      opts?: { free?: 'zero' | 'discount'; completedAt?: Date | null },
    ): Promise<{ orderId: string; code: string; taskId: string }> {
      redis.reset()
      const order = await createCloud(resumeFile, terminalId)
      const released = await payAndRelease(order.id, order.pickupCode!)
      if (opts?.free === 'zero') {
        await prisma.order.update({ where: { id: order.id }, data: { amountCents: 0, discountCents: 0 } })
      } else if (opts?.free === 'discount') {
        const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
        await prisma.order.update({ where: { id: order.id }, data: { discountCents: row.amountCents } })
      }
      await failTask(released.taskId, order.id, errorCode)
      if (opts && 'completedAt' in opts) {
        await prisma.printTask.update({ where: { id: released.taskId }, data: { completedAt: opts.completedAt ?? null } })
      }
      return { orderId: order.id, code: order.pickupCode!, taskId: released.taskId }
    }

    const cooledAt = new Date(Date.now() - UNCONFIRMED_SELF_SERVICE_COOLDOWN_MS)

    async function assertRefundPending(label: string, errorCode: 'PRINT_JOB_UNCONFIRMED' | 'PARTIAL_OUTPUT'): Promise<string> {
      const released = await releaseFailed(errorCode)
      const denied = await capture(() => pickup.claim(released.code, terminalId, source()))
      const row = await prisma.printTask.findUniqueOrThrow({ where: { id: released.taskId } })
      const order = await prisma.order.findUniqueOrThrow({ where: { id: released.orderId } })
      const refunds = await prisma.refund.count({ where: { orderId: released.orderId } })
      const view = await cloudOrders.detail(userId, released.orderId)
      if (
        denied.status !== 409
        || denied.code !== 'PICKUP_RESUME_REFUND_PENDING'
        || denied.message !== PICKUP_RESUME_REFUND_PENDING_MESSAGE
        || row.status !== 'failed'
        || !isPaidUnfulfilledRefundRequired(order)
        || order.payStatus !== 'paid'
        || refunds !== 0
        || view.reprintAllowed !== false
        || view.reprintNotice !== null
        || view.reprintRemaining !== 2
      ) {
        fail(`${label} 应付 409 且进入需退款判定，实际 ${JSON.stringify({ denied, status: row.status, refundReason: order.refundReason, refunds, view: { allowed: view.reprintAllowed, notice: view.reprintNotice, remaining: view.reprintRemaining } })}`)
      }
      return released.orderId
    }

    const paidUnconfirmedId = await assertRefundPending('付费未确认', 'PRINT_JOB_UNCONFIRMED')
    await assertRefundPending('付费部分出纸', 'PARTIAL_OUTPUT')
    const retryPaid = await releaseFailed('PRINT_JOB_UNCONFIRMED')
    const retryPaidDenied = await capture(() => printJobs.retryPaidFailedJob(retryPaid.taskId, { endUserId: userId }))
    const retryPaidOrder = await prisma.order.findUniqueOrThrow({ where: { id: retryPaid.orderId } })
    if (
      retryPaidDenied.status !== 409
      || retryPaidDenied.code !== 'PICKUP_RESUME_REFUND_PENDING'
      || retryPaidDenied.message !== PICKUP_RESUME_REFUND_PENDING_MESSAGE
      || !isPaidUnfulfilledRefundRequired(retryPaidOrder)
    ) {
      fail(`付费单 /retry 未确认应同样 409，实际 ${JSON.stringify(retryPaidDenied)} reason=${retryPaidOrder.refundReason}`)
    }
    const retryPaidPartial = await releaseFailed('PARTIAL_OUTPUT')
    const retryPaidPartialDenied = await capture(() => printJobs.retryPaidFailedJob(retryPaidPartial.taskId, { endUserId: userId }))
    const retryPaidPartialOrder = await prisma.order.findUniqueOrThrow({ where: { id: retryPaidPartial.orderId } })
    if (retryPaidPartialDenied.code !== 'PICKUP_RESUME_REFUND_PENDING' || !isPaidUnfulfilledRefundRequired(retryPaidPartialOrder)) {
      fail(`付费单 /retry 部分出纸应 409，实际 ${JSON.stringify(retryPaidPartialDenied)}`)
    }
    pass('付费单未确认与部分出纸：到机码和 /retry 都是 409 PICKUP_RESUME_REFUND_PENDING，订单进入需退款判定')

    await prisma.order.update({
      where: { id: paidUnconfirmedId },
      data: { paidAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    })
    await expiryRefunds.sweep()
    const swept = await prisma.order.findUniqueOrThrow({ where: { id: paidUnconfirmedId } })
    const sweptRefunds = await prisma.refund.count({ where: { orderId: paidUnconfirmedId, reason: 'paid_output_anomaly' } })
    if (swept.payStatus !== 'refunded' || sweptRefunds !== 1) {
      fail(`满 7 天的付费未确认应走到期退款，实际 pay=${swept.payStatus} refunds=${sweptRefunds} reason=${swept.refundReason}`)
    }
    pass('付费未确认标记后，付款满 7 天由原到期清扫退款')

    const unmarkedPartial = await releaseFailed('PARTIAL_OUTPUT')
    await prisma.order.update({
      where: { id: unmarkedPartial.orderId },
      data: { paidAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    })
    await expiryRefunds.sweep()
    const unmarkedAfter = await prisma.order.findUniqueOrThrow({ where: { id: unmarkedPartial.orderId } })
    const unmarkedRefunds = await prisma.refund.count({ where: { orderId: unmarkedPartial.orderId, reason: 'paid_output_anomaly' } })
    if (unmarkedAfter.payStatus !== 'refunded' || unmarkedRefunds !== 1) {
      fail(`没来续打的付费部分出纸，满 7 天也应退，实际 pay=${unmarkedAfter.payStatus} refunds=${unmarkedRefunds}`)
    }
    const verifiedPrinted = await releaseFailed('PRINT_JOB_UNCONFIRMED')
    await prisma.printTask.update({ where: { id: verifiedPrinted.taskId }, data: { printOutcome: 'printed' } })
    await prisma.order.update({
      where: { id: verifiedPrinted.orderId },
      data: { paidAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    })
    await expiryRefunds.sweep()
    const verifiedAfter = await prisma.order.findUniqueOrThrow({ where: { id: verifiedPrinted.orderId } })
    if (verifiedAfter.payStatus !== 'paid' || verifiedAfter.refundReason != null) {
      fail('已核查出纸的付费未确认不得被清扫退掉')
    }
    const recentPaid = await releaseFailed('PRINT_JOB_UNCONFIRMED')
    await expiryRefunds.sweep()
    const recentAfter = await prisma.order.findUniqueOrThrow({ where: { id: recentPaid.orderId } })
    if (recentAfter.payStatus !== 'paid' || recentAfter.refundReason != null) {
      fail('未满 7 天且没来续打的付费未确认不得提前标退款')
    }
    pass('没来续打的付费异常满 7 天也退；已核查出纸、未满 7 天不退')

    const cooling = await releaseFailed('PRINT_JOB_UNCONFIRMED', { free: 'zero' })
    const coolingDenied = await capture(() => pickup.claim(cooling.code, terminalId, source()))
    const coolingView = await cloudOrders.detail(userId, cooling.orderId)
    const coolingList = (await legacy.list(userId, { cursor: null, pageSize: 50 })).items.find((item) => item.id === cooling.taskId)
    const coolingTimeline = (await timeline.list(userId, parseTimelineQuery({ pageSize: '50' }), null)).items.find((item) => item.id === cooling.taskId)
    const coolingOrder = await prisma.order.findUniqueOrThrow({ where: { id: cooling.orderId } })
    if (
      coolingDenied.status !== 409
      || coolingDenied.code !== 'PICKUP_RESUME_UNCONFIRMED'
      || coolingDenied.message !== '这单的出纸结果还没确认，请 5 分钟后再试'
      || coolingView.reprintAllowed !== false
      || coolingView.reprintRemaining !== 2
      || coolingView.reprintNotice !== 'may_have_printed'
      || coolingList?.reprintNotice !== 'may_have_printed'
      || coolingList.reprintAllowed !== false
      || coolingTimeline?.reprintNotice !== 'may_have_printed'
      || coolingOrder.refundReason != null
    ) {
      fail(`免费未确认 5 分钟内应 409 且视图提示可能出过纸，实际 ${JSON.stringify({ coolingDenied, notice: coolingView.reprintNotice, allowed: coolingView.reprintAllowed })}`)
    }
    const coolingRetry = await capture(() => printJobs.retryPaidFailedJob(cooling.taskId, { endUserId: userId }))
    if (coolingRetry.status !== 409 || coolingRetry.code !== 'PICKUP_RESUME_UNCONFIRMED' || await selfServiceReprintCount(prisma, cooling.taskId) !== 0) {
      fail(`冷却期内 /retry 也应 409 且不计数，实际 ${JSON.stringify(coolingRetry)}`)
    }
    await prisma.order.update({
      where: { id: cooling.orderId },
      data: { paidAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    })
    await expiryRefunds.sweep()
    const coolingAfterSweep = await prisma.order.findUniqueOrThrow({ where: { id: cooling.orderId } })
    if (coolingAfterSweep.payStatus !== 'paid' || coolingAfterSweep.refundReason != null) {
      fail('免费单不得进入需退款判定，也不得被清扫退掉')
    }
    const missingClock = await releaseFailed('PRINT_JOB_UNCONFIRMED', { free: 'zero', completedAt: null })
    const missingDenied = await capture(() => pickup.claim(missingClock.code, terminalId, source()))
    if (missingDenied.code !== 'PICKUP_RESUME_UNCONFIRMED') {
      fail(`没有完成时间的未确认单应按未满冷却期拒绝，实际 ${JSON.stringify(missingDenied)}`)
    }
    pass('免费未确认 5 分钟内 409，视图 reprintNotice=may_have_printed；没有完成时间不放行')

    const freeUnconfirmed = await releaseFailed('PRINT_JOB_UNCONFIRMED', { free: 'zero', completedAt: cooledAt })
    const freeView = await cloudOrders.detail(userId, freeUnconfirmed.orderId)
    if (freeView.reprintAllowed !== true || freeView.reprintRemaining !== 2 || freeView.reprintNotice !== 'may_have_printed') {
      fail(`冷却期后免费未确认应允许续打，实际 ${JSON.stringify({ allowed: freeView.reprintAllowed, remaining: freeView.reprintRemaining, notice: freeView.reprintNotice })}`)
    }
    const freeResumed = await pickup.claim(freeUnconfirmed.code, terminalId, source()) as ClaimBody
    const freeCount = await selfServiceReprintCount(prisma, freeUnconfirmed.taskId)
    const freeRemaining = (await cloudOrders.detail(userId, freeUnconfirmed.orderId)).reprintRemaining
    if (
      freeResumed.resumed !== true
      || freeResumed.mayHavePrinted !== true
      || 'partialOutput' in freeResumed
      || freeCount !== 1
      || freeRemaining !== 1
    ) {
      fail(`免费未确认续打应带 mayHavePrinted 并计入上限，实际 ${JSON.stringify(freeResumed)} count=${freeCount} remaining=${freeRemaining}`)
    }
    await failTask(freeUnconfirmed.taskId, freeUnconfirmed.orderId, 'PRINT_JOB_UNCONFIRMED')
    await prisma.printTask.update({ where: { id: freeUnconfirmed.taskId }, data: { completedAt: cooledAt } })
    const freeSecond = await pickup.claim(freeUnconfirmed.code, terminalId, source()) as ClaimBody
    if (freeSecond.mayHavePrinted !== true || await selfServiceReprintCount(prisma, freeUnconfirmed.taskId) !== 2) {
      fail('第二次免费未确认续打也应计入上限')
    }
    await failTask(freeUnconfirmed.taskId, freeUnconfirmed.orderId, 'PRINT_JOB_UNCONFIRMED')
    await prisma.printTask.update({ where: { id: freeUnconfirmed.taskId }, data: { completedAt: cooledAt } })
    const freeThird = await capture(() => pickup.claim(freeUnconfirmed.code, terminalId, source()))
    if (freeThird.code !== 'PICKUP_RESUME_LIMIT_REACHED') {
      fail(`未确认续打满 2 次后应被上限拦住，实际 ${JSON.stringify(freeThird)}`)
    }
    const discountFree = await releaseFailed('PRINT_JOB_UNCONFIRMED', { free: 'discount', completedAt: cooledAt })
    const discountResumed = await pickup.claim(discountFree.code, terminalId, source()) as ClaimBody
    if (discountResumed.mayHavePrinted !== true || discountResumed.resumed !== true) {
      fail(`全额抵扣的未确认单应按免费单续打，实际 ${JSON.stringify(discountResumed)}`)
    }
    pass('免费未确认满 5 分钟后续打成功，带 mayHavePrinted，计入每单 2 次；全额抵扣同样')

    const freePartial = await releaseFailed('PARTIAL_OUTPUT', { free: 'zero' })
    const partialView = await cloudOrders.detail(userId, freePartial.orderId)
    if (partialView.reprintAllowed !== true || partialView.reprintNotice !== 'partial_output' || partialView.reprintRemaining !== 2) {
      fail(`免费部分出纸应允许整单重打，实际 ${JSON.stringify({ allowed: partialView.reprintAllowed, notice: partialView.reprintNotice })}`)
    }
    const partialResumed = await pickup.claim(freePartial.code, terminalId, source()) as ClaimBody
    if (
      partialResumed.resumed !== true
      || partialResumed.partialOutput !== true
      || 'mayHavePrinted' in partialResumed
      || await selfServiceReprintCount(prisma, freePartial.taskId) !== 1
    ) {
      fail(`免费部分出纸续打应带 partialOutput 并计数，实际 ${JSON.stringify(partialResumed)}`)
    }
    const retryPartial = await releaseFailed('PARTIAL_OUTPUT', { free: 'zero' })
    const retryPartialResult = await printJobs.retryPaidFailedJob(retryPartial.taskId, { endUserId: userId }) as RetryBody
    if (retryPartialResult.status !== 'pending' || retryPartialResult.partialOutput !== true || retryPartialResult.mayHavePrinted === true) {
      fail(`/retry 免费部分出纸应带 partialOutput，实际 ${JSON.stringify(retryPartialResult)}`)
    }
    const retryCooled = await releaseFailed('PRINT_JOB_UNCONFIRMED', { free: 'zero', completedAt: cooledAt })
    const retryCooledResult = await printJobs.retryPaidFailedJob(retryCooled.taskId, { endUserId: userId }) as RetryBody
    if (
      retryCooledResult.mayHavePrinted !== true
      || retryCooledResult.partialOutput === true
      || await selfServiceReprintCount(prisma, retryCooled.taskId) !== 1
    ) {
      fail(`/retry 免费未确认应带 mayHavePrinted 并计数，实际 ${JSON.stringify(retryCooledResult)} count=${await selfServiceReprintCount(prisma, retryCooled.taskId)}`)
    }
    pass('免费部分出纸可整单续打并带 partialOutput；/retry 与到机码同一规则')

    const adminPaid = await releaseFailed('PRINT_JOB_UNCONFIRMED')
    const adminDenied = await capture(() => adminScan.applyAction('print', adminPaid.taskId, 'retry'))
    const adminOrder = await prisma.order.findUniqueOrThrow({ where: { id: adminPaid.orderId } })
    const adminTask = await prisma.printTask.findUniqueOrThrow({ where: { id: adminPaid.taskId } })
    if (
      adminDenied.status !== 409
      || adminDenied.code !== 'PRINT_RETRY_UNCONFIRMED_FORBIDDEN'
      || adminDenied.message !== REPRINT_BLOCKED_MESSAGE.unconfirmed
      || adminOrder.refundReason != null
      || adminTask.status !== 'failed'
      || await selfServiceReprintCount(prisma, adminPaid.taskId) !== 0
    ) {
      fail(`管理员重试付费未确认不得改单，实际 ${JSON.stringify(adminDenied)} reason=${adminOrder.refundReason}`)
    }
    const adminPartial = await releaseFailed('PARTIAL_OUTPUT', { free: 'zero' })
    const adminPartialDenied = await capture(() => adminScan.applyAction('print', adminPartial.taskId, 'retry'))
    const adminPartialTask = await prisma.printTask.findUniqueOrThrow({ where: { id: adminPartial.taskId } })
    if (
      adminPartialDenied.code !== 'PRINT_RETRY_PARTIAL_OUTPUT_FORBIDDEN'
      || adminPartialDenied.message !== REPRINT_BLOCKED_MESSAGE.partial_output
      || adminPartialTask.status !== 'failed'
    ) {
      fail(`管理员重试部分出纸仍应拒绝，实际 ${JSON.stringify(adminPartialDenied)} status=${adminPartialTask.status}`)
    }
    pass('管理员重试未确认与部分出纸仍拒绝，不占次数，也不标退款')

    const expiredAnomaly = await releaseFailed('PRINT_JOB_UNCONFIRMED')
    await prisma.order.update({ where: { id: expiredAnomaly.orderId }, data: { pickupCodeExpiresAt: new Date(Date.now() - 60_000) } })
    const expiredAnomalyClaim = await capture(() => pickup.claim(expiredAnomaly.code, terminalId, source()))
    const expiredAnomalyOrder = await prisma.order.findUniqueOrThrow({ where: { id: expiredAnomaly.orderId } })
    if (expiredAnomalyClaim.code !== 'PICKUP_CODE_EXPIRED' || expiredAnomalyOrder.refundReason != null) {
      fail(`取件窗口已关应先于退款标记，实际 ${JSON.stringify(expiredAnomalyClaim)} reason=${expiredAnomalyOrder.refundReason}`)
    }
    pass('取件窗口已关的付费未确认仍是 PICKUP_CODE_EXPIRED，不标退款')

    redis.reset()
    const expiredOrder = await createCloud(resumeFile, terminalId)
    const expiredRelease = await payAndRelease(expiredOrder.id, expiredOrder.pickupCode!)
    await failTask(expiredRelease.taskId, expiredOrder.id)
    await prisma.order.update({ where: { id: expiredOrder.id }, data: { pickupCodeExpiresAt: new Date(Date.now() - 60_000) } })
    const expired = await capture(() => pickup.claim(expiredOrder.pickupCode!, terminalId, source()))
    const expiredTask = await prisma.printTask.findUniqueOrThrow({ where: { id: expiredRelease.taskId } })
    if (expired.status !== 400 || expired.code !== 'PICKUP_CODE_EXPIRED' || expiredTask.status !== 'failed') {
      fail(`取件窗口已关应拒绝续打，实际 ${JSON.stringify(expired)} status=${expiredTask.status}`)
    }
    pass('取件窗口已关沿用 PICKUP_CODE_EXPIRED，不回放')

    redis.reset()
    const refundOrder = await createCloud(resumeFile, terminalId)
    const refundRelease = await payAndRelease(refundOrder.id, refundOrder.pickupCode!)
    await failTask(refundRelease.taskId, refundOrder.id)
    await prisma.order.update({ where: { id: refundOrder.id }, data: { payStatus: 'refunding' } })
    const refunded = await capture(() => pickup.claim(refundOrder.pickupCode!, terminalId, source()))
    const refundTask = await prisma.printTask.findUniqueOrThrow({ where: { id: refundRelease.taskId } })
    if (refunded.status !== 400 || refunded.code !== 'ORDER_REFUNDED' || refundTask.status !== 'failed') {
      fail(`退款中必须拒绝，实际 ${JSON.stringify(refunded)} status=${refundTask.status}`)
    }
    pass('退款中拒绝续打')

    const pendingCloud = await createCloud(extraFile, terminalId)
    const pendingCode = pendingCloud.pickupCode!
    if (pendingCloud.reprintAllowed !== false || pendingCloud.reprintRemaining !== null) {
      fail('还没有任务时 reprintAllowed=false 且 reprintRemaining=null')
    }
    await stamp(pendingCloud.id)
    const cloudList = await cloudOrders.listCloud(userId)
    const cloudDetail = await cloudOrders.detail(userId, pendingCloud.id)
    const pendingTimeline = await timeline.list(userId, parseTimelineQuery({ pageSize: '50' }), null)
    const pendingPay = await payments.getPayStatus(pendingCloud.id, await payToken(pendingCloud.id))
    const pendingRow = cloudList.find((row) => row.id === pendingCloud.id)
    const pendingTimelineRow = pendingTimeline.items.find((item) => item.id === pendingCloud.id)
    for (const [label, payload] of [
      ['云打印列表', cloudList],
      ['云打印详情-可取', cloudDetail],
      ['时间线-可取', pendingTimeline],
      ['支付状态-可取', pendingPay],
    ] as const) assertNoCanary(label, payload)
    if (
      pendingRow?.pickupCode !== pendingCode
      || cloudDetail.pickupCode !== pendingCode
      || pendingTimelineRow?.pickupCode !== pendingCode
      || pendingPay.pickupCode !== pendingCode
      || pendingRow?.reprintAllowed !== false
      || pendingTimelineRow?.reprintAllowed !== false
      || pendingTimelineRow?.reprintRemaining !== null
    ) {
      fail('可取的云打印单 pickupCode 必须等于到机码')
    }
    pass('可取的云打印列表、详情、时间线、支付状态下发到机码，不含明文凭证码')

    const packed = await packages.create(userId, {
      terminalId,
      files: [{ fileId: packageFile }],
      params: { copies: 1, colorMode: 'black_white', duplex: 'simplex' },
    }, randomUUID())
    if (!packed.pickupCode) fail('材料包建单必须返回到机码')
    await stamp(packed.orderId)
    const packageList = await packages.list(userId, { cursor: null, pageSize: 20 })
    const packageDetail = await packages.detail(userId, packed.orderId)
    const packageRow = packageList.items.find((item) => item.orderId === packed.orderId)
    assertNoCanary('材料包列表', packageList)
    assertNoCanary('材料包详情', packageDetail)
    if (
      packageRow?.pickupCode !== packed.pickupCode
      || packageDetail.pickupCode !== packed.pickupCode
      || packageRow?.reprintAllowed !== false
      || packageRow?.reprintRemaining !== null
      || packageDetail.reprintAllowed !== false
      || packageDetail.reprintRemaining !== null
    ) {
      fail('可取的材料包必须下发到机码，且还没有任务时剩余次数为 null')
    }
    pass('材料包列表与详情下发到机码，不含明文凭证码')

    const onsiteTaskId = `ptask_onsite_${suffix}`
    await prisma.printTask.create({
      data: {
        id: onsiteTaskId, terminalId, endUserId: userId, fileUrl: 'https://invalid.example/onsite', fileMd5: '',
        status: 'pending', paramsJson: JSON.stringify({ fileName: '周宁-现场材料.pdf', copies: 1, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4' }),
      },
    })
    const onsite = await prisma.order.create({
      data: {
        orderNo: `ORD-OS-${suffix}`, endUserId: userId, terminalId, printTaskId: onsiteTaskId,
        amountCents: 100, payStatus: 'paid', paymentSource: 'offline', taskStatus: 'pending',
      },
    })
    await stamp(onsite.id)
    const onsiteList = await legacy.list(userId, { cursor: null, pageSize: 50 })
    const onsiteItem = onsiteList.items.find((item) => item.id === onsiteTaskId)
    assertNoCanary('现场单列表', onsiteList)
    if (onsiteItem?.pickupCode !== null || onsiteItem?.reprintAllowed !== false || onsiteItem?.reprintRemaining !== null) {
      fail('没有哈希的现场单不得下发 pickupCode')
    }
    pass('现场单列表不读明文列')

    const adminCloud = await createCloud(resumeFile, terminalId)
    await stamp(adminCloud.id)
    const adminView = await adminOrders.markPaid(adminCloud.id, { paymentSource: 'offline' }, { userId: 'admin-zhou', role: 'admin', orgId: null })
    assertNoCanary('管理员入账', adminView)
    if (adminView.pickupCode !== null || JSON.stringify(adminView).includes(adminCloud.pickupCode!)) {
      fail('管理员入账响应不得下发到机码或明文列')
    }
    pass('管理员订单动作的 pickupCode 恒为 null')

    const redeem = await createCloud(resumeFile, terminalId)
    const redeemBefore = await prisma.order.findUniqueOrThrow({ where: { id: redeem.id } })
    if (redeemBefore.pickupCode !== null || !redeemBefore.pickupCodeHash) fail('核销前应已有哈希且明文列为空')
    await prisma.$transaction((tx) => orderStatus.settleRedemptionInTransaction(tx, redeem.id, {
      discountCents: redeemBefore.amountCents,
      benefitRef: 'benefit-zhou-ning',
      operatorId: 'verify-resume',
    }))
    const redeemAfter = await prisma.order.findUniqueOrThrow({ where: { id: redeem.id } })
    if (redeemAfter.payStatus !== 'paid' || redeemAfter.pickupCode !== null || redeemAfter.pickupCodeHash !== redeemBefore.pickupCodeHash) {
      fail(`全额核销后明文列必须仍为 null，实际 pickupCode=${redeemAfter.pickupCode} pay=${redeemAfter.payStatus}`)
    }
    pass('权益全额核销入账后明文列仍为 null，到机码哈希不变')

    console.log('verify:pickup-code-resume PASS')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    const orderIds = (await prisma.order.findMany({ where: { endUserId: userId }, select: { id: true } }).catch(() => [])).map((row) => row.id)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } }).catch(() => undefined)
    await prisma.printTaskStatusLog.deleteMany({ where: { task: { endUserId: userId } } }).catch(() => undefined)
    await prisma.order.updateMany({ where: { endUserId: userId }, data: { printTaskId: null } }).catch(() => undefined)
    await prisma.orderItem.deleteMany({ where: { order: { endUserId: userId } } }).catch(() => undefined)
    await prisma.printTask.deleteMany({ where: { endUserId: userId } }).catch(() => undefined)
    await prisma.order.deleteMany({ where: { endUserId: userId } }).catch(() => undefined)
    await prisma.piiFinding.deleteMany({ where: { task: { endUserId: userId } } }).catch(() => undefined)
    await prisma.documentProcessTask.deleteMany({ where: { endUserId: userId } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { endUserId: userId } }).catch(() => undefined)
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: [terminalId, otherTerminalId] } } }).catch(() => undefined)
    await prisma.terminalCapability.deleteMany({ where: { terminalId: { in: [terminalId, otherTerminalId] } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: [terminalId, otherTerminalId] } } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: userId } }).catch(() => undefined)
    for (const key of storageKeys) await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(`  FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exit(1)
})
