import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import { randomInt } from 'crypto'
import { hashPhone } from '../common/crypto/phone-identity'
import { RedisService } from '../common/redis/redis.service'
import { SMS_SENDER, type SmsSender } from '../member-auth/sms/sms-sender'

type SmsProviderFailure = Error & { providerCode?: string }

export type InternalOtpPurpose = 'login' | 'reset_password' | 'bind_phone' | 'transfer_phone'

export interface InternalSendCodeResult {
  sent: true
  cooldownSeconds: number
  expiresInSeconds: number
}

export const INTERNAL_OTP_CODE_TTL_SECONDS = 300
const COOLDOWN = 60
const PHONE_DAILY_MAX = 10
const IP_HOURLY_MAX = 30
const DEVICE_HOURLY_MAX = 20
const VERIFY_MAX_ATTEMPTS = 5

@Injectable()
export class InternalOtpService {
  constructor(
    private readonly redis: RedisService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  async sendCode(input: {
    phone: string
    purpose: InternalOtpPurpose
    ip: string
    deviceId?: string
    shouldDeliver: boolean
  }): Promise<InternalSendCodeResult> {
    const phoneHash = hashPhone(input.phone)
    const fresh = await this.redis.setNxEx(this.k.cooldown(input.purpose, phoneHash), '1', COOLDOWN)
    if (!fresh) {
      throw this.tooMany('SMS_TOO_FREQUENT', '验证码发送过于频繁,请 60 秒后再试')
    }

    const day = this.dayBucket()
    const hour = this.hourBucket()
    const phoneDaily = await this.redis.incrWithTtl(this.k.phoneDaily(phoneHash, day), 86_400)
    if (phoneDaily > PHONE_DAILY_MAX) {
      throw this.tooMany('SMS_DAILY_LIMIT', '今日验证码请求次数过多,请明天再试')
    }
    const ipHourly = await this.redis.incrWithTtl(this.k.ipHourly(input.ip, hour), 3_600)
    if (ipHourly > IP_HOURLY_MAX) {
      throw this.tooMany('SMS_IP_LIMIT', '当前网络请求过于频繁,请稍后再试')
    }
    if (input.deviceId) {
      const deviceHourly = await this.redis.incrWithTtl(this.k.deviceHourly(input.deviceId, hour), 3_600)
      if (deviceHourly > DEVICE_HOURLY_MAX) {
        throw this.tooMany('SMS_DEVICE_LIMIT', '当前设备请求过于频繁,请稍后再试')
      }
    }

    if (!input.shouldDeliver) {
      await this.simulateProviderLatency()
      return { sent: true, cooldownSeconds: COOLDOWN, expiresInSeconds: INTERNAL_OTP_CODE_TTL_SECONDS }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const codeKey = this.k.code(input.purpose, phoneHash)
    await this.redis.setEx(codeKey, INTERNAL_OTP_CODE_TTL_SECONDS, code)
    await this.redis.del(this.k.attempt(input.purpose, phoneHash))

    try {
      await this.sms.sendCode(input.phone, code)
    } catch (error) {
      await this.redis.del(codeKey)
      await this.redis.del(this.k.cooldown(input.purpose, phoneHash))
      throw this.toSmsSendException(error)
    }

    return { sent: true, cooldownSeconds: COOLDOWN, expiresInSeconds: INTERNAL_OTP_CODE_TTL_SECONDS }
  }

  async verifyCode(phone: string, purpose: InternalOtpPurpose, code: string): Promise<void> {
    const phoneHash = hashPhone(phone)
    const codeKey = this.k.code(purpose, phoneHash)
    const attemptKey = this.k.attempt(purpose, phoneHash)
    const attempts = await this.redis.incrWithTtl(attemptKey, INTERNAL_OTP_CODE_TTL_SECONDS)
    if (attempts > VERIFY_MAX_ATTEMPTS) {
      await this.redis.del(codeKey)
      await this.redis.del(attemptKey)
      throw this.invalid('SMS_CODE_LOCKED', '验证码尝试次数过多,请重新获取')
    }

    const codeStatus = await this.redis.getAndDelIfEquals(codeKey, code)
    if (codeStatus === 'missing') {
      throw this.invalid('SMS_CODE_EXPIRED', '验证码已过期或不存在,请重新获取')
    }
    if (codeStatus === 'mismatched') {
      throw this.invalid('SMS_CODE_INVALID', '验证码不正确')
    }
    await this.redis.del(attemptKey)
  }

  private readonly k = {
    code: (purpose: string, h: string) => `internal:sms:code:${purpose}:${h}`,
    attempt: (purpose: string, h: string) => `internal:sms:attempt:${purpose}:${h}`,
    cooldown: (purpose: string, h: string) => `internal:sms:cooldown:${purpose}:${h}`,
    phoneDaily: (h: string, day: string) => `internal:sms:daily:${h}:${day}`,
    ipHourly: (ip: string, hour: string) => `internal:sms:ip:${ip}:${hour}`,
    deviceHourly: (d: string, hour: string) => `internal:sms:device:${d}:${hour}`,
  }

  private dayBucket(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private hourBucket(): string {
    return new Date().toISOString().slice(0, 13)
  }

  private tooMany(code: string, message: string): HttpException {
    return new HttpException({ error: { code, message } }, HttpStatus.TOO_MANY_REQUESTS)
  }

  private invalid(code: string, message: string): HttpException {
    return new HttpException({ error: { code, message } }, HttpStatus.UNAUTHORIZED)
  }

  private toSmsSendException(error: unknown): HttpException {
    if (error instanceof HttpException) return error

    const providerCode = this.smsProviderCode(error)
    if (providerCode === 'LimitExceeded.PhoneNumberDailyLimit') {
      return this.tooMany('SMS_PROVIDER_PHONE_DAILY_LIMIT', '该手机号今日短信发送次数已达上限,请明天再试')
    }
    if (providerCode?.startsWith('LimitExceeded.')) {
      return this.tooMany('SMS_PROVIDER_RATE_LIMIT', '短信通道请求过于频繁,请稍后再试')
    }

    return new HttpException(
      { error: { code: 'SMS_SEND_FAILED', message: '短信发送失败,请稍后再试' } },
      HttpStatus.BAD_GATEWAY,
    )
  }

  private smsProviderCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined
    const providerCode = (error as SmsProviderFailure).providerCode
    return typeof providerCode === 'string' && providerCode ? providerCode : undefined
  }

  private async simulateProviderLatency(): Promise<void> {
    const delayMs = randomInt(220, 481)
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  }
}
