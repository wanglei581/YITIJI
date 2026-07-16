import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decryptPhone, maskPhone } from '../common/crypto/phone-identity'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { MEMBER_STEP_UP_ACTIONS, type MemberStepUpAction } from './member-step-up.types'
import { SMS_SENDER, type SmsSender } from './sms/sms-sender'

function readStepUpTtlSeconds(): number {
  const raw = Number(process.env['MEMBER_STEP_UP_TTL_SECONDS'] ?? '300')
  if (!Number.isInteger(raw) || raw < 60 || raw > 600) {
    throw new Error('MEMBER_STEP_UP_TTL_SECONDS 必须是 60–600 的整数')
  }
  return raw
}

const ttlSeconds = readStepUpTtlSeconds()
const CHALLENGE_TTL_SECONDS = ttlSeconds
const GRANT_TTL_SECONDS = ttlSeconds
const MAX_VERIFY_ATTEMPTS = 5
const SEND_COOLDOWN_SECONDS = 60
const RATE_WINDOW_SECONDS = 3_600

// Step-up 是敏感操作边界：单 IP 每小时 20 次，单设备每小时 10 次。
// 计数只在短信真正发出后保留，中途失败会释放本次 reservation。
const IP_HOURLY_LIMIT = 20
const DEVICE_HOURLY_LIMIT = 10
const DIGEST_PATTERN = /^[a-f0-9]{64}$/

interface StepUpChallengeRecord {
  endUserId: string
  action: MemberStepUpAction
  deviceDigest: string | null
  createdAt: string
}

interface StepUpGrantRecord {
  endUserId: string
  action: MemberStepUpAction
  deviceDigest: string | null
  statusChangedAt: string | null
}

export interface SendStepUpChallengeInput {
  action: MemberStepUpAction
  deviceId?: string
  ip: string
}

export interface SendStepUpChallengeResult {
  challengeId: string
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: number
}

export interface VerifyStepUpChallengeInput {
  challengeId: string
  code: string
  deviceId?: string
}

export interface VerifyStepUpChallengeResult {
  stepUpToken: string
  action: MemberStepUpAction
  expiresInSeconds: number
}

