/** Wave 1A step-up RED: memory SMS double + real Redis/CI DB; never log secrets. */
import 'dotenv/config'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Redis } from 'ioredis'
import { MEMBER_STEP_UP_ACTIONS } from '../../../packages/shared/src/types/member-privacy'
import { MEMBER_STEP_UP_ACTIONS as API_MEMBER_STEP_UP_ACTIONS } from '../src/member-auth/member-step-up.types'
import { SMS_SENDER, type SmsSender } from '../src/member-auth/sms/sms-sender'
import {
  verifyCorruptAttemptMatrix,
  verifyGrantRedisInvariants,
} from './verify-member-step-up-adversarial'
import { verifyStepUpHttpContract } from './verify-member-step-up-http'
import {
  FakeSmsSender,
  type ChallengeResult,
  type GrantResult,
  type StepUpAction,
  type StepUpRedis,
  type StepUpService,
  type StepUpServiceConstructor,
  assert,
  assertNoSensitive,
  errorCode,
  expectCode,
  flattenValidationErrors,
  installOutputCapture,
  isAllowedTestDatabase,
  ownedKeys,
  pass,
  redisValue,
  registerSensitive,
  scanKeys,
  trackRedisWrites,
  verifyStepUpDtoValidation,
  withTestEnv,
} from './verify-member-step-up.helpers'

type Json = Record<string, unknown>
type DtoConstructor = new () => object

