import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { AuditService } from '../audit/audit.service'
import { encryptPhone, hashPhone, isValidCnMobile, maskPhone, normalizePhone } from '../common/crypto/phone-identity'
import { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../common/guards/jwt-auth.guard'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import {
  adminPhoneTransferKeys,
  adminPhoneTransferUnavailable,
  parseAdminPhoneTransferTicket,
  type AdminPhoneTransferStartResult,
  type AdminPhoneTransferTicket,
} from './admin-phone-transfer-ticket'
import { INTERNAL_OTP_CODE_TTL_SECONDS, InternalOtpService } from './internal-otp.service'

export type { AdminPhoneTransferStartResult } from './admin-phone-transfer-ticket'

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

type PartnerSessionState = {
  userId: string
  role: string
  orgId: string | null
  enabled: boolean
  tokenVersion: number
  orgEnabled: boolean
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
    if (!isValidCnMobile(phone)) throw adminPhoneTransferUnavailable()
    const phoneHash = hashPhone(phone)
    const owner = await this.prisma.user.findUnique({
      where: { phoneHash },
      include: { org: { select: { name: true } } },
    })
    if (!owner || owner.role !== 'partner' || !owner.orgId || !owner.org) {
      throw adminPhoneTransferUnavailable()
    }

    const bindTicket = randomUUID()
    let activeTicketCreated = false
    try {
      activeTicketCreated = await this.redis.setNxEx(
        adminPhoneTransferKeys.activeTicket(admin.id),
        bindTicket,
        INTERNAL_OTP_CODE_TTL_SECONDS,
      )
      if (!activeTicketCreated) throw adminPhoneTransferUnavailable()

      const ticket: AdminPhoneTransferTicket = {
        adminId: admin.id,
        adminTokenVersion: admin.tokenVersion,
        partnerId: owner.id,
        partnerTokenVersion: owner.tokenVersion,
        encryptedPhone: encryptPhone(phone),
        phoneHash,
      }
      await this.redis.setEx(
        adminPhoneTransferKeys.ticket(admin.id, bindTicket),
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
      throw adminPhoneTransferUnavailable()
    }
  }

  async verify(
    adminId: string,
    bindTicket: string,
    code: string,
  ): Promise<{ phoneMasked: string; phoneVerifiedAt: string }> {
    const serializedTicket = await this.redis.get(adminPhoneTransferKeys.ticket(adminId, bindTicket))
    if (!serializedTicket) throw adminPhoneTransferUnavailable()

    let ticket: AdminPhoneTransferTicket
    let phone: string
    try {
      const parsed = parseAdminPhoneTransferTicket(serializedTicket, adminId)
      ticket = parsed.ticket
      phone = parsed.phone
      const admin = await this.getEligibleAdmin(adminId)
      if (admin.tokenVersion !== ticket.adminTokenVersion) throw new Error('stale ticket')
    } catch {
      await this.cleanupTicket(adminId, bindTicket)
      throw adminPhoneTransferUnavailable()
    }

    const verifyLockValue = randomUUID()
    const verifyLockKey = adminPhoneTransferKeys.verifyLock(adminId, bindTicket)
    let verifyLockAcquired: boolean
    try {
      verifyLockAcquired = await this.redis.setNxEx(verifyLockKey, verifyLockValue, VERIFY_LOCK_TTL_SECONDS)
    } catch {
      throw adminPhoneTransferUnavailable()
    }
    if (!verifyLockAcquired) throw adminPhoneTransferUnavailable()

    try {
      await this.verifyOtpOrReject(adminId, bindTicket, phone, code)
      const ticketStatus = await this.redis.getAndDelIfEquals(
        adminPhoneTransferKeys.ticket(adminId, bindTicket),
        serializedTicket,
      )
      if (ticketStatus !== 'matched') throw adminPhoneTransferUnavailable()

      const activeTicketStatus = await this.redis.getAndDelIfEquals(
        adminPhoneTransferKeys.activeTicket(adminId),
        bindTicket,
      )
      if (activeTicketStatus !== 'matched') throw adminPhoneTransferUnavailable()

      const result = await this.commitTransfer(ticket, phone)
      await this.refreshPartnerSession(ticket.partnerId, result.partnerSessionState)
      return { phoneMasked: result.phoneMasked, phoneVerifiedAt: result.phoneVerifiedAt }
    } finally {
      await this.redis.getAndDelIfEquals(verifyLockKey, verifyLockValue).catch(() => undefined)
    }
  }

  async cancel(adminId: string, bindTicket: string): Promise<{ cancelled: true }> {
    try {
      const activeTicketStatus = await this.redis.getAndDelIfEquals(
        adminPhoneTransferKeys.activeTicket(adminId),
        bindTicket,
      )
      if (activeTicketStatus === 'matched') {
        await this.cleanupCancelledTicket(adminId, bindTicket)
        await this.writeCancelAudit(adminId).catch(() => undefined)
      }
      return { cancelled: true }
    } catch {
      throw adminPhoneTransferUnavailable()
    }
  }

  private async verifyOtpOrReject(adminId: string, bindTicket: string, phone: string, code: string): Promise<void> {
    try {
      await this.otp.verifyCode(phone, 'transfer_phone', code)
    } catch (error) {
      if (this.isRetryableOtpInvalid(error)) throw this.invalidOtpCode()
      await this.cleanupTicket(adminId, bindTicket)
      throw adminPhoneTransferUnavailable()
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
        if (released.count !== 1) throw adminPhoneTransferUnavailable()

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
        if (bound.count !== 1) throw adminPhoneTransferUnavailable()

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
      throw adminPhoneTransferUnavailable()
    }
  }

  private async refreshPartnerSession(partnerId: string, state: PartnerSessionState): Promise<void> {
    try {
      await this.redis.setJsonIfVersionNotOlder(
        adminPhoneTransferKeys.sessionState(partnerId),
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
      throw adminPhoneTransferUnavailable()
    }
    if (!currentPasswordMatches) throw adminPhoneTransferUnavailable()
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
      throw adminPhoneTransferUnavailable()
    }
    return admin
  }

  private async reserveCurrentPasswordAttempt(adminId: string): Promise<void> {
    const reserved = await this.redis.reserveWithinLimitWithTtl(
      adminPhoneTransferKeys.currentPasswordFailures(adminId),
      CURRENT_PASSWORD_FAILURE_TTL_SECONDS,
      CURRENT_PASSWORD_FAILURE_LIMIT,
    )
    if (!reserved) throw adminPhoneTransferUnavailable()
  }

  private releaseCurrentPasswordAttempt(adminId: string): Promise<void> {
    return this.redis.releaseReservedLimit(adminPhoneTransferKeys.currentPasswordFailures(adminId))
  }

  private async cleanupTicket(adminId: string, bindTicket: string): Promise<void> {
    await this.redis.del(adminPhoneTransferKeys.ticket(adminId, bindTicket)).catch(() => undefined)
    await this.redis.getAndDelIfEquals(adminPhoneTransferKeys.activeTicket(adminId), bindTicket).catch(() => undefined)
  }

  private async cleanupCancelledTicket(adminId: string, bindTicket: string): Promise<void> {
    const ticketKey = adminPhoneTransferKeys.ticket(adminId, bindTicket)
    const lockKey = adminPhoneTransferKeys.verifyLock(adminId, bindTicket)
    const [serializedTicket, verifyLockValue] = await Promise.all([this.redis.get(ticketKey), this.redis.get(lockKey)])
    if (serializedTicket) await this.redis.getAndDelIfEquals(ticketKey, serializedTicket)
    if (verifyLockValue) await this.redis.getAndDelIfEquals(lockKey, verifyLockValue)
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
}
