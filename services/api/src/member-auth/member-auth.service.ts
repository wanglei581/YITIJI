import { randomInt, randomUUID } from 'crypto'
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { encryptPhone, hashPhone, maskPhone, maskPhoneFromEnc } from '../common/crypto/phone-identity'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { SMS_SENDER, type SmsSender } from './sms/sms-sender'

type SmsProviderFailure = Error & { providerCode?: string }

// ── 时效 / 阈值(秒)─────────────────────────────────────────────
const CODE_TTL = 300 // 验证码 5 分钟
const SESSION_TTL = 1800 // 会话 30 分钟,与 JWT 过期一致
const COOLDOWN = 60 // 同号发送冷却
const VERIFY_MAX_ATTEMPTS = 5 // 单码最多尝试次数(防 6 位码爆破)

// ── 多维频控阈值 ────────────────────────────────────────────────
const PHONE_DAILY_MAX = 10 // 单手机号每日
const IP_HOURLY_MAX = 20 // 单 IP 每小时
const DEVICE_HOURLY_MAX = 20 // 单设备每小时

export interface SendCodeResult {
  sent: true
  cooldownSeconds: number
  expiresInSeconds: number
}

export interface MemberAuthUser {
  id: string
  phoneMasked: string
  nickname: string | null
}

export interface MemberLoginResult {
  token: string
  user: MemberAuthUser
}

/**
 * C 端求职者账号服务(阶段 A)。
 *
 * 验证码、频控计数、登录会话全部落 Redis;EndUser 落 Prisma。
 * 手机号不存明文(phoneHash 查找 + phoneEnc 加密),对外只回 phoneMasked。
 */