async function execute(capturedOutput: string[]): Promise<void> {
  console.log('\n=== member step-up security integration contract ===')

  assert(
    JSON.stringify(MEMBER_STEP_UP_ACTIONS) === JSON.stringify([
      'export_data_request', 'export_data_download', 'close_account',
    ]),
    'shared member step-up action allowlist drifted',
  )
  pass('shared action allowlist is exact')
  assert(JSON.stringify(API_MEMBER_STEP_UP_ACTIONS) === JSON.stringify(MEMBER_STEP_UP_ACTIONS),
    'API member step-up action allowlist drifted from the shared SSOT')
  pass('API action allowlist matches the shared SSOT')

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
    SendMemberStepUpCodeDto?: DtoConstructor
    VerifyMemberStepUpDto?: DtoConstructor
  }
  assert(dto.SendMemberStepUpCodeDto && dto.VerifyMemberStepUpDto, 'member step-up DTO exports are missing')

  await verifyStepUpDtoValidation(dto.SendMemberStepUpCodeDto, dto.VerifyMemberStepUpDto)

  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  assert(isAllowedTestDatabase(databaseUrl),
    'Task 5 verify only permits SQLite or local ci@ai_job_print_ci PostgreSQL')
  const redisUrl = process.env['REDIS_URL'] ?? ''
  assert(/^redis:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/\d+)?$/.test(redisUrl),
    'Task 5 verify only permits a loopback CI Redis instance')

  const [
    { NestFactory },
    { AppModule },
    { HttpExceptionFilter },
    { REDIS_CLIENT, RedisService },
    { PrismaService },
    { MemberAuthController },
    { encryptPhone, hashPhone },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('../src/app.module'),
    import('../src/common/filters/http-exception.filter'),
    import('../src/common/redis/redis.service'),
    import('../src/prisma/prisma.service'),
    import('../src/member-auth/member-auth.controller'),
    import('../src/common/crypto/phone-identity'),
  ])

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: flattenValidationErrors(errors)[0] ?? '请求参数校验失败',
        details: flattenValidationErrors(errors) },
    }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0)

  const prisma = app.get(PrismaService)
  const redis = app.get(RedisService)
  const rawRedis = app.get<Redis>(REDIS_CLIENT)
  const sms = new FakeSmsSender()
  const service = app.get<StepUpService>(StepUpClass)
  assert(service, 'MemberStepUpService must resolve from the real MemberAuthModule provider graph')
  pass('MemberStepUpService resolves from the real module')
  const controller = app.get(MemberAuthController) as unknown as Record<string, unknown>
  const smsSingleton = app.get<SmsSender>(SMS_SENDER)
  const originalSendCode = smsSingleton.sendCode
  smsSingleton.sendCode = sms.sendCode.bind(sms)
  const stepUpRedis = redis as unknown as StepUpRedis
  const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1/member`
  const startedAt = new Date()
  const runId = randomBytes(8).toString('hex')
  const userIds: string[] = []
  const phoneHashes: string[] = []
  const users = new Map<string, string>()
  const userIps = new Map<string, string>()
  const redisMarkers = new Set<string>()
  const exactOperationKeys = new Set<string>()
  const phoneBase = 10_000_000 + (randomBytes(4).readUInt32BE(0) % 70_000_000)
  let userNumber = 0

  function addRedisMarker(value: string): void {
    redisMarkers.add(value)
    redisMarkers.add(createHash('sha256').update(value).digest('hex'))
    const key = process.env['SECRET_ENCRYPTION_KEY']
    assert(key && key.length >= 32, 'test marker HMAC requires SECRET_ENCRYPTION_KEY >= 32')
    for (const domain of ['device', 'ip', 'end-user']) {
      redisMarkers.add(
        createHmac('sha256', key).update(`member-step-up:${domain}:${value}`).digest('hex'),
      )
    }
  }

  function testDevice(label: string): string {
    const deviceId = `${label}-${runId}`
    registerSensitive(deviceId)
    addRedisMarker(deviceId)
    return deviceId
  }

  addRedisMarker(runId)

  async function createUser(label: string, status = 'active'): Promise<{ id: string; phone: string }> {
    userNumber += 1
    const tail = (phoneBase + userNumber).toString().padStart(8, '0')
    const phone = `138${tail}`
    const id = `verify-step-up-${label}-${runId}`
    const phoneHash = hashPhone(phone)
    await prisma.endUser.create({
      data: { id, phoneHash, phoneEnc: encryptPhone(phone), enabled: status === 'active', status },
    })
    userIds.push(id)
    phoneHashes.push(phoneHash)
    users.set(id, phone)
    const ip = `2001:db8:${runId.slice(0, 4)}:${runId.slice(4, 8)}::${userNumber.toString(16)}`
    userIps.set(id, ip)
    addRedisMarker(id)
    addRedisMarker(phoneHash)
    addRedisMarker(ip)
    registerSensitive(phone)
    return { id, phone }
  }

  function stepUpInput(userId: string, action: StepUpAction, deviceId?: string): {
    action: StepUpAction; deviceId?: string; ip: string
  } {
    const ip = userIps.get(userId)
    assert(ip, `missing owned IP for ${userId}`)
    return { action, ...(deviceId ? { deviceId } : {}), ip }
  }

  function deliveryCode(userId: string): string {
    const delivery = sms.lastDelivery()
    assert(delivery.phone === users.get(userId), 'SMS dispatch must use the user decrypted phone')
    assert(/^\d{6}$/.test(delivery.code), 'FakeSmsSender must receive a six-digit code')
    registerSensitive(delivery.phone)
    registerSensitive(delivery.code)
    return delivery.code
  }

  function assertChallenge(challenge: ChallengeResult, userId: string, code: string): void {
    assert(challenge.expiresInSeconds === 60, 'challenge TTL must load MEMBER_STEP_UP_TTL_SECONDS=60')
    const serialized = JSON.stringify(challenge)
    assert(!serialized.includes(users.get(userId) ?? ''), 'challenge response must not expose the full phone')
    assert(!serialized.includes(code), 'challenge response must not expose the SMS code')
    addRedisMarker(challenge.challengeId)
  }

  function assertGrant(grant: GrantResult, action: StepUpAction): void {
    assert(grant.action === action, 'grant action must match the verified challenge')
    assert(grant.expiresInSeconds === 60, 'grant TTL must load MEMBER_STEP_UP_TTL_SECONDS=60')
    registerSensitive(grant.stepUpToken)
    addRedisMarker(createHash('sha256').update(grant.stepUpToken).digest('hex'))
  }

  async function request(
    path: string,
    body: Json,
    token?: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; json: Json; cacheControl: string | null }> {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    })
    return {
      status: response.status,
      json: (await response.json().catch(() => ({}))) as Json,
      cacheControl: response.headers.get('cache-control'),
    }
  }

  async function issueGrant(userId: string, action: StepUpAction, deviceId?: string): Promise<GrantResult> {
    sms.clear()
    const challenge = await service.sendChallenge(userId, stepUpInput(userId, action, deviceId))
    const code = deliveryCode(userId)
    assertChallenge(challenge, userId, code)
    const grant = await service.verifyChallenge(userId, { challengeId: challenge.challengeId, code, deviceId })
    assertGrant(grant, action)
    return grant
  }

  try {
    await rawRedis.ping()
    pass('real Redis is reachable')
    assert(Object.values(controller).includes(service),
      'MemberAuthController and integration harness must resolve the same MemberStepUpService provider')

    const runtimeActionUser = await createUser('runtime-action')
    sms.clear()
    await expectCode(
      () => service.sendChallenge(runtimeActionUser.id, stepUpInput(
        runtimeActionUser.id,
        'delete_everything' as unknown as StepUpAction,
      )),
      'STEP_UP_ACTION_INVALID',
      'service runtime rejects an action outside the shared allowlist',
    )
    assert(!sms.hasCode(), 'runtime action rejection must happen before SMS dispatch')

    await verifyStepUpHttpContract({ request, createUser, redis, rawRedis, sms, runId, addRedisMarker })

    const bindingOwner = await createUser('challenge-owner')
    const bindingOther = await createUser('challenge-other')
    const bindingDevice = testDevice('KSK-BIND')
    sms.clear()
    const bindingChallenge = await service.sendChallenge(
      bindingOwner.id,
      stepUpInput(bindingOwner.id, 'export_data_request', bindingDevice),
    )
    const bindingCode = deliveryCode(bindingOwner.id)
    assertChallenge(bindingChallenge, bindingOwner.id, bindingCode)
    const bindingPrefix = `member:step-up:challenge:${bindingChallenge.challengeId}`
    for (const suffix of ['meta', 'code', 'attempt']) {
      const ttl = await rawRedis.ttl(`${bindingPrefix}:${suffix}`)
      assert(ttl > 0 && ttl <= 60, `live challenge ${suffix} TTL must be within 1..60 seconds`)
    }
    pass('live challenge meta/code/attempt keys have the configured Redis TTL')
    const bindingKeys = await ownedKeys(rawRedis, [bindingOwner.id, bindingChallenge.challengeId])
    const bindingRedis = [
      ...bindingKeys,
      ...await Promise.all(bindingKeys.map((key) => redisValue(rawRedis, key))),
    ].join('|')
    assert(!bindingRedis.includes(bindingCode), 'live challenge Redis state must not contain the plaintext code')
    pass('4. live challenge Redis state contains only a code digest')
    await expectCode(
      () => service.verifyChallenge(bindingOther.id, {
        challengeId: bindingChallenge.challengeId,
        code: bindingCode,
        deviceId: bindingDevice,
      }),
      'STEP_UP_CHALLENGE_INVALID',
      '3. challenge rejects a different user',
    )
    const bindingGrant = await service.verifyChallenge(
      bindingOwner.id,
      { challengeId: bindingChallenge.challengeId, code: bindingCode, deviceId: bindingDevice },
    )
    assertGrant(bindingGrant, 'export_data_request')
    const bindingGrantHash = createHash('sha256').update(bindingGrant.stepUpToken).digest('hex')
    const bindingGrantTtl = await rawRedis.ttl(`member:step-up:grant:${bindingGrantHash}`)
    const bindingIndexTtl = await rawRedis.ttl(`member:user-step-up-grants:${bindingOwner.id}`)
    assert(bindingGrantTtl > 0 && bindingGrantTtl <= 60, 'live grant TTL must be within 1..60 seconds')
    assert(bindingIndexTtl > 0 && bindingIndexTtl <= 60, 'live grant owner-index TTL must be within 1..60 seconds')
    pass('live grant and owner index have the configured Redis TTL')

    const fourAttemptsUser = await createUser('attempts-four')
    const fourAttemptsDevice = testDevice('KSK-ATTEMPTS-FOUR')
    sms.clear()
    const fourAttemptsChallenge = await service.sendChallenge(
      fourAttemptsUser.id,
      stepUpInput(fourAttemptsUser.id, 'export_data_request', fourAttemptsDevice),
    )
    const correctAfterFour = deliveryCode(fourAttemptsUser.id)
    assertChallenge(fourAttemptsChallenge, fourAttemptsUser.id, correctAfterFour)
    const wrongForFour = correctAfterFour === '000000' ? '111111' : '000000'
    registerSensitive(wrongForFour)
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expectCode(
        () => service.verifyChallenge(fourAttemptsUser.id, {
          challengeId: fourAttemptsChallenge.challengeId,
          code: wrongForFour,
          deviceId: fourAttemptsDevice,
        }),
        'STEP_UP_CODE_INVALID',
        `5A.${attempt} wrong code attempt is rejected`,
      )
    }
    const grantAfterFour = await service.verifyChallenge(fourAttemptsUser.id, {
      challengeId: fourAttemptsChallenge.challengeId,
      code: correctAfterFour,
      deviceId: fourAttemptsDevice,
    })
    assertGrant(grantAfterFour, 'export_data_request')
    pass('5A. four wrong codes do not invalidate the challenge early')

    const fiveAttemptsUser = await createUser('attempts-five')
    const fiveAttemptsDevice = testDevice('KSK-ATTEMPTS-FIVE')
    sms.clear()
    const fiveAttemptsChallenge = await service.sendChallenge(
      fiveAttemptsUser.id,
      stepUpInput(fiveAttemptsUser.id, 'export_data_request', fiveAttemptsDevice),
    )
    const correctAfterFive = deliveryCode(fiveAttemptsUser.id)
    assertChallenge(fiveAttemptsChallenge, fiveAttemptsUser.id, correctAfterFive)
    const wrongForFive = correctAfterFive === '000000' ? '111111' : '000000'
    registerSensitive(wrongForFive)
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expectCode(
        () => service.verifyChallenge(fiveAttemptsUser.id, {
          challengeId: fiveAttemptsChallenge.challengeId,
          code: wrongForFive,
          deviceId: fiveAttemptsDevice,
        }),
        'STEP_UP_CODE_INVALID',
        `5B.${attempt} wrong code attempt is rejected`,
      )
    }
    await expectCode(
      () => service.verifyChallenge(fiveAttemptsUser.id, {
        challengeId: fiveAttemptsChallenge.challengeId,
        code: correctAfterFive,
        deviceId: fiveAttemptsDevice,
      }),
      'STEP_UP_CHALLENGE_INVALID',
      '5B. challenge is invalidated at five wrong codes',
    )

    await verifyCorruptAttemptMatrix({
      rawRedis,
      service,
      createChallenge: async (label) => {
        const user = await createUser(label)
        sms.clear()
        const challenge = await service.sendChallenge(user.id, stepUpInput(user.id, 'export_data_request'))
        const code = deliveryCode(user.id)
        assertChallenge(challenge, user.id, code)
        return { endUserId: user.id, challengeId: challenge.challengeId, code }
      },
    })

    const onceUser = await createUser('challenge-once')
    sms.clear()
    const onceChallenge = await service.sendChallenge(
      onceUser.id,
      stepUpInput(onceUser.id, 'export_data_request'),
    )
    const onceCode = deliveryCode(onceUser.id)
    assertChallenge(onceChallenge, onceUser.id, onceCode)
    const onceGrant = await service.verifyChallenge(onceUser.id, { challengeId: onceChallenge.challengeId, code: onceCode })
    assertGrant(onceGrant, 'export_data_request')
    await expectCode(
      () => service.verifyChallenge(onceUser.id, { challengeId: onceChallenge.challengeId, code: onceCode }),
      'STEP_UP_CHALLENGE_INVALID',
      '6. a correct code consumes its challenge exactly once',
    )

    const concurrentVerifyUser = await createUser('concurrent-verify')
    sms.clear()
    const concurrentChallenge = await service.sendChallenge(
      concurrentVerifyUser.id,
      stepUpInput(concurrentVerifyUser.id, 'export_data_request'),
    )
    const concurrentCode = deliveryCode(concurrentVerifyUser.id)
    assertChallenge(concurrentChallenge, concurrentVerifyUser.id, concurrentCode)
    const concurrentVerify = await Promise.allSettled([
      service.verifyChallenge(concurrentVerifyUser.id, {
        challengeId: concurrentChallenge.challengeId,
        code: concurrentCode,
      }),
      service.verifyChallenge(concurrentVerifyUser.id, {
        challengeId: concurrentChallenge.challengeId,
        code: concurrentCode,
      }),
    ])
    const concurrentVerifyWinners = concurrentVerify.filter(
      (result): result is PromiseFulfilledResult<GrantResult> => result.status === 'fulfilled',
    )
    const concurrentVerifyLosers = concurrentVerify.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    assert(
      concurrentVerifyWinners.length === 1
        && concurrentVerifyLosers.length === 1
        && errorCode(concurrentVerifyLosers[0]?.reason) === 'STEP_UP_CHALLENGE_INVALID',
      'concurrent correct-code verification must have exactly one winner and one invalid-challenge loser',
    )
    assertGrant(concurrentVerifyWinners[0].value, 'export_data_request')
    await service.consumeGrant(
      concurrentVerifyUser.id,
      'export_data_request',
      concurrentVerifyWinners[0].value.stepUpToken,
    )
    pass('concurrent correct-code verification has exactly one winner')

    const grantOwner = await createUser('grant-owner')
    const grantOther = await createUser('grant-other')
    const grantDevice = testDevice('KSK-GRANT')
    const foreignGrant = await issueGrant(grantOwner.id, 'export_data_request', grantDevice)
    await expectCode(
      () => service.consumeGrant(grantOther.id, 'export_data_request', foreignGrant.stepUpToken, grantDevice),
      'STEP_UP_TOKEN_INVALID',
      '7. grant rejects a different user',
    )
    await expectCode(
      () => service.consumeGrant(grantOwner.id, 'export_data_request', foreignGrant.stepUpToken, grantDevice),
      'STEP_UP_TOKEN_INVALID',
      '7. user mismatch destroys the grant instead of restoring it',
    )
    const confusedGrant = await issueGrant(grantOwner.id, 'close_account', grantDevice)
    await expectCode(
      () => service.consumeGrant(grantOwner.id, 'export_data_download', confusedGrant.stepUpToken, grantDevice),
      'STEP_UP_TOKEN_INVALID',
      '7. grant rejects a different action',
    )
    await expectCode(
      () => service.consumeGrant(grantOwner.id, 'close_account', confusedGrant.stepUpToken, grantDevice),
      'STEP_UP_TOKEN_INVALID',
      '7. action mismatch destroys the grant instead of restoring it',
    )

    const replayUser = await createUser('grant-replay')
    const replayDevice = testDevice('KSK-REPLAY')
    const replayGrant = await issueGrant(replayUser.id, 'export_data_request', replayDevice)
    await service.consumeGrant(replayUser.id, 'export_data_request', replayGrant.stepUpToken, replayDevice)
    await expectCode(
      () => service.consumeGrant(replayUser.id, 'export_data_request', replayGrant.stepUpToken, replayDevice),
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
    const originalDevice = testDevice('KSK-ORIGINAL')
    const changedDevice = testDevice('KSK-CHANGED')
    const laterDevice = testDevice('KSK-LATER')
    const changedDeviceGrant = await issueGrant(deviceUser.id, 'export_data_request', originalDevice)
    await service.consumeGrant(deviceUser.id, 'export_data_request', changedDeviceGrant.stepUpToken, changedDevice)
    const missingDeviceGrant = await issueGrant(deviceUser.id, 'export_data_download')
    await service.consumeGrant(deviceUser.id, 'export_data_download', missingDeviceGrant.stepUpToken, laterDevice)
    const riskLogs = await prisma.auditLog.findMany({
      where: {
        action: 'MEMBER_STEP_UP_GRANT_CONSUMED',
        targetId: deviceUser.id,
        createdAt: { gte: startedAt },
      },
      select: { action: true, actorRole: true, targetType: true, targetId: true, payloadJson: true },
    })
    assert(riskLogs.length === 2, 'device risk test must emit exactly two grant-consumed audits')
    const riskPayloads = riskLogs.map((row) => ({ row, payload: JSON.parse(row.payloadJson) as Json }))
    for (const expectedAction of ['export_data_request', 'export_data_download'] as const) {
      const matched = riskPayloads.find(({ payload }) => payload.action === expectedAction)
      assert(matched, `missing grant-consumed audit for ${expectedAction}`)
      assert(matched.row.action === 'MEMBER_STEP_UP_GRANT_CONSUMED'
        && matched.row.actorRole === 'end_user'
        && matched.row.targetType === 'EndUser'
        && matched.row.targetId === deviceUser.id,
        `grant-consumed audit identity drifted for ${expectedAction}`)
      assert(JSON.stringify(Object.keys(matched.payload).sort()) === JSON.stringify(['action', 'deviceMatched']),
        `grant-consumed audit payload must contain only action/deviceMatched for ${expectedAction}`)
      assert(matched.payload.deviceMatched === false,
        `deviceMatched must be false for ${expectedAction}`)
    }
    assertNoSensitive(JSON.stringify(riskLogs), 'device risk audits')
    pass('10. missing/changed device is non-blocking and records only boolean risk summaries')

    for (const status of ['disabled', 'closing', 'anonymized'] as const) {
      const unavailable = await createUser(`status-${status}`, status)
      sms.clear()
      await expectCode(
        () => service.sendChallenge(unavailable.id, stepUpInput(unavailable.id, 'close_account')),
        'ACCOUNT_UNAVAILABLE',
        `11. ${status} account cannot create a challenge`,
      )
      assert(!sms.hasCode(), `${status} account rejection must happen before SMS dispatch`)
    }

    const independentGateCases = [
      { label: 'enabled-false-status-active', enabled: false, status: 'active' },
      { label: 'enabled-true-status-disabled', enabled: true, status: 'disabled' },
      { label: 'enabled-true-status-closing', enabled: true, status: 'closing' },
    ] as const
    for (const gate of independentGateCases) {
      const unavailable = await createUser(gate.label)
      await prisma.endUser.update({
        where: { id: unavailable.id },
        data: { enabled: gate.enabled, status: gate.status, statusChangedAt: new Date() },
      })
      sms.clear()
      await expectCode(
        () => service.sendChallenge(unavailable.id, stepUpInput(unavailable.id, 'close_account')),
        'ACCOUNT_UNAVAILABLE',
        `11. independent account gate rejects ${gate.label}`,
      )
      assert(!sms.hasCode(), `${gate.label} rejection must happen before SMS dispatch`)
    }

    const verifyGateCases = [
      { label: 'enabled-false-status-active', enabled: false, status: 'active' },
      { label: 'enabled-true-status-disabled', enabled: true, status: 'disabled' },
      { label: 'enabled-true-status-closing', enabled: true, status: 'closing' },
    ] as const
    for (const gate of verifyGateCases) {
      const changed = await createUser(`challenge-status-flip-${gate.label}`)
      sms.clear()
      const challenge = await service.sendChallenge(changed.id, stepUpInput(changed.id, 'close_account'))
      const code = deliveryCode(changed.id)
      assertChallenge(challenge, changed.id, code)
      await prisma.endUser.update({
        where: { id: changed.id },
        data: { enabled: gate.enabled, status: gate.status, statusChangedAt: new Date() },
      })
      await expectCode(
        () => service.verifyChallenge(changed.id, { challengeId: challenge.challengeId, code }),
        'ACCOUNT_UNAVAILABLE',
        `11. verify gate independently rejects ${gate.label}`,
      )
      const prefix = `member:step-up:challenge:${challenge.challengeId}`
      for (const suffix of ['meta', 'code', 'attempt']) {
        assert(await rawRedis.exists(`${prefix}:${suffix}`) === 0,
          `${gate.label} verification rejection must consume the stale challenge ${suffix}`)
      }
      assert(await rawRedis.exists(`member:user-step-up-grants:${changed.id}`) === 0,
        `${gate.label} verification rejection must not create a grant index`)
    }

    const disabledGrantUser = await createUser('grant-status-flip')
    const disabledGrant = await issueGrant(disabledGrantUser.id, 'export_data_request')
    await prisma.endUser.update({
      where: { id: disabledGrantUser.id },
      data: { enabled: false, status: 'disabled', statusChangedAt: new Date() },
    })
    await expectCode(
      () => service.consumeGrant(disabledGrantUser.id, 'export_data_request', disabledGrant.stepUpToken),
      'ACCOUNT_UNAVAILABLE',
      '11. an existing grant cannot be consumed after the account becomes disabled',
    )
    await prisma.endUser.update({
      where: { id: disabledGrantUser.id },
      data: { enabled: true, status: 'active', statusChangedAt: new Date() },
    })
    await expectCode(
      () => service.consumeGrant(disabledGrantUser.id, 'export_data_request', disabledGrant.stepUpToken),
      'STEP_UP_TOKEN_INVALID',
      '11. a status-rejected grant is consumed and cannot revive after reactivation',
    )

    const epochGrantUser = await createUser('grant-status-epoch')
    const epochGrant = await issueGrant(epochGrantUser.id, 'export_data_request')
    await prisma.endUser.update({
      where: { id: epochGrantUser.id },
      data: { enabled: false, status: 'disabled', statusChangedAt: new Date() },
    })
    await prisma.endUser.update({
      where: { id: epochGrantUser.id },
      data: { enabled: true, status: 'active', statusChangedAt: new Date() },
    })
    await expectCode(
      () => service.consumeGrant(epochGrantUser.id, 'export_data_request', epochGrant.stepUpToken),
      'STEP_UP_TOKEN_INVALID',
      '11. a grant cannot survive a disable/reactivate status epoch change',
    )

    const smsFailureUser = await createUser('sms-failure')
    const smsFailureDevice = testDevice('KSK-SMS-FAIL')
    sms.clear()
    sms.failNextSend()
    const failureWrites = trackRedisWrites(redis)
    try {
      await expectCode(
        () => service.sendChallenge(
          smsFailureUser.id,
          stepUpInput(smsFailureUser.id, 'export_data_request', smsFailureDevice),
        ),
        'SMS_SEND_FAILED',
        '12. provider failure is surfaced safely',
      )
    } finally {
      failureWrites.restore()
      failureWrites.keys.forEach((key) => exactOperationKeys.add(key))
    }
    const failedDelivery = sms.lastDelivery()
    assert(failedDelivery.phone === users.get(smsFailureUser.id),
      'failed SMS dispatch must still target the user decrypted phone')
    registerSensitive(failedDelivery.phone)
    registerSensitive(failedDelivery.code)
    const failedChallengeKeys = [...failureWrites.keys].filter((key) => key.includes(':challenge:'))
    const retainedAttemptKeys = [...failureWrites.keys].filter(
      (key) => key.includes(':cooldown:') || key.includes(':rate:'),
    )
    assert(failedChallengeKeys.length === 3, 'provider failure fixture must track meta/code/attempt keys')
    assert(retainedAttemptKeys.length === 3, 'provider failure fixture must track cooldown/IP/device reservations')
    for (const key of failedChallengeKeys) {
      assert(await rawRedis.exists(key) === 0,
        'provider failure must clean challenge meta/code/attempt state')
    }
    for (const key of retainedAttemptKeys) {
      assert(await rawRedis.exists(key) === 1,
        'an ambiguous provider failure must retain cooldown and rate reservations')
      assert(await rawRedis.ttl(key) > 0, 'retained provider-failure reservation must remain bounded by TTL')
    }
    sms.clear()
    await expectCode(
      () => service.sendChallenge(
        smsFailureUser.id,
        stepUpInput(smsFailureUser.id, 'export_data_request', smsFailureDevice),
      ),
      'STEP_UP_SEND_TOO_FREQUENT',
      '12. ambiguous provider failure keeps the resend cooldown',
    )
    assert(!sms.hasCode(), 'cooldown rejection after provider failure must happen before another SMS dispatch')
    pass('12. provider failure removes secrets but retains bounded anti-abuse state')

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

    await verifyGrantRedisInvariants({ rawRedis, stepUpRedis, service, createUser, addRedisMarker })

    const sensitiveKeys = await ownedKeys(rawRedis, [...redisMarkers])
    const sensitiveRedis = (await Promise.all(sensitiveKeys.map(async (key) => (
      `${key}\n${await redisValue(rawRedis, key)}`
    )))).join('\n')
    assertNoSensitive(sensitiveRedis, 'owned Redis key names/values')
    const auditRows = await prisma.auditLog.findMany({
      where: { targetId: { in: userIds }, createdAt: { gte: startedAt } },
    })
    assertNoSensitive(JSON.stringify(auditRows), 'all test-user AuditLog fields/payloads')
    assertNoSensitive(capturedOutput.join('\n'), 'captured console/logger output')
    pass('integration contract completed without printing sensitive values')
  } finally {
    smsSingleton.sendCode = originalSendCode
    try {
      const cleanupKeys = new Set(await ownedKeys(rawRedis, [...redisMarkers]))
      exactOperationKeys.forEach((key) => cleanupKeys.add(key))
      if (cleanupKeys.size) await rawRedis.del(...cleanupKeys)
      await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds }, createdAt: { gte: startedAt } } })
      await prisma.endUser.deleteMany({ where: { phoneHash: { in: phoneHashes } } })
    } finally {
      await app.close()
    }
  }
}

async function main(): Promise<void> {
  const output = installOutputCapture()
  try {
    await withTestEnv(() => execute(output.raw))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'member step-up verify failed')
    process.exitCode = 1
  } finally {
    output.restore()
  }
}

void main()
