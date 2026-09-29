/**
 * verify:internal-accounts:postgres —— 3.9 备用管理员在 PostgreSQL 上的数据库约束与并发（2026-09-29）
 *
 * SQLite 版（verify:internal-accounts）已覆盖全部接口行为；这里只验 PostgreSQL 与 SQLite 不同的部分：
 *   [P1] 迁移里的条件唯一索引在 PostgreSQL 上生效：第二个未删除的备用管理员插不进去；软删后可以再建。
 *   [P2] 两个管理员同时互相停用（Serializable 事务 + 冲突重试）：只成功一个，另一个 409 INTERNAL_ACCOUNT_LAST_ADMIN，
 *        系统里至少剩一个可用管理员。
 *   [P3] 两个管理员同时提交建备用管理员：一个成功、一个 409 BACKUP_ADMIN_EXISTS，库里只有一个。
 * 两个并发用例都用屏障保证两边的前置检查都已通过、再一起进入事务。PostgreSQL 的冲突经 adapter-pg 抛出时是
 * `DriverAdapterError: TransactionWriteConflict`（cause.originalCode=40001）或 P2034，两种都必须被识别为可重试，
 * 否则输家拿到的是 500 而不是 409（本门禁第一次在真 PG 上跑时正是这样红的）。
 *
 * 在 postgres-readiness 的全新空库上、seed 之前运行（User 表必须为空，跑完自清）。真实 Redis（REDIS_URL）。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

assertIsolatedVerificationDatabase()
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-internal-accounts-pg-secret-key-0123456789abcdef'

let checks = 0
let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) {
    console.log(`  ✅ ${name}`)
    return
  }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

function codeOf(reason: unknown): string {
  const response = (reason as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
  return response?.error?.code ?? String((reason as Error)?.message ?? reason)
}

/** 包一层 $transaction：两个调用都到达后才放行，保证两边都已过前置检查。 */
function gated<T extends object>(prisma: T): { proxy: T; arrivals: () => number } {
  let arrivals = 0
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  setTimeout(() => release(), 10_000).unref()
  const proxy = new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async (...args: unknown[]) => {
          arrivals += 1
          if (arrivals >= 2) release()
          await gate
          return (Reflect.get(target, property, target) as (...a: unknown[]) => Promise<unknown>).apply(target, args)
        }
      }
      return Reflect.get(target, property, receiver)
    },
  })
  return { proxy, arrivals: () => arrivals }
}

