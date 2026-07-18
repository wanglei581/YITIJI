import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import Redis from 'ioredis'
import { PartnerAccountActionRedisService } from '../src/common/redis/partner-account-action-redis.service'

const redisUrl = process.env['REDIS_URL']
assert.ok(redisUrl, 'REDIS_URL is required for the real Redis verification gate')

const runId = randomBytes(8).toString('hex')
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 })

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const ticket = (): string => randomBytes(32).toString('base64url')

const baseChallenge = (challengeId: string, action: 'delete_account' | 'rebind_phone' = 'delete_account') => ({
  challengeId,
  adminId: 'admin-1',
  adminTokenVersion: 7,
  orgId: 'org-1',
  partnerId: 'partner-1',
  partnerTokenVersion: 11,
  action,
  verifyMethod: 'password' as const,
})

const ticketBinding = (action: 'delete_account' | 'rebind_phone' = 'delete_account') => ({
  adminId: 'admin-1',
  adminTokenVersion: 7,
  orgId: 'org-1',
  partnerId: 'partner-1',
  partnerTokenVersion: 11,
  action,
})

async function withCase(name: string, test: (service: PartnerAccountActionRedisService, ns: string) => Promise<void>) {
  const namespace = `verify:partner-action:${runId}:${name}`
  process.env['PARTNER_ACCOUNT_ACTION_REDIS_NAMESPACE'] = namespace
  const service = new PartnerAccountActionRedisService(redis)
  try {
    await test(service, namespace)
  } finally {
    const keys = await redis.keys(`${namespace}:*`)
    if (keys.length > 0) await redis.del(...keys)
  }
}

async function issuePasswordTicket(
  service: PartnerAccountActionRedisService,
  action: 'delete_account' | 'rebind_phone',
  rawTicket: string,
) {
  const challenge = baseChallenge(`challenge-${randomBytes(5).toString('hex')}`, action)
  await service.replaceChallenge(challenge, 300)
  const result = await service.consumePasswordChallenge({
    scope: {
      challengeId: challenge.challengeId,
      adminId: challenge.adminId,
      orgId: challenge.orgId,
      partnerId: challenge.partnerId,
      action,
    },
    challenge,
    actionTicketHash: sha256(rawTicket),
    actionTicketBinding: ticketBinding(action),
    ticketTtlSeconds: 90,
  })
  assert.equal(result, 'consumed')
}

