import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { createHash, randomInt, randomUUID } from 'crypto'
import { AuditService } from '../audit/audit.service'
import {
  decryptPhone,
  encryptPhone,
  hashPhone,
  isValidCnMobile,
  maskPhone,
  maskPhoneFromEnc,
  normalizePhone,
} from '../common/crypto/phone-identity'
import type { UserRole } from '../common/decorators/roles.decorator'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import type { SendInternalSmsCodeDto } from './dto/internal-auth.dto'
import { InternalOtpService, type InternalSendCodeResult } from './internal-otp.service'

type LoginPortal = 'admin' | 'partner' | 'kiosk'
type SmsPortal = 'admin' | 'partner'

const RESET_TICKET_TTL = 600
const RESET_UNKNOWN_IP_TTL = 60
const RESET_UNKNOWN_IP_LIMIT = 5

export interface LoginResult {
  token: string
  user: {
    id:          string
    name:        string
    role:        UserRole
    orgId:       string | null
    phoneMasked?: string
    phoneVerifiedAt?: string | null
  }
}

interface InternalUser {
  id: string
  username: string
  passwordHash: string
  name: string
  role: string
  orgId: string | null
  enabled: boolean
  phoneHash: string | null
  phoneEnc: string | null
  phoneVerifiedAt: Date | null
  tokenVersion: number
}

interface ResetTarget {
  user: InternalUser
  phone: string
}

