/** Wave 1A step-up RED: memory SMS double + real Redis/CI DB; never log secrets. */
import 'dotenv/config'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { format } from 'node:util'
import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Redis } from 'ioredis'
import { MEMBER_STEP_UP_ACTIONS } from '../../../packages/shared/src/types/member-privacy'
import { SMS_SENDER, type SmsSender } from '../src/member-auth/sms/sms-sender'

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

const TEST_ENV = {
  NODE_ENV: 'test',
  SMS_PROVIDER: 'log',
  JWT_SECRET: 'ci-only-member-step-up-jwt-secret-0123456789',
  SECRET_ENCRYPTION_KEY: 'ci-only-member-step-up-encryption-key-0123456789',
  MEMBER_STEP_UP_TTL_SECONDS: '60',
} as const
const sensitiveValues = new Set<string>()

function registerSensitive(value: string | undefined): void {
  if (value) sensitiveValues.add(value)
}

function redact(text: string): string {
  let output = text
  for (const secret of [...sensitiveValues].sort((a, b) => b.length - a.length)) {
    output = output.split(secret).join('[redacted]')
  }
  return output
    .replace(/\b1[3-9]\d{9}\b/g, '[redacted-phone]')
    .replace(/\b\d{6}\b/g, '[redacted-code]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]')
}

function installOutputCapture(): { raw: string[]; restore: () => void } {
  const raw: string[] = []
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }
  console.log = (...args: unknown[]) => { const line = format(...args); raw.push(line); original.log(redact(line)) }
  console.info = (...args: unknown[]) => { const line = format(...args); raw.push(line); original.info(redact(line)) }
  console.debug = (...args: unknown[]) => { const line = format(...args); raw.push(line); original.debug(redact(line)) }
  console.warn = (...args: unknown[]) => { const line = format(...args); raw.push(line); original.warn(redact(line)) }
  console.error = (...args: unknown[]) => { const line = format(...args); raw.push(line); original.error(redact(line)) }
  return {
    raw,
    restore: () => {
      console.log = original.log
      console.info = original.info
      console.debug = original.debug
      console.warn = original.warn
      console.error = original.error
    },
  }
}

