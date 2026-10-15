/**
 * 真 PostgreSQL：应用连接的锁等待 / 语句 / 空闲事务超时，以及领任务遇锁时的 503。
 *
 * 另开一条不带这些参数的 pg 连接，确认数据库默认仍是 0（迁移命令不走应用连接池）。
 * 越界环境变量回落缺省，并在构造 PrismaService 时各告警一次。
 *
 * 只在 postgres-readiness 跑。DATABASE_URL 不是 PostgreSQL 时直接失败。
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { isPostgresBusyError } from '../src/common/prisma/postgres-busy'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { resolvePgSessionTimeouts } from '../src/prisma/pg-session-timeouts'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-pg-lock-timeout-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-pg-lock-timeout-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-pg-lock-timeout-file-secret-0123456789'
process.env['DB_LOCK_TIMEOUT_MS'] = '2000'
// 语句超时长于锁等待，持锁用例才会落到 55P03，而不是和 statement_timeout 抢先后。
process.env['DB_STATEMENT_TIMEOUT_MS'] = '8000'
process.env['DB_IDLE_TX_TIMEOUT_MS'] = '60000'

const LOCK_MS = 2_000
const STATEMENT_MS = 8_000
const IDLE_MS = 60_000
const BUDGET_MS = LOCK_MS + 3_000

const requireFromAdapter = createRequire(require.resolve('@prisma/adapter-pg'))
const { Client } = requireFromAdapter('pg') as typeof import('pg')

function describeError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const value = error as { name?: unknown; code?: unknown; message?: unknown; cause?: { originalCode?: unknown } }
  return JSON.stringify({
    name: value.name,
    code: value.code,
    message: value.message,
    originalCode: value.cause?.originalCode,
  })
}

function capture(exception: unknown): { statusCode: number; body: { error?: { code?: string; message?: string } } } {
  const filter = new HttpExceptionFilter()
  const captured: { statusCode?: number; body?: { error?: { code?: string; message?: string } } } = {}
  const response = {
    status(statusCode: number) {
      captured.statusCode = statusCode
      return this
    },
    json(body: { error?: { code?: string; message?: string } }) {
      captured.body = body
      return this
    },
  }
  const host = {
    switchToHttp() {
      return {
        getResponse: () => response,
        getRequest: () => ({ requestId: 'verify-pg-lock-timeout' }),
      }
    },
  } as unknown as ArgumentsHost
  filter.catch(exception, host)
  return { statusCode: captured.statusCode ?? 0, body: captured.body ?? {} }
}

const SHOW_TIMEOUTS_SQL = `SELECT name, setting FROM pg_settings WHERE name IN ('lock_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout')`

async function showAppTimeouts(db: {
  $transaction: <T>(fn: (tx: { $queryRawUnsafe: (sql: string) => Promise<Array<{ name: string; setting: string }>> }) => Promise<T>) => Promise<T>
}): Promise<Record<string, string>> {
  const rows = await db.$transaction(async (tx) => tx.$queryRawUnsafe(SHOW_TIMEOUTS_SQL))
  return Object.fromEntries(rows.map((row) => [row.name, String(row.setting)]))
}

function assertWithinLockBudget(startedAt: number, label: string): void {
  const elapsed = Date.now() - startedAt
  assert.ok(elapsed >= 1_000, `${label} returned in ${elapsed}ms; the row lock was not waited on`)
  assert.ok(elapsed < BUDGET_MS, `${label} took ${elapsed}ms, budget is ${BUDGET_MS}ms`)
}

function assertPureResolver(): void {
  const missing = resolvePgSessionTimeouts({})
  assert.equal(missing.lockTimeoutMs, 5_000)
  assert.equal(missing.statementTimeoutMs, 30_000)
  assert.equal(missing.idleTxTimeoutMs, 60_000)
  assert.deepEqual(missing.warnings, [])

  const invalid = resolvePgSessionTimeouts({
    DB_LOCK_TIMEOUT_MS: '5000ms',
    DB_STATEMENT_TIMEOUT_MS: '999999999',
    DB_IDLE_TX_TIMEOUT_MS: '0',
  })
  assert.equal(invalid.lockTimeoutMs, 5_000)
  assert.equal(invalid.statementTimeoutMs, 30_000)
  assert.equal(invalid.idleTxTimeoutMs, 60_000)
  assert.equal(invalid.warnings.length, 3)
  assert.ok(invalid.warnings.every((line) => !line.includes('999999999') && !line.includes('5000ms')))
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? ''
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error('PG_LOCK_TIMEOUT_VERIFY_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL')
  }
  assertIsolatedVerificationDatabase()
  assertPureResolver()

  const [
    { PrismaService },
    { AuditService },
    { TerminalAgentService },
    { runSerializableTransaction },
  ] = await Promise.all([
    import('../src/prisma/prisma.service'),
    import('../src/audit/audit.service'),
    import('../src/terminals/terminals-agent.service'),
    import('../src/member-privacy/member-privacy.service'),
  ])

  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') throw new Error('PG_LOCK_TIMEOUT_VERIFY_POSTGRES_REQUIRED')
  await prisma.onModuleInit()

  const runId = randomBytes(6).toString('hex')
  const terminalId = `term_pgtimeout_${runId}`
  const fileId = `file_pgtimeout_${runId}`
  const taskId = `pt_pgtimeout_${runId}`
  const orderId = `order_pgtimeout_${runId}`
  const orderNo = `NO-PGTIMEOUT-${runId}`
  const agentToken = `tok_pgtimeout_${runId}`
  const agent = new TerminalAgentService(prisma, new AuditService(prisma))
  let holder: InstanceType<typeof Client> | null = null
  let held = false
  let fallback: InstanceType<typeof PrismaService> | null = null

  try {
    const applied = await showAppTimeouts(prisma)
    assert.equal(applied['lock_timeout'], String(LOCK_MS), 'app connection lock_timeout')
    assert.equal(applied['statement_timeout'], String(STATEMENT_MS), 'app connection statement_timeout')
    assert.equal(applied['idle_in_transaction_session_timeout'], String(IDLE_MS), 'app connection idle_in_transaction_session_timeout')

    const raw = new Client({ connectionString: url })
    await raw.connect()
    try {
      const defaults = await (async () => {
        const result = await raw.query(SHOW_TIMEOUTS_SQL)
        return Object.fromEntries(result.rows.map((row: { name: string; setting: string }) => [row.name, String(row.setting)]))
      })()
      assert.equal(defaults['lock_timeout'], '0', 'a non-app connection keeps the database default lock_timeout')
      assert.equal(defaults['statement_timeout'], '0', 'a non-app connection keeps the database default statement_timeout')
      assert.equal(defaults['idle_in_transaction_session_timeout'], '0', 'a non-app connection keeps the database default idle timeout')
    } finally {
      await raw.end()
    }

    const saved = {
      lock: process.env['DB_LOCK_TIMEOUT_MS'],
      statement: process.env['DB_STATEMENT_TIMEOUT_MS'],
      idle: process.env['DB_IDLE_TX_TIMEOUT_MS'],
    }
    process.env['DB_LOCK_TIMEOUT_MS'] = '1'
    process.env['DB_STATEMENT_TIMEOUT_MS'] = '999999999'
    process.env['DB_IDLE_TX_TIMEOUT_MS'] = '0'
    const warnings: string[] = []
    const originalWarn = Logger.prototype.warn
    Logger.prototype.warn = function (message: unknown, ...rest: unknown[]) {
      warnings.push(String(message))
      return originalWarn.apply(this, [message, ...rest])
    }
    try {
      fallback = new PrismaService()
      await fallback.onModuleInit()
      const fellBack = await showAppTimeouts(fallback)
      assert.equal(fellBack['lock_timeout'], '5000', 'out-of-range lock_timeout falls back to 5000')
      assert.equal(fellBack['statement_timeout'], '30000', 'out-of-range statement_timeout falls back to 30000')
      assert.equal(fellBack['idle_in_transaction_session_timeout'], '60000', 'out-of-range idle timeout falls back to 60000')
    } finally {
      Logger.prototype.warn = originalWarn
      process.env['DB_LOCK_TIMEOUT_MS'] = saved.lock
      process.env['DB_STATEMENT_TIMEOUT_MS'] = saved.statement
      process.env['DB_IDLE_TX_TIMEOUT_MS'] = saved.idle
      await fallback?.onModuleDestroy().catch(() => undefined)
    }
    for (const key of ['DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'DB_IDLE_TX_TIMEOUT_MS']) {
      assert.ok(warnings.some((line) => line.includes(key)), `startup warning missing for ${key}: ${warnings.join(' | ')}`)
    }
    assert.ok(warnings.every((line) => !line.includes('999999999')), 'startup warning must not echo the rejected value')

    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `PGT-${runId}`,
        agentToken,
        deviceFingerprint: `fp-pgtimeout-${runId}`,
      },
    })
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey: `verify/${fileId}.pdf`,
        filename: 'pg-timeout.pdf',
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
        fileUrl: 'https://example.invalid/pg-timeout.pdf',
        fileMd5: 'pg-timeout',
        status: 'pending',
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
        taskStatus: 'pending',
        amountCents: 100,
        paymentSource: 'offline',
      },
    })

    holder = new Client({ connectionString: url })
    await holder.connect()
    await holder.query('BEGIN')
    await holder.query('SELECT "id" FROM "Terminal" WHERE "id" = $1 FOR UPDATE', [terminalId])
    held = true

    const otherStarted = Date.now()
    let otherError: unknown
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "Terminal" SET "lifecycleStatus" = 'active' WHERE "id" = ${terminalId}`
      }, { timeout: 10_000 })
    } catch (error) {
      otherError = error
    }
    assertWithinLockBudget(otherStarted, 'locked update')
    assert.equal(isPostgresBusyError(otherError), true, `locked update must be 55P03, got ${describeError(otherError)}`)
    const otherBody = capture(otherError)
    assert.equal(otherBody.statusCode, 503, 'other endpoints map 55P03 to HTTP 503')
    assert.equal(otherBody.body.error?.code, 'DB_BUSY')
    assert.equal(otherBody.body.error?.message, '服务器忙，请稍后再试')
    assert.ok(!JSON.stringify(otherBody.body).includes('工作人员'))

    const claimStarted = Date.now()
    let claimError: unknown
    try {
      await agent.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    } catch (error) {
      claimError = error
    }
    assertWithinLockBudget(claimStarted, 'claim')
    assert.ok(claimError instanceof ServiceUnavailableException, `claim must throw 503, got ${describeError(claimError)}`)
    assert.equal(claimError.getStatus(), 503)
    const claimResponse = claimError.getResponse() as { error?: { code?: string; message?: string } }
    assert.equal(claimResponse.error?.code, 'TERMINAL_CLAIM_BUSY')
    assert.equal(claimResponse.error?.message, '服务器忙，稍后自动重试')
    const claimBody = capture(claimError)
    assert.equal(claimBody.body.error?.code, 'TERMINAL_CLAIM_BUSY')
    assert.equal(claimBody.body.error?.message, '服务器忙，稍后自动重试')
    const stillPending = await holder.query('SELECT "status" FROM "PrintTask" WHERE "id" = $1', [taskId])
    assert.equal(stillPending.rows[0]?.status, 'pending', 'a busy claim must not take the task')

    let attempts = 0
    let retryError: unknown
    try {
      await runSerializableTransaction(prisma, async (tx) => {
        attempts += 1
        await tx.$executeRaw`UPDATE "Terminal" SET "lifecycleStatus" = 'active' WHERE "id" = ${terminalId}`
      })
    } catch (error) {
      retryError = error
    }
    assert.equal(attempts, 1, `lock timeout must stop the serializable retry, attempts=${attempts}`)
    assert.equal(isPostgresBusyError(retryError), true, `retry loop must surface 55P03, got ${describeError(retryError)}`)

    await holder.query('ROLLBACK')
    held = false

    const claimed = await agent.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    assert.equal(claimed.length, 1, 'claim succeeds after the lock is released')
    assert.equal(claimed[0]?.taskId, taskId)

    const sleepStarted = Date.now()
    let sleepError: unknown
    try {
      await Promise.race([
        prisma.$transaction(async (tx) => {
          await tx.$queryRawUnsafe('SELECT pg_sleep(30)')
        }, { timeout: 20_000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('STATEMENT_TIMEOUT_NOT_ENFORCED')), 15_000)),
      ])
    } catch (error) {
      sleepError = error
    }
    const sleepElapsed = Date.now() - sleepStarted
    assert.ok(!(sleepError instanceof Error && sleepError.message === 'STATEMENT_TIMEOUT_NOT_ENFORCED'), 'statement_timeout did not cancel pg_sleep')
    assert.ok(sleepElapsed < STATEMENT_MS + 3_000, `pg_sleep took ${sleepElapsed}ms`)
    assert.equal(isPostgresBusyError(sleepError), true, `pg_sleep must be 57014, got ${describeError(sleepError)}`)
    const sleepBody = capture(sleepError)
    assert.equal(sleepBody.statusCode, 503, '57014 maps to HTTP 503')
    assert.equal(sleepBody.body.error?.code, 'DB_BUSY')
    assert.equal(sleepBody.body.error?.message, '服务器忙，请稍后再试')

    console.log('verify-pg-lock-timeout-postgres: PASS')
  } finally {
    if (held) await holder?.query('ROLLBACK').catch(() => undefined)
    await holder?.end().catch(() => undefined)
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId } }).catch(() => undefined)
    await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => undefined)
    await prisma.printTask.deleteMany({ where: { id: taskId } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { id: fileId } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
