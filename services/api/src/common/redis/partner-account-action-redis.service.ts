import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { REDIS_CLIENT } from './redis.service'
import type {
  ActionChallengeBinding,
  ActionTicketBinding,
  ChallengeConsumeResult,
  ChallengeScope,
  DeleteTicketConsumeInput,
  OtpConsumeBinding,
  PasswordChallengeConsumeInput,
  RebindSmsConsumeInput,
  RebindStartConsumeInput,
  RebindTicketBinding,
  SmsChallengeConsumeInput,
  TicketLockResult,
  TicketScope,
} from './partner-account-action-redis.types'

const ADMIN_RECENT_TTL_SECONDS = 600
const PASSWORD_FAILURE_TTL_SECONDS = 300
const PASSWORD_MAX_ATTEMPTS = 5

const CHALLENGE_MATCH_LUA = `
local function challengeMatches(raw, expectedRaw)
  local okStored, stored = pcall(cjson.decode, raw)
  local okExpected, expected = pcall(cjson.decode, expectedRaw)
  return okStored and okExpected and type(stored) == 'table' and type(expected) == 'table'
    and stored.challengeId == expected.challengeId
    and stored.adminId == expected.adminId
    and stored.adminTokenVersion == expected.adminTokenVersion
    and stored.orgId == expected.orgId
    and stored.partnerId == expected.partnerId
    and stored.partnerTokenVersion == expected.partnerTokenVersion
    and stored.action == expected.action
    and stored.verifyMethod == expected.verifyMethod
    and stored.phoneHash == expected.phoneHash
    and stored.otpPurpose == expected.otpPurpose
end
`

const TICKET_SCOPE_MATCH_LUA = `
local function ticketScopeMatches(raw, expectedRaw)
  local okStored, stored = pcall(cjson.decode, raw)
  local okExpected, expected = pcall(cjson.decode, expectedRaw)
  return okStored and okExpected and type(stored) == 'table' and type(expected) == 'table'
    and stored.adminId == expected.adminId
    and stored.orgId == expected.orgId
    and stored.partnerId == expected.partnerId
    and stored.action == expected.action
end
`

const ACTION_BINDING_MATCH_LUA = `
local function actionBindingMatches(leftRaw, rightRaw)
  local okLeft, left = pcall(cjson.decode, leftRaw)
  local okRight, right = pcall(cjson.decode, rightRaw)
  return okLeft and okRight and type(left) == 'table' and type(right) == 'table'
    and left.adminId == right.adminId
    and left.adminTokenVersion == right.adminTokenVersion
    and left.orgId == right.orgId
    and left.partnerId == right.partnerId
    and left.partnerTokenVersion == right.partnerTokenVersion
    and left.action == right.action
end
`

const OTP_CONSUME_LUA = `
local function consumeOtp(codeKey, attemptKey, lockedKey, submittedCode, maxAttempts, lockSeconds)
  if redis.call('EXISTS', lockedKey) == 1 then return 3 end
  local previousAttempts = tonumber(redis.call('GET', attemptKey) or '0')
  if previousAttempts >= maxAttempts then
    redis.call('SET', lockedKey, '1', 'EX', lockSeconds)
    redis.call('DEL', codeKey, attemptKey)
    return 3
  end
  local code = redis.call('GET', codeKey)
  if not code then return 2 end
  if code ~= submittedCode then
    local attempts = redis.call('INCR', attemptKey)
    if attempts == 1 then redis.call('EXPIRE', attemptKey, lockSeconds) end
    if attempts >= maxAttempts then
      redis.call('SET', lockedKey, '1', 'EX', lockSeconds)
      redis.call('DEL', codeKey, attemptKey)
      return 3
    end
    return 2
  end
  return 1
end
`

@Injectable()
export class PartnerAccountActionRedisService {
  private readonly ns = namespace()

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async replaceChallenge(binding: ActionChallengeBinding, ttlSeconds: number): Promise<void> {
    assertChallenge(binding)
    assertTtl(ttlSeconds, 3_600)
    await this.client.eval(
      `
      local oldChallengeId = redis.call('GET', KEYS[1])
      if oldChallengeId and oldChallengeId ~= ARGV[1] then
        redis.call('DEL', ARGV[4] .. ':challenge:' .. oldChallengeId)
      end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
      redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[3]))
      return 1
      `,
      2,
      this.activeKey(binding),
      this.challengeKey(binding.challengeId),
      binding.challengeId,
      JSON.stringify(binding),
      ttlSeconds,
      this.ns,
    )
  }

