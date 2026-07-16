import { BadRequestException, HttpException, Injectable } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { AuditService } from '../audit/audit.service'
import { decryptPhone, encryptPhone, hashPhone, isValidCnMobile, maskPhone, normalizePhone } from '../common/crypto/phone-identity'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { INTERNAL_OTP_CODE_TTL_SECONDS, InternalOtpService } from './internal-otp.service'

const CURRENT_PASSWORD_FAILURE_LIMIT = 5
const CURRENT_PASSWORD_FAILURE_TTL_SECONDS = INTERNAL_OTP_CODE_TTL_SECONDS
const VERIFY_LOCK_TTL_SECONDS = 30
const ACTIONABLE_SMS_FAILURE_CODES = new Set([
  'SMS_TOO_FREQUENT',
  'SMS_DAILY_LIMIT',
  'SMS_IP_LIMIT',
  'SMS_DEVICE_LIMIT',
  'SMS_PROVIDER_PHONE_DAILY_LIMIT',
  'SMS_PROVIDER_RATE_LIMIT',
])

type AdminInitialPhoneBindTicket = {
  userId: string
  encryptedPhone: string
  phoneHash: string
  tokenVersion: number
}

@Injectable()
export class AdminInitialPhoneBindService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly otp: InternalOtpService,
    private readonly audit: AuditService,
  ) {}

  async start(
    userId: string,
    currentPassword: string,
    candidatePhone: string,
    ip: string,
    deviceId?: string,
  ): Promise<{ bindTicket: string; cooldownSeconds: number; expiresInSeconds: number }> {
    const user = await this.getEligibleAdmin(userId)
    await this.reserveCurrentPasswordAttempt(user.id)

    let currentPasswordMatches: boolean
    try {
      currentPasswordMatches = await bcrypt.compare(currentPassword, user.passwordHash)
    } catch {
      await this.releaseCurrentPasswordAttempt(user.id)
      throw this.unavailable()
    }
    if (!currentPasswordMatches) throw this.unavailable()
    await this.releaseCurrentPasswordAttempt(user.id)

    const phone = normalizePhone(candidatePhone)
    if (!isValidCnMobile(phone)) throw this.unavailable()
    const phoneHash = hashPhone(phone)
    const phoneOwner = await this.prisma.user.findFirst({ where: { phoneHash, deletedAt: null } })
    if (phoneOwner) throw this.unavailable()

    const bindTicket = randomUUID()
    let activeTicketCreated = false
    try {
      activeTicketCreated = await this.redis.setNxEx(
        this.activeTicketKey(user.id),
        bindTicket,
        INTERNAL_OTP_CODE_TTL_SECONDS,
      )
      if (!activeTicketCreated) throw this.unavailable()

      const encryptedPhone = encryptPhone(phone)
      const ticket: AdminInitialPhoneBindTicket = {
        userId: user.id,
        encryptedPhone,
        phoneHash,
        tokenVersion: user.tokenVersion,
      }
      await this.redis.setEx(
        this.ticketKey(user.id, bindTicket),
        INTERNAL_OTP_CODE_TTL_SECONDS,
        JSON.stringify(ticket),
      )
      const result = await this.otp.sendCode({
        phone,
        purpose: 'bind_phone',
        ip,
        deviceId,
        shouldDeliver: true,
      })
      await this.writeAudit(user.id, 'auth.phone_initial_bind_start', maskPhone(phone)).catch(() => undefined)
      return {
        bindTicket,
        cooldownSeconds: result.cooldownSeconds,
        expiresInSeconds: INTERNAL_OTP_CODE_TTL_SECONDS,
      }
    } catch (error) {
      if (activeTicketCreated) await this.cleanupTicket(user.id, bindTicket)
      if (this.isActionableSmsFailure(error)) throw error
      throw this.unavailable()
    }
  }

  async verify(
    userId: string,
    bindTicket: string,
    code: string,
  ): Promise<{ phoneMasked: string; phoneVerifiedAt: string }> {
    const serializedTicket = await this.redis.get(this.ticketKey(userId, bindTicket))
    if (!serializedTicket) throw this.unavailable()

    let ticket: AdminInitialPhoneBindTicket
    let phone: string
    try {
      ticket = this.parseTicket(serializedTicket, userId)
      const user = await this.getEligibleAdmin(userId)
      if (user.tokenVersion !== ticket.tokenVersion) throw new Error('stale ticket')
      phone = this.decryptTicketPhone(ticket)
    } catch {
      await this.cleanupTicket(userId, bindTicket)
      throw this.unavailable()
    }

    const verifyLockValue = randomUUID()
    const verifyLockKey = this.verifyLockKey(userId, bindTicket)
    let verifyLockAcquired: boolean
    try {
      verifyLockAcquired = await this.redis.setNxEx(verifyLockKey, verifyLockValue, VERIFY_LOCK_TTL_SECONDS)
    } catch {
      throw this.unavailable()
    }
    if (!verifyLockAcquired) throw this.unavailable()

    try {
      try {
        await this.otp.verifyCode(phone, 'bind_phone', code)
      } catch (error) {
        if (this.isRetryableOtpInvalid(error)) throw this.invalidOtpCode()
        await this.cleanupTicket(userId, bindTicket)
        throw this.unavailable()
      }

      const ticketStatus = await this.redis.getAndDelIfEquals(this.ticketKey(userId, bindTicket), serializedTicket)
      if (ticketStatus !== 'matched') throw this.unavailable()

      const activeTicketStatus = await this.redis.getAndDelIfEquals(this.activeTicketKey(userId), bindTicket)
      if (activeTicketStatus !== 'matched') throw this.unavailable()

      const phoneVerifiedAt = new Date()
      const phoneMasked = maskPhone(phone)
      try {
        await this.prisma.$transaction(async (tx: PrismaTransactionClient) => {
          const updated = await tx.user.updateMany({
            where: {
              id: userId,
              role: 'admin',
              enabled: true,
              deletedAt: null,
              phoneHash: null,
              phoneEnc: null,
              phoneVerifiedAt: null,
              tokenVersion: ticket.tokenVersion,
            },
            data: {
              phoneHash: ticket.phoneHash,
              phoneEnc: ticket.encryptedPhone,
              phoneVerifiedAt,
            },
          })
          if (updated.count !== 1) throw this.unavailable()

          await tx.auditLog.create({
            data: {
              actorId: userId,
              actorRole: 'admin',
              action: 'auth.phone_initial_bind_complete',
              targetType: 'auth',
              targetId: userId,
              payloadJson: JSON.stringify({ phoneMasked }),
            },
          })
        })
      } catch {
        throw this.unavailable()
      }
      return { phoneMasked, phoneVerifiedAt: phoneVerifiedAt.toISOString() }
    } finally {
      await this.redis.getAndDelIfEquals(verifyLockKey, verifyLockValue).catch(() => undefined)
    }
  }

  /** 仅取消当前登录 Admin 自己的未验证尝试；已消费或过期的 ticket 统一视为已取消。 */
  async cancel(userId: string, bindTicket: string): Promise<{ cancelled: true }> {
    try {
      const activeTicketStatus = await this.redis.getAndDelIfEquals(this.activeTicketKey(userId), bindTicket)
      if (activeTicketStatus === 'matched') {
        await this.redis.del(this.ticketKey(userId, bindTicket)).catch(() => undefined)
        await this.writeCancellationAudit(userId).catch(() => undefined)
      }
      return { cancelled: true }
    } catch {
      throw this.unavailable()
    }
  }

  private async getEligibleAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (
      !user ||
      user.role !== 'admin' ||
      !user.enabled ||
      user.deletedAt !== null ||
      user.phoneHash !== null ||
      user.phoneEnc !== null ||
      user.phoneVerifiedAt !== null
    ) {
      throw this.unavailable()
    }
    return user
  }

  private parseTicket(serializedTicket: string, expectedUserId: string): AdminInitialPhoneBindTicket {
    try {
      const value: unknown = JSON.parse(serializedTicket)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid ticket')

      const ticket = value as Record<string, unknown>
      const ticketKeys = Object.keys(ticket).sort()
      const expectedKeys = ['encryptedPhone', 'phoneHash', 'tokenVersion', 'userId']
      if (
        JSON.stringify(ticketKeys) !== JSON.stringify(expectedKeys) ||
        ticket.userId !== expectedUserId ||
        typeof ticket.encryptedPhone !== 'string' ||
        !ticket.encryptedPhone ||
        typeof ticket.phoneHash !== 'string' ||
        !ticket.phoneHash ||
        typeof ticket.tokenVersion !== 'number' ||
        !Number.isSafeInteger(ticket.tokenVersion) ||
        ticket.tokenVersion < 0
      ) {
        throw new Error('invalid ticket')
      }
      return {
        userId: ticket.userId,
        encryptedPhone: ticket.encryptedPhone,
        phoneHash: ticket.phoneHash,
        tokenVersion: ticket.tokenVersion,
      }
    } catch {
      throw this.unavailable()
    }
  }

  private decryptTicketPhone(ticket: AdminInitialPhoneBindTicket): string {
    try {
      const phone = decryptPhone(ticket.encryptedPhone)
      if (!isValidCnMobile(phone) || hashPhone(phone) !== ticket.phoneHash) throw new Error('invalid ticket phone')
      return phone
    } catch {
      throw this.unavailable()
    }
  }

  private async reserveCurrentPasswordAttempt(userId: string): Promise<void> {
    const reserved = await this.redis.reserveWithinLimitWithTtl(
      this.currentPasswordFailureKey(userId),
      CURRENT_PASSWORD_FAILURE_TTL_SECONDS,
      CURRENT_PASSWORD_FAILURE_LIMIT,
    )
    if (!reserved) throw this.unavailable()
  }

  private releaseCurrentPasswordAttempt(userId: string): Promise<void> {
    return this.redis.releaseReservedLimit(this.currentPasswordFailureKey(userId))
  }

  private async cleanupTicket(userId: string, bindTicket: string): Promise<void> {
    await this.redis.del(this.ticketKey(userId, bindTicket)).catch(() => undefined)
    await this.redis.getAndDelIfEquals(this.activeTicketKey(userId), bindTicket).catch(() => undefined)
  }

  private async writeAudit(userId: string, action: 'auth.phone_initial_bind_start', phoneMasked: string): Promise<void> {
    await this.audit.write({
      actorId: userId,
      actorRole: 'admin',
      action,
      targetType: 'auth',
      targetId: userId,
      payload: { phoneMasked },
    })
  }

  /** 取消记录刻意不带手机号、ticket 或任何可重放凭据。 */
  private async writeCancellationAudit(userId: string): Promise<void> {
    await this.audit.write({
      actorId: userId,
      actorRole: 'admin',
      action: 'auth.phone_initial_bind_cancel',
      targetType: 'auth',
      targetId: userId,
      payload: {},
    })
  }

  private ticketKey(userId: string, bindTicket: string): string {
    return `internal:admin:phone-initial-bind:ticket:${userId}:${bindTicket}`
  }

  private activeTicketKey(userId: string): string {
    return `internal:admin:phone-initial-bind:active:${userId}`
  }

  private verifyLockKey(userId: string, bindTicket: string): string {
    return `internal:admin:phone-initial-bind:verify-lock:${userId}:${bindTicket}`
  }

  private currentPasswordFailureKey(userId: string): string {
    return `internal:admin:phone-initial-bind:password-fail:${userId}`
  }

  private isActionableSmsFailure(error: unknown): error is HttpException {
    const code = this.structuredExceptionCode(error)
    return code !== null && ACTIONABLE_SMS_FAILURE_CODES.has(code)
  }

  private isRetryableOtpInvalid(error: unknown): boolean {
    return this.structuredExceptionCode(error) === 'SMS_CODE_INVALID'
  }

  private structuredExceptionCode(error: unknown): string | null {
    if (!(error instanceof HttpException)) return null
    const response = error.getResponse()
    if (!response || typeof response !== 'object' || Array.isArray(response)) return null
    const nestedError = (response as { error?: unknown }).error
    if (!nestedError || typeof nestedError !== 'object' || Array.isArray(nestedError)) return null
    const code = (nestedError as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }

  private invalidOtpCode(): BadRequestException {
    return new BadRequestException({
      error: { code: 'SMS_CODE_INVALID', message: '验证码不正确，请重新输入' },
    })
  }

  private unavailable(): BadRequestException {
    return new BadRequestException({
      error: { code: 'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE', message: '当前账号暂不可进行首次手机号绑定' },
    })
  }
}
