import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SmsSender } from '../../src/member-auth/sms/sms-sender'
import { PrismaService } from '../../src/prisma/prisma.service'

export class VerificationFailure extends Error {
  constructor(message: string) {
    super(`VERIFY_ASSERTION_FAILED: ${message}`)
    this.name = 'VerificationFailure'
  }
}

export function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

export function fail(message: string): never {
  throw new VerificationFailure(message)
}

export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

export function errorCode(error: unknown): string | undefined {
  const exception = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof exception.getResponse === 'function' ? exception.getResponse() : exception.response) as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

export async function expectCode(
  operation: () => Promise<unknown>,
  code: string,
  message: string,
): Promise<void> {
  let rejected = false
  let rejection: unknown
  try {
    await operation()
  } catch (error) {
    rejected = true
    rejection = error
  }
  if (!rejected) fail(`${message}：期望失败但调用成功`)
  if (errorCode(rejection) !== code) fail(`${message}：错误码不符合契约`)
}

export function assertFailureUnwindsCleanup(): void {
  const probeDirectory = mkdtempSync(join(tmpdir(), 'verify-phone-transfer-cleanup-probe-'))
  let assertionObserved = false
  let assertionFinallyRan = false
  try {
    try {
      fail('受控 cleanup 自检')
    } finally {
      assertionFinallyRan = true
      rmSync(probeDirectory, { recursive: true, force: true })
    }
  } catch (error) {
    assertionObserved = error instanceof VerificationFailure
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true })
  }
  ensure(assertionObserved && assertionFinallyRan && !existsSync(probeDirectory), '0. 失败断言未经过 finally cleanup')
  pass('0a. 失败断言通过异常栈展开执行 finally cleanup')
}

export class CapturingSmsSender implements SmsSender {
  lastCode: string | null = null
  deliveries = 0

  async sendCode(_phone: string, code: string): Promise<void> {
    this.lastCode = code
    this.deliveries += 1
  }
}

export class MemoryRedis {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>()
  private readonly failingVersionedWrites = new Set<string>()
  private nowMs = 0

  private read(key: string): string | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= this.nowMs) {
      this.store.delete(key)
      return null
    }
    return entry.value
  }

  async get(key: string): Promise<string | null> {
    return this.read(key)
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.store.set(key, { value, expiresAt: this.nowMs + ttlSeconds * 1000 })
  }

  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.read(key) !== null) return false
    this.store.set(key, { value, expiresAt: this.nowMs + ttlSeconds * 1000 })
    return true
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const existing = this.read(key)
    const next = Number(existing ?? '0') + 1
    this.store.set(key, {
      value: String(next),
      expiresAt: existing === null ? this.nowMs + ttlSeconds * 1000 : this.store.get(key)?.expiresAt ?? null,
    })
    return next
  }

  async del(key: string): Promise<number> {
    if (this.read(key) === null) return 0
    this.store.delete(key)
    return 1
  }

  async getAndDelIfEquals(
    key: string,
    expected: string,
  ): Promise<'missing' | 'matched' | 'mismatched'> {
    const current = this.read(key)
    if (current === null) return 'missing'
    if (current !== expected) return 'mismatched'
    this.store.delete(key)
    return 'matched'
  }

  async reserveWithinLimitWithTtl(key: string, ttlSeconds: number, limit: number): Promise<boolean> {
    const existing = this.read(key)
    const current = Number(existing ?? '0')
    if (current >= limit) return false
    this.store.set(key, {
      value: String(current + 1),
      expiresAt: existing === null ? this.nowMs + ttlSeconds * 1000 : this.store.get(key)?.expiresAt ?? null,
    })
    return true
  }

  async releaseReservedLimit(key: string): Promise<void> {
    const existing = this.read(key)
    const current = Number(existing ?? '0')
    if (current <= 0) return
    if (current === 1) {
      this.store.delete(key)
      return
    }
    this.store.set(key, {
      value: String(current - 1),
      expiresAt: this.store.get(key)?.expiresAt ?? null,
    })
  }

  async setJsonIfVersionNotOlder(
    key: string,
    ttlSeconds: number,
    value: string,
    tokenVersion: number,
  ): Promise<'stored' | 'stale'> {
    if (this.failingVersionedWrites.delete(key)) throw new Error('simulated versioned cache write failure')
    const current = this.read(key)
    if (current) {
      try {
        const parsed = JSON.parse(current) as { tokenVersion?: unknown }
        if (typeof parsed.tokenVersion === 'number' && parsed.tokenVersion > tokenVersion) return 'stale'
      } catch {
        // 生产 Lua 对不可解析 JSON 同样采用覆盖写入。
      }
    }
    this.store.set(key, { value, expiresAt: this.nowMs + ttlSeconds * 1000 })
    return 'stored'
  }

  failNextVersionedWrite(key: string): void {
    this.failingVersionedWrites.add(key)
  }

  advanceSeconds(seconds: number): void {
    this.nowMs += seconds * 1000
  }

  raw(key: string): string | null {
    return this.read(key)
  }

  keysWithPrefix(prefix: string): string[] {
    return [...this.store.keys()].filter((key) => key.startsWith(prefix) && this.read(key) !== null)
  }
}

