import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { AuditService } from '../audit/audit.service'
import {
  decryptPhone,
  encryptPhone,
  hashPhone,
  isValidCnMobile,
  maskPhone,
  normalizePhone,
} from '../common/crypto/phone-identity'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService } from './auth.service'
import { InternalOtpService } from './internal-otp.service'

const INITIAL_PHONE_BIND_TICKET_TTL = 600
const CURRENT_PASSWORD_FAILURE_TTL = 300
const CURRENT_PASSWORD_FAILURE_LIMIT = 5

/**
 * 为已登录、尚未绑定手机号的内部账号提供一次性首次绑定状态机。
 *
 * ticket 以 userId 分区并只保存加密后的手机号；验证码、密码、ticket 和手机号
 * 明文都不写审计。完成步骤先原子消费 ticket，因此验证码错误后也必须重新开始。
 */
@Injectable()
export class InitialPhoneBindService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly otp: InternalOtpService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
  ) {}

  async start(
    userId: string,
    currentPassword: string,
    candidatePhone: string,
    ip: string,
    deviceId?: string,
  ): Promise<{ bindTicket: string; cooldownSeconds: number; expiresInSeconds: number }> {
    const user = await this.authService.findUsableSelfPhoneUser(userId)
    if (user.phoneEnc) throw this.selfPhoneAlreadyBound()

    await this.reserveCurrentPasswordAttempt(user.id)
    let currentPasswordMatches: boolean
    try {
      currentPasswordMatches = await bcrypt.compare(currentPassword, user.passwordHash)
    } catch (error) {
      await this.releaseCurrentPasswordAttempt(user.id)
      throw error
    }
    if (!currentPasswordMatches) throw this.currentPasswordMismatch()
    await this.releaseCurrentPasswordAttempt(user.id)

    const phone = normalizePhone(candidatePhone)
    if (!isValidCnMobile(phone)) {
      throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '必须是有效的中国大陆手机号' } })
    }
    const phoneHash = hashPhone(phone)
    await this.assertPhoneAvailable(phoneHash, user.id)

    const result = await this.otp.sendCode({
      phone,
      purpose: 'bind_phone',
      ip,
      deviceId,
      shouldDeliver: true,
    })
    const bindTicket = randomUUID()
    await this.redis.setEx(this.ticketKey(user.id, bindTicket), INITIAL_PHONE_BIND_TICKET_TTL, encryptPhone(phone))
    await this.writeAudit(user.id, user.role, 'auth.phone_initial_bind_start', maskPhone(phone))
    return { bindTicket, ...result }
  }

  async verify(
    userId: string,
    bindTicket: string,
    code: string,
  ): Promise<{ phoneMasked: string; phoneVerifiedAt: string }> {
    const encryptedPhone = await this.redis.getDel(this.ticketKey(userId, bindTicket))
    if (!encryptedPhone) throw this.ticketInvalid()

    const user = await this.authService.findUsableSelfPhoneUser(userId)
    const phone = this.decryptTicketPhone(encryptedPhone)
    await this.otp.verifyCode(phone, 'bind_phone', code)

    const phoneHash = hashPhone(phone)
    await this.assertPhoneAvailable(phoneHash, user.id)
    const phoneEnc = encryptPhone(phone)
    let updated: { count: number }
    try {
      updated = await this.prisma.user.updateMany({
        where: { id: user.id, enabled: true, deletedAt: null, phoneEnc: null },
        data: { phoneHash, phoneEnc, phoneVerifiedAt: new Date() },
      })
    } catch (error) {
      if (this.isPhoneHashUniqueConflict(error)) throw this.phoneAlreadyBound()
      throw error
    }
    if (updated.count !== 1) throw this.phoneBindConflict()

    const phoneMasked = maskPhone(phone)
    const phoneVerifiedAt = new Date().toISOString()
    await this.writeAudit(user.id, user.role, 'auth.phone_initial_bind_complete', phoneMasked)
    return { phoneMasked, phoneVerifiedAt }
  }

  private async assertPhoneAvailable(phoneHash: string, userId: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({ where: { phoneHash, deletedAt: null } })
    if (existing && existing.id !== userId) throw this.phoneAlreadyBound()
  }

  private decryptTicketPhone(encryptedPhone: string): string {
    try {
      const phone = decryptPhone(encryptedPhone)
      if (!isValidCnMobile(phone)) throw new Error('invalid ticket phone')
      return phone
    } catch {
      throw this.ticketInvalid()
    }
  }

  private ticketKey(userId: string, bindTicket: string): string {
    return `internal:phone-initial-bind:ticket:${userId}:${bindTicket}`
  }

  private currentPasswordFailureKey(userId: string): string {
    return `internal:phone-initial-bind:password-fail:${userId}`
  }

  private async reserveCurrentPasswordAttempt(userId: string): Promise<void> {
    const reserved = await this.redis.reserveWithinLimitWithTtl(
      this.currentPasswordFailureKey(userId),
      CURRENT_PASSWORD_FAILURE_TTL,
      CURRENT_PASSWORD_FAILURE_LIMIT,
    )
    if (!reserved) {
      throw new HttpException(
        { error: { code: 'AUTH_PHONE_BIND_PASSWORD_RATE_LIMITED', message: '当前密码验证失败次数过多，请 5 分钟后再试' } },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  private async releaseCurrentPasswordAttempt(userId: string): Promise<void> {
    await this.redis.releaseReservedLimit(this.currentPasswordFailureKey(userId))
  }

  private async writeAudit(userId: string, role: string, action: string, phoneMasked: string): Promise<void> {
    await this.audit.write({
      actorId: userId,
      actorRole: role,
      action,
      targetType: 'auth',
      targetId: userId,
      payload: { phoneMasked },
    })
  }

  private isPhoneHashUniqueConflict(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
  }

  private phoneAlreadyBound(): BadRequestException {
    return new BadRequestException({ error: { code: 'PHONE_ALREADY_BOUND', message: '该手机号已绑定其他账号' } })
  }

  private selfPhoneAlreadyBound(): BadRequestException {
    return new BadRequestException({
      error: { code: 'PHONE_SELF_ALREADY_BOUND', message: '当前账号已绑定手机号，请刷新页面确认状态' },
    })
  }

  private ticketInvalid(): BadRequestException {
    return new BadRequestException({ error: { code: 'PHONE_BIND_TICKET_INVALID', message: '绑定请求已失效，请重新获取验证码' } })
  }

  private currentPasswordMismatch(): BadRequestException {
    return new BadRequestException({ error: { code: 'AUTH_PASSWORD_MISMATCH', message: '当前密码不正确' } })
  }

  private phoneBindConflict(): HttpException {
    return new HttpException(
      { error: { code: 'PHONE_BIND_CONFLICT', message: '账号手机号状态已变化，请重新登录后再试' } },
      HttpStatus.CONFLICT,
    )
  }
}
