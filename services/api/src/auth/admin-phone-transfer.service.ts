import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { AuditService } from '../audit/audit.service'
import { decryptPhone, encryptPhone, hashPhone, isValidCnMobile, maskPhone, normalizePhone } from '../common/crypto/phone-identity'
import { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../common/guards/jwt-auth.guard'
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

type AdminPhoneTransferTicket = {
  adminId: string
  adminTokenVersion: number
  partnerId: string
  partnerTokenVersion: number
  encryptedPhone: string
  phoneHash: string
}

type PartnerSessionState = {
  userId: string
  role: string
  orgId: string | null
  enabled: boolean
  tokenVersion: number
  orgEnabled: boolean
}

export type AdminPhoneTransferStartResult = {
  bindTicket: string
  cooldownSeconds: number
  expiresInSeconds: number
  sourceAccount: {
    username: string
    organizationName: string
    phoneMasked: string
  }
}

type TransferCommitResult = {
  phoneMasked: string
  phoneVerifiedAt: string
  partnerSessionState: PartnerSessionState
}

@Injectable()
export class AdminPhoneTransferService {
  private readonly logger = new Logger(AdminPhoneTransferService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly otp: InternalOtpService,
    private readonly audit: AuditService,
  ) {}

  async start(
    adminId: string,
    currentPassword: string,
    candidatePhone: string,
    ip: string,
    deviceId?: string,
  ): Promise<AdminPhoneTransferStartResult> {
    const admin = await this.getEligibleAdmin(adminId)
    await this.verifyCurrentPassword(admin.id, currentPassword, admin.passwordHash)

    const phone = normalizePhone(candidatePhone)
    if (!isValidCnMobile(phone)) throw this.unavailable()
    const phoneHash = hashPhone(phone)
    const owner = await this.prisma.user.findUnique({
      where: { phoneHash },
      include: { org: { select: { name: true } } },
    })
    if (!owner || owner.role !== 'partner' || !owner.orgId || !owner.org) {
      throw this.unavailable()
    }

    const bindTicket = randomUUID()
    let activeTicketCreated = false
    try {
      activeTicketCreated = await this.redis.setNxEx(
        this.activeTicketKey(admin.id),
        bindTicket,
        INTERNAL_OTP_CODE_TTL_SECONDS,
      )
      if (!activeTicketCreated) throw this.unavailable()

      const ticket: AdminPhoneTransferTicket = {
        adminId: admin.id,
        adminTokenVersion: admin.tokenVersion,
        partnerId: owner.id,
        partnerTokenVersion: owner.tokenVersion,
        encryptedPhone: encryptPhone(phone),
        phoneHash,
      }
      await this.redis.setEx(
        this.ticketKey(admin.id, bindTicket),
        INTERNAL_OTP_CODE_TTL_SECONDS,
        JSON.stringify(ticket),
      )
      const result = await this.otp.sendCode({
        phone,
        purpose: 'transfer_phone',
        ip,
        deviceId,
        shouldDeliver: true,
      })
      await this.writeStartAudit(admin.id, owner.id).catch(() => undefined)
      return {
        bindTicket,
        cooldownSeconds: result.cooldownSeconds,
        expiresInSeconds: INTERNAL_OTP_CODE_TTL_SECONDS,
        sourceAccount: {
          username: owner.username,
          organizationName: owner.org.name,
          phoneMasked: maskPhone(phone),
        },
      }
    } catch (error) {
      if (activeTicketCreated) await this.cleanupTicket(admin.id, bindTicket)
      if (this.isActionableSmsFailure(error)) throw error
      throw this.unavailable()
    }
  }

  async verify(
    adminId: string,
    bindTicket: string,
    code: string,
  ): Promise<{ phoneMasked: string; phoneVerifiedAt: string }> {
    const serializedTicket = await this.redis.get(this.ticketKey(adminId, bindTicket))
    if (!serializedTicket) throw this.unavailable()

    let ticket: AdminPhoneTransferTicket
    let phone: string
    try {
      ticket = this.parseTicket(serializedTicket, adminId)
      phone = this.decryptTicketPhone(ticket)
      const admin = await this.getEligibleAdmin(adminId)
      if (admin.tokenVersion !== ticket.adminTokenVersion) throw new Error('stale ticket')
    } catch {
      await this.cleanupTicket(adminId, bindTicket)
      throw this.unavailable()
    }

    const verifyLockValue = randomUUID()
    const verifyLockKey = this.verifyLockKey(adminId, bindTicket)
    let verifyLockAcquired: boolean
    try {
      verifyLockAcquired = await this.redis.setNxEx(verifyLockKey, verifyLockValue, VERIFY_LOCK_TTL_SECONDS)
    } catch {
      throw this.unavailable()
    }
    if (!verifyLockAcquired) throw this.unavailable()

    try {
      await this.verifyOtpOrReject(adminId, bindTicket, phone, code)
      const ticketStatus = await this.redis.getAndDelIfEquals(
        this.ticketKey(adminId, bindTicket),
        serializedTicket,
      )
      if (ticketStatus !== 'matched') throw this.unavailable()

      const activeTicketStatus = await this.redis.getAndDelIfEquals(this.activeTicketKey(adminId), bindTicket)
      if (activeTicketStatus !== 'matched') throw this.unavailable()

      const result = await this.commitTransfer(ticket, phone)
      await this.refreshPartnerSession(ticket.partnerId, result.partnerSessionState)
      return { phoneMasked: result.phoneMasked, phoneVerifiedAt: result.phoneVerifiedAt }
    } finally {
      await this.redis.getAndDelIfEquals(verifyLockKey, verifyLockValue).catch(() => undefined)
    }
  }

  async cancel(adminId: string, bindTicket: string): Promise<{ cancelled: true }> {
    try {
      const activeTicketStatus = await this.redis.getAndDelIfEquals(this.activeTicketKey(adminId), bindTicket)
      if (activeTicketStatus === 'matched') {
        await this.redis.del(this.ticketKey(adminId, bindTicket)).catch(() => undefined)
        await this.writeCancelAudit(adminId).catch(() => undefined)
      }
      return { cancelled: true }
    } catch {
      throw this.unavailable()
    }
  }

  private async verifyOtpOrReject(adminId: string, bindTicket: string, phone: string, code: string): Promise<void> {
    try {
      await this.otp.verifyCode(phone, 'transfer_phone', code)
    } catch (error) {
      if (this.isRetryableOtpInvalid(error)) throw this.invalidOtpCode()
      await this.cleanupTicket(adminId, bindTicket)
      throw this.unavailable()
    }
  }

  private async commitTransfer(ticket: AdminPhoneTransferTicket, phone: string): Promise<TransferCommitResult> {
    const phoneVerifiedAt = new Date()
    const phoneMasked = maskPhone(phone)
    try {
      const partnerSessionState = await this.prisma.$transaction(async (tx: PrismaTransactionClient) => {
        const released = await tx.user.updateMany({
          where: {
            id: ticket.partnerId,
            role: 'partner',
            orgId: { not: null },
            phoneHash: ticket.phoneHash,
            tokenVersion: ticket.partnerTokenVersion,
          },
          data: {
            phoneHash: null,
            phoneEnc: null,
            phoneVerifiedAt: null,
            tokenVersion: { increment: 1 },
          },
        })
        if (released.count !== 1) throw this.unavailable()

        const bound = await tx.user.updateMany({
          where: {
            id: ticket.adminId,
            role: 'admin',
            enabled: true,
            phoneHash: null,
            phoneEnc: null,
            phoneVerifiedAt: null,
            tokenVersion: ticket.adminTokenVersion,
          },
          data: {
            phoneHash: ticket.phoneHash,
            phoneEnc: ticket.encryptedPhone,
            phoneVerifiedAt,
          },
        })
        if (bound.count !== 1) throw this.unavailable()

        await tx.auditLog.create({
          data: {
            actorId: ticket.adminId,
            actorRole: 'admin',
            action: 'auth.phone_transfer_complete',
            targetType: 'auth',
            targetId: ticket.adminId,
            payloadJson: JSON.stringify({ phoneMasked, sourcePartnerId: ticket.partnerId }),
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: ticket.adminId,
            actorRole: 'admin',
            action: 'auth.phone_released_by_admin',
            targetType: 'auth',
            targetId: ticket.partnerId,
            payloadJson: '{}',
          },
        })

        const freshPartner = await tx.user.findUniqueOrThrow({
          where: { id: ticket.partnerId },
          include: { org: { select: { enabled: true } } },
        })
        return {
          userId: freshPartner.id,
          role: freshPartner.role,
          orgId: freshPartner.orgId,
          enabled: freshPartner.enabled,
          tokenVersion: freshPartner.tokenVersion,
          orgEnabled: freshPartner.org?.enabled ?? false,
        }
      })
      return { phoneMasked, phoneVerifiedAt: phoneVerifiedAt.toISOString(), partnerSessionState }
    } catch {
      throw this.unavailable()
    }
  }

  private async refreshPartnerSession(partnerId: string, state: PartnerSessionState): Promise<void> {
    try {
      await this.redis.setJsonIfVersionNotOlder(
        this.sessionStateKey(partnerId),
        INTERNAL_SESSION_CACHE_TTL_SECONDS,
        JSON.stringify(state),
        state.tokenVersion,
      )
    } catch {
      this.logger.warn('手机号转移已提交，但机构账号会话缓存刷新失败；将以数据库 tokenVersion 和缓存 TTL 收敛')
    }
  }

  private async verifyCurrentPassword(adminId: string, currentPassword: string, passwordHash: string): Promise<void> {
    await this.reserveCurrentPasswordAttempt(adminId)
    let currentPasswordMatches: boolean
    try {
      currentPasswordMatches = await bcrypt.compare(currentPassword, passwordHash)
    } catch {
      await this.releaseCurrentPasswordAttempt(adminId)
      throw this.unavailable()
    }
    if (!currentPasswordMatches) throw this.unavailable()
    await this.releaseCurrentPasswordAttempt(adminId)
  }

  private async getEligibleAdmin(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } })
    if (
      !admin ||
      admin.role !== 'admin' ||
      !admin.enabled ||
      admin.phoneHash !== null ||
      admin.phoneEnc !== null ||
      admin.phoneVerifiedAt !== null
    ) {
      throw this.unavailable()
    }
    return admin
  }

  private parseTicket(serializedTicket: string, expectedAdminId: string): AdminPhoneTransferTicket {
    try {
      const value: unknown = JSON.parse(serializedTicket)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid ticket')

      const ticket = value as Record<string, unknown>
      const ticketKeys = Object.keys(ticket).sort()
      const expectedKeys = [
        'adminId',
        'adminTokenVersion',
        'encryptedPhone',
        'partnerId',
        'partnerTokenVersion',
        'phoneHash',
      ]
      if (
        JSON.stringify(ticketKeys) !== JSON.stringify(expectedKeys) ||
        ticket.adminId !== expectedAdminId ||
        typeof ticket.adminId !== 'string' ||
        !ticket.adminId ||
        typeof ticket.partnerId !== 'string' ||
        !ticket.partnerId ||
        ticket.partnerId === ticket.adminId ||
        typeof ticket.encryptedPhone !== 'string' ||
        !ticket.encryptedPhone ||
        typeof ticket.phoneHash !== 'string' ||
        !ticket.phoneHash ||
        !this.isNonNegativeSafeInteger(ticket.adminTokenVersion) ||
        !this.isNonNegativeSafeInteger(ticket.partnerTokenVersion)
      ) {
        throw new Error('invalid ticket')
      }
      return {
        adminId: ticket.adminId,
        adminTokenVersion: ticket.adminTokenVersion,
        partnerId: ticket.partnerId,
        partnerTokenVersion: ticket.partnerTokenVersion,
        encryptedPhone: ticket.encryptedPhone,
        phoneHash: ticket.phoneHash,
      }
    } catch {
      throw this.unavailable()
    }
  }

  private decryptTicketPhone(ticket: AdminPhoneTransferTicket): string {
    try {
      const phone = decryptPhone(ticket.encryptedPhone)
      if (!isValidCnMobile(phone) || hashPhone(phone) !== ticket.phoneHash) throw new Error('invalid ticket phone')
      return phone
    } catch {
      throw this.unavailable()
    }
  }

  private isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  }

  private async reserveCurrentPasswordAttempt(adminId: string): Promise<void> {
    const reserved = await this.redis.reserveWithinLimitWithTtl(
      this.currentPasswordFailureKey(adminId),
      CURRENT_PASSWORD_FAILURE_TTL_SECONDS,
      CURRENT_PASSWORD_FAILURE_LIMIT,
    )
    if (!reserved) throw this.unavailable()
  }

  private releaseCurrentPasswordAttempt(adminId: string): Promise<void> {
    return this.redis.releaseReservedLimit(this.currentPasswordFailureKey(adminId))
  }

  private async cleanupTicket(adminId: string, bindTicket: string): Promise<void> {
    await this.redis.del(this.ticketKey(adminId, bindTicket)).catch(() => undefined)
    await this.redis.getAndDelIfEquals(this.activeTicketKey(adminId), bindTicket).catch(() => undefined)
  }

  private writeStartAudit(adminId: string, partnerId: string): Promise<string | null> {
    return this.audit.write({
      actorId: adminId,
      actorRole: 'admin',
      action: 'auth.phone_transfer_start',
      targetType: 'auth',
      targetId: partnerId,
      payload: {},
    })
  }

  private writeCancelAudit(adminId: string): Promise<string | null> {
    return this.audit.write({
      actorId: adminId,
      actorRole: 'admin',
      action: 'auth.phone_transfer_cancel',
      targetType: 'auth',
      targetId: adminId,
      payload: {},
    })
  }

  private ticketKey(adminId: string, bindTicket: string): string {
    return `internal:admin:phone-transfer:ticket:${adminId}:${bindTicket}`
  }

  private activeTicketKey(adminId: string): string {
    return `internal:admin:phone-transfer:active:${adminId}`
  }

  private verifyLockKey(adminId: string, bindTicket: string): string {
    return `internal:admin:phone-transfer:verify-lock:${adminId}:${bindTicket}`
  }

  private currentPasswordFailureKey(adminId: string): string {
    return `internal:admin:phone-initial-bind:password-fail:${adminId}`
  }

  private sessionStateKey(userId: string): string {
    return `internal:session-state:${userId}`
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
      error: { code: 'AUTH_PHONE_TRANSFER_UNAVAILABLE', message: '当前账号暂不可进行手机号安全转移' },
    })
  }
}