export type RecordedAudit = {
  actorId?: string | null
  actorRole: string
  action: string
  targetType: string
  targetId?: string | null
  payload?: Record<string, unknown>
}

export class RecordingAudit {
  readonly entries: RecordedAudit[] = []

  async write(entry: RecordedAudit): Promise<string> {
    this.entries.push({ ...entry, payload: { ...(entry.payload ?? {}) } })
    return `verify-transfer-audit-${this.entries.length}`
  }
}

export type BoundedBarrier = {
  wait: () => Promise<void>
  release: () => void
}

export function createBoundedBarrier(participants: number, timeoutMs: number, label: string): BoundedBarrier {
  ensure(Number.isSafeInteger(participants) && participants > 0, `${label}：barrier 参与数非法`)
  ensure(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, `${label}：barrier 超时非法`)

  let arrivals = 0
  let settled = false
  let resolveGate: (() => void) | null = null
  let rejectGate: ((error: Error) => void) | null = null
  const gate = new Promise<void>((resolve, reject) => {
    resolveGate = resolve
    rejectGate = reject
  })
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    rejectGate?.(new VerificationFailure(`${label}：barrier 等待参与方超时`))
  }, timeoutMs)

  const release = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolveGate?.()
  }
  return {
    wait: async () => {
      arrivals += 1
      if (arrivals === participants) release()
      await gate
    },
    release,
  }
}

export type IsolatedVerificationDatabase = {
  databasePath: string
  initialize: () => void
  cleanup: () => void
}

