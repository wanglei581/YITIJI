import { createHash, randomBytes } from 'node:crypto'
import type { Redis } from 'ioredis'
import type {
  StepUpRedis,
  StepUpService,
} from './verify-member-step-up.helpers'
import {
  assert,
  expectCode,
  pass,
  registerSensitive,
} from './verify-member-step-up.helpers'

interface UserFixture {
  id: string
}

export async function verifyCorruptAttemptMatrix(args: {
  rawRedis: Redis
  service: StepUpService
  createChallenge(label: string): Promise<{ endUserId: string; challengeId: string; code: string }>
}): Promise<void> {
  const corruptions: Array<{
    label: string
    mutate(redis: Redis, key: string): Promise<unknown>
  }> = [
    { label: 'missing', mutate: (redis, key) => redis.del(key) },
    {
      label: 'wrong-type',
      mutate: async (redis, key) => {
        await redis.del(key)
        return redis.hset(key, 'attempts', '0')
      },
    },
    { label: 'persistent', mutate: (redis, key) => redis.persist(key) },
    {
      label: 'already-exhausted',
      mutate: async (redis, key) => {
        await redis.set(key, '5')
        return redis.expire(key, 60)
      },
    },
  ]

  for (const corruption of corruptions) {
    for (const useCorrectCode of [true, false]) {
      const fixture = await args.createChallenge(
        `attempt-${corruption.label}-${useCorrectCode ? 'correct' : 'wrong'}`,
      )
      const prefix = `member:step-up:challenge:${fixture.challengeId}`
      await corruption.mutate(args.rawRedis, `${prefix}:attempt`)
      const wrongCode = fixture.code === '000000' ? '111111' : '000000'
      registerSensitive(wrongCode)
      await expectCode(
        () => args.service.verifyChallenge(fixture.endUserId, {
          challengeId: fixture.challengeId,
          code: useCorrectCode ? fixture.code : wrongCode,
        }),
        'STEP_UP_CHALLENGE_INVALID',
        `corrupt ${corruption.label} attempt state rejects ${useCorrectCode ? 'correct' : 'wrong'} code`,
      )
      for (const suffix of ['meta', 'code', 'attempt']) {
        assert(await args.rawRedis.exists(`${prefix}:${suffix}`) === 0,
          `corrupt ${corruption.label} attempt state must destroy challenge ${suffix}`)
      }
    }
  }
  pass('missing/corrupt attempt state always fails closed')
}