/**
 * 内部运营账号认证。
 *
 * C 端 EndUser 会员域与内部 User 账号域保持隔离:
 * - 这里不 upsert EndUser,也不允许手机号验证码自动建 User。
 * - 手机号只作为已授权内部账号的登录别名、验证码登录和找回密码凭据。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly otp: InternalOtpService,
    private readonly audit: AuditService,
  ) {}

  async login(loginId: string, password: string, portal: LoginPortal): Promise<LoginResult> {
    const user = await this.findUserByLoginId(loginId)
    if (!user || !(await this.canUseAccount(user, portal))) {
      throw this.loginFailed()
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      throw this.loginFailed()
    }

    await this.writeAudit(user.id, user.role, 'auth.password_login', { portal })
    return this.issueLogin(user)
  }

  async sendSmsCode(dto: SendInternalSmsCodeDto, ip: string): Promise<InternalSendCodeResult> {
    if (dto.purpose !== 'login' || !dto.portal) {
      throw new BadRequestException({
        error: { code: 'AUTH_SMS_PURPOSE_FORBIDDEN', message: '该验证码入口仅用于内部账号登录' },
      })
    }

    const user = await this.findVerifiedUserByPhone(dto.phone)
    const shouldDeliver = !!user && (await this.canUseAccount(user, dto.portal))
    const result = await this.otp.sendCode({
      phone: normalizePhone(dto.phone),
      purpose: dto.purpose,
      ip,
      deviceId: dto.deviceId,
      shouldDeliver,
    })
    await this.writeAudit(user?.id ?? null, user?.role ?? 'system', 'auth.sms_code_send', {
      purpose: dto.purpose,
      portal: dto.portal ?? null,
      phoneMasked: maskPhone(dto.phone),
    })
    return result
  }

  async loginWithSms(phone: string, code: string, portal: SmsPortal): Promise<LoginResult> {
    await this.otp.verifyCode(phone, 'login', code)
    const user = await this.findVerifiedUserByPhone(phone)
    if (!user || !(await this.canUseAccount(user, portal))) {
      throw this.loginFailed()
    }
    await this.writeAudit(user.id, user.role, 'auth.sms_login', { portal, phoneMasked: maskPhone(phone) })
    return this.issueLogin(user)
  }

  async startPasswordReset(loginIdOrPhone: string, ip: string): Promise<InternalSendCodeResult> {
    await this.throttleResetIp(ip)
    await this.enforceResetIdentityCooldown(loginIdOrPhone)
    const target = await this.resolveResetTarget(loginIdOrPhone)
    if (!target) {
      const phone = this.normalizedPhoneOrNull(loginIdOrPhone)
      let result: InternalSendCodeResult
      if (!phone) {
        await this.simulateResetLatency()
        result = this.genericSendResult()
      } else {
        result = await this.sendResetCodeOrGeneric(phone, ip, false)
      }
      await this.writeAudit(null, 'system', 'auth.password_reset_unknown', {
        identityMasked: this.maskLoginIdentity(loginIdOrPhone),
      })
      return result
    }

    const shouldDeliver = await this.canUseAccount(target.user)
    const result = await this.sendResetCodeOrGeneric(target.phone, ip, shouldDeliver)
    await this.writeAudit(target.user.id, target.user.role, 'auth.password_reset_start', {
      phoneMasked: maskPhone(target.phone),
    })
    return result
  }

  async verifyPasswordReset(loginIdOrPhone: string, code: string): Promise<{ resetTicket: string; expiresInSeconds: number }> {
    const target = await this.resolveResetTarget(loginIdOrPhone)
    if (!target || !(await this.canUseAccount(target.user))) {
      throw this.resetFailed()
    }

    try {
      await this.otp.verifyCode(target.phone, 'reset_password', code)
    } catch {
      throw this.resetFailed()
    }
    const resetTicket = randomUUID()
    await this.redis.setEx(this.resetTicketKey(resetTicket), RESET_TICKET_TTL, target.user.id)
    return { resetTicket, expiresInSeconds: RESET_TICKET_TTL }
  }

  async completePasswordReset(resetTicket: string, newPassword: string): Promise<{ success: true }> {
    const userId = await this.redis.getDel(this.resetTicketKey(resetTicket))
    if (!userId) {
      throw this.resetFailed()
    }
    const passwordHash = await bcrypt.hash(newPassword, 10)
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    })
    await this.invalidateSessionState(user.id)
    await this.writeAudit(user.id, user.role, 'auth.password_reset_complete', {})
    return { success: true }
  }

  /**
   * 登录态下自助改密:须校验当前密码,成功后旧 token 立即失效(与找回密码一致)。
   *
   * - 按 userId 独立限流当前密码尝试次数(IP 限流对已持有 token 的场景不够,见 changePasswordFailKey)。
   * - 新密码不得与当前密码相同(仅前端校验不构成安全边界)。
   * - 用 updateMany + 旧 passwordHash 做乐观并发控制:防止两个并发请求都读到同一旧 hash
   *   校验通过后各自无条件覆盖,造成"两边都返回成功但只有一边真正生效"的静默丢失更新。
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ success: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new UnauthorizedException({ error: { code: 'AUTH_SESSION_INVALID', message: '登录状态已失效' } })
    }

    await this.assertChangePasswordNotRateLimited(user.id)

    const ok = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!ok) {
      await this.recordChangePasswordFailure(user.id)
      throw new BadRequestException({ error: { code: 'AUTH_PASSWORD_MISMATCH', message: '当前密码不正确' } })
    }

    const unchanged = await bcrypt.compare(newPassword, user.passwordHash)
    if (unchanged) {
      throw new BadRequestException({ error: { code: 'AUTH_PASSWORD_UNCHANGED', message: '新密码不能与当前密码相同' } })
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)
    const updated = await this.prisma.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    })
    if (updated.count !== 1) {
      throw new HttpException({
        error: { code: 'AUTH_CHANGE_PASSWORD_CONFLICT', message: '密码刚被其他会话修改，请重新登录后再试' },
      }, HttpStatus.CONFLICT)
    }

    await this.invalidateSessionState(user.id)
    await this.writeAudit(user.id, user.role, 'auth.password_change_self', {})
    return { success: true }
  }

  private changePasswordFailKey(userId: string): string {
    return `internal:password-change:fail:${userId}`
  }

  private async assertChangePasswordNotRateLimited(userId: string): Promise<void> {
    const raw = await this.redis.get(this.changePasswordFailKey(userId))
    if (Number(raw ?? '0') >= 5) {
      throw new HttpException({
        error: { code: 'AUTH_CHANGE_PASSWORD_RATE_LIMITED', message: '当前密码验证失败次数过多，请 5 分钟后再试' },
      }, HttpStatus.TOO_MANY_REQUESTS)
    }
  }

  private async recordChangePasswordFailure(userId: string): Promise<void> {
    await this.redis.incrWithTtl(this.changePasswordFailKey(userId), 300)
  }

  async sendPhoneBindCode(phone: string, ip: string, deviceId?: string): Promise<InternalSendCodeResult> {
    return this.otp.sendCode({
      phone: normalizePhone(phone),
      purpose: 'bind_phone',
      ip,
      deviceId,
      shouldDeliver: true,
    })
  }

  async sendOwnPhoneBindCode(
    userId: string,
    ip: string,
    deviceId?: string,
  ): Promise<InternalSendCodeResult> {
    const user = await this.findUsableSelfPhoneUser(userId)
    if (!user.phoneEnc) {
      throw new BadRequestException({ error: { code: 'PHONE_NOT_BOUND', message: '当前账号未绑定登录手机号' } })
    }
    const phone = decryptPhone(user.phoneEnc)
    const result = await this.sendPhoneBindCode(phone, ip, deviceId)
    await this.writeAudit(user.id, user.role, 'auth.phone_bind_code', { phoneMasked: maskPhone(phone) })
    return result
  }

  async verifyAndBindPhone(userId: string, phone: string, code: string): Promise<{ phoneMasked: string; phoneVerifiedAt: Date }> {
    await this.otp.verifyCode(phone, 'bind_phone', code)
    const normalized = normalizePhone(phone)
    const phoneHash = hashPhone(normalized)
    const exists = await this.prisma.user.findFirst({ where: { phoneHash, NOT: { id: userId } } })
    if (exists) {
      throw new BadRequestException({ error: { code: 'PHONE_ALREADY_BOUND', message: '该手机号已绑定其他账号' } })
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneHash,
        phoneEnc: encryptPhone(normalized),
        phoneVerifiedAt: new Date(),
      },
    })
    return { phoneMasked: maskPhone(normalized), phoneVerifiedAt: updated.phoneVerifiedAt! }
  }

  async verifyOwnPhoneBindCode(
    userId: string,
    code: string,
  ): Promise<{ phoneMasked: string; phoneVerifiedAt: string }> {
    const user = await this.findUsableSelfPhoneUser(userId)
    if (!user.phoneEnc) {
      throw new BadRequestException({ error: { code: 'PHONE_NOT_BOUND', message: '当前账号未绑定登录手机号' } })
    }
    const phone = decryptPhone(user.phoneEnc)
    const result = await this.verifyAndBindPhone(user.id, phone, code)
    await this.writeAudit(user.id, user.role, 'auth.phone_bind_verify', { phoneMasked: result.phoneMasked })
    return { phoneMasked: result.phoneMasked, phoneVerifiedAt: result.phoneVerifiedAt.toISOString() }
  }

  private async findUserByLoginId(loginId: string): Promise<InternalUser | null> {
    const phone = this.normalizedPhoneOrNull(loginId)
    if (phone) {
      const phoneHash = hashPhone(phone)
      const user = await this.prisma.user.findUnique({ where: { phoneHash } })
      return user?.phoneVerifiedAt ? user : null
    }
    return this.prisma.user.findUnique({ where: { username: loginId.trim() } })
  }

  private async findVerifiedUserByPhone(phone: string): Promise<InternalUser | null> {
    const phoneHash = hashPhone(phone)
    const user = await this.prisma.user.findUnique({ where: { phoneHash } })
    return user?.phoneVerifiedAt ? user : null
  }

  private async resolveResetTarget(loginIdOrPhone: string): Promise<ResetTarget | null> {
    const phone = this.normalizedPhoneOrNull(loginIdOrPhone)
    if (phone) {
      const user = await this.findVerifiedUserByPhone(phone)
      return user ? { user, phone } : null
    }

    const user = await this.prisma.user.findUnique({ where: { username: loginIdOrPhone.trim() } })
    if (!user?.phoneEnc || !user.phoneVerifiedAt) return null
    return { user, phone: decryptPhone(user.phoneEnc) }
  }

  private async findUsableSelfPhoneUser(userId: string): Promise<InternalUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new UnauthorizedException({ error: { code: 'AUTH_SESSION_INVALID', message: '登录状态已失效' } })
    }
    const role = user.role as UserRole
    if (role !== 'admin' && role !== 'partner') {
      throw new BadRequestException({ error: { code: 'AUTH_PHONE_BIND_FORBIDDEN', message: '当前账号类型不支持手机号验证' } })
    }
    if (!(await this.canUseAccount(user, role))) {
      throw new UnauthorizedException({ error: { code: 'AUTH_SESSION_INVALID', message: '登录状态已失效' } })
    }
    return user
  }

  private async canUseAccount(user: InternalUser, portal?: LoginPortal): Promise<boolean> {
    const role = user.role as UserRole
    if (!user.enabled) return false
    if (role !== 'admin' && role !== 'partner' && role !== 'kiosk') return false
    if (portal && role !== portal) return false
    if (role === 'partner') {
      if (!user.orgId) return false
      const org = await this.prisma.organization.findUnique({ where: { id: user.orgId }, select: { enabled: true } })
      if (!org?.enabled) return false
    }
    return true
  }

  private async issueLogin(user: InternalUser): Promise<LoginResult> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })
    const role = updated.role as UserRole
    const token = this.jwtService.sign({
      sub: updated.id,
      role,
      orgId: updated.orgId,
      ver: updated.tokenVersion,
    })

    return {
      token,
      user: {
        id: updated.id,
        name: updated.name,
        role,
        orgId: updated.orgId,
        ...(updated.phoneEnc ? { phoneMasked: maskPhoneFromEnc(updated.phoneEnc) } : {}),
        phoneVerifiedAt: updated.phoneVerifiedAt?.toISOString() ?? null,
      },
    }
  }

  private normalizedPhoneOrNull(value: string): string | null {
    const normalized = normalizePhone(value.trim())
    return isValidCnMobile(normalized) ? normalized : null
  }

  private maskLoginIdentity(value: string): string {
    const phone = this.normalizedPhoneOrNull(value)
    if (phone) return maskPhone(phone)
    const trimmed = value.trim()
    if (trimmed.length <= 2) return '*'.repeat(trimmed.length || 1)
    return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`
  }

  private genericSendResult(): InternalSendCodeResult {
    return { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 }
  }

  private async sendResetCodeOrGeneric(
    phone: string,
    ip: string,
    shouldDeliver: boolean,
  ): Promise<InternalSendCodeResult> {
    try {
      return await this.otp.sendCode({ phone, purpose: 'reset_password', ip, shouldDeliver })
    } catch {
      await this.simulateResetLatency()
      return this.genericSendResult()
    }
  }

  private resetTicketKey(ticket: string): string {
    return `internal:password-reset:ticket:${ticket}`
  }

  private async throttleResetIp(ip: string): Promise<void> {
    const count = await this.redis.incrWithTtl(`internal:password-reset:ip:${ip}`, RESET_UNKNOWN_IP_TTL)
    if (count > RESET_UNKNOWN_IP_LIMIT) {
      throw new HttpException({
        error: { code: 'AUTH_RESET_RATE_LIMITED', message: '操作过于频繁,请稍后再试' },
      }, HttpStatus.TOO_MANY_REQUESTS)
    }
  }

  private async enforceResetIdentityCooldown(identity: string): Promise<void> {
    const key = `internal:password-reset:identity-cooldown:${this.hashResetIdentity(identity)}`
    const fresh = await this.redis.setNxEx(key, '1', 60)
    if (!fresh) {
      throw new HttpException({
        error: { code: 'SMS_TOO_FREQUENT', message: '验证码发送过于频繁,请 60 秒后再试' },
      }, HttpStatus.TOO_MANY_REQUESTS)
    }
  }

  private hashResetIdentity(identity: string): string {
    return createHash('sha256').update(identity.trim().toLowerCase()).digest('hex')
  }

  private async simulateResetLatency(): Promise<void> {
    const delayMs = randomInt(220, 481)
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  }

  private sessionStateKey(userId: string): string {
    return `internal:session-state:${userId}`
  }

  private async invalidateSessionState(userId: string): Promise<void> {
    await this.redis.del(this.sessionStateKey(userId))
  }

  private async writeAudit(
    actorId: string | null,
    actorRole: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.write({
      actorId,
      actorRole,
      action,
      targetType: 'auth',
      targetId: actorId,
      payload,
    })
  }

  private loginFailed(): UnauthorizedException {
    return new UnauthorizedException({
      error: { code: 'AUTH_LOGIN_FAILED', message: '账号或密码不正确' },
    })
  }

  private resetFailed(): UnauthorizedException {
    return new UnauthorizedException({
      error: { code: 'AUTH_RESET_FAILED', message: '验证码已过期或重置请求无效' },
    })
  }
}
