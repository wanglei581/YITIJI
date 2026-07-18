import assert from 'node:assert/strict'
import { HttpException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import Redis from 'ioredis'
import { AuditService } from '../src/audit/audit.service'
import { InternalOtpService } from '../src/auth/internal-otp.service'
import { PartnerAccountActionService } from '../src/auth/partner-account-action.service'
import { PartnerPhoneRebindService } from '../src/auth/partner-phone-rebind.service'
import { createOpaqueTicket, digestOpaqueTicket } from '../src/auth/partner-account-action-ticket'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import { PartnerAccountActionRedisService } from '../src/common/redis/partner-account-action-redis.service'
import { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminOrgsService } from '../src/orgs/admin-orgs.service'
import { assertExactCredentialDto } from '../src/orgs/dto/partner-account-action.dto'
import { prepareIsolatedDatabase } from './support/internal-auth-verify-harness'
import { verifyPartnerAccountActionStaticContract } from './support/partner-account-action-static-contract'

async function main(): Promise<void> {
  await verifyPartnerAccountActionStaticContract()

  const first = createOpaqueTicket()
  const second = createOpaqueTicket()
  assert.equal(Buffer.from(first.ticket, 'base64url').byteLength, 32)
  assert.match(first.digest, /^[a-f0-9]{64}$/)
  assert.equal(digestOpaqueTicket(first.ticket), first.digest)
  assert.notEqual(first.ticket, second.ticket)

  assert.deepEqual(assertExactCredentialDto({ code: '123456' }), { code: '123456' })
  assert.deepEqual(assertExactCredentialDto({ currentPassword: 'owner-password' }), {
    currentPassword: 'owner-password',
  })
  assert.throws(() => assertExactCredentialDto({}), (error) => apiCode(error) === 'VALIDATION_FAILED')
  assert.throws(
    () => assertExactCredentialDto({ code: '123456', currentPassword: 'owner-password' }),
    (error) => apiCode(error) === 'VALIDATION_FAILED',
  )

  let deleteCalls = 0
  const failClosed = createActionService({
    redisGet: async () => { throw new Error('redis unavailable') },
    deleteAccount: async () => { deleteCalls += 1; return { success: true as const } },
  })
  await expectCode(
    () => failClosed.deleteAccount(ADMIN, 'org-a', 'partner-a', undefined),
    'ACCOUNT_ACTION_STEP_UP_REQUIRED',
  )
  await assert.rejects(() => failClosed.deleteAccount(ADMIN, 'org-a', 'partner-a', first.ticket), /redis unavailable/)
  assert.equal(deleteCalls, 0, 'Redis 异常时不得进入删除事务')

  const challenge = {
    challengeId: 'challenge-1',
    adminId: ADMIN.userId,
    adminTokenVersion: 3,
    orgId: 'org-a',
    partnerId: 'partner-a',
    partnerTokenVersion: 7,
    action: 'delete_account',
    verifyMethod: 'password',
  }
  const proofNotReady = createActionService({
    redisGet: async (key) => key.includes(':challenge:') ? JSON.stringify(challenge) : null,
    admin: currentAdmin(),
    partner: currentPartner('temporary'),
  })
  await expectCode(
    () => proofNotReady.verifyChallenge(
      ADMIN,
      'org-a',
      'partner-a',
      'challenge-1',
      { currentPassword: 'target-password' },
    ),
    'ACCOUNT_PASSWORD_PROOF_NOT_READY',
  )

  const adminLocked = createActionService({
    passwordLocked: true,
    admin: currentAdmin(),
    partner: currentPartner('owner_managed'),
  })
  await expectCode(
    () => adminLocked.createChallenge(
      ADMIN,
      'org-a',
      'partner-a',
      { action: 'delete_account', verifyMethod: 'password', adminCurrentPassword: 'admin-password' },
      { ip: '127.0.0.1' },
    ),
    'ADMIN_CREDENTIAL_LOCKED',
  )

  await verifySqliteAndRedisFlow()

  console.log('verify-partner-account-action: PASS')
}

const ADMIN = { userId: 'admin-a', role: 'admin' as const, orgId: null }

function currentAdmin() {
  return {
    id: ADMIN.userId,
    role: 'admin',
    enabled: true,
    deletedAt: null,
    tokenVersion: 3,
    passwordHash: '$2b$10$not-used-in-this-contract',
  }
}

function currentPartner(passwordProofState: string) {
  return {
    id: 'partner-a',
    enabled: true,
    tokenVersion: 7,
    passwordHash: '$2b$10$not-used-in-this-contract',
    passwordProofState,
    phoneHash: null,
    phoneEnc: null,
    phoneVerifiedAt: null,
  }
}

function createActionService(options: {
  redisGet?: (key: string) => Promise<string | null>
  admin?: ReturnType<typeof currentAdmin>
  partner?: ReturnType<typeof currentPartner>
  deleteAccount?: () => Promise<{ success: true }>
  passwordLocked?: boolean
}): PartnerAccountActionService {
  const prisma = {
    user: {
      findUnique: async () => options.admin ?? currentAdmin(),
      findFirst: async () => options.partner ?? currentPartner('owner_managed'),
    },
    organization: { findUnique: async () => ({ id: 'org-a' }) },
  }
  const redis = { get: options.redisGet ?? (async () => null) }
  const actionRedis = {
    getAdminRecentVerification: async () => null,
    isPasswordLocked: async () => options.passwordLocked ?? false,
  }
  const otp = {}
  const adminOrgs = { deleteAccount: options.deleteAccount ?? (async () => ({ success: true as const })) }
  const audit = { write: async () => null }
  return new PartnerAccountActionService(
    prisma as never,
    redis as never,
    actionRedis as never,
    otp as never,
    adminOrgs as never,
    audit as never,
  )
}

function apiCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined
  const response = error.getResponse() as { error?: { code?: string } }
  return response.error?.code
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error) => apiCode(error) === code)
}