@Injectable()
export class MemberStepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  async sendChallenge(
    endUserId: string,
    input: SendStepUpChallengeInput,
  ): Promise<SendStepUpChallengeResult> {
    if (!this.isAction(input.action)) throw this.invalidAction()

    const user = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { id: true, enabled: true, status: true, phoneEnc: true },
    })
    if (!user || !user.enabled || user.status !== 'active') throw this.accountUnavailable()

    const cooldownKey = this.k.cooldown(endUserId, input.action)
    const cooldownOwner = randomUUID()
    if (!await this.redis.setNxEx(cooldownKey, cooldownOwner, SEND_COOLDOWN_SECONDS)) {
      throw this.tooMany('STEP_UP_SEND_TOO_FREQUENT', '验证码发送过于频繁，请稍后再试')
    }

    const reservationKeys: string[] = []
    let challengeId: string | null = null
    try {
      await this.reserveRate(this.k.ipHourly(input.ip), IP_HOURLY_LIMIT, reservationKeys)
      if (input.deviceId) {
        await this.reserveRate(this.k.deviceHourly(input.deviceId), DEVICE_HOURLY_LIMIT, reservationKeys)
      }

      challengeId = randomUUID()
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
      const record: StepUpChallengeRecord = {
        endUserId,
        action: input.action,
        deviceDigest: input.deviceId ? this.hmacDigest('device', input.deviceId) : null,
        createdAt: new Date().toISOString(),
      }
      await this.redis.setEx(this.k.meta(challengeId), CHALLENGE_TTL_SECONDS, JSON.stringify(record))
      await this.redis.setEx(this.k.code(challengeId), CHALLENGE_TTL_SECONDS, this.codeDigest(challengeId, code))
      await this.redis.setEx(this.k.attempt(challengeId), CHALLENGE_TTL_SECONDS, '0')

      let phoneMasked: string
      let deliveryAttempted = false
      try {
        const phone = decryptPhone(user.phoneEnc)
        phoneMasked = maskPhone(phone)
        deliveryAttempted = true
        await this.sms.sendCode(phone, code)
      } catch {
        if (deliveryAttempted) await this.cleanupChallenge(challengeId)
        else await this.cleanupBeforeDelivery(challengeId, cooldownKey, cooldownOwner, reservationKeys)
        throw this.smsSendFailed()
      }

      return {
        challengeId,
        phoneMasked,
        expiresInSeconds: CHALLENGE_TTL_SECONDS,
        cooldownSeconds: SEND_COOLDOWN_SECONDS,
      }
    } catch (error) {
      if (!(error instanceof HttpException && this.errorCode(error) === 'SMS_SEND_FAILED')) {
        await this.cleanupBeforeDelivery(challengeId, cooldownKey, cooldownOwner, reservationKeys)
      }
      throw error
    }
  }

  async verifyChallenge(
    endUserId: string,
    input: VerifyStepUpChallengeInput,
  ): Promise<VerifyStepUpChallengeResult> {
    const challenge = await this.redis.consumeMemberStepUpChallenge(
      endUserId,
      input.challengeId,
      this.codeDigest(input.challengeId, input.code),
      MAX_VERIFY_ATTEMPTS,
    )
    if (challenge.status === 'missing' || challenge.status === 'owner_mismatch') {
      throw this.challengeInvalid()
    }
    if (challenge.status === 'mismatched') throw this.codeInvalid()

    const record = this.parseChallenge(challenge.meta)
    if (!record || record.endUserId !== endUserId) throw this.challengeInvalid()

    // 状态检查必须发生在 challenge 原子消费之后，状态变化时绝不签发 grant。
    const user = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { enabled: true, status: true, statusChangedAt: true },
    })
    if (!user || !user.enabled || user.status !== 'active') throw this.accountUnavailable()

    const stepUpToken = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(stepUpToken).digest('hex')
    const grant: StepUpGrantRecord = {
      endUserId,
      action: record.action,
      deviceDigest: record.deviceDigest,
      statusChangedAt: user.statusChangedAt?.toISOString() ?? null,
    }
    await this.redis.registerMemberStepUpGrant(
      endUserId,
      tokenHash,
      GRANT_TTL_SECONDS,
      JSON.stringify(grant),
    )
    return { stepUpToken, action: record.action, expiresInSeconds: GRANT_TTL_SECONDS }
  }

  async consumeGrant(
    endUserId: string,
    action: MemberStepUpAction,
    token: string,
    deviceId?: string,
  ): Promise<void> {
    if (typeof token !== 'string' || token.length === 0) throw this.tokenInvalid()

    const tokenHash = createHash('sha256').update(token).digest('hex')
    const grant = this.parseGrant(await this.redis.getDelMemberStepUpGrant(endUserId, tokenHash))
    if (!grant || grant.endUserId !== endUserId || grant.action !== action) throw this.tokenInvalid()

    // grant 先原子消费再复核状态：被禁用/注销中的账号不能使用旧授权，
    // 且重新启用后也不能复活已经被拒绝的 token。
    const user = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { enabled: true, status: true, statusChangedAt: true },
    })
    if (!user || !user.enabled || user.status !== 'active') {
      await this.redis.revokeMemberStepUpGrants(endUserId)
      throw this.accountUnavailable()
    }
    if ((user.statusChangedAt?.toISOString() ?? null) !== grant.statusChangedAt) {
      await this.redis.revokeMemberStepUpGrants(endUserId)
      throw this.tokenInvalid()
    }

    const currentDeviceDigest = deviceId ? this.hmacDigest('device', deviceId) : null
    const deviceMatched = grant.deviceDigest === currentDeviceDigest
    await this.audit.write({
      actorId: null,
      actorRole: 'end_user',
      action: 'MEMBER_STEP_UP_GRANT_CONSUMED',
      targetType: 'EndUser',
      targetId: endUserId,
      payload: { action: grant.action, deviceMatched },
    })
  }

  private readonly k = {
    meta: (challengeId: string) => `member:step-up:challenge:${challengeId}:meta`,
    code: (challengeId: string) => `member:step-up:challenge:${challengeId}:code`,
    attempt: (challengeId: string) => `member:step-up:challenge:${challengeId}:attempt`,
    cooldown: (endUserId: string, action: MemberStepUpAction) => (
      `member:step-up:cooldown:${this.hmacDigest('end-user', endUserId)}:${action}`
    ),
    ipHourly: (ip: string) => (
      `member:step-up:rate:ip:${this.hmacDigest('ip', ip)}:${this.hourBucket()}`
    ),
    deviceHourly: (deviceId: string) => (
      `member:step-up:rate:device:${this.hmacDigest('device', deviceId)}:${this.hourBucket()}`
    ),
  }

  private async reserveRate(key: string, limit: number, reservations: string[]): Promise<void> {
    if (!await this.redis.reserveWithinLimitWithTtl(key, RATE_WINDOW_SECONDS, limit)) {
      throw this.tooMany('STEP_UP_RATE_LIMITED', '二次验证请求过于频繁，请稍后再试')
    }
    reservations.push(key)
  }

  private async cleanupBeforeDelivery(
    challengeId: string | null,
    cooldownKey: string,
    cooldownOwner: string,
    reservationKeys: string[],
  ): Promise<void> {
    const cleanup: Array<Promise<unknown>> = [
      this.redis.getAndDelIfEquals(cooldownKey, cooldownOwner),
    ]
    if (challengeId) cleanup.push(this.cleanupChallenge(challengeId))
    cleanup.push(...reservationKeys.map((key) => this.redis.releaseReservedLimit(key)))
    await Promise.allSettled(cleanup)
  }

  private async cleanupChallenge(challengeId: string): Promise<void> {
    await Promise.allSettled([
      this.redis.del(this.k.meta(challengeId)),
      this.redis.del(this.k.code(challengeId)),
      this.redis.del(this.k.attempt(challengeId)),
    ])
  }

  private codeDigest(challengeId: string, code: string): string {
    return createHmac('sha256', this.secret()).update(`${challengeId}:${code}`).digest('hex')
  }

  private hmacDigest(domain: 'device' | 'ip' | 'end-user', value: string): string {
    return createHmac('sha256', this.secret())
      .update(`member-step-up:${domain}:${value}`)
      .digest('hex')
  }

  private secret(): string {
    const key = process.env['SECRET_ENCRYPTION_KEY']
    if (!key || key.length < 32) throw new Error('SECRET_ENCRYPTION_KEY 未配置或长度不足 32')
    return key
  }

  private parseChallenge(raw: string | null): StepUpChallengeRecord | null {
    const parsed = this.parseObject(raw, ['action', 'createdAt', 'deviceDigest', 'endUserId'])
    if (!parsed || typeof parsed['endUserId'] !== 'string' || !parsed['endUserId']) return null
    if (!this.isAction(parsed['action'])) return null
    if (!this.isOptionalDigest(parsed['deviceDigest'])) return null
    if (typeof parsed['createdAt'] !== 'string' || !this.isIsoDate(parsed['createdAt'])) return null
    return {
      endUserId: parsed['endUserId'],
      action: parsed['action'],
      deviceDigest: parsed['deviceDigest'],
      createdAt: parsed['createdAt'],
    }
  }

  private parseGrant(raw: string | null): StepUpGrantRecord | null {
    const parsed = this.parseObject(raw, ['action', 'deviceDigest', 'endUserId', 'statusChangedAt'])
    if (!parsed || typeof parsed['endUserId'] !== 'string' || !parsed['endUserId']) return null
    if (!this.isAction(parsed['action']) || !this.isOptionalDigest(parsed['deviceDigest'])) return null
    if (!this.isOptionalIsoDate(parsed['statusChangedAt'])) return null
    return {
      endUserId: parsed['endUserId'],
      action: parsed['action'],
      deviceDigest: parsed['deviceDigest'],
      statusChangedAt: parsed['statusChangedAt'],
    }
  }

  private parseObject(raw: string | null, expectedKeys: string[]): Record<string, unknown> | null {
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const record = value as Record<string, unknown>
      if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)) return null
      return record
    } catch {
      return null
    }
  }

  private isAction(value: unknown): value is MemberStepUpAction {
    return typeof value === 'string'
      && (MEMBER_STEP_UP_ACTIONS as readonly string[]).includes(value)
  }

  private isOptionalDigest(value: unknown): value is string | null {
    return value === null || (typeof value === 'string' && DIGEST_PATTERN.test(value))
  }

  private isIsoDate(value: string): boolean {
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
  }

  private isOptionalIsoDate(value: unknown): value is string | null {
    return value === null || (typeof value === 'string' && this.isIsoDate(value))
  }

  private hourBucket(): string {
    return new Date().toISOString().slice(0, 13)
  }

  private errorCode(error: HttpException): string | undefined {
    const response = error.getResponse()
    return typeof response === 'object' && response !== null
      ? (response as { error?: { code?: string } }).error?.code
      : undefined
  }

  private invalidAction(): BadRequestException {
    return new BadRequestException({ error: { code: 'STEP_UP_ACTION_INVALID', message: '不支持的二次验证动作' } })
  }

  private accountUnavailable(): ForbiddenException {
    return new ForbiddenException({ error: { code: 'ACCOUNT_UNAVAILABLE', message: '账号当前不可用，请联系工作人员' } })
  }

  private challengeInvalid(): UnauthorizedException {
    return new UnauthorizedException({
      error: { code: 'STEP_UP_CHALLENGE_INVALID', message: '二次验证挑战无效或已过期' },
    })
  }

  private codeInvalid(): UnauthorizedException {
    return new UnauthorizedException({ error: { code: 'STEP_UP_CODE_INVALID', message: '验证码无效' } })
  }

  private tokenInvalid(): UnauthorizedException {
    return new UnauthorizedException({
      error: { code: 'STEP_UP_TOKEN_INVALID', message: '二次验证凭证无效或已过期' },
    })
  }

  private tooMany(code: string, message: string): HttpException {
    return new HttpException({ error: { code, message } }, HttpStatus.TOO_MANY_REQUESTS)
  }

  private smsSendFailed(): HttpException {
    return new HttpException(
      { error: { code: 'SMS_SEND_FAILED', message: '短信发送失败，请稍后再试' } },
      HttpStatus.BAD_GATEWAY,
    )
  }
}
