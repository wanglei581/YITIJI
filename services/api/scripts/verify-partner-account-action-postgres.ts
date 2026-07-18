import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import Redis from 'ioredis'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import { verifyPartnerAccountActionStaticContract } from './support/partner-account-action-static-contract'

async function main(): Promise<void> {
  const url = process.env['POSTGRES_URL'] ?? process.env['DATABASE_URL']
  if (!url?.startsWith('postgresql://') && !url?.startsWith('postgres://')) {
    throw new Error('PostgreSQL environment unavailable: set POSTGRES_URL or DATABASE_URL')
  }
  process.env['DATABASE_URL'] = url
  process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-partner-action-pg-secret-at-least-32-bytes'
  await verifyPartnerAccountActionStaticContract()

  const [
    { PrismaService }, { AuditService }, { AdminOrgsService },
    { RedisService }, { PartnerAccountActionRedisService }, { InternalOtpService },
    { PartnerPhoneRebindService }, { PartnerAccountActionService },
  ] = await Promise.all([
    import('../src/prisma/prisma.service'),
    import('../src/audit/audit.service'),
    import('../src/orgs/admin-orgs.service'),
    import('../src/common/redis/redis.service'),
    import('../src/common/redis/partner-account-action-redis.service'),
    import('../src/auth/internal-otp.service'),
    import('../src/auth/partner-phone-rebind.service'),
    import('../src/auth/partner-account-action.service'),
  ])
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const rawRedis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 })
  const runId = randomBytes(8).toString('hex')
  const namespace = `verify:partner-action:pg:${runId}`
  process.env['PARTNER_ACCOUNT_ACTION_REDIS_NAMESPACE'] = namespace
  const orgId = `verify_partner_action_${runId}`
  const adminId = `verify_admin_${runId}`
  const firstId = `verify_partner_a_${runId}`
  const secondId = `verify_partner_b_${runId}`
  try {
    await prisma.organization.create({
      data: { id: orgId, name: 'Partner action PG verify', type: 'school_employment_center' },
    })
    await prisma.user.createMany({
      data: [
        { id: adminId, username: `${adminId}_user`, passwordHash: 'x', name: 'verify admin', role: 'admin' },
        { id: firstId, username: `${firstId}_user`, passwordHash: 'x', name: 'verify first', role: 'partner', orgId },
        { id: secondId, username: `${secondId}_user`, passwordHash: 'x', name: 'verify second', role: 'partner', orgId },
      ],
    })
    const redisService = new RedisService(rawRedis)
    const actionRedis = new PartnerAccountActionRedisService(rawRedis)
    const sms = new CapturingSmsSender()
    const otp = new InternalOtpService(redisService, sms as never)
    const audit = new AuditService(prisma)
    const service = new AdminOrgsService(prisma, audit, redisService)
    const actions = new PartnerAccountActionService(prisma, redisService, actionRedis, otp, service, audit)
    const admin = { userId: adminId, role: 'admin' as const, orgId: null }
    const firstTicket = await issueActionTicket(actionRedis, 'delete_account', {
      adminId, orgId, partnerId: firstId, adminTokenVersion: 0, partnerTokenVersion: 0,
    })
    const secondTicket = await issueActionTicket(actionRedis, 'delete_account', {
      adminId, orgId, partnerId: secondId, adminTokenVersion: 0, partnerTokenVersion: 0,
    })
    const results = await Promise.allSettled([
      actions.deleteAccount(admin, orgId, firstId, firstTicket),
      actions.deleteAccount(admin, orgId, secondId, secondTicket),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const conflictIndex = results.findIndex((result) => result.status === 'rejected'
      && apiCode(result.reason) === 'ACCOUNT_COMMIT_CONFLICT')
    assert.notEqual(conflictIndex, -1)
    await expectCode(
      () => actions.deleteAccount(
        admin,
        orgId,
        conflictIndex === 0 ? firstId : secondId,
        conflictIndex === 0 ? firstTicket : secondTicket,
      ),
      'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED',
    )
    assert.equal(await prisma.user.count({
      where: { orgId, role: 'partner', enabled: true, deletedAt: null },
    }), 1)
    assert.equal(await prisma.auditLog.count({
      where: { actorId: adminId, action: 'org.account.delete', targetId: orgId },
    }), 1)

    const survivor = await prisma.user.findFirstOrThrow({
      where: { orgId, role: 'partner', enabled: true, deletedAt: null },
      select: { id: true, tokenVersion: true },
    })
    const rebind = new PartnerPhoneRebindService(
      prisma,
      redisService,
      actionRedis,
      otp,
    )
    const adminUser = { userId: adminId, role: 'admin' as const, orgId: null }

    const racedPhone = `139${runId.replace(/[^0-9]/g, '').padEnd(8, '1').slice(0, 8)}`
    const racedTicket = await issueActionTicket(actionRedis, 'rebind_phone', {
      adminId,
      orgId,
      partnerId: survivor.id,
      adminTokenVersion: 0,
      partnerTokenVersion: survivor.tokenVersion,
    })
    const raced = await rebind.start(adminUser, orgId, survivor.id, racedTicket, racedPhone, { ip: '127.0.0.1' })
    await prisma.user.create({
      data: {
        id: `verify_race_${runId}`,
        username: `verify_race_${runId}`,
        passwordHash: 'x',
        name: 'race owner',
        role: 'partner',
        orgId,
        phoneHash: hashPhone(racedPhone),
        phoneEnc: encryptPhone(racedPhone),
        phoneVerifiedAt: new Date(),
      },
    })
    await expectCode(
      () => rebind.verify(adminUser, orgId, survivor.id, raced.rebindTicket, sms.codeFor(racedPhone)),
      'PHONE_TAKEN',
    )
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: survivor.id } })).tokenVersion, 0)

    const successPhone = `138${runId.replace(/[^0-9]/g, '').padEnd(8, '2').slice(0, 8)}`
    const successTicket = await issueActionTicket(actionRedis, 'rebind_phone', {
      adminId,
      orgId,
      partnerId: survivor.id,
      adminTokenVersion: 0,
      partnerTokenVersion: 0,
    })
    const started = await rebind.start(adminUser, orgId, survivor.id, successTicket, successPhone, { ip: '127.0.0.2' })
    await rebind.verify(adminUser, orgId, survivor.id, started.rebindTicket, sms.codeFor(successPhone))
    const rebound = await prisma.user.findUniqueOrThrow({ where: { id: survivor.id } })
    assert.equal(rebound.phoneHash, hashPhone(successPhone))
    assert.equal(rebound.tokenVersion, 1)
    assert.equal(await prisma.auditLog.count({
      where: { actorId: adminId, action: 'org.account.phone_rebind', targetId: orgId },
    }), 1)
    console.log('verify-partner-account-action-postgres: PASS')
  } finally {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: adminId }, { targetId: orgId }] } })
    await prisma.user.deleteMany({ where: { OR: [{ id: adminId }, { orgId }] } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    await prisma.onModuleDestroy()
    const keys = await rawRedis.keys(`${namespace}:*`)
    if (keys.length > 0) await rawRedis.del(...keys)
    await rawRedis.quit()
  }
}

function apiCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return undefined
  const response = (error as { getResponse: () => unknown }).getResponse() as { error?: { code?: string } }
  return response.error?.code
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error) => apiCode(error) === code)
}

class CapturingSmsSender {
  private readonly codes = new Map<string, string>()
  async sendCode(phone: string, code: string): Promise<void> { this.codes.set(phone, code) }
  codeFor(phone: string): string {
    const code = this.codes.get(phone)
    assert.match(code ?? '', /^\d{6}$/)
    return code!
  }
}

async function issueActionTicket(
  actionRedis: import('../src/common/redis/partner-account-action-redis.service').PartnerAccountActionRedisService,
  action: 'delete_account' | 'rebind_phone',
  binding: {
    adminId: string
    orgId: string
    partnerId: string
    adminTokenVersion: number
    partnerTokenVersion: number
  },
): Promise<string> {
  const challengeId = randomBytes(16).toString('base64url')
  const ticket = randomBytes(32).toString('base64url')
  const challenge = { ...binding, challengeId, action, verifyMethod: 'password' as const }
  await actionRedis.replaceChallenge(challenge, 300)
  assert.equal(await actionRedis.consumePasswordChallenge({
    scope: { challengeId, adminId: binding.adminId, orgId: binding.orgId, partnerId: binding.partnerId, action },
    challenge,
    actionTicketHash: createHash('sha256').update(ticket).digest('hex'),
    actionTicketBinding: { ...binding, action },
    ticketTtlSeconds: 90,
  }), 'consumed')
  return ticket
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'partner account action PostgreSQL verification failed')
  process.exitCode = 1
})