class CapturingSmsSender {
  private readonly codes = new Map<string, string>()

  async sendCode(phone: string, code: string): Promise<void> {
    this.codes.set(phone, code)
  }

  codeFor(phone: string): string {
    const code = this.codes.get(phone)
    assert.match(code ?? '', /^\d{6}$/)
    return code!
  }
}

async function verifySqliteAndRedisFlow(): Promise<void> {
  const database = prepareIsolatedDatabase()
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'
  const rawRedis = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
  const namespace = `verify:partner-action:sqlite:${createOpaqueTicket().digest.slice(0, 16)}`
  const phoneSuffix = randomPhoneSuffix(namespace)
  process.env['PARTNER_ACCOUNT_ACTION_REDIS_NAMESPACE'] = namespace
  process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-partner-action-secret-at-least-32-bytes'
  let prisma: PrismaService | undefined
  try {
    assert.equal(await rawRedis.ping(), 'PONG')
    database.initialize()
    prisma = new PrismaService()
    await prisma.onModuleInit()
    const redis = new RedisService(rawRedis)
    const actionRedis = new PartnerAccountActionRedisService(rawRedis)
    const sms = new CapturingSmsSender()
    const otp = new InternalOtpService(redis, sms as never)
    const audit = new AuditService(prisma)
    const adminOrgs = new AdminOrgsService(prisma, audit, redis)
    const actions = new PartnerAccountActionService(prisma, redis, actionRedis, otp, adminOrgs, audit)
    const rebind = new PartnerPhoneRebindService(prisma, redis, actionRedis, otp)

    const adminPassword = 'AdminPass123'
    const targetPassword = 'TargetPass123'
    const adminPasswordHash = await bcrypt.hash(adminPassword, 4)
    const targetPasswordHash = await bcrypt.hash(targetPassword, 4)
    await prisma.organization.createMany({
      data: [
        { id: 'org-delete', name: 'delete verify', type: 'school_employment_center' },
        { id: 'org-rebind', name: 'rebind verify', type: 'school_employment_center' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: ADMIN.userId, username: 'verify_admin', passwordHash: adminPasswordHash, name: 'admin', role: 'admin' },
        {
          id: 'partner-delete', username: 'partner_delete', passwordHash: targetPasswordHash,
          passwordProofState: 'owner_managed', name: 'delete', role: 'partner', orgId: 'org-delete',
        },
        {
          id: 'partner-remain', username: 'partner_remain', passwordHash: targetPasswordHash,
          passwordProofState: 'owner_managed', name: 'remain', role: 'partner', orgId: 'org-delete',
        },
        {
          id: 'partner-rebind', username: 'partner_rebind', passwordHash: targetPasswordHash,
          passwordProofState: 'owner_managed', name: 'rebind', role: 'partner', orgId: 'org-rebind',
        },
      ],
    })

    const deleteTicket = await issuePasswordAction(
      actions, 'org-delete', 'partner-delete', 'delete_account', adminPassword, targetPassword,
    )
    await expectCode(
      () => rebind.start(ADMIN, 'org-delete', 'partner-delete', deleteTicket, `137${phoneSuffix}`, { ip: '127.0.0.1' }),
      'ACCOUNT_ACTION_TICKET_STALE',
    )
    await expectCode(
      () => actions.deleteAccount(ADMIN, 'org-delete', 'partner-delete', createOpaqueTicket().ticket),
      'ACCOUNT_ACTION_STEP_UP_REQUIRED',
    )
    await actions.deleteAccount(ADMIN, 'org-delete', 'partner-delete', deleteTicket)
    await expectCode(
      () => actions.deleteAccount(ADMIN, 'org-delete', 'partner-delete', deleteTicket),
      'ACCOUNT_ACTION_STEP_UP_REQUIRED',
    )
    const deleted = await prisma.user.findUniqueOrThrow({ where: { id: 'partner-delete' } })
    assert.equal(deleted.deletedAt instanceof Date, true)
    assert.equal(deleted.enabled, false)
    assert.equal(deleted.tokenVersion, 1)
    const deletedSession = JSON.parse((await redis.get('internal:session-state:partner-delete')) ?? '{}') as {
      enabled?: boolean; tokenVersion?: number
    }
    assert.deepEqual({ enabled: deletedSession.enabled, tokenVersion: deletedSession.tokenVersion }, {
      enabled: false, tokenVersion: 1,
    })
    assert.equal(await prisma.auditLog.count({
      where: { actorId: ADMIN.userId, action: 'org.account.delete', targetId: 'org-delete' },
    }), 1)

    const lastTicket = await issuePasswordAction(
      actions, 'org-delete', 'partner-remain', 'delete_account', adminPassword, targetPassword,
    )
    await expectCode(
      () => actions.deleteAccount(ADMIN, 'org-delete', 'partner-remain', lastTicket),
      'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED',
    )
    await expectCode(
      () => actions.deleteAccount(ADMIN, 'org-delete', 'partner-remain', lastTicket),
      'ACCOUNT_ACTION_STEP_UP_REQUIRED',
    )

    const actionTicket = await issuePasswordAction(
      actions, 'org-rebind', 'partner-rebind', 'rebind_phone', adminPassword, targetPassword,
    )
    const newPhone = `139${phoneSuffix}`
    const started = await rebind.start(
      ADMIN, 'org-rebind', 'partner-rebind', actionTicket, newPhone, { ip: '127.0.0.2' },
    )
    assert.equal(started.phoneMasked, `${newPhone.slice(0, 3)}****${newPhone.slice(7)}`)
    await rebind.verify(
      ADMIN, 'org-rebind', 'partner-rebind', started.rebindTicket, sms.codeFor(newPhone),
    )
    const rebound = await prisma.user.findUniqueOrThrow({ where: { id: 'partner-rebind' } })
    assert.equal(rebound.phoneHash, hashPhone(newPhone))
    assert.equal(rebound.tokenVersion, 1)
    const reboundSession = JSON.parse((await redis.get('internal:session-state:partner-rebind')) ?? '{}') as {
      tokenVersion?: number
    }
    assert.equal(reboundSession.tokenVersion, 1)
    assert.equal(await prisma.auditLog.count({
      where: { actorId: ADMIN.userId, action: 'org.account.phone_rebind', targetId: 'org-rebind' },
    }), 1)

    const raceTicket = await issuePasswordAction(
      actions, 'org-rebind', 'partner-rebind', 'rebind_phone', adminPassword, targetPassword,
    )
    const racedPhone = `138${phoneSuffix}`
    const raceStarted = await rebind.start(
      ADMIN, 'org-rebind', 'partner-rebind', raceTicket, racedPhone, { ip: '127.0.0.3' },
    )
    await prisma.user.create({
      data: {
        id: 'partner-race-owner', username: 'partner_race_owner', passwordHash: targetPasswordHash,
        passwordProofState: 'owner_managed', name: 'race owner', role: 'partner', orgId: 'org-rebind',
        phoneHash: hashPhone(racedPhone), phoneEnc: encryptPhone(racedPhone), phoneVerifiedAt: new Date(),
      },
    })
    await expectCode(
      () => rebind.verify(
        ADMIN, 'org-rebind', 'partner-rebind', raceStarted.rebindTicket, sms.codeFor(racedPhone),
      ),
      'PHONE_TAKEN',
    )
    const afterRace = await prisma.user.findUniqueOrThrow({ where: { id: 'partner-rebind' } })
    assert.equal(afterRace.phoneHash, hashPhone(newPhone))
    assert.equal(afterRace.tokenVersion, 1)
  } finally {
    if (prisma) await prisma.onModuleDestroy()
    const keys = await rawRedis.keys(`${namespace}:*`)
    if (keys.length > 0) await rawRedis.del(...keys)
    await rawRedis.quit()
    database.cleanup()
  }
}

