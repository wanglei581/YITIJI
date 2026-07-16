import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common'
import { decryptPhone, maskPhone } from '../common/crypto/phone-identity'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { SMS_SENDER, type SmsSender } from './sms/sms-sender'
import { Inject } from '@nestjs/common'
import { MEMBER_STEP_UP_ACTIONS, type MemberStepUpAction } from './dto/member-step-up.dto'

const MAX_VERIFY_ATTEMPTS = 5
const SEND_COOLDOWN_SECONDS = 60
const IP_HOURLY_MAX = 20
const DEVICE_HOURLY_MAX = 20

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
}

export interface SendMemberStepUpChallengeInput {
  action: MemberStepUpAction
  deviceId?: string
  ip: string
}

export interface SendMemberStepUpChallengeResult {
  challengeId: string
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: number
}

export interface VerifyMemberStepUpInput {
  challengeId: string
  code: string
  deviceId?: string
}

export interface VerifyMemberStepUpResult {
  stepUpToken: string
  action: MemberStepUpAction
  expiresInSeconds: number
}

export interface ConsumedMemberStepUpGrant {
  action: MemberStepUpAction
  deviceMatched: boolean
}

function readStepUpTtlSeconds(): number {
  const raw = Number(process.env['MEMBER_STEP_UP_TTL_SECONDS'] ?? '300')
  if (!Number.isInteger(raw) || raw < 60 || raw > 600) {
    throw new Error('MEMBER_STEP_UP_TTL_SECONDS 必须是 60–600 的整数')
  }
  return raw
}

const STEP_UP_TTL_SECONDS = readStepUpTtlSeconds()

/**
 * A short-lived, one-time SMS re-authentication primitive for future data
 * export and account closure flows. It never performs those actions itself.
 */
