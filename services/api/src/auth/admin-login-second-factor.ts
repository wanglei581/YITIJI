import { ForbiddenException, HttpException, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { assertAdminIpAllowed } from '../common/auth/admin-ip-allowlist'
import { decryptPhone, maskPhone } from '../common/crypto/phone-identity'
import type { RedisService } from '../common/redis/redis.service'
import type { PrismaService } from '../prisma/prisma.service'
import { INTERNAL_OTP_CODE_TTL_SECONDS, type InternalOtpService } from './internal-otp.service'

/**
 * 管理员登录的第二步：账号密码通过后，再用绑定手机号收到的短信验证码确认本人（P1-4，2026-09-29）。
 *
 * 开关 `ADMIN_LOGIN_SECOND_FACTOR`：
 * - 不设置 / `off`（默认）：不要求第二步，今天的行为不变；
 * - `sms`：管理员入口的密码登录不再直接发登录凭证，而是先发短信验证码、返回一张一次性的
 *   「第二步凭证」，前端拿验证码与凭证调 `POST /auth/login/second-factor` 才拿到登录凭证；
 *   同时关掉管理员入口的「只用短信验证码登录」（那只证明持有手机，是单因素）。
 *   其它任何非空值也按 `sms` 处理并打一条告警：安全开关拼错时宁可多验一步，不能悄悄失效。
 *
 * 开之前必须先确认每个启用中的管理员账号都绑定并验证了手机号：没绑的账号在开关打开后
 * 会被如实拒绝（`AUTH_SECOND_FACTOR_NOT_ENROLLED`），不会退回只验密码。
 * 首位管理员初始化（临时密码 → 受控改密）不走第二步，它本来就不签发登录凭证。
 *
 * 为什么单独成文件：auth.service.ts 已到 800 行线；这里只依赖 Redis、短信验证码与数据库，
 * 由 AuthService 惰性创建，不改它的构造参数（十几个门禁直接 new AuthService）。
 */

export const ADMIN_LOGIN_SECOND_FACTOR_ENV = 'ADMIN_LOGIN_SECOND_FACTOR'
const CHALLENGE_TTL_SECONDS = INTERNAL_OTP_CODE_TTL_SECONDS
const RESEND_COOLDOWN_SECONDS = 60

const logger = new Logger('AdminLoginSecondFactor')
let warnedValue: string | null = null

export function adminSecondFactorRequired(): boolean {
  const raw = process.env[ADMIN_LOGIN_SECOND_FACTOR_ENV]?.trim().toLowerCase() ?? ''
  if (raw === '' || raw === 'off' || raw === 'false' || raw === '0') return false
  if (raw !== 'sms' && warnedValue !== raw) {
    warnedValue = raw
    logger.warn(`${ADMIN_LOGIN_SECOND_FACTOR_ENV}=${JSON.stringify(raw.slice(0, 16))} 不是 off / sms，按 sms 处理（要求短信第二步）`)
  }
  return true
}

/**
 * 管理员入口的「只用短信验证码登录」：打开短信第二步后关闭（它只证明持有手机，是单因素）；
 * 配置了地址名单时同样只许名单内地址。发码与登录两处都调，避免白发短信。
 */
export function assertAdminSmsOnlyLoginAllowed(clientIp: string | null): void {
  assertAdminIpAllowed(clientIp)
  if (!adminSecondFactorRequired()) return
  throw new HttpException({
    error: {
      code: 'AUTH_ADMIN_SMS_LOGIN_REQUIRES_PASSWORD',
      message: '管理员登录需要「账号密码 + 短信验证码」两步，请用账号密码登录',
    },
  }, HttpStatus.FORBIDDEN)
}

/** 第二步的两个入口（验证、重发）：地址名单照查；开关关着时如实告知，不假装能用。 */
export function assertAdminSecondFactorRoute(clientIp: string | null): void {
  assertAdminIpAllowed(clientIp)
  if (adminSecondFactorRequired()) return
  throw new HttpException({
    error: { code: 'AUTH_SECOND_FACTOR_DISABLED', message: '当前未开启短信第二步验证，请直接用账号密码登录' },
  }, HttpStatus.BAD_REQUEST)
}

export interface AdminSecondFactorChallenge {
  secondFactorRequired: true
  challengeTicket: string
  phoneMasked: string
  /** false：60 秒内刚发过验证码（可能是别的用途），这次没有新发；倒计时结束后可调 resend。 */
  codeSent: boolean
  cooldownSeconds: number
  expiresInSeconds: number
}

export interface SecondFactorUser {
  id: string
  role: string
  tokenVersion: number
  passwordHash: string
  phoneEnc: string | null
  phoneVerifiedAt: Date | null
}

interface ChallengeState {
  v: number
  ph: string
  s: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

function challengeInvalid(): UnauthorizedException {
  return new UnauthorizedException({
    error: { code: 'AUTH_SECOND_FACTOR_CHALLENGE_INVALID', message: '第二步验证已过期或无效，请重新输入账号密码' },
  })
}

function notEnrolled(): ForbiddenException {
  return new ForbiddenException({
    error: {
      code: 'AUTH_SECOND_FACTOR_NOT_ENROLLED',
      message: '该管理员账号还没有绑定并验证手机号，无法完成短信第二步验证；请联系系统维护人员处理',
    },
  })
}

function isTooFrequent(error: unknown): boolean {
  if (!(error instanceof HttpException) || error.getStatus() !== HttpStatus.TOO_MANY_REQUESTS) return false
  const body = error.getResponse() as { error?: { code?: string } } | string
  return typeof body === 'object' && body?.error?.code === 'SMS_TOO_FREQUENT'
}

export class AdminLoginSecondFactor {
  constructor(
    private readonly redis: RedisService,
    private readonly otp: InternalOtpService,
    private readonly prisma: PrismaService,
  ) {}

  /** 密码已通过：签发第二步凭证并发验证码。 */
  async start(user: SecondFactorUser, ip: string, deviceId?: string): Promise<AdminSecondFactorChallenge> {
    if (!user.phoneEnc || !user.phoneVerifiedAt) throw notEnrolled()
    const phone = decryptPhone(user.phoneEnc)
    const secret = randomBytes(32).toString('base64url')
    const state: ChallengeState = { v: user.tokenVersion, ph: sha256(user.passwordHash), s: sha256(secret) }
    // 覆盖写：同一账号只认最新一张凭证，旧凭证随之作废。
    await this.redis.setEx(this.key(user.id), CHALLENGE_TTL_SECONDS, JSON.stringify(state))
    const codeSent = await this.sendCode(user.id, phone, ip, deviceId)
    return {
      secondFactorRequired: true,
      challengeTicket: `${user.id}.${secret}`,
      phoneMasked: maskPhone(phone),
      codeSent,
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
    }
  }

  /** 重新发送验证码：凭证必须仍然有效。 */
  async resend(ticket: string, ip: string, deviceId?: string): Promise<{ codeSent: boolean; cooldownSeconds: number }> {
    const { user } = await this.load(ticket)
    const codeSent = await this.sendCode(user.id, decryptPhone(user.phoneEnc!), ip, deviceId)
    return { codeSent, cooldownSeconds: RESEND_COOLDOWN_SECONDS }
  }

  /**
   * 校验验证码并**消费**凭证，返回可签发登录凭证的账号 id。
   * 验证码错误时凭证保留（错码次数由短信验证码自己的 5 次上限管），不必重输密码。
   */
  async verify(ticket: string, code: string): Promise<string> {
    const { user, raw } = await this.load(ticket)
    await this.otp.verifyCode(decryptPhone(user.phoneEnc!), 'admin_login_2fa', code)
    const consumed = await this.redis.getAndDelIfEquals(this.key(user.id), raw)
    if (consumed !== 'matched') throw challengeInvalid()
    return user.id
  }

  private async load(ticket: string): Promise<{ user: SecondFactorUser & { phoneEnc: string }; raw: string }> {
    const separator = ticket.indexOf('.')
    if (separator <= 0 || separator === ticket.length - 1) throw challengeInvalid()
    const userId = ticket.slice(0, separator)
    const secret = ticket.slice(separator + 1)
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw challengeInvalid()

    const raw = await this.redis.get(this.key(userId))
    if (!raw) throw challengeInvalid()
    let state: ChallengeState
    try {
      state = JSON.parse(raw) as ChallengeState
    } catch {
      throw challengeInvalid()
    }
    if (typeof state?.s !== 'string' || !sameHex(state.s, sha256(secret))) throw challengeInvalid()

    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    // 发出第二步之后改过密码、被重置或被撤销会话（tokenVersion 变了），这张凭证作废。
    if (
      !user || user.role !== 'admin' || !user.enabled
      || user.tokenVersion !== state.v || !sameHex(state.ph, sha256(user.passwordHash))
    ) {
      await this.redis.del(this.key(userId)).catch(() => undefined)
      throw challengeInvalid()
    }
    if (!user.phoneEnc || !user.phoneVerifiedAt) throw notEnrolled()
    return { user: { ...user, phoneEnc: user.phoneEnc }, raw }
  }

  private async sendCode(userId: string, phone: string, ip: string, deviceId?: string): Promise<boolean> {
    try {
      await this.otp.sendCode({ phone, purpose: 'admin_login_2fa', ip, deviceId, shouldDeliver: true })
      return true
    } catch (error) {
      // 同一号码 60 秒内刚发过（可能是别的用途）：凭证照发，让前端倒计时后点「重新发送」。
      if (isTooFrequent(error)) return false
      await this.redis.del(this.key(userId)).catch(() => undefined)
      throw error
    }
  }

  private key(userId: string): string {
    return `internal:admin-login-2fa:challenge:${userId}`
  }
}
