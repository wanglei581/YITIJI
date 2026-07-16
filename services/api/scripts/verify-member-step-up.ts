/**
 * Member SMS step-up verification.
 *
 * Uses a real Redis instance and a deliberately small in-memory Prisma/SMS
 * boundary so challenge, grant, replay, and ownership security invariants are
 * exercised without touching a developer database.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HttpException } from '@nestjs/common'
import { Redis } from 'ioredis'
import { encryptPhone } from '../src/common/crypto/phone-identity'
import { RedisService } from '../src/common/redis/redis.service'
import { MemberStepUpService } from '../src/member-auth/member-step-up.service'
import type { SmsSender } from '../src/member-auth/sms/sms-sender'

interface EndUserRecord {
  id: string
  enabled: boolean
  status: 'active' | 'disabled' | 'closing' | 'anonymized'
  phoneEnc: string
}

class FakeSmsSender implements SmsSender {
  lastCode: string | null = null
  shouldFail = false

  async sendCode(_phone: string, code: string): Promise<void> {
    if (this.shouldFail) throw new Error('fake SMS failure')
    this.lastCode = code
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined
  return (error.getResponse() as { error?: { code?: string } }).error?.code
}

async function expectCode(label: string, fn: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    await fn()
  } catch (error) {
    if (errorCode(error) === expected) {
      console.log(`  PASS ${label} → ${expected}`)
      return
    }
    throw new Error(`${label}: expected ${expected}, received ${errorCode(error) ?? String(error)}`)
  }
  throw new Error(`${label}: expected ${expected}, but call succeeded`)
}

function stepUpCodeKey(challengeId: string): string {
  return `member:step-up:code:${challengeId}`
}

function stepUpMetaKey(challengeId: string): string {
  return `member:step-up:meta:${challengeId}`
}

function stepUpAttemptKey(challengeId: string): string {
  return `member:step-up:attempt:${challengeId}`
}

function stepUpCooldownKey(endUserId: string, action: string): string {
  return `member:step-up:cooldown:${endUserId}:${action}`
}

function grantHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function verifyHttpContract(): void {
  const controller = readFileSync(resolve(__dirname, '../src/member-auth/member-auth.controller.ts'), 'utf8')
  const sharedContract = readFileSync(resolve(__dirname, '../../../packages/shared/src/types/member-privacy.ts'), 'utf8')
  const dtoContract = readFileSync(resolve(__dirname, '../src/member-auth/dto/member-step-up.dto.ts'), 'utf8')
  const requiredMarkers = [
    "@Post('auth/step-up/sms-code')",
    "@Post('auth/step-up/verify')",
    '@UseGuards(EndUserAuthGuard)',
    'async sendStepUpCode(',
    'async verifyStepUp(',
    'this.stepUp.sendChallenge(user.endUserId',
    'this.stepUp.verifyChallenge(user.endUserId, dto)',
  ]
  for (const marker of requiredMarkers) {
    assert(controller.includes(marker), `missing guarded step-up HTTP contract: ${marker}`)
  }
  const actionList = (source: string): string[] => {
    const match = source.match(/export const MEMBER_STEP_UP_ACTIONS = \[([\s\S]*?)\] as const/)
    assert(match, 'missing MEMBER_STEP_UP_ACTIONS contract')
    return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  }
  assert(
    JSON.stringify(actionList(dtoContract)) === JSON.stringify(actionList(sharedContract)),
    'API step-up action allowlist drifted from the shared member privacy contract',
  )
  assert(!/console\.(?:log|warn|error)\([^\n]*(?:code|phone|stepUpToken)/.test(controller), 'controller logs sensitive step-up data')
  console.log('  PASS guarded HTTP routes expose no plaintext credential logging or action-contract drift')
}

async function main(): Promise<void> {
  const redisUrl = process.env['REDIS_URL']
  const secret = process.env['SECRET_ENCRYPTION_KEY'] ?? ''
  if (!redisUrl) throw new Error('REDIS_URL is required')
  if (secret.length < 32) throw new Error('SECRET_ENCRYPTION_KEY must be at least 32 characters')

  const rawRedis = new Redis(redisUrl)
  const redis = new RedisService(rawRedis)
  const sms = new FakeSmsSender()
  const runId = randomUUID()
  const testIp = `198.18.${parseInt(runId.slice(0, 2), 16)}.${parseInt(runId.slice(2, 4), 16)}`
  const records = new Map<string, EndUserRecord>()
  const makeUser = (suffix: string, status: EndUserRecord['status'] = 'active', enabled = true): EndUserRecord => {
    const record: EndUserRecord = {
      id: `step-up-${suffix}-${runId}`,
      enabled,
      status,
      phoneEnc: encryptPhone('13800138000'),
    }
    records.set(record.id, record)
    return record
  }
  const prisma = {
    endUser: {
      findUnique: async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null,
    },
  } as never
  const service = new MemberStepUpService(prisma, redis, sms)
  const cleanupKeys = new Set<string>()

  try {
    console.log('\n=== member step-up security verification ===')
    const activeUser = makeUser('active')

    await expectCode(
      'missing member cannot create a challenge',
      () => service.sendChallenge(`missing-${runId}`, { action: 'export_data_request', ip: testIp }),
      'ACCOUNT_UNAVAILABLE',
    )
    await expectCode(
      'unallowlisted action is rejected',
      () => service.sendChallenge(activeUser.id, { action: 'invalid-action' as never, ip: testIp }),
      'STEP_UP_ACTION_INVALID',
    )

    const first = await service.sendChallenge(activeUser.id, {
      action: 'export_data_request',
      deviceId: 'KSK-001',
      ip: testIp,
    })
    cleanupKeys.add(stepUpCodeKey(first.challengeId))
    cleanupKeys.add(stepUpMetaKey(first.challengeId))
    cleanupKeys.add(stepUpAttemptKey(first.challengeId))
    cleanupKeys.add(stepUpCooldownKey(activeUser.id, 'export_data_request'))
    assert(sms.lastCode && /^\d{6}$/.test(sms.lastCode), 'SMS sender did not receive a six-digit code')
    const persistedDigest = await redis.get(stepUpCodeKey(first.challengeId))
    assert(persistedDigest && persistedDigest !== sms.lastCode && !persistedDigest.includes(sms.lastCode), 'Redis stored a plaintext step-up code')
    console.log('  PASS Redis challenge code is HMAC, not the six-digit plaintext')

    await expectCode(
      'another member cannot verify the challenge',
      () => service.verifyChallenge(makeUser('other').id, { challengeId: first.challengeId, code: sms.lastCode!, deviceId: 'KSK-001' }),
      'STEP_UP_CHALLENGE_INVALID',
    )
    const firstGrant = await service.verifyChallenge(activeUser.id, {
      challengeId: first.challengeId,
      code: sms.lastCode,
      deviceId: 'KSK-001',
    })
    assert(firstGrant.action === 'export_data_request' && firstGrant.stepUpToken.length >= 40, 'grant response is malformed')
    console.log('  PASS matching member receives an opaque, action-bound grant')
    const firstConsumption = await service.consumeGrant(
      activeUser.id,
      'export_data_request',
      firstGrant.stepUpToken,
      'KSK-001',
    )
    assert(firstConsumption.action === 'export_data_request' && firstConsumption.deviceMatched === true, 'grant consumption did not bind action/device')
    console.log('  PASS grant consumes once for the matching member and action')
    await expectCode(
      'replayed grant is uniformly invalid',
      () => service.consumeGrant(activeUser.id, 'export_data_request', firstGrant.stepUpToken, 'KSK-001'),
      'STEP_UP_TOKEN_INVALID',
    )

    const actionMismatchUser = makeUser('action-mismatch')
    const actionMismatchChallenge = await service.sendChallenge(actionMismatchUser.id, {
      action: 'export_data_request', ip: testIp,
    })
    cleanupKeys.add(stepUpCodeKey(actionMismatchChallenge.challengeId))
    cleanupKeys.add(stepUpMetaKey(actionMismatchChallenge.challengeId))
    cleanupKeys.add(stepUpAttemptKey(actionMismatchChallenge.challengeId))
    cleanupKeys.add(stepUpCooldownKey(actionMismatchUser.id, 'export_data_request'))
    const actionMismatchGrant = await service.verifyChallenge(actionMismatchUser.id, {
      challengeId: actionMismatchChallenge.challengeId, code: sms.lastCode!,
    })
    await expectCode(
      'wrong action consumes and rejects the grant',
      () => service.consumeGrant(actionMismatchUser.id, 'close_account', actionMismatchGrant.stepUpToken),
      'STEP_UP_TOKEN_INVALID',
    )
    await expectCode(
      'action-mismatched grant cannot be retried with its original action',
      () => service.consumeGrant(actionMismatchUser.id, 'export_data_request', actionMismatchGrant.stepUpToken),
      'STEP_UP_TOKEN_INVALID',
    )

    const changedDeviceUser = makeUser('device-change')
    const changedDeviceChallenge = await service.sendChallenge(changedDeviceUser.id, {
      action: 'close_account', deviceId: 'KSK-002', ip: testIp,
    })
    cleanupKeys.add(stepUpCodeKey(changedDeviceChallenge.challengeId))
    cleanupKeys.add(stepUpMetaKey(changedDeviceChallenge.challengeId))
    cleanupKeys.add(stepUpAttemptKey(changedDeviceChallenge.challengeId))
    cleanupKeys.add(stepUpCooldownKey(changedDeviceUser.id, 'close_account'))
    const changedDeviceGrant = await service.verifyChallenge(changedDeviceUser.id, {
      challengeId: changedDeviceChallenge.challengeId, code: sms.lastCode!, deviceId: 'KSK-003',
    })
    const changedDeviceConsumption = await service.consumeGrant(
      changedDeviceUser.id, 'close_account', changedDeviceGrant.stepUpToken, undefined,
    )
    assert(changedDeviceConsumption.deviceMatched === false, 'device mismatch should be surfaced only as a risk summary')
    console.log('  PASS missing/changed device does not reject a valid step-up grant')

    const wrongCodeUser = makeUser('wrong-code')
    const wrongCodeChallenge = await service.sendChallenge(wrongCodeUser.id, {
      action: 'export_data_download', ip: testIp,
    })
    cleanupKeys.add(stepUpCodeKey(wrongCodeChallenge.challengeId))
    cleanupKeys.add(stepUpMetaKey(wrongCodeChallenge.challengeId))
    cleanupKeys.add(stepUpAttemptKey(wrongCodeChallenge.challengeId))
    cleanupKeys.add(stepUpCooldownKey(wrongCodeUser.id, 'export_data_download'))
    const wrongCode = sms.lastCode === '000000' ? '111111' : '000000'
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expectCode(
        `wrong code attempt ${attempt}`,
        () => service.verifyChallenge(wrongCodeUser.id, { challengeId: wrongCodeChallenge.challengeId, code: wrongCode }),
        'STEP_UP_CODE_INVALID',
      )
    }
    await expectCode(
      'sixth wrong code invalidates the challenge',
      () => service.verifyChallenge(wrongCodeUser.id, { challengeId: wrongCodeChallenge.challengeId, code: wrongCode }),
      'STEP_UP_CODE_LOCKED',
    )
    assert(await redis.get(stepUpCodeKey(wrongCodeChallenge.challengeId)) === null, 'locked challenge retained its code')
    assert(await redis.get(stepUpMetaKey(wrongCodeChallenge.challengeId)) === null, 'locked challenge retained metadata')
    console.log('  PASS wrong-code threshold atomically invalidates challenge state')

    for (const state of ['disabled', 'closing', 'anonymized'] as const) {
      const unavailableUser = makeUser(state, state, state !== 'disabled')
      await expectCode(
        `${state} member cannot create step-up challenge`,
        () => service.sendChallenge(unavailableUser.id, { action: 'close_account', ip: testIp }),
        'ACCOUNT_UNAVAILABLE',
      )
    }

    const smsFailureUser = makeUser('sms-failure')
    sms.shouldFail = true
    await expectCode(
      'SMS provider failure returns a safe error',
      () => service.sendChallenge(smsFailureUser.id, { action: 'close_account', ip: testIp }),
      'STEP_UP_SMS_SEND_FAILED',
    )
    sms.shouldFail = false
    const failedCooldownKey = stepUpCooldownKey(smsFailureUser.id, 'close_account')
    cleanupKeys.add(failedCooldownKey)
    assert(await rawRedis.get(failedCooldownKey) === null, 'SMS failure left a cooldown key behind')
    console.log('  PASS SMS failure cleans up challenge and cooldown state')

    const concurrentUser = makeUser('concurrent')
    const concurrentChallenge = await service.sendChallenge(concurrentUser.id, { action: 'export_data_request', ip: testIp })
    cleanupKeys.add(stepUpCodeKey(concurrentChallenge.challengeId))
    cleanupKeys.add(stepUpMetaKey(concurrentChallenge.challengeId))
    cleanupKeys.add(stepUpAttemptKey(concurrentChallenge.challengeId))
    cleanupKeys.add(stepUpCooldownKey(concurrentUser.id, 'export_data_request'))
    const concurrentGrant = await service.verifyChallenge(concurrentUser.id, {
      challengeId: concurrentChallenge.challengeId, code: sms.lastCode!,
    })
    const concurrentResults = await Promise.allSettled([
      service.consumeGrant(concurrentUser.id, 'export_data_request', concurrentGrant.stepUpToken),
      service.consumeGrant(concurrentUser.id, 'export_data_request', concurrentGrant.stepUpToken),
    ])
    assert(concurrentResults.filter((result) => result.status === 'fulfilled').length === 1, 'concurrent grant consumption was not single-use')
    console.log('  PASS concurrent consumption permits exactly one request')

    const grantOwner = makeUser('grant-owner')
    const otherGrantOwner = makeUser('grant-other')
    const ownerTokens = ['owner-a', 'owner-b']
    const otherToken = 'other-a'
    for (const token of ownerTokens) {
      await redis.registerMemberStepUpGrant(
        grantOwner.id,
        grantHash(token),
        120,
        JSON.stringify({ endUserId: grantOwner.id, action: 'close_account', deviceDigest: null }),
      )
      cleanupKeys.add(`member:step-up:grant:${grantHash(token)}`)
    }
    cleanupKeys.add(`member:user-step-up-grants:${grantOwner.id}`)
    await redis.registerMemberStepUpGrant(
      otherGrantOwner.id,
      grantHash(otherToken),
      120,
      JSON.stringify({ endUserId: otherGrantOwner.id, action: 'close_account', deviceDigest: null }),
    )
    cleanupKeys.add(`member:step-up:grant:${grantHash(otherToken)}`)
    cleanupKeys.add(`member:user-step-up-grants:${otherGrantOwner.id}`)
    const revokedGrantCount = await redis.revokeMemberStepUpGrants(grantOwner.id)
    assert(revokedGrantCount === 2, 'revokeMemberStepUpGrants did not revoke exactly the owner grants')
    assert(await redis.getDelMemberStepUpGrant(otherGrantOwner.id, grantHash(otherToken)), 'grant revocation crossed user boundary')
    console.log('  PASS grant revocation is scoped to the owning member')

    verifyHttpContract()

    console.log('\n✅ ALL PASS — member step-up security contracts hold')
  } finally {
    await rawRedis.del(...cleanupKeys)
    await rawRedis.disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(`\n❌ member step-up verification failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
