import { createHash, createHmac } from 'node:crypto'
import { JwtService } from '@nestjs/jwt'
import type { Redis } from 'ioredis'
import type { FakeSmsSender } from './verify-member-step-up.helpers'
import {
  assert,
  pass,
  registerSensitive,
} from './verify-member-step-up.helpers'

type Json = Record<string, unknown>

interface HttpResult {
  status: number
  json: Json
  cacheControl: string | null
}

interface SessionRedis {
  registerMemberSession(endUserId: string, sessionId: string, ttlSeconds: number): Promise<void>
  unregisterMemberSession(endUserId: string, sessionId: string): Promise<void>
}

function errorCode(result: HttpResult): string | undefined {
  return ((result.json['error'] as Json | undefined)?.['code'] as string | undefined)
}

function assertSafeError(result: HttpResult, expectedStatus: number, expectedCode: string, secrets: string[]): void {
  assert(result.status === expectedStatus, `HTTP error expected ${expectedStatus}, got ${result.status}`)
  assert(result.json['success'] === false, 'HTTP error must use the unified success=false envelope')
  assert(errorCode(result) === expectedCode, `HTTP error expected ${expectedCode}, got ${errorCode(result) ?? 'unknown'}`)
  const serialized = JSON.stringify(result.json)
  assert(!secrets.some((secret) => serialized.includes(secret)), 'HTTP error envelope must not leak account data')
}

