/** Wave 1A step-up RED: memory SMS double + real Redis/CI DB; never log secrets. */
import 'dotenv/config'
import 'reflect-metadata'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Redis } from 'ioredis'
import { MEMBER_STEP_UP_ACTIONS } from '../../../packages/shared/src/types/member-privacy'
import type { SmsSender } from '../src/member-auth/sms/sms-sender'

type StepUpAction = (typeof MEMBER_STEP_UP_ACTIONS)[number]
type Json = Record<string, unknown>

interface ChallengeResult {
  challengeId: string
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: number
}
interface GrantResult {
  stepUpToken: string
  action: StepUpAction
  expiresInSeconds: number
}
interface StepUpService {
  sendChallenge(endUserId: string, input: {
    action: StepUpAction
    deviceId?: string
    ip: string
  }): Promise<ChallengeResult>
  verifyChallenge(endUserId: string, input: {
    challengeId: string
    code: string
    deviceId?: string
  }): Promise<GrantResult>
  consumeGrant(endUserId: string, action: StepUpAction, token: string, deviceId?: string): Promise<unknown>
}
type StepUpServiceConstructor = new (...args: unknown[]) => StepUpService
type StepUpRedis = {
  revokeMemberStepUpGrants(endUserId: string): Promise<number>
}

class FakeSmsSender implements SmsSender {
  private code: string | null = null
  private rejectNext = false
  failNextSend(): void { this.rejectNext = true }
  clear(): void { this.code = null }
  hasCode(): boolean { return this.code !== null }
  lastCode(): string {
    if (!this.code) throw new Error('FakeSmsSender did not receive a code')
    return this.code
  }
  async sendCode(_phone: string, code: string): Promise<void> {
    if (this.rejectNext) {
      this.rejectNext = false
      throw new Error('fake provider unavailable')
    }
    this.code = code
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function pass(message: string): void { console.log(`  PASS ${message}`) }

function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property
    const own = error.constraints ? Object.values(error.constraints).map((message) => `${path}: ${message}`) : []
    return [...own, ...(error.children?.length ? flatten(error.children, path) : [])]
  })
}

function errorCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return ((response as { error?: { code?: string } } | undefined)?.error?.code)
    ?? (error as { code?: string }).code
}

async function expectCode(fn: () => Promise<unknown>, expected: string, label: string): Promise<void> {
  try {
    await fn()
  } catch (error) {
    assert(errorCode(error) === expected, `${label}: expected ${expected}, got ${errorCode(error) ?? 'unknown'}`)
    pass(label)
    return
  }
  throw new Error(`${label}: expected rejection`)
}

async function scanKeys(redis: Redis): Promise<string[]> {
  const output = new Set<string>()
  for (const pattern of ['member:step-up:*', 'member:user-step-up-grants:*']) {
    let cursor = '0'
    do {
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = result[0]
      result[1].forEach((key) => output.add(key))
    } while (cursor !== '0')
  }
  return [...output]
}

async function redisValue(redis: Redis, key: string): Promise<string> {
  const type = await redis.type(key)
  if (type === 'string') return (await redis.get(key)) ?? ''
  if (type === 'set') return (await redis.smembers(key)).join('|')
  if (type === 'hash') return JSON.stringify(await redis.hgetall(key))
  return ''
}

async function ownedKeys(redis: Redis, markers: string[]): Promise<string[]> {
  const output: string[] = []
  for (const key of await scanKeys(redis)) {
    if (markers.some((marker) => key.includes(marker))) {
      output.push(key)
      continue
    }
    const value = await redisValue(redis, key)
    if (markers.some((marker) => value.includes(marker))) output.push(key)
  }
  return output
}

