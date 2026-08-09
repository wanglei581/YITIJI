import 'dotenv/config'
import assert from 'node:assert/strict'
import { PrismaService } from '../src/prisma/prisma.service'
import { createFirstAdmin, FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION } from '../src/auth/first-admin-bootstrap'

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
    console.log('ALL PASS: PostgreSQL concurrent bootstrap created exactly one User and one audit')
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

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