async function main(): Promise<void> {
await redis.ping()

await withCase('replace', async (service, ns) => {
  const first = baseChallenge('challenge-first')
  const second = baseChallenge('challenge-second')
  await service.replaceChallenge(first, 300)
  await service.replaceChallenge(second, 300)
  assert.equal(await redis.get(`${ns}:challenge:${first.challengeId}`), null)
  assert.deepEqual(JSON.parse((await redis.get(`${ns}:challenge:${second.challengeId}`))!), second)
  assert.equal(await redis.get(`${ns}:active:admin-1:partner-1:delete_account`), second.challengeId)
})

await withCase('password-concurrency', async (service) => {
  const challenge = baseChallenge('challenge-password-race')
  await service.replaceChallenge(challenge, 300)
  const results = await Promise.all(
    ['one', 'two'].map((suffix) => service.consumePasswordChallenge({
      scope: { challengeId: challenge.challengeId, adminId: 'admin-1', orgId: 'org-1', partnerId: 'partner-1', action: 'delete_account' },
      challenge,
      actionTicketHash: sha256(`password-ticket-${suffix}`),
      actionTicketBinding: ticketBinding(),
      ticketTtlSeconds: 90,
    })),
  )
  assert.equal(results.filter((result) => result === 'consumed').length, 1)
  assert.equal(results.filter((result) => result === 'unavailable').length, 1)
})

await withCase('sms-atomic', async (service, ns) => {
  const challenge = { ...baseChallenge('challenge-sms'), verifyMethod: 'sms' as const, phoneHash: sha256('13800138000'), otpPurpose: 'partner_account_delete' as const }
  const otp = {
    codeKey: `${ns}:otp:code`,
    attemptKey: `${ns}:otp:attempt`,
    lockedKey: `${ns}:otp:locked`,
    submittedCode: '123456',
    maxAttempts: 5 as const,
    lockSeconds: 300 as const,
  }
  await service.replaceChallenge(challenge, 300)
  await redis.set(otp.codeKey, '654321', 'EX', 300)
  assert.equal(await service.consumeSmsChallenge({
    scope: { challengeId: challenge.challengeId, adminId: 'admin-1', orgId: 'org-1', partnerId: 'partner-1', action: 'delete_account' },
    challenge,
    actionTicketHash: sha256('sms-wrong-ticket'),
    actionTicketBinding: ticketBinding(),
    ticketTtlSeconds: 90,
    otp,
  }), 'credential_invalid')
  assert.ok(await redis.get(`${ns}:challenge:${challenge.challengeId}`))
  await redis.set(otp.codeKey, otp.submittedCode, 'EX', 300)
  const results = await Promise.all(['one', 'two'].map((suffix) => service.consumeSmsChallenge({
    scope: { challengeId: challenge.challengeId, adminId: 'admin-1', orgId: 'org-1', partnerId: 'partner-1', action: 'delete_account' },
    challenge,
    actionTicketHash: sha256(`sms-ticket-${suffix}`),
    actionTicketBinding: ticketBinding(),
    ticketTtlSeconds: 90,
    otp,
  })))
  assert.equal(results.filter((result) => result === 'consumed').length, 1)
  assert.equal(results.filter((result) => result === 'unavailable').length, 1)
  assert.equal(await redis.exists(otp.codeKey, otp.attemptKey), 0)
})

await withCase('sms-lock', async (service, ns) => {
  const challenge = { ...baseChallenge('challenge-sms-lock'), verifyMethod: 'sms' as const, phoneHash: sha256('13900139000'), otpPurpose: 'partner_account_delete' as const }
  const common = {
    scope: { challengeId: challenge.challengeId, adminId: 'admin-1', orgId: 'org-1', partnerId: 'partner-1', action: 'delete_account' as const },
    challenge,
    actionTicketHash: sha256('locked-ticket'),
    actionTicketBinding: ticketBinding(),
    ticketTtlSeconds: 90 as const,
  }
  const otp = { codeKey: `${ns}:otp:code`, attemptKey: `${ns}:otp:attempt`, lockedKey: `${ns}:otp:locked`, submittedCode: '000000', maxAttempts: 5 as const, lockSeconds: 300 as const }
  await service.replaceChallenge(challenge, 300)
  await redis.set(otp.codeKey, '123456', 'EX', 300)
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.equal(await service.consumeSmsChallenge({ ...common, otp }), 'credential_invalid')
  }
  assert.equal(await service.consumeSmsChallenge({ ...common, otp }), 'credential_locked')
  assert.ok(await redis.get(otp.lockedKey))
  await redis.set(otp.codeKey, otp.submittedCode, 'EX', 300)
  assert.equal(await service.consumeSmsChallenge({ ...common, otp }), 'credential_locked')
  assert.ok(await redis.get(`${ns}:challenge:${challenge.challengeId}`))
})

await withCase('cancel-and-revoke', async (service, ns) => {
  const challenge = baseChallenge('challenge-cancel')
  await service.replaceChallenge(challenge, 300)
  await service.cancelChallenge({ challengeId: challenge.challengeId, adminId: 'admin-1', orgId: 'wrong-org', partnerId: 'partner-1', action: 'delete_account' })
  assert.ok(await redis.get(`${ns}:challenge:${challenge.challengeId}`))
  await service.cancelChallenge({ challengeId: challenge.challengeId, adminId: 'admin-1', orgId: 'org-1', partnerId: 'partner-1', action: 'delete_account' })
  assert.equal(await redis.get(`${ns}:challenge:${challenge.challengeId}`), null)

  const rawTicket = ticket()
  await issuePasswordTicket(service, 'delete_account', rawTicket)
  await service.revokeActionTicket(rawTicket, { adminId: 'admin-1', orgId: 'wrong-org', partnerId: 'partner-1', action: 'delete_account' })
  assert.ok(await redis.get(`${ns}:verified:${sha256(rawTicket)}`))
  await service.revokeActionTicket(rawTicket, { adminId: 'admin-1', orgId: 'org-1', partnerId: 'partner-1', action: 'delete_account' })
  assert.equal(await redis.get(`${ns}:verified:${sha256(rawTicket)}`), null)
})

