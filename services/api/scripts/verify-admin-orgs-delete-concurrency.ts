import { AdminOrgsService } from '../src/orgs/admin-orgs.service'

process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-admin-orgs-concurrency-secret-32b'

type UserRow = {
  id: string
  username: string
  passwordHash: string
  name: string
  role: string
  orgId: string | null
  phoneHash: string | null
  phoneEnc: string | null
  phoneVerifiedAt: Date | null
  tokenVersion: number
  lastLoginAt: Date | null
  deletedAt: Date | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

type AuditEntry = { payloadJson: string }

function pass(message: string): void { console.log(`  PASS ${message}`) }

function fail(message: string): never {
  throw new Error(`VERIFY FAILED: ${message}`)
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return null
  const response = (error as { getResponse: () => unknown }).getResponse()
  if (!response || typeof response !== 'object' || !('error' in response)) return null
  const body = response.error
  return body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
    ? body.code
    : null
}

class VersionedMemoryRedis {
  private readonly cache = new Map<string, string>()

  async del(key: string): Promise<number> {
    return this.cache.delete(key) ? 1 : 0
  }

  async setJsonIfVersionNotOlder(
    key: string,
    _ttlSeconds: number,
    value: string,
    tokenVersion: number,
  ): Promise<'stored' | 'stale'> {
    const current = this.cache.get(key)
    if (current) {
      const currentVersion = (JSON.parse(current) as { tokenVersion?: number }).tokenVersion
      if (typeof currentVersion === 'number' && currentVersion > tokenVersion) return 'stale'
    }
    this.cache.set(key, value)
    return 'stored'
  }

  raw(key: string): string | null {
    return this.cache.get(key) ?? null
  }
}

function matches(row: UserRow, where: Record<string, unknown>): boolean {
  return (
    (where.id === undefined || row.id === where.id)
    && (where.orgId === undefined || row.orgId === where.orgId)
    && (where.role === undefined || row.role === where.role)
    && (where.enabled === undefined || row.enabled === where.enabled)
    && (where.deletedAt !== null || row.deletedAt === null)
  )
}

class SerializedMemoryPrisma {
  readonly audits: AuditEntry[] = []
  private transactionTail: Promise<void> = Promise.resolve()

  readonly user = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const row = this.users.find((candidate) => matches(candidate, where))
      return row ? { ...row } : null
    },
    count: async ({ where }: { where: Record<string, unknown> }) =>
      this.users.filter((candidate) => matches(candidate, where)).length,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const targets = this.users.filter((candidate) => matches(candidate, where))
      for (const row of targets) {
        row.deletedAt = data.deletedAt as Date
        row.enabled = data.enabled as boolean
        row.username = data.username as string
        row.passwordHash = data.passwordHash as string
        row.name = data.name as string
        row.phoneHash = data.phoneHash as null
        row.phoneEnc = data.phoneEnc as null
        row.phoneVerifiedAt = data.phoneVerifiedAt as null
        row.lastLoginAt = data.lastLoginAt as null
        row.tokenVersion += (data.tokenVersion as { increment: number }).increment
      }
      return { count: targets.length }
    },
  }

  readonly auditLog = {
    create: async ({ data }: { data: { payloadJson: string } }) => {
      this.audits.push({ payloadJson: data.payloadJson })
      return { id: `audit-${this.audits.length}` }
    },
  }

  constructor(readonly users: UserRow[]) {}

  async $transaction<T>(
    operation: (tx: SerializedMemoryPrisma) => Promise<T>,
    options: { isolationLevel?: string } | undefined,
  ): Promise<T> {
    if (options?.isolationLevel !== 'Serializable') {
      fail(`删除事务未请求 Serializable 隔离级别：${options?.isolationLevel ?? 'missing'}`)
    }
    const current = this.transactionTail.then(() => operation(this))
    this.transactionTail = current.then(() => undefined, () => undefined)
    return current
  }
}

function account(id: string, username: string): UserRow {
  const now = new Date()
  return {
    id,
    username,
    passwordHash: '$2b$10$placeholder',
    name: username,
    role: 'partner',
    orgId: 'org-concurrency',
    phoneHash: `hash-${id}`,
    phoneEnc: `enc-${id}`,
    phoneVerifiedAt: now,
    tokenVersion: 0,
    lastLoginAt: now,
    deletedAt: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

async function main(): Promise<void> {
  console.log('\n=== Admin 合作机构账号安全移除并发验证 ===')
  const first = account('account-concurrent-a', 'concurrent_a')
  const second = account('account-concurrent-b', 'concurrent_b')
  const prisma = new SerializedMemoryPrisma([first, second])
  const redis = new VersionedMemoryRedis()
  const service = new AdminOrgsService(prisma as never, {} as never, redis as never)
  const admin = { userId: 'admin-concurrency', role: 'admin' as const, orgId: null }

  const results = await Promise.allSettled([
    service.deleteAccount('org-concurrency', first.id, admin),
    service.deleteAccount('org-concurrency', second.id, admin),
  ])
  const succeeded = results.filter((result) => result.status === 'fulfilled')
  const failureCodes = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => errorCode(result.reason))
  const active = prisma.users.filter((user) =>
    user.orgId === 'org-concurrency' && user.role === 'partner' && user.enabled && user.deletedAt === null,
  )

  if (succeeded.length !== 1 || failureCodes.length !== 1 || failureCodes[0] !== 'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED') {
    fail(`并发删除的结果不符合最后有效账号保护：${JSON.stringify({ succeeded: succeeded.length, failureCodes })}`)
  }
  if (active.length !== 1) fail(`并发删除后有效账号数应为 1，实际为 ${active.length}`)
  if (prisma.audits.length !== 1) fail(`并发删除应仅写入一条删除审计，实际为 ${prisma.audits.length}`)
  if (
    !prisma.audits[0].payloadJson.includes('accountId')
    || prisma.audits[0].payloadJson.includes(first.username)
    || prisma.audits[0].payloadJson.includes(second.username)
  ) {
    fail('删除审计未最小化记录账号 ID，或泄露原用户名')
  }
  const deleted = prisma.users.find((user) => user.deletedAt !== null)
  if (!deleted) fail('并发删除后未找到墓碑账号')
  const cacheKey = `internal:session-state:${deleted.id}`
  const deletedState = redis.raw(cacheKey)
  if (!deletedState) fail('删除后未发布高版本禁用会话状态')
  const parsedDeletedState = JSON.parse(deletedState) as {
    enabled?: boolean
    tokenVersion?: number
    deletedAt?: string | null
  }
  if (parsedDeletedState.enabled !== false || parsedDeletedState.tokenVersion !== 1 || !parsedDeletedState.deletedAt) {
    fail(`删除会话状态不完整：${deletedState}`)
  }
  await redis.setJsonIfVersionNotOlder(
    cacheKey,
    60,
    JSON.stringify({
      userId: deleted.id,
      role: 'partner',
      orgId: deleted.orgId,
      enabled: true,
      tokenVersion: 0,
      deletedAt: null,
      orgEnabled: true,
    }),
    0,
  )
  if (redis.raw(cacheKey) !== deletedState) fail('晚到的旧缓存状态覆盖了删除后的高版本禁用状态')
  pass('并发移除两个有效账号时，事务只允许一个成功并保留一个有效账号')
  pass('删除审计仅记录账号 ID，不泄露原用户名')
  pass('删除发布高版本禁用会话状态，晚到旧缓存无法覆盖')
  console.log('\n=== CONCURRENCY ALL PASS ===')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
