/**
 * 真 PostgreSQL：Serializable 冲突落在 COMMIT 上时，重试逻辑必须认得出来。
 *
 * 规格：机构成员账号删除（AdminOrgsService.deleteAccount）是「最后一个有效账号不能删」
 * 的可串行化事务，冲突后最多重试 3 次。两个管理员同时各删一个账号（Redis 提交锁
 * 过期或失效时就会真的并发进到数据库），结果必须是：
 *   - 恰好一个成功；
 *   - 另一个重试后看到只剩一个有效账号，返回原有业务码 409
 *     LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED —— 而不是把驱动层错误原样抛出、被全局
 *     异常过滤器变成 500「服务器内部错误」。
 *
 * 只认 `P2034` 的旧写法在这里必红：adapter-pg 在 COMMIT 上抛的是没有 code 的
 * DriverAdapterError（见 src/common/prisma/serialization-conflict.ts 文件头）。
 * 屏障保证两个事务确定地冲突在 COMMIT 上（scripts/support/serializable-race-barrier.ts）。
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import Redis from 'ioredis'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { createRacingPrisma } from './support/serializable-race-barrier'

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? ''
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error('PG_SERIALIZATION_CONFLICT_VERIFY_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL')
  }
  assertIsolatedVerificationDatabase()

  const [{ PrismaService }, { AuditService }, { AdminOrgsService }, { RedisService }] = await Promise.all([
    import('../src/prisma/prisma.service'),
    import('../src/audit/audit.service'),
    import('../src/orgs/admin-orgs.service'),
    import('../src/common/redis/redis.service'),
  ])
  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') throw new Error('PG_SERIALIZATION_CONFLICT_VERIFY_POSTGRES_REQUIRED')
  await prisma.onModuleInit()
  const rawRedis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 })
  const runId = randomBytes(8).toString('hex')
  const orgId = `verify_pg_conflict_${runId}`
  const adminId = `verify_pg_conflict_admin_${runId}`
  const firstId = `verify_pg_conflict_a_${runId}`
  const secondId = `verify_pg_conflict_b_${runId}`
  let passed = 0
  try {
    await prisma.organization.create({
      data: { id: orgId, name: 'PG serialization conflict verify', type: 'school_employment_center' },
    })
    await prisma.user.createMany({
      data: [
        { id: adminId, username: `${adminId}_user`, passwordHash: 'x', name: 'verify admin', role: 'admin' },
        { id: firstId, username: `${firstId}_user`, passwordHash: 'x', name: 'verify first', role: 'partner', orgId },
        { id: secondId, username: `${secondId}_user`, passwordHash: 'x', name: 'verify second', role: 'partner', orgId },
      ],
    })
    const racing = createRacingPrisma(prisma)
    const service = new AdminOrgsService(racing.prisma, new AuditService(prisma), new RedisService(rawRedis))
    const admin = { userId: adminId, role: 'admin' as const, orgId: null }
    const binding = { adminTokenVersion: 0, partnerTokenVersion: 0 }

    const results = await Promise.allSettled([
      service.deleteAccount(orgId, firstId, admin, binding),
      service.deleteAccount(orgId, secondId, admin, binding),
    ])

    assert.equal(racing.afterRead.timedOut, false, 'both transactions must read before either writes (race not forced)')
    assert.equal(racing.beforeCommit.timedOut, false, 'both transactions must reach COMMIT together (race not forced)')
    passed += 1

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    assert.equal(fulfilled.length, 1, 'exactly one concurrent delete must succeed')
    assert.equal(rejected.length, 1, 'exactly one concurrent delete must be refused')
    passed += 1

    const reason = rejected[0]!.reason as unknown
    assert.ok(
      reason instanceof HttpException,
      `commit-time serialization conflict must be retried, not surfaced as a 500; got ${describeError(reason)}`,
    )
    assert.equal(reason.getStatus(), 409)
    assert.equal(apiCode(reason), 'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED')
    passed += 1

    // 赢的一方 1 次；输的一方至少重试 1 次（证明 COMMIT 上的冲突被认出来并重试了）。
    // 输方重试时的新快照可能早于赢家提交可见，于是再冲突、再重试一次，所以 4 也是正确行为
    // （2026-10-01 main CI 实测到 4）。每个调用方上限 3 次尝试（withSerializableRetry），合计不超过 6。
    // 下限 3 不能放宽：不重试的写法只有 2 次。
    assert.ok(
      racing.transactionCalls >= 3 && racing.transactionCalls <= 6,
      `loser must be retried at least once and each caller makes at most 3 attempts; got ${racing.transactionCalls}`,
    )
    passed += 1

    assert.equal(await prisma.user.count({ where: { orgId, role: 'partner', enabled: true, deletedAt: null } }), 1)
    assert.equal(await prisma.auditLog.count({
      where: { actorId: adminId, action: 'org.account.delete', targetId: orgId },
    }), 1, 'the refused delete must not leave an audit row')
    passed += 1

    console.log(`verify-pg-serialization-conflict-postgres: ${passed}/5 PASS`)
  } finally {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: adminId }, { targetId: orgId }] } })
    await prisma.user.deleteMany({ where: { OR: [{ id: adminId }, { orgId }] } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    await prisma.onModuleDestroy()
    for (const id of [firstId, secondId]) await rawRedis.del(`internal:session-state:${id}`).catch(() => undefined)
    await rawRedis.quit()
  }
}

function apiCode(error: HttpException): string | undefined {
  const response = error.getResponse() as { error?: { code?: string } }
  return response.error?.code
}

/** 只描述错误的形状，不输出 SQL 或行数据。 */
function describeError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const value = error as { name?: unknown; code?: unknown; cause?: { kind?: unknown; originalCode?: unknown } }
  return JSON.stringify({
    name: value.name,
    code: value.code,
    causeKind: value.cause?.kind,
    causeCode: value.cause?.originalCode,
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'PG serialization conflict verification failed')
  process.exitCode = 1
})