await withCase('delete-lock', async (service, ns) => {
  const rawTicket = ticket()
  await issuePasswordTicket(service, 'delete_account', rawTicket)
  const input = {
    actionTicketHash: sha256(rawTicket),
    scope: { adminId: 'admin-1', orgId: 'org-1', partnerId: 'partner-1', action: 'delete_account' as const },
    requestId: 'request-owner',
    lockSeconds: 60 as const,
  }
  await redis.set(`${ns}:commit-lock:org-1:account-membership`, 'request-other', 'EX', 60)
  assert.deepEqual(await service.consumeDeleteTicketAndAcquireLock(input), { kind: 'conflict' })
  assert.ok(await redis.get(`${ns}:verified:${sha256(rawTicket)}`), 'lock conflict must not consume the ticket')
  await redis.del(`${ns}:commit-lock:org-1:account-membership`)
  assert.deepEqual(await service.consumeDeleteTicketAndAcquireLock({ ...input, scope: { ...input.scope, orgId: 'wrong-org' } }), { kind: 'missing_or_scope_mismatch' })
  assert.ok(await redis.get(`${ns}:verified:${sha256(rawTicket)}`), 'scope mismatch must not consume the ticket')
  assert.deepEqual(await service.consumeDeleteTicketAndAcquireLock(input), { kind: 'acquired', binding: ticketBinding() })
  assert.equal(await redis.get(`${ns}:verified:${sha256(rawTicket)}`), null)
  await service.releaseCommitLock('org-1', 'request-other')
  assert.equal(await redis.get(`${ns}:commit-lock:org-1:account-membership`), 'request-owner')
  await service.releaseCommitLock('org-1', 'request-owner')
  assert.equal(await redis.get(`${ns}:commit-lock:org-1:account-membership`), null)
})

await withCase('rebind', async (service, ns) => {
  const actionTicket = ticket()
  await issuePasswordTicket(service, 'rebind_phone', actionTicket)
  const rebindTicket = ticket()
  const rebindBinding = {
    ...ticketBinding('rebind_phone'),
    action: 'rebind_phone' as const,
    newPhoneHash: sha256('13700137000'),
    newPhoneEnc: 'encrypted-phone',
    phoneMasked: '137****7000',
  }
  const start = {
    actionTicketHash: sha256(actionTicket),
    scope: { adminId: 'admin-1', orgId: 'org-1', partnerId: 'partner-1', action: 'rebind_phone' as const },
    rebindTicketHash: sha256(rebindTicket),
    rebindBinding,
    rebindTtlSeconds: 300 as const,
  }
  assert.equal(await service.consumeActionTicketForRebind({ ...start, scope: { ...start.scope, orgId: 'wrong-org' } }), null)
  assert.ok(await redis.get(`${ns}:verified:${sha256(actionTicket)}`))
  assert.deepEqual(await service.consumeActionTicketForRebind(start), ticketBinding('rebind_phone'))
  assert.equal(await redis.get(`${ns}:verified:${sha256(actionTicket)}`), null)
  assert.deepEqual(JSON.parse((await redis.get(`${ns}:rebind:${sha256(rebindTicket)}`))!), rebindBinding)
  await service.revokeRebindTicket(rebindTicket, { ...start.scope, orgId: 'wrong-org' })
  assert.ok(await redis.get(`${ns}:rebind:${sha256(rebindTicket)}`))
  await service.revokeRebindTicket(rebindTicket, start.scope)
  assert.equal(await redis.get(`${ns}:rebind:${sha256(rebindTicket)}`), null)
})

