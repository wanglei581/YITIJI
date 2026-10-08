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
import { RefundService } from '../src/payment/refund.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PickupOrderService } from '../src/print-jobs/pickup-order.service'
import { PICKUP_CODE_RESUME, selfServiceReprintCount } from '../src/print-jobs/self-service-reprint'
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
      || memberBefore?.pickupCode !== code
      || memberBefore.reprintAllowed !== true
      || memberBefore.reprintRemaining !== 2
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

    async function blockedRelease(label: string, errorCode: string, expectCode: string, expectMessage: string): Promise<void> {
      redis.reset()
      const order = await createCloud(resumeFile, terminalId)
      const released = await payAndRelease(order.id, order.pickupCode!)
      await failTask(released.taskId, order.id, errorCode)
      const denied = await capture(() => pickup.claim(order.pickupCode!, terminalId, source()))
      const row = await prisma.printTask.findUniqueOrThrow({ where: { id: released.taskId } })
      if (denied.status !== 409 || denied.code !== expectCode || denied.message !== expectMessage || row.status !== 'failed') {
        fail(`${label} 应 409 ${expectCode}，实际 ${JSON.stringify(denied)} status=${row.status}`)
      }
    }
    await blockedRelease('结果未确认', 'PRINT_JOB_UNCONFIRMED', 'PICKUP_RESUME_UNCONFIRMED', '这单的出纸结果还没确认，暂时不能接着打，请稍后再试')
    await blockedRelease('已出部分纸', 'PARTIAL_OUTPUT', 'PICKUP_RESUME_PARTIAL_OUTPUT', '这单已经出了一部分纸，不能整单重打')
    pass('未确认与已出部分纸各自用续打自己的 409 文案')

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
