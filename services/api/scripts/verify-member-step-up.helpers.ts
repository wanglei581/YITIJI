import { format } from 'node:util'
import { ValidationPipe, type ValidationError } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { MEMBER_STEP_UP_ACTIONS } from '../../../packages/shared/src/types/member-privacy'
import type { SmsSender } from '../src/member-auth/sms/sms-sender'

type DtoConstructor = new () => object
export type StepUpAction = (typeof MEMBER_STEP_UP_ACTIONS)[number]

export interface ChallengeResult {
  challengeId: string
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: number
}

export interface GrantResult {
  stepUpToken: string
  action: StepUpAction
  expiresInSeconds: number
}

export interface StepUpService {
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

export type StepUpServiceConstructor = new (...args: unknown[]) => StepUpService

export interface StepUpRedis {
  getAndDelIfEquals(key: string, expectedValue: string): Promise<'missing' | 'matched' | 'mismatched'>
  registerMemberStepUpGrant(
    endUserId: string,
    tokenHash: string,
    ttlSeconds: number,
    payload: string,
  ): Promise<void>
  getDelMemberStepUpGrant(endUserId: string, tokenHash: string): Promise<string | null>
  revokeMemberStepUpGrants(endUserId: string): Promise<number>
}

type TrackableRedisWrites = {
  setEx(key: string, ttlSeconds: number, value: string): Promise<void>
  setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean>
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>
  reserveWithinLimitWithTtl(key: string, ttlSeconds: number, limit: number): Promise<boolean>
}

const TEST_ENV = {
  NODE_ENV: 'test',
  SMS_PROVIDER: 'log',
  JWT_SECRET: 'ci-only-member-step-up-jwt-secret-0123456789',
  SECRET_ENCRYPTION_KEY: 'ci-only-member-step-up-encryption-key-0123456789',
  TERMINAL_ADMIN_SECRET: 'ci-only-member-step-up-terminal-admin-secret',
  TERMINAL_ACTION_TOKEN_SECRET: 'ci-only-member-step-up-terminal-action-secret',
  MEMBER_STEP_UP_TTL_SECONDS: '60',
} as const

const sensitiveValues = new Set<string>()

export function registerSensitive(value: string | undefined): void {
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

export function installOutputCapture(): { raw: string[]; restore: () => void } {
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

export async function withTestEnv(run: () => Promise<void>): Promise<void> {
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

export class FakeSmsSender implements SmsSender {
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

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function pass(message: string): void { console.log(`  PASS ${message}`) }
export function skip(message: string): void { console.log(`  SKIP ${message}`) }

export function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property
    const own = error.constraints ? Object.values(error.constraints).map((message) => `${path}: ${message}`) : []
    return [...own, ...(error.children?.length ? flattenValidationErrors(error.children, path) : [])]
  })
}

export async function verifyStepUpDtoValidation(
  sendDto: DtoConstructor,
  verifyDto: DtoConstructor,
): Promise<void> {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  const validChallengeId = '00000000-0000-4000-8000-000000000001'
  await pipe.transform(
    { action: 'export_data_request', deviceId: 'KSK-DTO' },
    { type: 'body', metatype: sendDto },
  )
  await pipe.transform(
    { challengeId: validChallengeId, code: '123456', deviceId: 'KSK-DTO' },
    { type: 'body', metatype: verifyDto },
  )
  const invalidCases: Array<{ value: Record<string, unknown>; metatype: DtoConstructor; label: string }> = [
    {
      value: { action: 'delete_everything' },
      metatype: sendDto,
      label: 'send DTO rejects an action outside the allowlist',
    },
    {
      value: { action: 'export_data_request', deviceId: 'x'.repeat(121) },
      metatype: sendDto,
      label: 'send DTO rejects deviceId longer than 120 characters',
    },
    {
      value: { action: 'export_data_request', unexpected: true },
      metatype: sendDto,
      label: 'send DTO rejects unknown fields',
    },
    {
      value: { challengeId: 'not-a-uuid', code: '123456' },
      metatype: verifyDto,
      label: 'verify DTO rejects a non-UUID challengeId',
    },
    {
      value: { challengeId: validChallengeId, code: '12345' },
      metatype: verifyDto,
      label: 'verify DTO rejects a non-six-digit code',
    },
    {
      value: { challengeId: validChallengeId, code: '123456', deviceId: 'x'.repeat(121) },
      metatype: verifyDto,
      label: 'verify DTO rejects deviceId longer than 120 characters',
    },
    {
      value: { challengeId: validChallengeId, code: '123456', unexpected: true },
      metatype: verifyDto,
      label: 'verify DTO rejects unknown fields',
    },
  ]
  for (const invalid of invalidCases) {
    let rejected = false
    try {
      await pipe.transform(invalid.value, { type: 'body', metatype: invalid.metatype })
    } catch {
      rejected = true
    }
    assert(rejected, invalid.label)
  }
  pass('step-up DTO validation executes every security boundary')
}

export function errorCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return ((response as { error?: { code?: string } } | undefined)?.error?.code)
    ?? (error as { code?: string }).code
}

export async function expectCode(fn: () => Promise<unknown>, expected: string, label: string): Promise<void> {
  try {
    await fn()
  } catch (error) {
    assert(errorCode(error) === expected, `${label}: expected ${expected}, got ${errorCode(error) ?? 'unknown'}`)
    pass(label)
    return
  }
  throw new Error(`${label}: expected rejection`)
}

export async function scanKeys(redis: Redis): Promise<string[]> {
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

export async function redisValue(redis: Redis, key: string): Promise<string> {
  const type = await redis.type(key)
  if (type === 'string') return (await redis.get(key)) ?? ''
  if (type === 'set') return (await redis.smembers(key)).join('|')
  if (type === 'hash') return JSON.stringify(await redis.hgetall(key))
  return ''
}

export async function ownedKeys(redis: Redis, markers: string[]): Promise<string[]> {
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

export function trackRedisWrites(redis: TrackableRedisWrites): { keys: Set<string>; restore: () => void } {
  const keys = new Set<string>()
  const original = {
    setEx: redis.setEx,
    setNxEx: redis.setNxEx,
    incrWithTtl: redis.incrWithTtl,
    reserveWithinLimitWithTtl: redis.reserveWithinLimitWithTtl,
  }
  redis.setEx = function (key, ttlSeconds, value) {
    keys.add(key)
    return original.setEx.call(this, key, ttlSeconds, value)
  }
  redis.setNxEx = function (key, value, ttlSeconds) {
    keys.add(key)
    return original.setNxEx.call(this, key, value, ttlSeconds)
  }
  redis.incrWithTtl = function (key, ttlSeconds) {
    keys.add(key)
    return original.incrWithTtl.call(this, key, ttlSeconds)
  }
  redis.reserveWithinLimitWithTtl = function (key, ttlSeconds, limit) {
    keys.add(key)
    return original.reserveWithinLimitWithTtl.call(this, key, ttlSeconds, limit)
  }
  return {
    keys,
    restore: () => {
      redis.setEx = original.setEx
      redis.setNxEx = original.setNxEx
      redis.incrWithTtl = original.incrWithTtl
      redis.reserveWithinLimitWithTtl = original.reserveWithinLimitWithTtl
    },
  }
}

export function isAllowedTestDatabase(databaseUrl: string): boolean {
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

export function assertNoSensitive(text: string, label: string): void {
  const leaked = [...sensitiveValues].find((value) => text.includes(value))
  assert(!leaked, `${label} contains a raw phone, code, grant token, or device identifier`)
}