  async consumePasswordChallenge(input: PasswordChallengeConsumeInput): Promise<ChallengeConsumeResult> {
    assertChallengeConsume(input, 'password')
    const result = await this.client.eval(
      `
      ${CHALLENGE_MATCH_LUA}
      local raw = redis.call('GET', KEYS[2])
      if redis.call('GET', KEYS[1]) ~= ARGV[1] or not raw or not challengeMatches(raw, ARGV[2])
        or redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
      redis.call('DEL', KEYS[1], KEYS[2])
      redis.call('SET', KEYS[3], ARGV[3], 'EX', tonumber(ARGV[4]))
      return 1
      `,
      3,
      this.activeKey(input.challenge),
      this.challengeKey(input.scope.challengeId),
      this.verifiedKey(input.actionTicketHash),
      input.scope.challengeId,
      JSON.stringify(input.challenge),
      JSON.stringify(input.actionTicketBinding),
      input.ticketTtlSeconds,
    )
    return result === 1 ? 'consumed' : 'unavailable'
  }

  async consumeSmsChallenge(input: SmsChallengeConsumeInput): Promise<ChallengeConsumeResult> {
    assertChallengeConsume(input, 'sms')
    assertOtp(input.otp)
    const result = await this.client.eval(
      `
      ${CHALLENGE_MATCH_LUA}
      ${OTP_CONSUME_LUA}
      local raw = redis.call('GET', KEYS[2])
      if redis.call('GET', KEYS[1]) ~= ARGV[1] or not raw or not challengeMatches(raw, ARGV[2])
        or redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
      local otpResult = consumeOtp(KEYS[4], KEYS[5], KEYS[6], ARGV[5], tonumber(ARGV[6]), tonumber(ARGV[7]))
      if otpResult ~= 1 then return otpResult end
      redis.call('DEL', KEYS[1], KEYS[2], KEYS[4], KEYS[5])
      redis.call('SET', KEYS[3], ARGV[3], 'EX', tonumber(ARGV[4]))
      return 1
      `,
      6,
      this.activeKey(input.challenge),
      this.challengeKey(input.scope.challengeId),
      this.verifiedKey(input.actionTicketHash),
      input.otp.codeKey,
      input.otp.attemptKey,
      input.otp.lockedKey,
      input.scope.challengeId,
      JSON.stringify(input.challenge),
      JSON.stringify(input.actionTicketBinding),
      input.ticketTtlSeconds,
      input.otp.submittedCode,
      input.otp.maxAttempts,
      input.otp.lockSeconds,
    )
    return challengeResult(result)
  }

  async cancelChallenge(scope: ChallengeScope): Promise<void> {
    assertChallengeScope(scope)
    await this.client.eval(
      `
      ${TICKET_SCOPE_MATCH_LUA}
      local raw = redis.call('GET', KEYS[2])
      if redis.call('GET', KEYS[1]) == ARGV[1] and raw and ticketScopeMatches(raw, ARGV[2]) then
        redis.call('DEL', KEYS[1], KEYS[2])
      end
      return 1
      `,
      2,
      this.activeKey(scope),
      this.challengeKey(scope.challengeId),
      scope.challengeId,
      JSON.stringify(scope),
    )
  }

  async revokeActionTicket(ticket: string, scope: TicketScope): Promise<void> {
    assertBearerTicket(ticket)
    assertTicketScope(scope)
    await this.revokeScoped(this.verifiedKey(sha256(ticket)), scope)
  }

  async consumeDeleteTicketAndAcquireLock(input: DeleteTicketConsumeInput): Promise<TicketLockResult> {
    assertDigest(input.actionTicketHash)
    assertTicketScope(input.scope, 'delete_account')
    assertKeyPart(input.requestId, 'requestId')
    assertExactTtl(input.lockSeconds, 60)
    const result: unknown = await this.client.eval(
      `
      ${TICKET_SCOPE_MATCH_LUA}
      local raw = redis.call('GET', KEYS[1])
      if not raw or not ticketScopeMatches(raw, ARGV[1]) then return { 0 } end
      if redis.call('EXISTS', KEYS[2]) == 1 then return { 2 } end
      redis.call('DEL', KEYS[1])
      redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[3]))
      return { 1, raw }
      `,
      2,
      this.verifiedKey(input.actionTicketHash),
      this.commitLockKey(input.scope.orgId),
      JSON.stringify(input.scope),
      input.requestId,
      input.lockSeconds,
    )
    if (!Array.isArray(result) || typeof result[0] !== 'number') throw new Error('Invalid delete ticket result')
    if (result[0] === 2) return { kind: 'conflict' }
    if (result[0] !== 1 || typeof result[1] !== 'string') return { kind: 'missing_or_scope_mismatch' }
    return { kind: 'acquired', binding: parseActionTicket(result[1]) }
  }

