import { BadRequestException, Injectable } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { AuditService } from '../audit/audit.service'
import { decryptPhone, encryptPhone, hashPhone, isValidCnMobile, maskPhone, normalizePhone } from '../common/crypto/phone-identity'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { INTERNAL_OTP_CODE_TTL_SECONDS, InternalOtpService } from './internal-otp.service'

const CURRENT_PASSWORD_FAILURE_LIMIT = 5
const CURRENT_PASSWORD_FAILURE_TTL_SECONDS = INTERNAL_OTP_CODE_TTL_SECONDS

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
    const phoneOwner = await this.prisma.user.findUnique({ where: { phoneHash } })
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
      await this.writeAudit(user.id, 'auth.phone_initial_bind_start', maskPhone(phone))
      return {
        bindTicket,
        cooldownSeconds: result.cooldownSeconds,
        expiresInSeconds: INTERNAL_OTP_CODE_TTL_SECONDS,
      }
    } catch {
      if (activeTicketCreated) await this.cleanupTicket(user.id, bindTicket)
      throw this.unavailable()
    }
  }

  async verify(
    userId: string,
    bindTicket: string,
    code: string,
  ): Promise<{ phoneMasked: string; phoneVerifiedAt: string }> {
    const serializedTicket = await this.redis.getDel(this.ticketKey(userId, bindTicket))
    if (!serializedTicket) throw this.unavailable()

    const activeTicketStatus = await this.redis.getAndDelIfEquals(this.activeTicketKey(userId), bindTicket)
    if (activeTicketStatus !== 'matched') throw this.unavailable()

    const ticket = this.parseTicket(serializedTicket, userId)
    const user = await this.getEligibleAdmin(userId)
    if (user.tokenVersion !== ticket.tokenVersion) throw this.unavailable()

    const phone = this.decryptTicketPhone(ticket)
    try {
      await this.otp.verifyCode(phone, 'bind_phone', code)
    } catch {
      throw this.unavailable()
    }

    const phoneVerifiedAt = new Date()
    let updated: { count: number }
    try {
      updated = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          role: 'admin',
          enabled: true,
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
    } catch {
      throw this.unavailable()
    }
    if (updated.count !== 1) throw this.unavailable()

    const phoneMasked = maskPhone(phone)
    try {
      await this.writeAudit(user.id, 'auth.phone_initial_bind_complete', phoneMasked)
    } catch {
      throw this.unavailable()
    }
    return { phoneMasked, phoneVerifiedAt: phoneVerifiedAt.toISOString() }
  }

  private async getEligibleAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (
      !user ||
      user.role !== 'admin' ||
      !user.enabled ||
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

  private async writeAudit(userId: string, action: 'auth.phone_initial_bind_start' | 'auth.phone_initial_bind_complete', phoneMasked: string): Promise<void> {
    await this.audit.write({
      actorId: userId,
      actorRole: 'admin',
      action,
      targetType: 'auth',
      targetId: userId,
      payload: { phoneMasked },
    })
  }

  private ticketKey(userId: string, bindTicket: string): string {
    return `internal:admin:phone-initial-bind:ticket:${userId}:${bindTicket}`
  }

  private activeTicketKey(userId: string): string {
    return `internal:admin:phone-initial-bind:active:${userId}`
  }

  private currentPasswordFailureKey(userId: string): string {
    return `internal:admin:phone-initial-bind:password-fail:${userId}`
  }

  private unavailable(): BadRequestException {
    return new BadRequestException({
      error: { code: 'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE', message: '当前账号暂不可进行首次手机号绑定' },
    })
  }
}