await withCase('rebind-sms', async (service, ns) => {
  const actionTicket = ticket()
  await issuePasswordTicket(service, 'rebind_phone', actionTicket)
  const rebindTicket = ticket()
  const scope = { adminId: 'admin-1', orgId: 'org-1', partnerId: 'partner-1', action: 'rebind_phone' as const }
  await service.consumeActionTicketForRebind({
    actionTicketHash: sha256(actionTicket),
    scope,
    rebindTicketHash: sha256(rebindTicket),
    rebindBinding: { ...ticketBinding('rebind_phone'), action: 'rebind_phone', newPhoneHash: sha256('13600136000'), newPhoneEnc: 'encrypted', phoneMasked: '136****6000' },
    rebindTtlSeconds: 300,
  })
  const otp = { codeKey: `${ns}:otp:rebind-code`, attemptKey: `${ns}:otp:rebind-attempt`, lockedKey: `${ns}:otp:rebind-locked`, submittedCode: '246810', maxAttempts: 5 as const, lockSeconds: 300 as const }
  await redis.set(otp.codeKey, otp.submittedCode, 'EX', 300)
  const results = await Promise.all([1, 2].map(() => service.consumeRebindSmsTicket({ rebindTicketHash: sha256(rebindTicket), scope, otp })))
  assert.equal(results.filter((result) => result === 'consumed').length, 1)
  assert.equal(results.filter((result) => result === 'unavailable').length, 1)
  assert.equal(await redis.exists(`${ns}:rebind:${sha256(rebindTicket)}`, otp.codeKey, otp.attemptKey), 0)
})

await withCase('recent-and-failures', async (service, ns) => {
  assert.equal(await service.getAdminRecentVerification('admin-1'), null)
  await service.setAdminRecentVerification('admin-1', 7)
  assert.equal(await service.getAdminRecentVerification('admin-1'), 7)
  await service.clearAdminRecentVerification('admin-1')
  assert.equal(await service.getAdminRecentVerification('admin-1'), null)

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.equal(await service.reservePasswordAttempt('admin', 'admin-1'), true)
  }
  await redis.expire(`${ns}:admin-password-fail:admin-1`, 1)
  assert.equal(await service.isPasswordLocked('admin', 'admin-1'), false)
  assert.equal(await service.reservePasswordAttempt('admin', 'admin-1'), true)
  assert.equal(await service.isPasswordLocked('admin', 'admin-1'), true)
  assert.ok(
    await redis.ttl(`${ns}:admin-password-fail:admin-1`) >= 299,
    '第五次失败必须重新开始完整 300 秒锁定期',
  )
  assert.equal(await service.reservePasswordAttempt('admin', 'admin-1'), false)
  await service.clearPasswordFailures('admin', 'admin-1')
  assert.equal(await service.isPasswordLocked('admin', 'admin-1'), false)
  const concurrent = await Promise.all(
    Array.from({ length: 12 }, () => service.reservePasswordAttempt('admin', 'admin-1')),
  )
  assert.equal(concurrent.filter(Boolean).length, 5, 'bcrypt 前原子预约最多放行 5 个并发尝试')
  await service.clearPasswordFailures('admin', 'admin-1')
  assert.equal(await service.reservePasswordAttempt('partner', 'partner-1'), true)
  await service.clearPasswordFailures('partner', 'partner-1')
})

await redis.quit()
delete process.env['PARTNER_ACCOUNT_ACTION_REDIS_NAMESPACE']
console.log('verify-partner-account-action-redis: PASS')
}

void main().catch(async (error: unknown) => {
  await redis.quit().catch(() => undefined)
  delete process.env['PARTNER_ACCOUNT_ACTION_REDIS_NAMESPACE']
  console.error(error)
  process.exitCode = 1
})