@Injectable()
export class MemberAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  /** 发送短信验证码:冷却 + 多维频控 + 写 Redis(TTL 5min)+ 下发。 */
  async sendSmsCode(phone: string, deviceId: string | undefined, ip: string): Promise<SendCodeResult> {
    const phoneHash = hashPhone(phone)

    // 1) 同号冷却:60s 内重复请求直接拒,防短信轰炸。
    const fresh = await this.redis.setNxEx(this.k.cooldown(phoneHash), '1', COOLDOWN)
    if (!fresh) {
      throw this.tooMany('SMS_TOO_FREQUENT', '验证码发送过于频繁,请 60 秒后再试')
    }

    // 2) 多维频控:手机号(日)/ IP(时)/ 设备(时)。
    const day = this.dayBucket()
    const hour = this.hourBucket()
    const phoneDaily = await this.redis.incrWithTtl(this.k.phoneDaily(phoneHash, day), 86_400)
    if (phoneDaily > PHONE_DAILY_MAX) {
      throw this.tooMany('SMS_DAILY_LIMIT', '今日验证码请求次数过多,请明天再试')
    }
    const ipHourly = await this.redis.incrWithTtl(this.k.ipHourly(ip, hour), 3_600)
    if (ipHourly > IP_HOURLY_MAX) {
      throw this.tooMany('SMS_IP_LIMIT', '当前网络请求过于频繁,请稍后再试')
    }
    if (deviceId) {
      const deviceHourly = await this.redis.incrWithTtl(this.k.deviceHourly(deviceId, hour), 3_600)
      if (deviceHourly > DEVICE_HOURLY_MAX) {
        throw this.tooMany('SMS_DEVICE_LIMIT', '当前设备请求过于频繁,请稍后再试')
      }
    }

    // 3) 生成 6 位数字验证码 → Redis(TTL 5min),重置尝试计数。
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const codeKey = this.k.code(phoneHash)
    await this.redis.setEx(codeKey, CODE_TTL, code)
    await this.redis.del(this.k.attempt(phoneHash))

    // 4) 下发(dev: 仅服务端日志,不返回明文验证码)。若真实服务商发送失败,
    // 立即删除本次验证码,避免出现"短信未发出但验证码仍可用"的残留状态。
    try {
      await this.sms.sendCode(phone, code)
    } catch (error) {
      await this.redis.del(codeKey)
      await this.redis.del(this.k.cooldown(phoneHash))
      throw this.toSmsSendException(error)
    }

    return { sent: true, cooldownSeconds: COOLDOWN, expiresInSeconds: CODE_TTL }
  }

  /** 校验验证码 → upsert EndUser → 建立 Redis 会话 → 签发 JWT。 */
  async login(phone: string, code: string, deviceId: string | undefined, ip: string): Promise<MemberLoginResult> {
    return this.loginWithSmsCode(phone, code, deviceId, ip)
  }

  /** 供手机号登录与 QR 确认共用同一套验证码校验、账号创建与会话签发逻辑。 */
  async loginWithSmsCode(phone: string, code: string, _deviceId: string | undefined, _ip: string): Promise<MemberLoginResult> {
    const user = await this.verifySmsCodeForUser(phone, code)
    return this.issueLoginForUser(user)
  }

  /** 原子消费短信验证码并创建/更新 EndUser；不签发 token，供 QR 确认阶段使用。 */
  async verifySmsCodeForUser(phone: string, code: string): Promise<MemberAuthUser> {
    const phoneHash = hashPhone(phone)
    const codeKey = this.k.code(phoneHash)
    const attemptKey = this.k.attempt(phoneHash)

    // 尝试次数闸:防对 6 位码暴力穷举。超限即作废当前码。
    const attempts = await this.redis.incrWithTtl(attemptKey, CODE_TTL)
    if (attempts > VERIFY_MAX_ATTEMPTS) {
      await this.redis.del(codeKey)
      await this.redis.del(attemptKey)
      throw this.loginFailed('SMS_CODE_LOCKED', '验证码尝试次数过多,请重新获取')
    }

    const codeStatus = await this.redis.getAndDelIfEquals(codeKey, code)
    if (codeStatus === 'missing') {
      throw this.loginFailed('SMS_CODE_EXPIRED', '验证码已过期或不存在,请重新获取')
    }
    if (codeStatus === 'mismatched') {
      throw this.loginFailed('SMS_CODE_INVALID', '验证码不正确')
    }

    // 验证通过:立即销毁尝试计数；验证码已由 Redis 原子脚本删除(防并发重放)。
    await this.redis.del(attemptKey)

    // upsert EndUser(by phoneHash)。新旧门禁双轨期间任何不可用状态都拒绝登录。
    let user = await this.prisma.endUser.findUnique({ where: { phoneHash } })
    if (user && (!user.enabled || user.status !== 'active')) {
      throw this.accountUnavailable()
    }
    if (!user) {
      user = await this.prisma.endUser.create({
        data: {
          phoneHash,
          phoneEnc: encryptPhone(phone),
          enabled: true,
          status: 'active',
          lastLoginAt: new Date(),
        },
      })
    } else {
      user = await this.prisma.endUser.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
    }

    return { id: user.id, phoneMasked: maskPhone(phone), nickname: user.nickname }
  }

  async issueLoginForUser(user: MemberAuthUser): Promise<MemberLoginResult> {
    // QR 确认与最终 claim 之间账户状态可能变化，签发前必须重读双轨门禁。
    const current = await this.prisma.endUser.findUnique({
      where: { id: user.id },
      select: { enabled: true, status: true },
    })
    if (!current || !current.enabled || current.status !== 'active') {
      throw this.accountUnavailable()
    }

    // 建立 Redis 会话(jti),签发短期 JWT(aud=enduser + jti)。
    const sessionId = randomUUID()
    await this.redis.registerMemberSession(user.id, sessionId, SESSION_TTL)
    const token = this.jwtService.sign({ sub: user.id }, { jwtid: sessionId })

    return {
      token,
      user,
    }
  }

  /** 登出:删除 Redis 会话即失效(JWT 即使未过期也作废)。 */
  async logout(endUserId: string, sessionId: string): Promise<void> {
    await this.redis.unregisterMemberSession(endUserId, sessionId)
  }

  /** 当前登录用户信息(phoneMasked 由 phoneEnc 解密派生,绝不回明文)。 */
  async me(endUserId: string): Promise<MemberAuthUser> {
    const user = await this.prisma.endUser.findUnique({ where: { id: endUserId } })
    if (!user) {
      throw new UnauthorizedException({ error: { code: 'MEMBER_SESSION_EXPIRED', message: '会话已失效,请重新登录' } })
    }
    return { id: user.id, phoneMasked: maskPhoneFromEnc(user.phoneEnc), nickname: user.nickname }
  }

  // ── Redis key 约定 ──────────────────────────────────────────
  private readonly k = {
    code: (h: string) => `member:sms:code:${h}`,
    attempt: (h: string) => `member:sms:attempt:${h}`,
    cooldown: (h: string) => `member:sms:cooldown:${h}`,
    phoneDaily: (h: string, day: string) => `member:sms:daily:${h}:${day}`,
    ipHourly: (ip: string, hour: string) => `member:sms:ip:${ip}:${hour}`,
    deviceHourly: (d: string, hour: string) => `member:sms:device:${d}:${hour}`,
  }

  private dayBucket(): string {
    return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  }

  private hourBucket(): string {
    return new Date().toISOString().slice(0, 13) // YYYY-MM-DDTHH
  }

  private tooMany(code: string, message: string): HttpException {
    return new HttpException({ error: { code, message } }, HttpStatus.TOO_MANY_REQUESTS)
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

  private loginFailed(code: string, message: string): UnauthorizedException {
    return new UnauthorizedException({ error: { code, message } })
  }

  private accountUnavailable(): ForbiddenException {
    return new ForbiddenException({
      error: { code: 'ACCOUNT_UNAVAILABLE', message: '账号当前不可登录，请联系工作人员' },
    })
  }
}