async function withTestEnv(run: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(TEST_ENV)) {
    previous.set(key, process.env[key])
    process.env[key] = value
  }
  try {
    await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

class FakeSmsSender implements SmsSender {
  private code: string | null = null
  private phone: string | null = null
  private rejectNext = false
  failNextSend(): void { this.rejectNext = true }
  clear(): void { this.code = null; this.phone = null }
  hasCode(): boolean { return this.code !== null }
  lastDelivery(): { phone: string; code: string } {
    if (!this.phone || !this.code) throw new Error('FakeSmsSender did not receive a complete delivery')
    return { phone: this.phone, code: this.code }
  }
  async sendCode(phone: string, code: string): Promise<void> {
    this.phone = phone
    this.code = code
    if (this.rejectNext) {
      this.rejectNext = false
      throw new Error('fake provider unavailable')
    }
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

function isAllowedTestDatabase(databaseUrl: string): boolean {
  if (databaseUrl.startsWith('file:')) return true
  try {
    const parsed = new URL(databaseUrl)
    return ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
      && parsed.username === 'ci'
      && parsed.pathname === '/ai_job_print_ci'
  } catch {
    return false
  }
}

function assertNoSensitive(text: string, label: string): void {
  const leaked = [...sensitiveValues].find((value) => text.includes(value))
  assert(!leaked, `${label} contains a raw phone, code, grant token, or device identifier`)
}

async function execute(capturedOutput: string[]): Promise<void> {
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

  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  assert(isAllowedTestDatabase(databaseUrl),
    'Task 5 verify only permits SQLite or local ci@ai_job_print_ci PostgreSQL')
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
    { MemberAuthController },
    { encryptPhone, hashPhone },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('@nestjs/jwt'),
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
      error: { code: 'VALIDATION_FAILED', message: flatten(errors)[0] ?? '请求参数校验失败', details: flatten(errors) },
    }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0)

  const prisma = app.get(PrismaService)
  const redis = app.get(RedisService)
  const rawRedis = app.get<Redis>(REDIS_CLIENT)
  const sms = new FakeSmsSender()
  const service = app.get<StepUpService>(StepUpClass)
  const controller = app.get(MemberAuthController) as unknown as Record<string, unknown>
  assert(Object.values(controller).includes(service),
    'MemberAuthController and integration harness must resolve the same MemberStepUpService provider')
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
    const ip = `198.51.100.${userNumber}`
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
    if (deviceId) {
      registerSensitive(deviceId)
      addRedisMarker(deviceId)
    }
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

    const httpUser = await createUser('http')
    const unauthenticated = await request('/auth/step-up/sms-code', { action: 'export_data_request' })
    assert(unauthenticated.status === 401, 'unauthenticated challenge creation must return 401')
    pass('1. unauthenticated HTTP challenge is rejected')

    const sessionId = `verify-step-up-session-${runId}`
    await redis.registerMemberSession(httpUser.id, sessionId, 300)
    addRedisMarker(sessionId)
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
    sms.clear()
    const bindingChallenge = await service.sendChallenge(
      bindingOwner.id,
      stepUpInput(bindingOwner.id, 'export_data_request', 'KSK-BIND'),
    )
    const bindingCode = deliveryCode(bindingOwner.id)
    assertChallenge(bindingChallenge, bindingOwner.id, bindingCode)
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
    assertGrant(bindingGrant, 'export_data_request')

    const fourAttemptsUser = await createUser('attempts-four')
    sms.clear()
    const fourAttemptsChallenge = await service.sendChallenge(
      fourAttemptsUser.id,
      stepUpInput(fourAttemptsUser.id, 'export_data_request', 'KSK-ATTEMPTS-FOUR'),
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
        }),
        'STEP_UP_CODE_INVALID',
        `5A.${attempt} wrong code attempt is rejected`,
      )
    }
    const grantAfterFour = await service.verifyChallenge(fourAttemptsUser.id, {
      challengeId: fourAttemptsChallenge.challengeId,
      code: correctAfterFour,
    })
    assertGrant(grantAfterFour, 'export_data_request')
    pass('5A. four wrong codes do not invalidate the challenge early')

    const fiveAttemptsUser = await createUser('attempts-five')
    sms.clear()
    const fiveAttemptsChallenge = await service.sendChallenge(
      fiveAttemptsUser.id,
      stepUpInput(fiveAttemptsUser.id, 'export_data_request', 'KSK-ATTEMPTS-FIVE'),
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
    registerSensitive('KSK-CHANGED')
    addRedisMarker('KSK-CHANGED')
    await service.consumeGrant(deviceUser.id, 'export_data_request', changedDeviceGrant.stepUpToken, 'KSK-CHANGED')
    const missingDeviceGrant = await issueGrant(deviceUser.id, 'export_data_download')
    registerSensitive('KSK-LATER')
    addRedisMarker('KSK-LATER')
    await service.consumeGrant(deviceUser.id, 'export_data_download', missingDeviceGrant.stepUpToken, 'KSK-LATER')
    const riskLogs = await prisma.auditLog.findMany({
      where: {
        action: 'MEMBER_STEP_UP_GRANT_CONSUMED',
        targetId: deviceUser.id,
        createdAt: { gte: startedAt },
      },
      select: { action: true, targetId: true, payloadJson: true },
    })
    assert(riskLogs.length === 2, 'device risk test must emit exactly two grant-consumed audits')
    const riskPayloads = riskLogs.map((row) => ({ row, payload: JSON.parse(row.payloadJson) as Json }))
    for (const expectedAction of ['export_data_request', 'export_data_download'] as const) {
      const matched = riskPayloads.find(({ payload }) => payload.action === expectedAction)
      assert(matched, `missing grant-consumed audit for ${expectedAction}`)
      assert(matched.row.action === 'MEMBER_STEP_UP_GRANT_CONSUMED' && matched.row.targetId === deviceUser.id,
        `grant-consumed audit identity drifted for ${expectedAction}`)
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

    const smsFailureUser = await createUser('sms-failure')
    const beforeFailure = new Set(await scanKeys(rawRedis))
    sms.clear()
    sms.failNextSend()
    await expectCode(
      () => service.sendChallenge(
        smsFailureUser.id,
        stepUpInput(smsFailureUser.id, 'export_data_request', 'KSK-SMS-FAIL'),
      ),
      'SMS_SEND_FAILED',
      '12. provider failure is surfaced safely',
    )
    const failedDelivery = sms.lastDelivery()
    assert(failedDelivery.phone === users.get(smsFailureUser.id),
      'failed SMS dispatch must still target the user decrypted phone')
    registerSensitive(failedDelivery.phone)
    registerSensitive(failedDelivery.code)
    const failureAdditions = (await scanKeys(rawRedis)).filter((key) => !beforeFailure.has(key))
    failureAdditions.forEach((key) => exactOperationKeys.add(key))
    assert(failureAdditions.length === 0,
      'provider failure must clean every added meta/code/attempt/grant/index/cooldown key')
    pass('12. provider failure leaves no residual step-up state')

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