function instantiateService(
  Constructor: StepUpServiceConstructor,
  dependencies: { prisma: unknown; redis: unknown; audit: unknown; sms: FakeSmsSender },
): StepUpService {
  const types = (Reflect.getMetadata('design:paramtypes', Constructor) as Array<{ name?: string }> | undefined) ?? []
  const explicit = (Reflect.getMetadata('self:paramtypes', Constructor) as Array<{ index: number; param: unknown }> | undefined) ?? []
  const args = types.map((type, index) => {
    const token = explicit.find((entry) => entry.index === index)?.param
    if (token && String(token).includes('SMS_SENDER')) return dependencies.sms
    if (type?.name === 'PrismaService') return dependencies.prisma
    if (type?.name === 'RedisService') return dependencies.redis
    if (type?.name === 'AuditService') return dependencies.audit
    if (type?.name === 'Object' && explicit.some((entry) => entry.index === index)) return dependencies.sms
    throw new Error(`MemberStepUpService dependency at index ${index} is not covered by the integration harness`)
  })
  return new Constructor(...args)
}

async function main(): Promise<void> {
  console.log('\n=== member step-up security integration contract ===')

  assert(
    JSON.stringify(MEMBER_STEP_UP_ACTIONS) === JSON.stringify([
      'export_data_request', 'export_data_download', 'close_account',
    ]),
    'shared member step-up action allowlist drifted',
  )
  pass('shared action allowlist is exact')

  const serviceFile = resolve(__dirname, '../src/member-auth/member-step-up.service.ts')
  if (!existsSync(serviceFile)) {
    throw new Error('RED: MemberStepUpService 尚未实现（expected Task 5 failure）')
  }
  const serviceModule = (await import(serviceFile)) as { MemberStepUpService?: StepUpServiceConstructor }
  const StepUpClass = serviceModule.MemberStepUpService
  assert(StepUpClass, 'MemberStepUpService export is missing')

  const dtoFile = resolve(__dirname, '../src/member-auth/dto/member-step-up.dto.ts')
  if (!existsSync(dtoFile)) {
    throw new Error('RED: member step-up DTO 尚未实现（expected Task 5 failure）')
  }
  const dto = (await import(dtoFile)) as {
    SendMemberStepUpCodeDto?: unknown
    VerifyMemberStepUpDto?: unknown
  }
  assert(dto.SendMemberStepUpCodeDto && dto.VerifyMemberStepUpDto, 'member step-up DTO exports are missing')

  process.env['NODE_ENV'] = 'test'
  process.env['SMS_PROVIDER'] = 'log'
  process.env['JWT_SECRET'] = 'ci-only-member-step-up-jwt-secret-0123456789'
  process.env['SECRET_ENCRYPTION_KEY'] = 'ci-only-member-step-up-encryption-key-0123456789'
  process.env['MEMBER_STEP_UP_TTL_SECONDS'] = '60'
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  assert(databaseUrl.startsWith('file:'), 'Task 5 verify only permits the CI SQLite database; PostgreSQL wiring belongs to Task 8')
  const redisUrl = process.env['REDIS_URL'] ?? ''
  assert(/^redis:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/\d+)?$/.test(redisUrl),
    'Task 5 verify only permits a loopback CI Redis instance')

  const [
    { NestFactory },
    { JwtService },
    { AppModule },
    { HttpExceptionFilter },
    { REDIS_CLIENT, RedisService },
    { PrismaService },
    { AuditService },
    { encryptPhone, hashPhone },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('@nestjs/jwt'),
    import('../src/app.module'),
    import('../src/common/filters/http-exception.filter'),
    import('../src/common/redis/redis.service'),
    import('../src/prisma/prisma.service'),
    import('../src/audit/audit.service'),
    import('../src/common/crypto/phone-identity'),
  ])

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: flatten(errors)[0] ?? '请求参数校验失败', details: flatten(errors) },
    }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0)

  const prisma = app.get(PrismaService)
  const redis = app.get(RedisService)
  const rawRedis = app.get<Redis>(REDIS_CLIENT)
  const audit = app.get(AuditService)
  const sms = new FakeSmsSender()
  const service = instantiateService(StepUpClass, { prisma, redis, audit, sms })
  const stepUpRedis = redis as unknown as StepUpRedis
  const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1/member`
  const startedAt = new Date()
  const runId = randomBytes(8).toString('hex')
  const userIds: string[] = []
  const phoneHashes: string[] = []
  const redisMarkers = [runId]
  const sensitiveValues = new Set<string>(['KSK-ORIGINAL', 'KSK-CHANGED', 'KSK-LATER'])
  const initialKeys = new Set(await scanKeys(rawRedis))
  let userNumber = 0

  async function createUser(label: string, status = 'active'): Promise<{ id: string; phone: string }> {
    userNumber += 1
    const tail = ((Date.now() % 90_000_000) + userNumber).toString().padStart(8, '0')
    const phone = `138${tail}`
    const id = `verify-step-up-${label}-${runId}`
    const phoneHash = hashPhone(phone)
    await prisma.endUser.create({
      data: { id, phoneHash, phoneEnc: encryptPhone(phone), enabled: status === 'active', status },
    })
    userIds.push(id)
    phoneHashes.push(phoneHash)
    redisMarkers.push(id, phoneHash)
    sensitiveValues.add(phone)
    return { id, phone }
  }

  async function request(path: string, body: Json, token?: string): Promise<{ status: number; json: Json }> {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Json }
  }

  async function issueGrant(userId: string, action: StepUpAction, deviceId?: string): Promise<GrantResult> {
    sms.clear()
    const challenge = await service.sendChallenge(userId, { action, deviceId, ip: '127.0.0.1' })
    redisMarkers.push(challenge.challengeId)
    const code = sms.lastCode()
    assert(/^\d{6}$/.test(code), 'FakeSmsSender must receive a six-digit code')
    const grant = await service.verifyChallenge(userId, { challengeId: challenge.challengeId, code, deviceId })
    const challengeJson = JSON.stringify(challenge)
    assert(!challengeJson.includes(code), 'challenge response must not expose the SMS code')
    redisMarkers.push(createHash('sha256').update(grant.stepUpToken).digest('hex'))
    sensitiveValues.add(code)
    sensitiveValues.add(grant.stepUpToken)
    return grant
  }

  try {
    await rawRedis.ping()
    pass('real Redis is reachable')

    const httpUser = await createUser('http')
    const unauthenticated = await request('/auth/step-up/sms-code', { action: 'export_data_request' })
    assert(unauthenticated.status === 401, 'unauthenticated challenge creation must return 401')
    pass('1. unauthenticated HTTP challenge is rejected')

    const sessionId = `verify-step-up-session-${runId}`
    await redis.registerMemberSession(httpUser.id, sessionId, 300)
    redisMarkers.push(sessionId)
    const memberJwt = new JwtService({
      secret: process.env['JWT_SECRET'],
      signOptions: { expiresIn: '5m', audience: 'enduser' },
    })
    const memberToken = memberJwt.sign({ sub: httpUser.id }, { jwtid: sessionId })
    const invalidAction = await request('/auth/step-up/sms-code', { action: 'delete_everything' }, memberToken)
    assert(invalidAction.status === 400, 'action outside shared allowlist must return 400')
    pass('2. HTTP DTO rejects action outside shared allowlist')
    await redis.unregisterMemberSession(httpUser.id, sessionId)

    const bindingOwner = await createUser('challenge-owner')
    const bindingOther = await createUser('challenge-other')
    const bindingChallenge = await service.sendChallenge(bindingOwner.id, {
      action: 'export_data_request', deviceId: 'KSK-BIND', ip: '127.0.0.1',
    })
    redisMarkers.push(bindingChallenge.challengeId)
    const bindingCode = sms.lastCode()
    sensitiveValues.add(bindingCode)
    const bindingKeys = await ownedKeys(rawRedis, [bindingOwner.id, bindingChallenge.challengeId])
    const bindingRedis = [
      ...bindingKeys,
      ...await Promise.all(bindingKeys.map((key) => redisValue(rawRedis, key))),
    ].join('|')
    assert(!bindingRedis.includes(bindingCode), 'live challenge Redis state must not contain the plaintext code')
    pass('4. live challenge Redis state contains only a code digest')
    await expectCode(
      () => service.verifyChallenge(bindingOther.id, { challengeId: bindingChallenge.challengeId, code: bindingCode }),
      'STEP_UP_CHALLENGE_INVALID',
      '3. challenge rejects a different user',
    )
    const bindingGrant = await service.verifyChallenge(
      bindingOwner.id,
      { challengeId: bindingChallenge.challengeId, code: bindingCode },
    )
    sensitiveValues.add(bindingGrant.stepUpToken)

    const fourAttemptsUser = await createUser('attempts-four')
    sms.clear()
    const fourAttemptsChallenge = await service.sendChallenge(fourAttemptsUser.id, {
      action: 'export_data_request', deviceId: 'KSK-ATTEMPTS-FOUR', ip: '127.0.0.1',
    })
    redisMarkers.push(fourAttemptsChallenge.challengeId)
    const correctAfterFour = sms.lastCode()
    sensitiveValues.add(correctAfterFour)
    const wrongForFour = correctAfterFour === '000000' ? '111111' : '000000'
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expectCode(
        () => service.verifyChallenge(fourAttemptsUser.id, {
          challengeId: fourAttemptsChallenge.challengeId,
          code: wrongForFour,
        }),
        'STEP_UP_CODE_INVALID',
        `5A.${attempt} wrong code attempt is rejected`,
      )
    }
    const grantAfterFour = await service.verifyChallenge(fourAttemptsUser.id, {
      challengeId: fourAttemptsChallenge.challengeId,
      code: correctAfterFour,
    })
    sensitiveValues.add(grantAfterFour.stepUpToken)
    redisMarkers.push(createHash('sha256').update(grantAfterFour.stepUpToken).digest('hex'))
    pass('5A. four wrong codes do not invalidate the challenge early')

    const fiveAttemptsUser = await createUser('attempts-five')
    sms.clear()
    const fiveAttemptsChallenge = await service.sendChallenge(fiveAttemptsUser.id, {
      action: 'export_data_request', deviceId: 'KSK-ATTEMPTS-FIVE', ip: '127.0.0.1',
    })
    redisMarkers.push(fiveAttemptsChallenge.challengeId)
    const correctAfterFive = sms.lastCode()
    sensitiveValues.add(correctAfterFive)
    const wrongForFive = correctAfterFive === '000000' ? '111111' : '000000'
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expectCode(
        () => service.verifyChallenge(fiveAttemptsUser.id, {
          challengeId: fiveAttemptsChallenge.challengeId,
          code: wrongForFive,
        }),
        'STEP_UP_CODE_INVALID',
        `5B.${attempt} wrong code attempt is rejected`,
      )
    }
    await expectCode(
      () => service.verifyChallenge(fiveAttemptsUser.id, {
        challengeId: fiveAttemptsChallenge.challengeId,
        code: correctAfterFive,
      }),
      'STEP_UP_CHALLENGE_INVALID',
      '5B. challenge is invalidated at five wrong codes',
    )

    const onceUser = await createUser('challenge-once')
    sms.clear()
    const onceChallenge = await service.sendChallenge(onceUser.id, {
      action: 'export_data_request', ip: '127.0.0.1',
    })
    redisMarkers.push(onceChallenge.challengeId)
    const onceCode = sms.lastCode()
    const onceGrant = await service.verifyChallenge(onceUser.id, { challengeId: onceChallenge.challengeId, code: onceCode })
    redisMarkers.push(createHash('sha256').update(onceGrant.stepUpToken).digest('hex'))
    sensitiveValues.add(onceCode)
    sensitiveValues.add(onceGrant.stepUpToken)
    await expectCode(
      () => service.verifyChallenge(onceUser.id, { challengeId: onceChallenge.challengeId, code: onceCode }),
      'STEP_UP_CHALLENGE_INVALID',
      '6. a correct code consumes its challenge exactly once',
    )

    const grantOwner = await createUser('grant-owner')
    const grantOther = await createUser('grant-other')
    const foreignGrant = await issueGrant(grantOwner.id, 'export_data_request', 'KSK-GRANT')
    await expectCode(
      () => service.consumeGrant(grantOther.id, 'export_data_request', foreignGrant.stepUpToken, 'KSK-GRANT'),
      'STEP_UP_TOKEN_INVALID',
      '7. grant rejects a different user',
    )
    await expectCode(
      () => service.consumeGrant(grantOwner.id, 'export_data_request', foreignGrant.stepUpToken, 'KSK-GRANT'),
      'STEP_UP_TOKEN_INVALID',
      '7. user mismatch destroys the grant instead of restoring it',
    )
    const confusedGrant = await issueGrant(grantOwner.id, 'close_account', 'KSK-GRANT')
    await expectCode(
      () => service.consumeGrant(grantOwner.id, 'export_data_download', confusedGrant.stepUpToken, 'KSK-GRANT'),
      'STEP_UP_TOKEN_INVALID',
      '7. grant rejects a different action',
    )
    await expectCode(
      () => service.consumeGrant(grantOwner.id, 'close_account', confusedGrant.stepUpToken, 'KSK-GRANT'),
      'STEP_UP_TOKEN_INVALID',
      '7. action mismatch destroys the grant instead of restoring it',
    )

    const replayUser = await createUser('grant-replay')
    const replayGrant = await issueGrant(replayUser.id, 'export_data_request', 'KSK-REPLAY')
    await service.consumeGrant(replayUser.id, 'export_data_request', replayGrant.stepUpToken, 'KSK-REPLAY')
    await expectCode(
      () => service.consumeGrant(replayUser.id, 'export_data_request', replayGrant.stepUpToken, 'KSK-REPLAY'),
      'STEP_UP_TOKEN_INVALID',
      '8. grant replay uses the same invalid-token error',
    )

    const expiryUser = await createUser('grant-expiry')
    const expiryGrant = await issueGrant(expiryUser.id, 'export_data_request')
    const expiryHash = createHash('sha256').update(expiryGrant.stepUpToken).digest('hex')
    const expiryKey = (await scanKeys(rawRedis)).find((key) => key.includes(expiryHash))
    assert(expiryKey, 'grant key must be indexed by the token hash')
    await rawRedis.pexpire(expiryKey, 1)
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    await expectCode(
      () => service.consumeGrant(expiryUser.id, 'export_data_request', expiryGrant.stepUpToken),
      'STEP_UP_TOKEN_INVALID',
      '9. expired grant uses the same invalid-token error',
    )

    const deviceUser = await createUser('device-risk')
    const changedDeviceGrant = await issueGrant(deviceUser.id, 'export_data_request', 'KSK-ORIGINAL')
    await service.consumeGrant(deviceUser.id, 'export_data_request', changedDeviceGrant.stepUpToken, 'KSK-CHANGED')
    const missingDeviceGrant = await issueGrant(deviceUser.id, 'export_data_download')
    await service.consumeGrant(deviceUser.id, 'export_data_download', missingDeviceGrant.stepUpToken, 'KSK-LATER')
    const riskLogs = await prisma.auditLog.findMany({
      where: { targetId: deviceUser.id, createdAt: { gte: startedAt } },
      select: { payloadJson: true },
    })
    const riskPayloads = riskLogs.map((row) => JSON.parse(row.payloadJson) as Json)
      .filter((payload) => typeof payload.deviceMatched === 'boolean')
    assert(riskPayloads.length >= 2, 'device changes/missing values must emit boolean risk summaries')
    const riskSerialized = JSON.stringify(riskPayloads)
    assert(!['KSK-ORIGINAL', 'KSK-CHANGED', 'KSK-LATER'].some((value) => riskSerialized.includes(value)),
      'risk summaries must not persist raw device identifiers')
    pass('10. missing/changed device is non-blocking and records only boolean risk summaries')

    for (const status of ['disabled', 'closing', 'anonymized'] as const) {
      const unavailable = await createUser(`status-${status}`, status)
      sms.clear()
      await expectCode(
        () => service.sendChallenge(unavailable.id, { action: 'close_account', ip: '127.0.0.1' }),
        'ACCOUNT_UNAVAILABLE',
        `11. ${status} account cannot create a challenge`,
      )
      assert(!sms.hasCode(), `${status} account rejection must happen before SMS dispatch`)
    }

    const smsFailureUser = await createUser('sms-failure')
    const beforeFailure = new Set(await scanKeys(rawRedis))
    sms.clear()
    sms.failNextSend()
    await expectCode(
      () => service.sendChallenge(smsFailureUser.id, {
        action: 'export_data_request', deviceId: 'KSK-SMS-FAIL', ip: '127.0.0.1',
      }),
      'SMS_SEND_FAILED',
      '12. provider failure is surfaced safely',
    )
    const failureAdditions = (await scanKeys(rawRedis)).filter((key) => !beforeFailure.has(key))
    assert(!failureAdditions.some((key) => /challenge|code|cooldown/.test(key)),
      'provider failure must clean challenge/code/cooldown keys')
    pass('12. provider failure cleans challenge, code and cooldown state')

    const revokeOwner = await createUser('revoke-owner')
    const revokeOther = await createUser('revoke-other')
    const revokeA = await issueGrant(revokeOwner.id, 'export_data_request')
    const revokeB = await issueGrant(revokeOwner.id, 'close_account')
    const keepGrant = await issueGrant(revokeOther.id, 'export_data_request')
    assert(await stepUpRedis.revokeMemberStepUpGrants(revokeOwner.id) === 2,
      'whole-user revocation must report exactly the two owned grants')
    await expectCode(
      () => service.consumeGrant(revokeOwner.id, 'export_data_request', revokeA.stepUpToken),
      'STEP_UP_TOKEN_INVALID',
      'revocation invalidates the first owned grant',
    )
    await expectCode(
      () => service.consumeGrant(revokeOwner.id, 'close_account', revokeB.stepUpToken),
      'STEP_UP_TOKEN_INVALID',
      'revocation invalidates the second owned grant',
    )
    await service.consumeGrant(revokeOther.id, 'export_data_request', keepGrant.stepUpToken)
    pass('whole-user revocation preserves another user grant')

    const concurrentUser = await createUser('concurrent-consume')
    const concurrentGrant = await issueGrant(concurrentUser.id, 'export_data_request')
    const concurrent = await Promise.allSettled([
      service.consumeGrant(concurrentUser.id, 'export_data_request', concurrentGrant.stepUpToken),
      service.consumeGrant(concurrentUser.id, 'export_data_request', concurrentGrant.stepUpToken),
    ])
    const fulfilled = concurrent.filter((result) => result.status === 'fulfilled').length
    const rejected = concurrent.filter((result) => result.status === 'rejected')
    assert(fulfilled === 1 && rejected.length === 1 && errorCode(rejected[0]?.reason) === 'STEP_UP_TOKEN_INVALID',
      'concurrent grant consumption must have exactly one winner and one unified invalid-token rejection')
    pass('concurrent grant consumption has exactly one winner')

    const sensitiveKeys = await ownedKeys(rawRedis, redisMarkers)
    const sensitiveRedis = (await Promise.all(sensitiveKeys.map((key) => redisValue(rawRedis, key)))).join('|')
    assert(![...sensitiveValues].some((value) => sensitiveRedis.includes(value)),
      'Redis fixture contains a raw phone, code, grant token, or device identifier')
    pass('integration contract completed without printing sensitive values')
  } finally {
    const cleanupKeys = new Set(await ownedKeys(rawRedis, redisMarkers))
    for (const key of await scanKeys(rawRedis)) if (!initialKeys.has(key)) cleanupKeys.add(key)
    if (cleanupKeys.size) await rawRedis.del(...cleanupKeys)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds }, createdAt: { gte: startedAt } } })
    await prisma.endUser.deleteMany({ where: { phoneHash: { in: phoneHashes } } })
    await app.close()
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'member step-up verify failed'
  const redacted = message
    .replace(/\b1[3-9]\d{9}\b/g, '[redacted-phone]')
    .replace(/\b\d{6}\b/g, '[redacted-code]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]')
  console.error(redacted)
  process.exit(1)
})