export async function verifyGrantRedisInvariants(args: {
  rawRedis: Redis
  stepUpRedis: StepUpRedis
  service: StepUpService
  createUser(label: string): Promise<UserFixture>
  addRedisMarker(value: string): void
}): Promise<void> {
  const cooldownCasKey = `member:step-up:cooldown:verify-${randomBytes(16).toString('hex')}:close_account`
  const oldCooldownOwner = randomBytes(16).toString('hex')
  const newCooldownOwner = randomBytes(16).toString('hex')
  args.addRedisMarker(cooldownCasKey)
  await args.rawRedis.set(cooldownCasKey, newCooldownOwner, 'EX', 60)
  assert(await args.stepUpRedis.getAndDelIfEquals(cooldownCasKey, oldCooldownOwner) === 'mismatched',
    'late cooldown cleanup must detect a replacement owner')
  assert(await args.rawRedis.get(cooldownCasKey) === newCooldownOwner,
    'late cooldown cleanup must not delete a replacement owner reservation')
  await args.rawRedis.del(cooldownCasKey)
  pass('late cooldown owner cleanup cannot delete a replacement reservation')

  const ttlOwner = await args.createUser('grant-index-ttl')
  const longHash = randomBytes(32).toString('hex')
  const shortHash = randomBytes(32).toString('hex')
  args.addRedisMarker(longHash)
  args.addRedisMarker(shortHash)
  const ttlPayload = JSON.stringify({
    endUserId: ttlOwner.id,
    action: 'export_data_request',
    deviceDigest: null,
    statusChangedAt: null,
  })
  await args.stepUpRedis.registerMemberStepUpGrant(ttlOwner.id, longHash, 60, ttlPayload)
  const ttlIndexKey = `member:user-step-up-grants:${ttlOwner.id}`
  const indexTtlBefore = await args.rawRedis.ttl(ttlIndexKey)
  await args.stepUpRedis.registerMemberStepUpGrant(ttlOwner.id, shortHash, 5, ttlPayload)
  const indexTtlAfter = await args.rawRedis.ttl(ttlIndexKey)
  assert(indexTtlBefore > 0 && indexTtlAfter >= indexTtlBefore - 1 && indexTtlAfter > 5,
    'registering a shorter grant must not shrink the whole-user grant index TTL')
  assert(await args.stepUpRedis.revokeMemberStepUpGrants(ttlOwner.id) === 2,
    'TTL anomaly fixture must revoke exactly its two owned grants')
  pass('grant index TTL is monotonic when a shorter grant is registered')

  const corruptIndexOwner = await args.createUser('corrupt-index-owner')
  const protectedOwner = await args.createUser('corrupt-index-protected')
  const protectedToken = randomBytes(32).toString('base64url')
  const protectedHash = createHash('sha256').update(protectedToken).digest('hex')
  registerSensitive(protectedToken)
  args.addRedisMarker(protectedHash)
  await args.rawRedis.set(
    `member:step-up:grant:${protectedHash}`,
    JSON.stringify({
      endUserId: protectedOwner.id,
      action: 'export_data_request',
      deviceDigest: null,
      statusChangedAt: null,
    }),
    'EX',
    60,
  )
  await args.rawRedis.sadd(`member:user-step-up-grants:${corruptIndexOwner.id}`, protectedHash)
  await args.rawRedis.expire(`member:user-step-up-grants:${corruptIndexOwner.id}`, 60)
  assert(await args.stepUpRedis.revokeMemberStepUpGrants(corruptIndexOwner.id) === 0,
    'corrupt foreign index entries must not be counted as owned grant revocations')
  assert(await args.rawRedis.exists(`member:step-up:grant:${protectedHash}`) === 1,
    'whole-user revocation must not delete a grant whose payload belongs to another user')
  await args.service.consumeGrant(protectedOwner.id, 'export_data_request', protectedToken)
  pass('corrupt user index cannot revoke another user grant')

  const collisionOwner = await args.createUser('grant-collision-owner')
  const collisionOther = await args.createUser('grant-collision-other')
  const collisionHash = randomBytes(32).toString('hex')
  args.addRedisMarker(collisionHash)
  const collisionPayload = JSON.stringify({
    endUserId: collisionOwner.id,
    action: 'close_account',
    deviceDigest: null,
    statusChangedAt: null,
  })
  await args.stepUpRedis.registerMemberStepUpGrant(collisionOwner.id, collisionHash, 60, collisionPayload)
  let collisionRejected = false
  try {
    await args.stepUpRedis.registerMemberStepUpGrant(
      collisionOther.id,
      collisionHash,
      60,
      JSON.stringify({
        endUserId: collisionOther.id,
        action: 'export_data_request',
        deviceDigest: null,
        statusChangedAt: null,
      }),
    )
  } catch {
    collisionRejected = true
  }
  assert(collisionRejected, 'grant token-hash collision must fail closed')
  assert(await args.rawRedis.get(`member:step-up:grant:${collisionHash}`) === collisionPayload,
    'grant token-hash collision must not overwrite the original payload')
  assert(await args.rawRedis.sismember(`member:user-step-up-grants:${collisionOther.id}`, collisionHash) === 0,
    'grant token-hash collision must not contaminate the other user index')
  assert(await args.stepUpRedis.getDelMemberStepUpGrant(collisionOwner.id, collisionHash) === collisionPayload,
    'original collision grant must remain atomically consumable by its owner')
  pass('grant token-hash collision cannot overwrite payload or owner index')
}