  async releaseCommitLock(orgId: string, requestId: string): Promise<void> {
    assertKeyPart(orgId, 'orgId')
    assertKeyPart(requestId, 'requestId')
    await this.client.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
      1,
      this.commitLockKey(orgId),
      requestId,
    )
  }

  async consumeActionTicketForRebind(input: RebindStartConsumeInput): Promise<ActionTicketBinding | null> {
    assertDigest(input.actionTicketHash)
    assertDigest(input.rebindTicketHash)
    assertTicketScope(input.scope, 'rebind_phone')
    assertRebindBinding(input.rebindBinding)
    assertExactTtl(input.rebindTtlSeconds, 300)
    const result: unknown = await this.client.eval(
      `
      ${TICKET_SCOPE_MATCH_LUA}
      ${ACTION_BINDING_MATCH_LUA}
      local raw = redis.call('GET', KEYS[1])
      if not raw or not ticketScopeMatches(raw, ARGV[1]) or not actionBindingMatches(raw, ARGV[2])
        or redis.call('EXISTS', KEYS[2]) == 1 then return nil end
      redis.call('DEL', KEYS[1])
      redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[3]))
      return raw
      `,
      2,
      this.verifiedKey(input.actionTicketHash),
      this.rebindKey(input.rebindTicketHash),
      JSON.stringify(input.scope),
      JSON.stringify(input.rebindBinding),
      input.rebindTtlSeconds,
    )
    return typeof result === 'string' ? parseActionTicket(result) : null
  }

  async consumeRebindSmsTicket(input: RebindSmsConsumeInput): Promise<ChallengeConsumeResult> {
    assertDigest(input.rebindTicketHash)
    assertTicketScope(input.scope, 'rebind_phone')
    assertOtp(input.otp)
    const result = await this.client.eval(
      `
      ${TICKET_SCOPE_MATCH_LUA}
      ${OTP_CONSUME_LUA}
      local raw = redis.call('GET', KEYS[1])
      if not raw or not ticketScopeMatches(raw, ARGV[1]) then return 0 end
      local otpResult = consumeOtp(KEYS[2], KEYS[3], KEYS[4], ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4]))
      if otpResult ~= 1 then return otpResult end
      redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
      return 1
      `,
      4,
      this.rebindKey(input.rebindTicketHash),
      input.otp.codeKey,
      input.otp.attemptKey,
      input.otp.lockedKey,
      JSON.stringify(input.scope),
      input.otp.submittedCode,
      input.otp.maxAttempts,
      input.otp.lockSeconds,
    )
    return challengeResult(result)
  }

  async revokeRebindTicket(ticket: string, scope: TicketScope): Promise<void> {
    assertBearerTicket(ticket)
    assertTicketScope(scope, 'rebind_phone')
    await this.revokeScoped(this.rebindKey(sha256(ticket)), scope)
  }

  async setAdminRecentVerification(adminId: string, sessionId: string, tokenVersion: number): Promise<void> {
    assertKeyPart(adminId, 'adminId')
    assertKeyPart(sessionId, 'adminSessionId')
    assertVersion(tokenVersion, 'adminTokenVersion')
    await this.client.set(
      this.adminRecentKey(adminId, sessionId),
      JSON.stringify({ tokenVersion, expiresAt: Date.now() + ADMIN_RECENT_TTL_SECONDS * 1_000 }),
      'EX',
      ADMIN_RECENT_TTL_SECONDS,
    )
  }

  async getAdminRecentVerification(adminId: string, sessionId: string): Promise<number | null> {
    assertKeyPart(adminId, 'adminId')
    assertKeyPart(sessionId, 'adminSessionId')
    const raw = await this.client.get(this.adminRecentKey(adminId, sessionId))
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as { tokenVersion?: unknown; expiresAt?: unknown }
      if (!Number.isSafeInteger(value.tokenVersion) || Number(value.tokenVersion) < 0
        || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()) return null
      return Number(value.tokenVersion)
    } catch {
      return null
    }
  }

  async reservePasswordAttempt(subject: 'admin' | 'partner', id: string): Promise<boolean> {
    assertPasswordSubject(subject)
    assertKeyPart(id, `${subject}Id`)
    const result = await this.client.eval(
      `
      local current = tonumber(redis.call('GET', KEYS[1]) or '0')
      if current >= tonumber(ARGV[1]) then return 0 end
      current = redis.call('INCR', KEYS[1])
      if current == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
      if current >= tonumber(ARGV[1]) then
        redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
      end
      return 1
      `,
      1,
      this.passwordFailureKey(subject, id),
      PASSWORD_MAX_ATTEMPTS,
      PASSWORD_FAILURE_TTL_SECONDS,
    )
    return result === 1
  }

  async isPasswordLocked(subject: 'admin' | 'partner', id: string): Promise<boolean> {
    assertPasswordSubject(subject)
    assertKeyPart(id, `${subject}Id`)
    const failures = await this.client.get(this.passwordFailureKey(subject, id))
    return Number(failures ?? '0') >= PASSWORD_MAX_ATTEMPTS
  }

  async clearPasswordFailures(subject: 'admin' | 'partner', id: string): Promise<void> {
    assertPasswordSubject(subject)
    assertKeyPart(id, `${subject}Id`)
    await this.client.del(this.passwordFailureKey(subject, id))
  }

  async clearAdminRecentVerification(adminId: string, sessionId: string): Promise<void> {
    assertKeyPart(adminId, 'adminId')
    assertKeyPart(sessionId, 'adminSessionId')
    await this.client.del(this.adminRecentKey(adminId, sessionId))
  }

  private async revokeScoped(key: string, scope: TicketScope): Promise<void> {
    await this.client.eval(
      `
      ${TICKET_SCOPE_MATCH_LUA}
      local raw = redis.call('GET', KEYS[1])
      if raw and ticketScopeMatches(raw, ARGV[1]) then return redis.call('DEL', KEYS[1]) end
      return 0
      `,
      1,
      key,
      JSON.stringify(scope),
    )
  }

  private challengeKey(challengeId: string): string { return `${this.ns}:challenge:${challengeId}` }
  private verifiedKey(hash: string): string { return `${this.ns}:verified:${hash}` }
  private rebindKey(hash: string): string { return `${this.ns}:rebind:${hash}` }
  private activeKey(value: Pick<ActionChallengeBinding, 'adminId' | 'partnerId' | 'action'>): string {
    return `${this.ns}:active:${value.adminId}:${value.partnerId}:${value.action}`
  }
  private commitLockKey(orgId: string): string { return `${this.ns}:commit-lock:${orgId}:account-membership` }
  private adminRecentKey(adminId: string, sessionId: string): string {
    return `${this.ns}:admin-recent-verify:${adminId}:${sessionId}`
  }
  private passwordFailureKey(subject: 'admin' | 'partner', id: string): string {
    return `${this.ns}:${subject}-password-fail:${id}`
  }
}