@Injectable()
export class MemberStepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  async sendChallenge(
    endUserId: string,
    input: SendMemberStepUpChallengeInput,
  ): Promise<SendMemberStepUpChallengeResult> {
    const action = this.assertAction(input.action)
    const user = await this.findActiveUser(endUserId)
    const deviceDigest = this.digestOptional(input.deviceId)
    const cooldownKey = this.cooldownKey(endUserId, action)

    if (!await this.redis.setNxEx(cooldownKey, '1', SEND_COOLDOWN_SECONDS)) {
      throw this.tooMany('STEP_UP_TOO_FREQUENT', '敏感操作验证发送过于频繁，请稍后再试')
    }

    const hour = new Date().toISOString().slice(0, 13)
    const ipCount = await this.redis.incrWithTtl(this.ipHourlyKey(this.digestValue(input.ip), hour), 3_600)
    if (ipCount > IP_HOURLY_MAX) {
      throw this.tooMany('STEP_UP_IP_LIMIT', '当前网络请求过于频繁，请稍后再试')
    }
    if (deviceDigest) {
      const deviceCount = await this.redis.incrWithTtl(this.deviceHourlyKey(deviceDigest, hour), 3_600)
      if (deviceCount > DEVICE_HOURLY_MAX) {
        throw this.tooMany('STEP_UP_DEVICE_LIMIT', '当前设备请求过于频繁，请稍后再试')
      }
    }

    const challengeId = randomUUID()
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const record: StepUpChallengeRecord = {
      endUserId,
      action,
      deviceDigest,
      createdAt: new Date().toISOString(),
    }
    await Promise.all([
      this.redis.setEx(this.metaKey(challengeId), STEP_UP_TTL_SECONDS, JSON.stringify(record)),
      this.redis.setEx(this.codeKey(challengeId), STEP_UP_TTL_SECONDS, this.codeDigest(challengeId, code)),
      this.redis.del(this.attemptKey(challengeId)),
    ])

    try {
      const phone = decryptPhone(user.phoneEnc)
      await this.sms.sendCode(phone, code)
      return {
        challengeId,
        phoneMasked: maskPhone(phone),
        expiresInSeconds: STEP_UP_TTL_SECONDS,
        cooldownSeconds: SEND_COOLDOWN_SECONDS,
      }
    } catch {
      await Promise.all([
        this.redis.del(this.metaKey(challengeId)),
        this.redis.del(this.codeKey(challengeId)),
        this.redis.del(this.attemptKey(challengeId)),
        this.redis.del(cooldownKey),
      ])
      throw new HttpException(
        { error: { code: 'STEP_UP_SMS_SEND_FAILED', message: '验证短信发送失败，请稍后再试' } },
        HttpStatus.BAD_GATEWAY,
      )
    }
  }

  async verifyChallenge(endUserId: string, input: VerifyMemberStepUpInput): Promise<VerifyMemberStepUpResult> {
    await this.findActiveUser(endUserId)
    const record = this.parseChallenge(await this.redis.get(this.metaKey(input.challengeId)))
    if (!record || record.endUserId !== endUserId) throw this.challengeInvalid()

    const attempts = await this.redis.incrWithTtl(this.attemptKey(input.challengeId), STEP_UP_TTL_SECONDS)
    if (attempts > MAX_VERIFY_ATTEMPTS) {
      await Promise.all([
        this.redis.del(this.codeKey(input.challengeId)),
        this.redis.del(this.metaKey(input.challengeId)),
        this.redis.del(this.attemptKey(input.challengeId)),
      ])
      throw this.unauthorized('STEP_UP_CODE_LOCKED', '验证尝试次数过多，请重新获取验证码')
    }

    const codeState = await this.redis.getAndDelIfEquals(this.codeKey(input.challengeId), this.codeDigest(input.challengeId, input.code))
    if (codeState === 'missing') throw this.challengeInvalid()
    if (codeState === 'mismatched') throw this.unauthorized('STEP_UP_CODE_INVALID', '验证码不正确')

    const consumedRecord = this.parseChallenge(await this.redis.getDel(this.metaKey(input.challengeId)))
    await this.redis.del(this.attemptKey(input.challengeId))
    if (!consumedRecord || consumedRecord.endUserId !== endUserId) throw this.challengeInvalid()

    const stepUpToken = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(stepUpToken).digest('hex')
    const grant: StepUpGrantRecord = {
      endUserId,
      action: consumedRecord.action,
      deviceDigest: consumedRecord.deviceDigest,
    }
    await this.redis.registerMemberStepUpGrant(endUserId, tokenHash, STEP_UP_TTL_SECONDS, JSON.stringify(grant))
    return { stepUpToken, action: consumedRecord.action, expiresInSeconds: STEP_UP_TTL_SECONDS }
  }

  async consumeGrant(
    endUserId: string,
    action: MemberStepUpAction,
    stepUpToken: string,
    deviceId?: string,
  ): Promise<ConsumedMemberStepUpGrant> {
    const tokenHash = createHash('sha256').update(stepUpToken).digest('hex')
    const record = this.parseGrant(await this.redis.getDelMemberStepUpGrant(endUserId, tokenHash))
    if (!record || record.endUserId !== endUserId || record.action !== action) throw this.tokenInvalid()

    const currentDeviceDigest = this.digestOptional(deviceId)
    return {
      action: record.action,
      deviceMatched: record.deviceDigest === currentDeviceDigest,
    }
  }

  private async findActiveUser(endUserId: string): Promise<{ phoneEnc: string }> {
    const user = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { enabled: true, status: true, phoneEnc: true },
    })
    if (!user || !user.enabled || user.status !== 'active') {
      throw new ForbiddenException({
        error: { code: 'ACCOUNT_UNAVAILABLE', message: '账号当前不可用，请重新登录或联系工作人员' },
      })
    }
    return user
  }

  private assertAction(action: string): MemberStepUpAction {
    if ((MEMBER_STEP_UP_ACTIONS as readonly string[]).includes(action)) return action as MemberStepUpAction
    throw new HttpException(
      { error: { code: 'STEP_UP_ACTION_INVALID', message: '不支持的敏感操作类型' } },
      HttpStatus.BAD_REQUEST,
    )
  }

  private parseChallenge(raw: string | null): StepUpChallengeRecord | null {
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as StepUpChallengeRecord
      if (
        typeof value.endUserId === 'string' &&
        this.isAction(value.action) &&
        (typeof value.deviceDigest === 'string' || value.deviceDigest === null) &&
        typeof value.createdAt === 'string'
      ) return value
    } catch {
      // Treat malformed Redis state as an expired challenge.
    }
    return null
  }

  private parseGrant(raw: string | null): StepUpGrantRecord | null {
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as StepUpGrantRecord
      if (
        typeof value.endUserId === 'string' &&
        this.isAction(value.action) &&
        (typeof value.deviceDigest === 'string' || value.deviceDigest === null)
      ) return value
    } catch {
      // A malformed or expired grant is indistinguishable from an invalid one.
    }
    return null
  }

  private isAction(value: unknown): value is MemberStepUpAction {
    return typeof value === 'string' && (MEMBER_STEP_UP_ACTIONS as readonly string[]).includes(value)
  }

  private codeDigest(challengeId: string, code: string): string {
    return createHmac('sha256', this.secretKey()).update(`${challengeId}:${code}`).digest('hex')
  }

  private digestOptional(value: string | undefined): string | null {
    const normalized = value?.trim()
    return normalized ? this.digestValue(normalized) : null
  }

  private digestValue(value: string): string {
    return createHmac('sha256', this.secretKey()).update(value).digest('hex')
  }

  private secretKey(): string {
    const key = process.env['SECRET_ENCRYPTION_KEY']
    if (!key || key.length < 32) throw new Error('SECRET_ENCRYPTION_KEY 未配置或长度不足 32')
    return key
  }

  private codeKey(challengeId: string): string {
    return `member:step-up:code:${challengeId}`
  }

  private metaKey(challengeId: string): string {
    return `member:step-up:meta:${challengeId}`
  }

  private attemptKey(challengeId: string): string {
    return `member:step-up:attempt:${challengeId}`
  }

  private cooldownKey(endUserId: string, action: MemberStepUpAction): string {
    return `member:step-up:cooldown:${endUserId}:${action}`
  }

  private ipHourlyKey(ipDigest: string, hour: string): string {
    return `member:step-up:ip:${ipDigest}:${hour}`
  }

  private deviceHourlyKey(deviceDigest: string, hour: string): string {
    return `member:step-up:device:${deviceDigest}:${hour}`
  }

  private challengeInvalid(): UnauthorizedException {
    return this.unauthorized('STEP_UP_CHALLENGE_INVALID', '敏感操作验证已失效，请重新获取验证码')
  }

  private tokenInvalid(): UnauthorizedException {
    return this.unauthorized('STEP_UP_TOKEN_INVALID', '敏感操作验证无效或已过期')
  }

  private unauthorized(code: string, message: string): UnauthorizedException {
    return new UnauthorizedException({ error: { code, message } })
  }

  private tooMany(code: string, message: string): HttpException {
    return new HttpException({ error: { code, message } }, HttpStatus.TOO_MANY_REQUESTS)
  }
}
