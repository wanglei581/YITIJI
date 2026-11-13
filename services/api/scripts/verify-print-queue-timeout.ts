/**
 * 排队超时：过了上限的 pending 已付款单判失败且领不走；
 * 未到时间照常领；到机码预订单没有 PrintTask，不受影响；
 * 领取和过期同时发生时，不会既变成已领取又写成排队超时。
 *
 * 运行：node -r @swc-node/register scripts/verify-print-queue-timeout.ts
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-print-queue-timeout-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-print-queue-timeout-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-queue-timeout-file-signing-secret-012345'

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BadRequestException } from '@nestjs/common'
import { AuditService } from '../src/audit/audit.service'
import { PAID_UNFULFILLED_PENDING_REFUND_REASON } from '../src/payment/pending-refund-signal'
import { loadFreePrintUsage } from '../src/print-jobs/free-print-quota.usage'
import { failureReasonForUser } from '../src/print-jobs/print-jobs.service'
import {
  PRINT_QUEUE_TIMEOUT,
  PRINT_QUEUE_TIMEOUT_AUDIT,
  PRINT_QUEUE_TIMEOUT_SETTING_AUDIT,
  PRINT_QUEUE_TIMEOUT_SETTING_KEY,
  clearQueueTimeoutRefundMark,
  expireQueuedPrintTasks,
  readPrintQueueTimeoutMinutes,
  updatePrintQueueTimeoutMinutes,
} from '../src/print-jobs/print-queue-timeout'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = join(__dirname, '..')
const REPO_ROOT = join(API_ROOT, '../..')
const TERM = 'term-queue-timeout'
const SCREEN = '这单等了太久没有打印，没有出纸，可以重新提交打印。'

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function assertWired(): void {
  const agent = read(join(API_ROOT, 'src/terminals/terminals-agent.service.ts'))
  assert.match(agent, /expireQueuedPrintTasks\(this\.prisma\)/)
  assert.match(agent, /AND: \[claimableFreshnessFilter\(claimableSince\)\]/)
  assert.match(agent, /claimableFreshnessFilter\(claimableSince\)/)
  for (const relative of [
    'src/print-jobs/print-jobs.service.ts',
    'src/print-jobs/pickup-code-resume.ts',
    'src/admin-print-scan/admin-print-scan.service.ts',
  ]) {
    assert.match(read(join(API_ROOT, relative)), /clearQueueTimeoutRefundMark\(/, relative)
  }
  const model = read(join(REPO_ROOT, 'apps/kiosk/src/pages/print/printProgressModel.ts'))
  assert.match(model, /PRINT_QUEUE_TIMEOUT: '这单等了太久没有打印，没有出纸，可以重新提交打印。'/)
  assert.match(model, /export function screenFailureReason/)
  assert.match(read(join(REPO_ROOT, 'apps/kiosk/src/pages/print/PrintProgressPage.tsx')), /screenFailureReason\(result\)/)
  assert.match(read(join(REPO_ROOT, 'apps/kiosk/src/pages/print/PrintDonePage.tsx')), /screenFailureReason\(result\)/)
  assert.equal(model.includes('找工作人员'), false)
  assert.match(read(join(API_ROOT, 'src/print-jobs/print-queue-timeout.controller.ts')), /admin\/print-queue-timeout/)
  assert.match(read(join(REPO_ROOT, 'apps/admin/src/routes/print-scan/index.tsx')), /PrintQueueTimeoutCard/)
  assert.equal(failureReasonForUser(PRINT_QUEUE_TIMEOUT), SCREEN)
  assert.equal(failureReasonForUser(PRINT_QUEUE_TIMEOUT).includes('工作人员'), false)
  execFileSync(process.execPath, [join(REPO_ROOT, 'apps/kiosk/scripts/verify-print-queue-timeout-copy.cjs')], {
    stdio: 'inherit',
  })
  console.log('PASS 接线：领取上限、清退款标记、一体机对照表、后台设置')
}

function pushSchema(url: string): void {
  execFileSync(process.execPath, [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', url, '--accept-data-loss',
  ], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' })
}

async function main(): Promise<void> {
  assertWired()
  const now = new Date()
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
  const dir = mkdtempSync(join(tmpdir(), 'print-queue-timeout-'))
  const databasePath = join(dir, 'verify-print-queue-timeout.db')
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') process.env['NODE_ENV'] = 'test'
  assertIsolatedVerificationDatabase()
  closeSync(openSync(databasePath, 'wx'))
  pushSchema(databaseUrl)
  for (const file of [
    'prisma/migrations/20260724200000_guard_planned_terminal_updates/migration.sql',
    'prisma/migrations/20260726003000_guard_retired_terminal/migration.sql',
  ]) {
    execFileSync('sqlite3', [databasePath], { input: read(join(API_ROOT, file)) })
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')
  const agent = new TerminalAgentService(prisma, audit, { validateTerminalToken: async () => undefined } as never)

  await prisma.terminal.create({
    data: {
      id: TERM,
      terminalCode: 'QT-01',
      displayName: '排队超时测试机',
      agentToken: 'agent-queue-timeout',
      deviceFingerprint: 'fp-queue-timeout',
      credentialGeneration: 0,
      enabled: true,
      lifecycleStatus: 'active',
    },
  })
  await prisma.terminalHeartbeat.create({
    data: { terminalId: TERM, status: 'online', printerStatus: 'idle', localTaskDatabaseAvailable: true },
  })
  const admin = await prisma.user.create({
    data: {
      id: 'user-queue-timeout',
      username: 'queue-timeout-admin',
      passwordHash: 'not-used',
      name: '排队超时管理员',
      role: 'admin',
    },
  })

  let seq = 0
  async function resetJobs(): Promise<void> {
    const tasks = await prisma.printTask.findMany({ where: { terminalId: TERM }, select: { id: true } })
    const ids = tasks.map((task) => task.id)
    if (ids.length > 0) await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: ids } } })
    await prisma.order.deleteMany({ where: { OR: [{ terminalId: TERM }, { printTaskId: { in: ids } }] } })
    await prisma.printTask.deleteMany({ where: { terminalId: TERM } })
  }

  async function ageTask(id: string, when: Date): Promise<void> {
    const stamp = when.toISOString()
    execFileSync('sqlite3', [databasePath], {
      input: `UPDATE "PrintTask" SET "updatedAt" = '${stamp}' WHERE "id" = '${id}';`,
    })
    const row = await prisma.printTask.findUnique({ where: { id }, select: { updatedAt: true } })
    assert.ok(row)
    assert.ok(Math.abs(row.updatedAt.getTime() - when.getTime()) < 2000, `updatedAt 没有写成过去：${row.updatedAt.toISOString()}`)
  }

  async function seed(input: {
    status?: string
    payStatus?: string
    amountCents?: number
    discountCents?: number
    paidAt?: Date | null
    refundReason?: string | null
    taskUpdatedAt?: Date
    channel?: string
    pickupStatus?: string
    withTask?: boolean
    errorCode?: string | null
  }): Promise<{ taskId: string | null; orderId: string }> {
    seq += 1
    const withTask = input.withTask !== false
    const taskId = withTask ? `ptask-queue-${seq}` : null
    const orderId = `order-queue-${seq}`
    if (taskId) {
      await prisma.printTask.create({
        data: {
          id: taskId,
          terminalId: TERM,
          fileUrl: 'https://files.invalid/queue-timeout',
          fileMd5: 'queue-timeout',
          paramsJson: JSON.stringify({ copies: 1 }),
          status: input.status ?? 'pending',
          errorCode: input.errorCode ?? null,
        },
      })
      if (input.taskUpdatedAt) await ageTask(taskId, input.taskUpdatedAt)
    }
    await prisma.order.create({
      data: {
        id: orderId,
        orderNo: `QT${String(seq).padStart(6, '0')}`,
        printTaskId: taskId,
        terminalId: TERM,
        amountCents: input.amountCents ?? 0,
        discountCents: input.discountCents ?? 0,
        payStatus: input.payStatus ?? 'paid',
        paymentSource: (input.amountCents ?? 0) - (input.discountCents ?? 0) > 0 ? 'offline' : 'free',
        paidAt: input.paidAt === undefined ? (input.payStatus === 'unpaid' ? null : now) : input.paidAt,
        taskStatus: input.status ?? 'pending',
        refundReason: input.refundReason ?? null,
        billablePages: 2,
        printParamsJson: JSON.stringify({ copies: 1 }),
        channel: input.channel ?? 'kiosk',
        pickupStatus: input.pickupStatus ?? 'none',
      },
    })
    return { taskId, orderId }
  }

  async function claim() {
    return agent.claimTasks(TERM, { maxTasks: 1 }, 'Bearer verify')
  }

  assert.equal(await readPrintQueueTimeoutMinutes(prisma), 15)
  const saved = await updatePrintQueueTimeoutMinutes(prisma, audit, 20, { userId: admin.id, role: 'admin' })
  assert.equal(saved, 20)
  assert.equal(await readPrintQueueTimeoutMinutes(prisma), 20)
  await assert.rejects(
    () => updatePrintQueueTimeoutMinutes(prisma, audit, 4, { userId: admin.id, role: 'admin' }),
    (error: unknown) => error instanceof BadRequestException,
  )
  assert.equal(await readPrintQueueTimeoutMinutes(prisma), 20)
  await prisma.platformSetting.update({
    where: { key: PRINT_QUEUE_TIMEOUT_SETTING_KEY },
    data: { value: 'nope' },
  })
  assert.equal(await readPrintQueueTimeoutMinutes(prisma), 15)
  await prisma.platformSetting.delete({ where: { key: PRINT_QUEUE_TIMEOUT_SETTING_KEY } })
  const settingAudit = await prisma.auditLog.findFirst({ where: { action: PRINT_QUEUE_TIMEOUT_SETTING_AUDIT } })
  assert.ok(settingAudit)
  console.log('PASS 上限缺省 15，可存 20，4 和垃圾值都不生效')

  await resetJobs()
  const stalePaid = await seed({
    amountCents: 300,
    paidAt: minutesAgo(40),
    taskUpdatedAt: minutesAgo(40),
  })
  assert.equal((await claim()).length, 0, '过期的单即使还没清理也领不走')
  assert.equal(await expireQueuedPrintTasks(prisma, now), 1)
  const staleTask = await prisma.printTask.findUnique({ where: { id: stalePaid.taskId! } })
  const staleOrder = await prisma.order.findUnique({ where: { id: stalePaid.orderId } })
  assert.equal(staleTask?.status, 'failed')
  assert.equal(staleTask?.errorCode, PRINT_QUEUE_TIMEOUT)
  assert.equal(staleTask?.claimedAt, null)
  assert.equal(staleOrder?.taskStatus, 'failed')
  assert.equal(staleOrder?.refundReason, PAID_UNFULFILLED_PENDING_REFUND_REASON)
  assert.equal((await claim()).length, 0)
  const timeoutAudit = await prisma.auditLog.findFirst({
    where: { action: PRINT_QUEUE_TIMEOUT_AUDIT, targetId: stalePaid.taskId },
  })
  assert.ok(timeoutAudit)
  console.log('PASS 付费单超时判失败，待退款标记沿用已有口径，领不走')

  await resetJobs()
  const fresh = await seed({
    amountCents: 100,
    paidAt: minutesAgo(5),
    taskUpdatedAt: minutesAgo(5),
  })
  assert.equal(await expireQueuedPrintTasks(prisma, now), 0)
  const claimedFresh = await claim()
  assert.equal(claimedFresh.length, 1)
  assert.equal(claimedFresh[0]?.taskId, fresh.taskId)
  const freshTask = await prisma.printTask.findUnique({ where: { id: fresh.taskId! } })
  assert.equal(freshTask?.status, 'claimed')
  assert.equal(freshTask?.errorCode, null)
  console.log('PASS 未超时的单照常领取，不会被判失败')

  await resetJobs()
  const waitingPay = await seed({
    payStatus: 'unpaid',
    paidAt: null,
    amountCents: 100,
    taskUpdatedAt: minutesAgo(90),
  })
  const pickup = await seed({
    withTask: false,
    amountCents: 200,
    paidAt: minutesAgo(60 * 24 * 3),
    channel: 'miniapp_cloud',
    pickupStatus: 'pending',
  })
  const released = await seed({
    amountCents: 200,
    paidAt: minutesAgo(60 * 24 * 3),
    channel: 'miniapp_cloud',
    pickupStatus: 'used',
  })
  const justPaid = await seed({
    amountCents: 100,
    paidAt: minutesAgo(1),
    taskUpdatedAt: minutesAgo(90),
  })
  assert.equal(await expireQueuedPrintTasks(prisma, now), 0)
  const waiting = await prisma.printTask.findUnique({ where: { id: waitingPay.taskId! } })
  const pickupOrder = await prisma.order.findUnique({ where: { id: pickup.orderId } })
  const releasedTask = await prisma.printTask.findUnique({ where: { id: released.taskId! } })
  assert.equal(waiting?.status, 'pending')
  assert.equal(pickupOrder?.printTaskId, null)
  assert.equal(pickupOrder?.payStatus, 'paid')
  assert.equal(pickupOrder?.refundReason, null)
  assert.equal(releasedTask?.status, 'pending')
  assert.equal(releasedTask?.errorCode, null)
  const claimedReleased = await claim()
  assert.equal(claimedReleased.length, 1)
  assert.equal(claimedReleased[0]?.taskId, released.taskId)
  const claimedJustPaid = await claim()
  assert.equal(claimedJustPaid.length, 1)
  assert.equal(claimedJustPaid[0]?.taskId, justPaid.taskId)
  console.log('PASS 未付款、到机码预订单、刚核销的单不判超时；付款后才开始算')

  await resetJobs()
  const free = await seed({
    amountCents: 0,
    paidAt: minutesAgo(30),
    taskUpdatedAt: minutesAgo(30),
  })
  const before = await loadFreePrintUsage(prisma, TERM, null, now)
  assert.ok(before.terminalInFlight > 0, `免费在途应大于 0，实际 ${before.terminalInFlight}`)
  assert.equal(await expireQueuedPrintTasks(prisma, now), 1)
  const after = await loadFreePrintUsage(prisma, TERM, null, now)
  assert.equal(after.terminalInFlight, 0)
  const freeOrder = await prisma.order.findUnique({ where: { id: free.orderId } })
  assert.equal(freeOrder?.refundReason, null)
  assert.equal(freeOrder?.taskStatus, 'failed')
  console.log('PASS 免费单超时后不再占在途额度，不写待退款标记')

  await resetJobs()
  const parked = await seed({
    amountCents: 100,
    paidAt: minutesAgo(40),
    taskUpdatedAt: minutesAgo(40),
    refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON,
  })
  assert.equal(await expireQueuedPrintTasks(prisma, now), 0)
  const parkedTask = await prisma.printTask.findUnique({ where: { id: parked.taskId! } })
  assert.equal(parkedTask?.status, 'pending')
  console.log('PASS 已标待退款、还停在 pending 的单不被这条超时再改一次')

  await resetJobs()
  const blocked = await seed({
    amountCents: 100,
    paidAt: minutesAgo(40),
    taskUpdatedAt: minutesAgo(40),
  })
  assert.equal(await expireQueuedPrintTasks(prisma, now), 1)
  await prisma.printTask.update({
    where: { id: blocked.taskId! },
    data: {
      status: 'pending',
      errorCode: null,
      errorMessage: null,
      completedAt: null,
      claimedAt: null,
    },
  })
  await prisma.order.update({
    where: { id: blocked.orderId },
    data: { taskStatus: 'pending' },
  })
  assert.equal((await claim()).length, 0, '待退款标记还在时不能领')
  await clearQueueTimeoutRefundMark(prisma, blocked.orderId, PRINT_QUEUE_TIMEOUT)
  const cleared = await prisma.order.findUnique({ where: { id: blocked.orderId } })
  assert.equal(cleared?.refundReason, null)
  await clearQueueTimeoutRefundMark(prisma, blocked.orderId, 'PAPER_EMPTY')
  const claimedAgain = await claim()
  assert.equal(claimedAgain.length, 1)
  assert.equal(claimedAgain[0]?.taskId, blocked.taskId)
  console.log('PASS 重新排队会清掉排队超时的待退款标记，清掉之后才能领')

  await resetJobs()
  const race = await seed({ amountCents: 100, paidAt: now })
  const [claimedRace, expiredRace] = await Promise.all([
    claim(),
    expireQueuedPrintTasks(prisma, new Date(now.getTime() + 20 * 60_000)),
  ])
  const raceTask = await prisma.printTask.findUnique({ where: { id: race.taskId! } })
  const claimedOk = raceTask?.status === 'claimed' && raceTask.errorCode == null && raceTask.claimedAt != null
  const failedOk = raceTask?.status === 'failed' && raceTask.errorCode === PRINT_QUEUE_TIMEOUT && raceTask.claimedAt == null
  assert.equal(claimedOk !== failedOk, true)
  if (claimedOk) {
    assert.equal(claimedRace.length, 1)
    assert.equal(expiredRace, 0)
  } else {
    assert.equal(claimedRace.length, 0)
    assert.equal(expiredRace, 1)
  }
  assert.equal(raceTask?.status === 'claimed' && raceTask.errorCode === PRINT_QUEUE_TIMEOUT, false)
  console.log(`PASS 领取和过期并发只落一种结果（${claimedOk ? '领走' : '判失败'}）`)

  await prisma.onModuleDestroy()
  console.log('verify:print-queue-timeout PASS')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