function namespace(): string {
  const value = process.env['PARTNER_ACCOUNT_ACTION_REDIS_NAMESPACE']?.trim() || 'internal:partner-account-action'
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(value)) throw new Error('Invalid partner account action Redis namespace')
  return value
}

function assertChallenge(binding: ActionChallengeBinding): void {
  assertKeyPart(binding.challengeId, 'challengeId')
  assertKeyPart(binding.adminId, 'adminId')
  assertKeyPart(binding.orgId, 'orgId')
  assertKeyPart(binding.partnerId, 'partnerId')
  assertVersion(binding.adminTokenVersion, 'adminTokenVersion')
  assertVersion(binding.partnerTokenVersion, 'partnerTokenVersion')
  if (binding.action !== 'delete_account' && binding.action !== 'rebind_phone') throw new Error('Invalid account action')
  if (binding.verifyMethod !== 'password' && binding.verifyMethod !== 'sms') throw new Error('Invalid verification method')
  if (binding.verifyMethod === 'sms') {
    assertDigest(binding.phoneHash ?? '')
    const expectedPurpose = binding.action === 'delete_account' ? 'partner_account_delete' : 'partner_phone_rebind_authorize'
    if (binding.otpPurpose !== expectedPurpose) throw new Error('Invalid challenge OTP purpose')
  } else if (binding.phoneHash !== undefined || binding.otpPurpose !== undefined) {
    throw new Error('Password challenge cannot include OTP binding')
  }
}