export function prepareIsolatedDatabase(): IsolatedVerificationDatabase {
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const tempDirectory = mkdtempSync(join(tmpdir(), 'verify-admin-phone-transfer-'))
  const databasePath = join(tempDirectory, 'verify.db')
  process.env['DATABASE_URL'] = `file:${databasePath}`

  return {
    databasePath,
    initialize: () => {
      execFileSync('sqlite3', [
        databasePath,
        `
        PRAGMA foreign_keys = ON;
        CREATE TABLE "Organization" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "contact" TEXT,
          "contactPhone" TEXT,
          "sceneTemplate" TEXT,
          "enabledModulesJson" TEXT NOT NULL DEFAULT '[]',
          "enabled" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE "User" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "username" TEXT NOT NULL,
          "passwordHash" TEXT NOT NULL,
          "passwordProofState" TEXT NOT NULL DEFAULT 'legacy',
          "name" TEXT NOT NULL,
          "role" TEXT NOT NULL,
          "orgId" TEXT,
          "phoneHash" TEXT,
          "phoneEnc" TEXT,
          "phoneVerifiedAt" DATETIME,
          "tokenVersion" INTEGER NOT NULL DEFAULT 0,
          "lastLoginAt" DATETIME,
          "enabled" BOOLEAN NOT NULL DEFAULT true,
          "deletedAt" DATETIME,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        );
        CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
        CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");
        CREATE INDEX "User_orgId_idx" ON "User"("orgId");
        CREATE INDEX "User_phoneVerifiedAt_idx" ON "User"("phoneVerifiedAt");
        CREATE INDEX "User_orgId_role_enabled_deletedAt_idx" ON "User"("orgId", "role", "enabled", "deletedAt");
        CREATE TABLE "AuditLog" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "actorId" TEXT,
          "actorRole" TEXT NOT NULL,
          "action" TEXT NOT NULL,
          "targetType" TEXT NOT NULL,
          "targetId" TEXT,
          "payloadJson" TEXT NOT NULL DEFAULT '{}',
          "ipAddress" TEXT,
          "userAgent" TEXT,
          "requestId" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        );
        CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
        CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
        CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
        CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
        `,
      ], { stdio: 'pipe' })
    },
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

export async function assertHarnessReady(prisma: PrismaService): Promise<void> {
  ensure(prisma.dbKind === 'sqlite', '0. 隔离 harness 未使用 SQLite')
  ensure((await prisma.user.count()) === 0, '0. 临时数据库不是空库')

  const redis = new MemoryRedis()
  await redis.setEx('ttl', 2, 'v')
  ensure((await redis.get('ttl')) === 'v', '0. MemoryRedis get/setEx 语义错误')
  ensure(!(await redis.setNxEx('ttl', 'other', 2)), '0. MemoryRedis setNxEx 未保持 NX 原子语义')
  ensure((await redis.getAndDelIfEquals('ttl', 'other')) === 'mismatched', '0. MemoryRedis CAS mismatch 语义错误')
  ensure((await redis.getAndDelIfEquals('ttl', 'v')) === 'matched', '0. MemoryRedis CAS consume 语义错误')
  ensure((await redis.incrWithTtl('counter', 2)) === 1, '0. MemoryRedis 首次 INCR 错误')
  ensure((await redis.incrWithTtl('counter', 9)) === 2, '0. MemoryRedis 后续 INCR 错误')
  redis.advanceSeconds(2)
  ensure((await redis.get('counter')) === null, '0. MemoryRedis INCR 错误刷新了首次 TTL')
  ensure(await redis.reserveWithinLimitWithTtl('limit', 5, 1), '0. MemoryRedis 额度预约失败')
  ensure(!(await redis.reserveWithinLimitWithTtl('limit', 5, 1)), '0. MemoryRedis 额度上限不是原子的')
  await redis.releaseReservedLimit('limit')
  ensure(await redis.reserveWithinLimitWithTtl('limit', 5, 1), '0. MemoryRedis 额度释放后未恢复')
  await redis.setJsonIfVersionNotOlder('session', 5, JSON.stringify({ tokenVersion: 2 }), 2)
  ensure(
    (await redis.setJsonIfVersionNotOlder('session', 5, JSON.stringify({ tokenVersion: 1 }), 1)) === 'stale',
    '0. MemoryRedis 允许旧会话版本覆盖新版本',
  )
  ensure((await redis.del('session')) === 1, '0. MemoryRedis del 返回值错误')

  const barrier = createBoundedBarrier(2, 20, 'Memory barrier 自检')
  let barrierTimedOut = false
  try {
    await barrier.wait()
  } catch (error) {
    barrierTimedOut = error instanceof VerificationFailure
  } finally {
    barrier.release()
  }
  ensure(barrierTimedOut, '0. 有界 barrier 未在参与方缺失时快速失败')
  pass('0. 临时 SQLite、真实 Prisma、Redis 原子语义与有界 barrier 可用')
}