async function main(): Promise<void> {
  console.log('\n=== verify:internal-accounts:postgres ===')
  const bcrypt = await import('bcryptjs')
  const { default: Redis } = await import('ioredis')
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { RedisService } = await import('../src/common/redis/redis.service')
  const { PartnerAccountActionRedisService } = await import('../src/common/redis/partner-account-action-redis.service')
  const { AuditService } = await import('../src/audit/audit.service')
  const { InternalOtpService } = await import('../src/auth/internal-otp.service')
  const { AdminInternalAccountsService } = await import('../src/admin-internal-accounts/admin-internal-accounts.service')
  const { BackupAdminCreateService } = await import('../src/admin-internal-accounts/backup-admin-create.service')

  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') throw new Error('INTERNAL_ACCOUNTS_PG_VERIFY_POSTGRES_REQUIRED')
  await prisma.onModuleInit()
  const rawRedis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 })
  const redis = new RedisService(rawRedis)
  const actionRedis = new PartnerAccountActionRedisService(rawRedis)
  const audit = new AuditService(prisma)
  const codes = new Map<string, string>()
  const otp = new InternalOtpService(redis, { sendCode: async (phone: string, code: string) => { codes.set(phone, code) } })
  const suffix = randomBytes(4).toString('hex')
  const createdIds: string[] = []

  try {
    if (await prisma.user.count() !== 0) throw new Error('INTERNAL_ACCOUNTS_PG_VERIFY_REQUIRES_EMPTY_USER_TABLE')

    // ── [P1] 条件唯一索引 ────────────────────────────────────────────────
    const mkBackup = (tag: string) => prisma.user.create({
      data: { username: `pg-backup-${tag}-${suffix}`, name: '备用', role: 'admin', passwordHash: 'x', enabled: false, isBackupAdmin: true },
      select: { id: true },
    })
    const first = await mkBackup('1')
    createdIds.push(first.id)
    let secondError = ''
    try {
      createdIds.push((await mkBackup('2')).id)
    } catch (error) {
      secondError = (error as Error).message
    }
    check('P1-1 第二个未删除的备用管理员被数据库拒绝', secondError !== '', 'second live backup inserted')
    await prisma.user.update({ where: { id: first.id }, data: { deletedAt: new Date() } })
    let afterDelete = ''
    try {
      createdIds.push((await mkBackup('3')).id)
    } catch (error) {
      afterDelete = (error as Error).message
    }
    check('P1-2 原备用管理员软删后可以再建一个', afterDelete === '', afterDelete.slice(0, 160))
    check('P1-3 普通管理员（isBackupAdmin=false）不受索引影响', await (async () => {
      const a = await prisma.user.create({ data: { username: `pg-plain-a-${suffix}`, name: 'a', role: 'admin', passwordHash: 'x' }, select: { id: true } })
      const b = await prisma.user.create({ data: { username: `pg-plain-b-${suffix}`, name: 'b', role: 'admin', passwordHash: 'x' }, select: { id: true } })
      createdIds.push(a.id, b.id)
      await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id] } } })
      return true
    })())
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } })
    createdIds.length = 0

    // ── [P2] 并发互停 ──────────────────────────────────────────────────
    const pwA = `Pg-A-${suffix}-Aa1!`
    const pwB = `Pg-B-${suffix}-Aa1!`
    const adminA = await prisma.user.create({ data: { username: `pg-admin-a-${suffix}`, name: '甲', role: 'admin', passwordHash: await bcrypt.hash(pwA, 4), passwordProofState: 'owner_managed' } })
    const adminB = await prisma.user.create({ data: { username: `pg-admin-b-${suffix}`, name: '乙', role: 'admin', passwordHash: await bcrypt.hash(pwB, 4), passwordProofState: 'owner_managed' } })
    createdIds.push(adminA.id, adminB.id)
    const race = gated(prisma)
    const racer = new AdminInternalAccountsService(race.proxy, redis, actionRedis, audit)
    const ctx = (ip: string) => ({ ip, ipAddress: '127.0.0.1', userAgent: 'verify-pg', requestId: null })
    const results = await Promise.allSettled([
      racer.setStatus({ userId: adminA.id, role: 'admin', orgId: null }, adminB.id, { action: 'disable', reason: '并发互停', adminCurrentPassword: pwA }, ctx(`198.51.100.${suffix.length}`)),
      racer.setStatus({ userId: adminB.id, role: 'admin', orgId: null }, adminA.id, { action: 'disable', reason: '并发互停', adminCurrentPassword: pwB }, ctx(`198.51.100.${suffix.length + 1}`)),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => codeOf(r.reason))
    const enabledAdmins = await prisma.user.count({ where: { role: 'admin', enabled: true, deletedAt: null } })
    check('P2-1 两边都进入事务（冲突方重试后再次进入），只成功一个，另一个 409 INTERNAL_ACCOUNT_LAST_ADMIN',
      race.arrivals() >= 2 && fulfilled === 1 && rejected.length === 1 && rejected[0] === 'INTERNAL_ACCOUNT_LAST_ADMIN',
      `arrivals=${race.arrivals()} fulfilled=${fulfilled} rejected=${rejected.join(',')}`)
    check('P2-2 至少剩一个可用管理员', enabledAdmins === 1, `${enabledAdmins}`)

    // ── [P3] 并发建备用管理员 ─────────────────────────────────────────────
    await prisma.user.updateMany({ where: { id: { in: [adminA.id, adminB.id] } }, data: { enabled: true } })
    const plain = new BackupAdminCreateService(prisma, redis, actionRedis, otp, audit)
    const phoneA = `139${String(Date.now()).slice(-8)}`
    const phoneB = `137${String(Date.now()).slice(-8)}`
    const actorA = { userId: adminA.id, role: 'admin' as const, orgId: null }
    const actorB = { userId: adminB.id, role: 'admin' as const, orgId: null }
    const startA = await plain.start(actorA, { phone: phoneA, adminCurrentPassword: pwA }, ctx(`203.0.113.${1 + suffix.length}`))
    const startB = await plain.start(actorB, { phone: phoneB, adminCurrentPassword: pwB }, ctx(`203.0.113.${2 + suffix.length}`))
    const createRace = gated(prisma)
    const creator = new BackupAdminCreateService(createRace.proxy, redis, actionRedis, otp, audit)
    const created = await Promise.allSettled([
      creator.verify(actorA, { ticket: startA.ticket, code: codes.get(phoneA) ?? '' }, ctx('203.0.113.9')),
      creator.verify(actorB, { ticket: startB.ticket, code: codes.get(phoneB) ?? '' }, ctx('203.0.113.9')),
    ])
    const createdOk = created.filter((r) => r.status === 'fulfilled') as Array<PromiseFulfilledResult<{ id: string }>>
    const createdErr = created.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => codeOf(r.reason))
    createdIds.push(...createdOk.map((r) => r.value.id))
    const live = await prisma.user.count({ where: { isBackupAdmin: true, deletedAt: null } })
    check('P3-1 两边都进入事务，一个成功、一个 409 BACKUP_ADMIN_EXISTS，库里只有一个备用管理员',
      createRace.arrivals() >= 2 && createdOk.length === 1 && createdErr.length === 1 && createdErr[0] === 'BACKUP_ADMIN_EXISTS' && live === 1,
      `arrivals=${createRace.arrivals()} ok=${createdOk.length} err=${createdErr.join(',')} live=${live}`)
  } finally {
    const leftovers = await prisma.user.findMany({ where: { username: { contains: suffix } }, select: { id: true } })
    const backupIds = await prisma.user.findMany({ where: { isBackupAdmin: true }, select: { id: true } })
    const ids = [...new Set([...createdIds, ...leftovers.map((u) => u.id), ...backupIds.map((u) => u.id)])]
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await rawRedis.quit().catch(() => undefined)
    await prisma.onModuleDestroy()
  }
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILED'} (${checks - failures}/${checks})`)
    process.exit(failures === 0 ? 0 : 1)
  })
  .catch((error: unknown) => {
    console.error('\n', error)
    process.exit(1)
  })