export async function verifyStepUpHttpContract(args: {
  request(path: string, body: Json, token?: string, headers?: Record<string, string>): Promise<HttpResult>
  createUser(label: string): Promise<{ id: string; phone: string }>
  redis: SessionRedis
  rawRedis: Redis
  sms: FakeSmsSender
  runId: string
  addRedisMarker(value: string): void
}): Promise<void> {
  const unauthenticated = await args.request('/auth/step-up/sms-code', { action: 'export_data_request' })
  assertSafeError(unauthenticated, 401, 'MEMBER_MISSING_TOKEN', [])
  pass('1. unauthenticated HTTP challenge is rejected')

  const user = await args.createUser('http')
  const sessionId = `verify-step-up-session-${args.runId}`
  await args.redis.registerMemberSession(user.id, sessionId, 300)
  args.addRedisMarker(sessionId)
  const memberJwt = new JwtService({
    secret: process.env['JWT_SECRET'],
    signOptions: { expiresIn: '5m', audience: 'enduser' },
  })
  const memberToken = memberJwt.sign({ sub: user.id }, { jwtid: sessionId })
  registerSensitive(memberToken)

  try {
    const internalToken = new JwtService({ secret: process.env['JWT_SECRET'] }).sign(
      { sub: user.id, role: 'admin' },
      { expiresIn: '5m' },
    )
    registerSensitive(internalToken)
    const internalRejected = await args.request(
      '/auth/step-up/sms-code',
      { action: 'export_data_request' },
      internalToken,
    )
    assertSafeError(internalRejected, 401, 'MEMBER_TOKEN_INVALID', [user.id, user.phone, internalToken])
    pass('1. internal JWT cannot authorize a member step-up route')

    const invalidAction = await args.request(
      '/auth/step-up/sms-code',
      { action: 'delete_everything' },
      memberToken,
    )
    assertSafeError(invalidAction, 400, 'VALIDATION_FAILED', [user.id, user.phone, memberToken])
    pass('2. HTTP DTO rejects action outside shared allowlist')

    args.sms.clear()
    const forgedIp = '198.51.100.77'
    args.addRedisMarker(forgedIp)
    const sent = await args.request(
      '/auth/step-up/sms-code',
      { action: 'export_data_request', deviceId: `KSK-HTTP-${args.runId}` },
      memberToken,
      { 'x-forwarded-for': forgedIp },
    )
    assert(sent.status === 201 && sent.json['success'] === true, 'authorized HTTP challenge must return 201 success')
    assert(sent.cacheControl === 'no-store', 'HTTP challenge response must disable caching')
    const secret = process.env['SECRET_ENCRYPTION_KEY']
    assert(secret && secret.length >= 32, 'forged-XFF test requires SECRET_ENCRYPTION_KEY')
    const forgedDigest = createHmac('sha256', secret)
      .update(`member-step-up:ip:${forgedIp}`)
      .digest('hex')
    const forgedRateKey = `member:step-up:rate:ip:${forgedDigest}:${new Date().toISOString().slice(0, 13)}`
    assert(await args.rawRedis.exists(forgedRateKey) === 0,
      'untrusted X-Forwarded-For must not select the service IP rate bucket')
    const sentData = sent.json['data'] as Json | undefined
    assert(sentData && JSON.stringify(Object.keys(sentData).sort()) === JSON.stringify([
      'challengeId', 'cooldownSeconds', 'expiresInSeconds', 'phoneMasked',
    ]), 'HTTP challenge response fields drifted')
    const delivery = args.sms.lastDelivery()
    assert(delivery.phone === user.phone, 'HTTP challenge SMS must target the authenticated user')
    registerSensitive(delivery.phone)
    registerSensitive(delivery.code)
    const sentSerialized = JSON.stringify(sent.json)
    assert(!sentSerialized.includes(user.phone) && !sentSerialized.includes(delivery.code),
      'HTTP challenge response must not expose the full phone or SMS code')
    pass('2. authorized HTTP challenge returns only masked safe fields')

    const challengeId = sentData['challengeId']
    assert(typeof challengeId === 'string', 'HTTP challenge response must contain challengeId')
    const unauthenticatedVerify = await args.request(
      '/auth/step-up/verify',
      { challengeId, code: delivery.code },
    )
    assertSafeError(unauthenticatedVerify, 401, 'MEMBER_MISSING_TOKEN', [user.id, user.phone, delivery.code, challengeId])

    const missingChallenge = await args.request(
      '/auth/step-up/verify',
      { challengeId: '00000000-0000-4000-8000-000000000002', code: delivery.code },
      memberToken,
    )
    assertSafeError(missingChallenge, 401, 'STEP_UP_CHALLENGE_INVALID', [
      user.id, user.phone, delivery.code, memberToken, '00000000-0000-4000-8000-000000000002',
    ])

    const wrongCode = delivery.code === '000000' ? '111111' : '000000'
    registerSensitive(wrongCode)
    const wrong = await args.request('/auth/step-up/verify', { challengeId, code: wrongCode }, memberToken)
    assertSafeError(wrong, 401, 'STEP_UP_CODE_INVALID', [
      user.id, user.phone, delivery.code, wrongCode, memberToken, challengeId,
    ])

    const verified = await args.request('/auth/step-up/verify', { challengeId, code: delivery.code }, memberToken)
    assert(verified.status === 201 && verified.json['success'] === true,
      'authorized HTTP verification must return 201 success')
    assert(verified.cacheControl === 'no-store', 'HTTP verification response must disable caching')
    const verifiedData = verified.json['data'] as Json | undefined
    assert(verifiedData && JSON.stringify(Object.keys(verifiedData).sort()) === JSON.stringify([
      'action', 'expiresInSeconds', 'stepUpToken',
    ]), 'HTTP verification response fields drifted')
    assert(verifiedData && verifiedData['action'] === 'export_data_request',
      'HTTP verification grant must preserve the challenge action')
    assert(typeof verifiedData['stepUpToken'] === 'string' && verifiedData['stepUpToken'],
      'HTTP verification must return a non-empty opaque token')
    registerSensitive(verifiedData['stepUpToken'] as string)
    args.addRedisMarker(createHash('sha256').update(verifiedData['stepUpToken'] as string).digest('hex'))
    const verifiedSerialized = JSON.stringify(verified.json)
    assert(!verifiedSerialized.includes(user.phone) && !verifiedSerialized.includes(delivery.code),
      'HTTP verification response must not expose the full phone or SMS code')
    pass('2. guarded HTTP verification returns an opaque action-bound grant')
  } finally {
    await args.redis.unregisterMemberSession(user.id, sessionId)
  }
}