function randomPhoneSuffix(seed: string): string {
  const digits = digestOpaqueTicket(createOpaqueTicket().ticket)
    .replace(/[a-f]/g, (letter) => String(letter.charCodeAt(0) - 96))
    .replace(/\D/g, '')
  return `${seed.length}${digits}`.padEnd(8, '7').slice(0, 8)
}

async function issuePasswordAction(
  actions: PartnerAccountActionService,
  orgId: string,
  partnerId: string,
  action: 'delete_account' | 'rebind_phone',
  adminPassword: string,
  targetPassword: string,
): Promise<string> {
  const challenge = await actions.createChallenge(
    ADMIN,
    orgId,
    partnerId,
    { action, verifyMethod: 'password', adminCurrentPassword: adminPassword },
    { ip: '127.0.0.10' },
  )
  const verified = await actions.verifyChallenge(
    ADMIN,
    orgId,
    partnerId,
    challenge.challengeId,
    { currentPassword: targetPassword },
  )
  return verified.actionTicket
}

main().catch((error) => {
  const code = apiCode(error) ?? 'UNEXPECTED_ERROR'
  const name = error instanceof Error ? error.name : typeof error
  const location = error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined
  console.error(`verify-partner-account-action failed: code=${code} type=${name}`)
  if (location) console.error(location)
  process.exitCode = 1
})
