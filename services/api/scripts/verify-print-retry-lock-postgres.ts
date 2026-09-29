/**
 * 真 PostgreSQL：会员重提与管理员重试同时打同一单。
 *
 * 两条入口都先锁 PrintTask，再动 Order。本脚本把两个事务在任何 SQL 之前对齐，
 * 然后让它们争用同一行。结果必须是恰好一个成功，另一个得到明确的 409，
 * 不能是 PostgreSQL 死锁 40P01，也不能两边都成功。
 *
 * 屏障只放在回调开头。不能复用 createRacingPrisma 的提交前屏障：
 * 第二个事务会堵在行锁上，等不到提交前的会合点，测试自己先死锁。
 *
 * 只在 postgres-readiness 跑。DATABASE_URL 不是 PostgreSQL 时直接失败，避免误在 SQLite 上变绿。
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { createRaceBarrier } from './support/serializable-race-barrier'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-print-retry-lock-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-print-retry-lock-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-retry-lock-file-secret-0123456789'
process.env['PAYMENT_SESSION_SECRET'] ||= process.env['FILE_SIGNING_SECRET']

function apiCode(error: HttpException): string | undefined {
  const response = error.getResponse() as { error?: { code?: string } }
  return response.error?.code
}

function isDeadlock(error: unknown): boolean {
  const seen = new Set<unknown>()
  const walk = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    const record = value as {
      code?: unknown
      message?: unknown
      meta?: { code?: unknown }
      cause?: unknown
    }
    if (record.code === '40P01' || record.meta?.code === '40P01') return true
    if (typeof record.message === 'string' && /40P01|deadlock detected/i.test(record.message)) return true
    return walk(record.cause)
  }
  return walk(error)
}

function describeError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const value = error as { name?: unknown; code?: unknown; message?: unknown }
  return JSON.stringify({ name: value.name, code: value.code, message: value.message })
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? ''
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error('PRINT_RETRY_LOCK_VERIFY_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL')
  }
  assertIsolatedVerificationDatabase()

  const [
    { PrismaService },
    { AuditService },
    { PrintJobsService },
    { AdminPrintScanService },
    { createPaymentSessionToken },
    { signFileUrl },
  ] = await Promise.all([
    import('../src/prisma/prisma.service'),
    import('../src/audit/audit.service'),
    import('../src/print-jobs/print-jobs.service'),
    import('../src/admin-print-scan/admin-print-scan.service'),
    import('../src/payment/payment-session-token'),
    import('../src/files/signing'),
  ])

  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') {
    throw new Error('PRINT_RETRY_LOCK_VERIFY_POSTGRES_REQUIRED')
  }
  await prisma.onModuleInit()

  const barrier = createRaceBarrier(2)
  let transactionCalls = 0
  const racing = new Proxy(prisma, {
    get(target, property) {
      if (property === '$transaction') {
        const original = target.$transaction.bind(target)
        return (operation: unknown, options?: unknown) => {
          if (typeof operation !== 'function') return original(operation as never, options as never)
          transactionCalls += 1
          return original(async (tx: object) => {
            await barrier.wait()
            return (operation as (client: object) => Promise<unknown>)(tx)
          }, options as never)
        }
      }
      const value = Reflect.get(target, property) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })

  const runId = randomBytes(6).toString('hex')
  const terminalId = `term_retry_lock_${runId}`
  const fileId = `file_retry_lock_${runId}`
  const taskId = `pt_retry_lock_${runId}`
  const orderId = `order_retry_lock_${runId}`
  const orderNo = `NO-LOCK-${runId}`
  const printJobs = new PrintJobsService(
    racing as never,
    new AuditService(prisma),
    null as never,
    null as never,
    null as never,
    null as never,
  )
  const admin = new AdminPrintScanService(racing as never)

  try {
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `LOCK-${runId}`,
        agentToken: `tok_retry_lock_${runId}`,
        deviceFingerprint: `fp-retry-lock-${runId}`,
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId, agentVersion: '0.4.13' },
    })
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey: `verify/${fileId}.pdf`,
        filename: 'retry-lock.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 3,
        sha256: '',
        purpose: 'print_doc',
      },
    })
    await prisma.printTask.create({
      data: {
        id: taskId,
        terminalId,
        fileId,
        fileUrl: signFileUrl(fileId, 60_000).url,
        fileMd5: 'retry-lock',
        status: 'failed',
        errorCode: 'PAPER_EMPTY',
      },
    })
    await prisma.order.create({
      data: {
        id: orderId,
        orderNo,
        type: 'print',
        printTaskId: taskId,
        terminalId,
        payStatus: 'paid',
        taskStatus: 'failed',
        amountCents: 100,
        paymentSource: 'offline',
      },
    })
    const token = createPaymentSessionToken({
      terminalId,
      orderId,
      orderNo,
      amountCents: 100,
      printTaskId: taskId,
    })

    const results = await Promise.allSettled([
      printJobs.retryPaidFailedJob(taskId, { paymentSessionToken: token }),
      admin.applyAction('print', taskId, 'retry'),
    ])

    assert.equal(barrier.timedOut, false, 'both retries must enter the transaction before either commits')
    assert.equal(barrier.arrivals, 2, 'both retries must reach the PrintTask lock')
    assert.equal(transactionCalls, 2, 'each retry opens one transaction')

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    assert.equal(fulfilled.length, 1, `exactly one retry must succeed, got ${results.map((result) => result.status).join(',')}`)
    assert.equal(rejected.length, 1, 'exactly one retry must be refused')

    const reason = rejected[0]!.reason
    assert.equal(isDeadlock(reason), false, `concurrent retries deadlocked: ${describeError(reason)}`)
    assert.ok(reason instanceof HttpException, `conflict must be a 409, got ${describeError(reason)}`)
    assert.equal(reason.getStatus(), 409)
    const code = apiCode(reason)
    assert.ok(
      code === 'PRINT_RETRY_INVALID_STATE' || code === 'PRINT_SCAN_ACTION_INVALID_STATE',
      `loser must be a state conflict, got ${String(code)}`,
    )

    const task = await prisma.printTask.findUniqueOrThrow({ where: { id: taskId } })
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    const retries = await prisma.printTaskStatusLog.count({
      where: { taskId, fromStatus: 'failed', toStatus: 'pending' },
    })
    assert.equal(task.status, 'pending')
    assert.equal(order.taskStatus, 'pending')
    assert.equal(order.payStatus, 'paid')
    assert.equal(retries, 1, 'only the winner may write failed→pending')
    console.log('verify-print-retry-lock-postgres: PASS')
  } finally {
    await prisma.auditLog.deleteMany({ where: { targetId: taskId } }).catch(() => undefined)
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId } }).catch(() => undefined)
    await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => undefined)
    await prisma.printTask.deleteMany({ where: { id: taskId } }).catch(() => undefined)
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { id: fileId } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