function assertActionTicket(binding: ActionTicketBinding): void {
  assertKeyPart(binding.adminId, 'adminId')
  assertKeyPart(binding.orgId, 'orgId')
  assertKeyPart(binding.partnerId, 'partnerId')
  assertVersion(binding.adminTokenVersion, 'adminTokenVersion')
  assertVersion(binding.partnerTokenVersion, 'partnerTokenVersion')
  if (binding.action !== 'delete_account' && binding.action !== 'rebind_phone') throw new Error('Invalid account action')
}

function assertRebindBinding(binding: RebindTicketBinding): void {
  assertActionTicket(binding)
  if (binding.action !== 'rebind_phone') throw new Error('Invalid rebind action')
  assertDigest(binding.newPhoneHash)
  if (!binding.newPhoneEnc || binding.newPhoneEnc.length > 4_096) throw new Error('Invalid encrypted phone')
  if (!binding.phoneMasked || binding.phoneMasked.length > 64) throw new Error('Invalid masked phone')
}

function assertChallengeConsume(input: PasswordChallengeConsumeInput, method: 'password' | 'sms'): void {
  assertChallengeScope(input.scope)
  assertChallenge(input.challenge)
  assertActionTicket(input.actionTicketBinding)
  assertDigest(input.actionTicketHash)
  assertExactTtl(input.ticketTtlSeconds, 90)
  if (input.challenge.verifyMethod !== method || input.challenge.challengeId !== input.scope.challengeId) {
    throw new Error('Challenge verification method or id mismatch')
  }
  assertBindingMatchesScope(input.challenge, input.scope)
  assertBindingMatchesScope(input.actionTicketBinding, input.scope)
  if (input.actionTicketBinding.adminTokenVersion !== input.challenge.adminTokenVersion
    || input.actionTicketBinding.partnerTokenVersion !== input.challenge.partnerTokenVersion) {
    throw new Error('Ticket credential version mismatch')
  }
}

function assertChallengeScope(scope: ChallengeScope): void {
  assertKeyPart(scope.challengeId, 'challengeId')
  assertTicketScope(scope)
}

function assertTicketScope(scope: TicketScope, action?: TicketScope['action']): void {
  assertKeyPart(scope.adminId, 'adminId')
  assertKeyPart(scope.orgId, 'orgId')
  assertKeyPart(scope.partnerId, 'partnerId')
  if ((scope.action !== 'delete_account' && scope.action !== 'rebind_phone') || (action && scope.action !== action)) {
    throw new Error('Invalid ticket scope action')
  }
}

function assertBindingMatchesScope(binding: TicketScope, scope: TicketScope): void {
  if (binding.adminId !== scope.adminId || binding.orgId !== scope.orgId || binding.partnerId !== scope.partnerId
    || binding.action !== scope.action) throw new Error('Binding does not match scope')
}

function assertOtp(otp: OtpConsumeBinding): void {
  for (const [name, key] of [['codeKey', otp.codeKey], ['attemptKey', otp.attemptKey], ['lockedKey', otp.lockedKey]] as const) {
    if (!key || key.length > 512) throw new Error(`Invalid OTP ${name}`)
  }
  if (!/^\d{6}$/.test(otp.submittedCode) || otp.maxAttempts !== 5 || otp.lockSeconds !== 300) {
    throw new Error('Invalid OTP consume input')
  }
}

function assertBearerTicket(value: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Invalid bearer ticket')
}

function assertDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid ticket or phone digest')
}

function assertKeyPart(value: string, name: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`Invalid ${name}`)
}

function assertVersion(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`)
}

function assertTtl(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new Error('Invalid Redis TTL')
}

function assertExactTtl(value: number, expected: number): void {
  if (value !== expected) throw new Error(`Redis TTL must be ${expected} seconds`)
}

function assertPasswordSubject(value: string): asserts value is 'admin' | 'partner' {
  if (value !== 'admin' && value !== 'partner') throw new Error('Invalid password failure subject')
}

function challengeResult(result: unknown): ChallengeConsumeResult {
  if (result === 1) return 'consumed'
  if (result === 2) return 'credential_invalid'
  if (result === 3) return 'credential_locked'
  if (result === 0) return 'unavailable'
  throw new Error('Invalid challenge consume result')
}

function parseActionTicket(raw: string): ActionTicketBinding {
  const binding = JSON.parse(raw) as ActionTicketBinding
  assertActionTicket(binding)
  return binding
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
