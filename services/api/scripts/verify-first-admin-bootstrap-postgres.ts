import 'dotenv/config'
import assert from 'node:assert/strict'
import { PrismaService } from '../src/prisma/prisma.service'
import { createFirstAdmin, FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION } from '../src/auth/first-admin-bootstrap'
import { createRacingPrisma } from './support/serializable-race-barrier'

const BOOTSTRAP_LOSER_CODES = ['FIRST_ADMIN_BOOTSTRAP_CONFLICT', 'FIRST_ADMIN_BOOTSTRAP_NOT_EMPTY']

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] !== 'test' || process.env['FIRST_ADMIN_BOOTSTRAP_VERIFY_TARGET'] !== 'isolated') {
    throw new Error('FIRST_ADMIN_BOOTSTRAP_VERIFY_TARGET_FORBIDDEN')
  }
  const url = new URL(process.env['DATABASE_URL'] ?? '')
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || !url.pathname.endsWith('_ci')) {
    throw new Error('FIRST_ADMIN_BOOTSTRAP_VERIFY_DATABASE_FORBIDDEN')
  }
  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') throw new Error('FIRST_ADMIN_BOOTSTRAP_VERIFY_POSTGRES_REQUIRED')
  await prisma.onModuleInit()
  const verifyUsernames = ['verify.bootstrap.a', 'verify.bootstrap.b']
  try {
    assert.equal(await prisma.user.count(), 0, 'isolated PostgreSQL verify must start with User=0')
    assert.equal(await prisma.auditLog.count({ where: { action: FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION } }), 0,
      'isolated PostgreSQL verify must start without bootstrap audits')
    const attempts = await Promise.allSettled([
      createFirstAdmin(prisma, { username: 'verify.bootstrap.a', name: '并发验证A', passwordHash: 'hash-a' }),
      createFirstAdmin(prisma, { username: 'verify.bootstrap.b', name: '并发验证B', passwordHash: 'hash-b' }),
    ])
    const fulfilled = attempts.filter((attempt): attempt is PromiseFulfilledResult<{ id: string; username: string }> => attempt.status === 'fulfilled')
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected')
    assert.equal(fulfilled.length, 1, 'exactly one concurrent bootstrap must succeed')
    assert.equal(rejected.length, 1, 'exactly one concurrent bootstrap must fail')
    // 败者只能是两个既有业务码之一；驱动层错误（例如 COMMIT 上的 DriverAdapterError）
    // 原样漏出去，运维看到的就不是「并发冲突」而是一条看不懂的底层报错。
    assert.ok(BOOTSTRAP_LOSER_CODES.includes(errorMessage((rejected[0] as PromiseRejectedResult).reason)),
      `concurrent loser must fail with a bootstrap code; got ${errorMessage((rejected[0] as PromiseRejectedResult).reason)}`)
    const createdUserId = fulfilled[0]!.value.id
    assert.equal(await prisma.user.count(), 1)
    const bootstrapAudits = await prisma.auditLog.findMany({
      where: { action: FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION },
      select: { targetId: true, payloadJson: true },
    })
    assert.equal(bootstrapAudits.length, 1, 'concurrent loser must not leave an audit')
    assert.equal(bootstrapAudits[0]!.targetId, createdUserId)
    assert.deepEqual(JSON.parse(bootstrapAudits[0]!.payloadJson), {
      username: fulfilled[0]!.value.username,
      passwordProofState: 'temporary',
    })
    await verifyCommitTimeConflictIsRecognized(prisma, verifyUsernames)
    console.log('ALL PASS: PostgreSQL concurrent bootstrap created exactly one User and one audit; commit-time conflict maps to FIRST_ADMIN_BOOTSTRAP_CONFLICT')
  } finally {
    const verifyUsers = await prisma.user.findMany({
      where: { username: { in: verifyUsernames } },
      select: { id: true },
    })
    const verifyUserIds = verifyUsers.map((user) => user.id)
    await prisma.$transaction([
      prisma.auditLog.deleteMany({
        where: {
          OR: [
            { action: FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION },
            ...(verifyUserIds.length > 0 ? [{ targetId: { in: verifyUserIds } }] : []),
          ],
        },
      }),
      prisma.user.deleteMany({ where: { username: { in: verifyUsernames } } }),
    ])
    await prisma.onModuleDestroy()
  }
}

/**
 * 屏障把两次引导确定地挤进同一时间窗，冲突落在 COMMIT 上（adapter-pg 抛的是没有 code
 * 的 DriverAdapterError，不是 P2034）。规格：败者必须报 FIRST_ADMIN_BOOTSTRAP_CONFLICT。
 */
async function verifyCommitTimeConflictIsRecognized(prisma: PrismaService, verifyUsernames: string[]): Promise<void> {
  const verifyUsers = await prisma.user.findMany({ where: { username: { in: verifyUsernames } }, select: { id: true } })
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { action: FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION } }),
    prisma.auditLog.deleteMany({ where: { targetId: { in: verifyUsers.map((user) => user.id) } } }),
    prisma.user.deleteMany({ where: { username: { in: verifyUsernames } } }),
  ])
  assert.equal(await prisma.user.count(), 0, 'commit-time race must start with User=0')
  const racing = createRacingPrisma(prisma)
  const attempts = await Promise.allSettled([
    createFirstAdmin(racing.prisma, { username: verifyUsernames[0]!, name: '并发验证A', passwordHash: 'hash-a' }),
    createFirstAdmin(racing.prisma, { username: verifyUsernames[1]!, name: '并发验证B', passwordHash: 'hash-b' }),
  ])
  assert.equal(racing.afterRead.timedOut, false, 'both bootstraps must count users before either inserts (race not forced)')
  assert.equal(racing.beforeCommit.timedOut, false, 'both bootstraps must reach COMMIT together (race not forced)')
  const rejected = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected')
  assert.equal(attempts.length - rejected.length, 1, 'exactly one forced-race bootstrap must succeed')
  assert.equal(rejected.length, 1, 'exactly one forced-race bootstrap must fail')
  assert.equal(errorMessage(rejected[0]!.reason), 'FIRST_ADMIN_BOOTSTRAP_CONFLICT',
    'commit-time serialization conflict must map to FIRST_ADMIN_BOOTSTRAP_CONFLICT')
  assert.equal(await prisma.user.count(), 1)
  assert.equal(await prisma.auditLog.count({ where: { action: FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION } }), 1)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
