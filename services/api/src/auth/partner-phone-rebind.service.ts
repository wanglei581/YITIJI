import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import {
  decryptPhone,
  encryptPhone,
  hashPhone,
  isValidCnMobile,
  maskPhone,
  normalizePhone,
} from '../common/crypto/phone-identity'
import type {
  OtpRequestContext,
  RebindTicketBinding,
  ResendRebindResponse,
  StartRebindResponse,
} from '../common/redis/partner-account-action-redis.types'
import { PartnerAccountActionRedisService } from '../common/redis/partner-account-action-redis.service'
import { RedisService } from '../common/redis/redis.service'
import { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../common/constants/internal-session.constants'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { InternalOtpService } from './internal-otp.service'
import {
  createOpaqueTicket,
  digestOpaqueTicket,
  parseActionTicketBinding,
  parseRebindTicketBinding,
  partnerAccountActionRedisKey,
} from './partner-account-action-ticket'

const REBIND_TTL_SECONDS = 300 as const

@Injectable()
export class PartnerPhoneRebindService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly actionRedis: PartnerAccountActionRedisService,
    private readonly otp: InternalOtpService,
    private readonly audit: AuditService,
  ) {}

  async start(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    actionTicket: string | undefined,
    newPhoneInput: string,
    context: OtpRequestContext,
  ): Promise<StartRebindResponse> {
    if (!actionTicket) {
      await this.auditFailure(admin, orgId, partnerId, 'start', 'step_up_required')
      throw stepUpRequired()
    }
    const actionBinding = await this.loadActionTicket(actionTicket)
    if (!actionBinding || actionBinding.action !== 'rebind_phone'
      || actionBinding.adminId !== admin.userId || actionBinding.orgId !== orgId
      || actionBinding.partnerId !== partnerId) {
      await this.auditFailure(admin, orgId, partnerId, 'start', 'ticket_scope_mismatch')
      throw ticketStale()
    }

    const state = await this.loadCurrentState(admin, orgId, partnerId)
    if (state.adminTokenVersion !== actionBinding.adminTokenVersion
      || state.partnerTokenVersion !== actionBinding.partnerTokenVersion) {
      await this.auditFailure(admin, orgId, partnerId, 'start', 'ticket_stale')
      throw ticketStale()
    }

    const newPhone = normalizePhone(newPhoneInput)
    if (!isValidCnMobile(newPhone)) throw actionError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', '新手机号格式不正确')
    const newPhoneHash = hashPhone(newPhone)
    await this.assertPhoneAvailable(newPhoneHash)
    const newPhoneEnc = encryptPhone(newPhone)
    const phoneMasked = maskPhone(decryptPhone(newPhoneEnc))
    const rebindTicket = createOpaqueTicket()
    const rebindBinding: RebindTicketBinding = {
      ...actionBinding,
      action: 'rebind_phone',
      newPhoneHash,
      newPhoneEnc,
      phoneMasked,
    }

    const consumed = await this.actionRedis.consumeActionTicketForRebind({
      actionTicketHash: digestOpaqueTicket(actionTicket),
      scope: { adminId: admin.userId, orgId, partnerId, action: 'rebind_phone' },
      rebindTicketHash: rebindTicket.digest,
      rebindBinding,
      rebindTtlSeconds: REBIND_TTL_SECONDS,
    })
    if (!consumed) {
      await this.auditFailure(admin, orgId, partnerId, 'start', 'ticket_consume_failed')
      throw ticketStale()
    }

    try {
      await this.otp.sendCode({
        phone: newPhone,
        purpose: 'partner_phone_rebind_new',
        ip: context.ip,
        deviceId: context.deviceId,
        shouldDeliver: true,
      })
    } catch (error) {
      await this.actionRedis.revokeRebindTicket(rebindTicket.ticket, {
        adminId: admin.userId,
        orgId,
        partnerId,
        action: 'rebind_phone',
      }).catch(() => undefined)
      await this.auditFailure(admin, orgId, partnerId, 'start', 'otp_delivery_failed')
      throw error
    }
    return {
      rebindTicket: rebindTicket.ticket,
      phoneMasked,
      expiresInSeconds: REBIND_TTL_SECONDS,
      cooldownSeconds: 60,
    }
  }

  async resend(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    rebindTicket: string | undefined,
    context: OtpRequestContext,
  ): Promise<ResendRebindResponse> {
    let binding: RebindTicketBinding
    try {
      binding = await this.requireRebindTicket(admin, orgId, partnerId, rebindTicket)
      await this.assertBindingCurrent(admin, binding)
    } catch (error) {
      await this.auditFailure(admin, orgId, partnerId, 'resend', httpErrorCode(error) ?? 'ticket_unavailable')
      throw error
    }
    const phone = this.trustedNewPhone(binding)
    const sent = await this.otp.sendCode({
      phone,
      purpose: 'partner_phone_rebind_new',
      ip: context.ip,
      deviceId: context.deviceId,
      shouldDeliver: true,
    })
    const ttl = await this.redis.ttl(partnerAccountActionRedisKey('rebind', digestOpaqueTicket(rebindTicket!)))
    if (ttl <= 0) throw ticketStale()
    return {
      phoneMasked: maskPhone(phone),
      expiresInSeconds: Math.min(ttl, sent.expiresInSeconds),
      cooldownSeconds: 60,
    }
  }

  async verify(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    rebindTicket: string | undefined,
    code: string,
  ): Promise<{ success: true }> {
    let binding: RebindTicketBinding
    try {
      binding = await this.requireRebindTicket(admin, orgId, partnerId, rebindTicket)
      await this.assertBindingCurrent(admin, binding)
    } catch (error) {
      await this.auditFailure(admin, orgId, partnerId, 'verify', httpErrorCode(error) ?? 'ticket_unavailable')
      throw error
    }
    const phone = this.trustedNewPhone(binding)
    const consumeResult = await this.actionRedis.consumeRebindSmsTicket({
      rebindTicketHash: digestOpaqueTicket(rebindTicket!),
      scope: { adminId: admin.userId, orgId, partnerId, action: 'rebind_phone' },
      otp: this.otp.verificationDescriptor(phone, 'partner_phone_rebind_new', code),
    })
    if (consumeResult === 'credential_invalid') {
      await this.auditFailure(admin, orgId, partnerId, 'verify', 'credential_invalid')
      throw actionError(HttpStatus.UNPROCESSABLE_ENTITY, 'ACCOUNT_CREDENTIAL_INVALID', '新手机号验证码不正确')
    }
    if (consumeResult === 'credential_locked') {
      await this.auditFailure(admin, orgId, partnerId, 'verify', 'credential_locked')
      throw actionError(HttpStatus.TOO_MANY_REQUESTS, 'ACCOUNT_CREDENTIAL_LOCKED', '新手机号验证尝试次数过多，请重新开始')
    }
    if (consumeResult !== 'consumed') {
      await this.auditFailure(admin, orgId, partnerId, 'verify', 'ticket_consume_failed')
      throw ticketStale()
    }

    let sessionState: SessionState
    try {
      sessionState = await this.commitRebind(binding)
    } catch (error) {
      await this.auditFailure(admin, orgId, partnerId, 'commit', httpErrorCode(error) ?? 'commit_failed')
      throw error
    }
    await this.publishSessionState(sessionState)
    return { success: true }
  }

  async revoke(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    rebindTicket: string | undefined,
  ): Promise<void> {
    if (!rebindTicket) return
    const binding = await this.loadRebindTicket(rebindTicket)
    if (!binding || binding.adminId !== admin.userId || binding.orgId !== orgId
      || binding.partnerId !== partnerId) return
    await this.assertBindingCurrent(admin, binding)
    await this.actionRedis.revokeRebindTicket(rebindTicket, {
      adminId: admin.userId,
      orgId,
      partnerId,
      action: 'rebind_phone',
    })
  }

  private async commitRebind(binding: RebindTicketBinding): Promise<SessionState> {
    try {
      return await this.withSerializableRetry(() => this.prisma.$transaction(async (tx) => {
        const [admin, org, partner, phoneOwner] = await Promise.all([
          tx.user.findFirst({
            where: {
              id: binding.adminId,
              role: 'admin',
              enabled: true,
              deletedAt: null,
              tokenVersion: binding.adminTokenVersion,
            },
            select: { id: true },
          }),
          tx.organization.findUnique({ where: { id: binding.orgId }, select: { id: true, enabled: true } }),
          tx.user.findFirst({
            where: {
              id: binding.partnerId,
              orgId: binding.orgId,
              role: 'partner',
              deletedAt: null,
              tokenVersion: binding.partnerTokenVersion,
            },
            select: { id: true, role: true, orgId: true, enabled: true, tokenVersion: true },
          }),
          tx.user.findFirst({ where: { phoneHash: binding.newPhoneHash, deletedAt: null }, select: { id: true } }),
        ])
        if (!admin || !org || !partner) throw ticketStale()
        if (phoneOwner) throw phoneTaken()

        const phoneVerifiedAt = new Date()
        const updated = await tx.user.updateMany({
          where: {
            id: partner.id,
            orgId: binding.orgId,
            role: 'partner',
            deletedAt: null,
            tokenVersion: binding.partnerTokenVersion,
          },
          data: {
            phoneHash: binding.newPhoneHash,
            phoneEnc: binding.newPhoneEnc,
            phoneVerifiedAt,
            tokenVersion: { increment: 1 },
          },
        })
        if (updated.count !== 1) throw ticketStale()

        await tx.auditLog.create({
          data: {
            actorId: binding.adminId,
            actorRole: 'admin',
            action: 'org.account.phone_rebind',
            targetType: 'organization',
            targetId: binding.orgId,
            payloadJson: JSON.stringify({ partnerId: binding.partnerId, phoneMasked: binding.phoneMasked }),
            requestId: randomUUID(),
          },
        })
        return {
          userId: partner.id,
          role: partner.role,
          orgId: partner.orgId,
          enabled: partner.enabled,
          tokenVersion: partner.tokenVersion + 1,
          deletedAt: null,
          orgEnabled: org.enabled,
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      }))
    } catch (error) {
      if (isPhoneUniqueConflict(error)) throw phoneTaken()
      throw error
    }
  }

  private async publishSessionState(state: SessionState): Promise<void> {
    const key = `internal:session-state:${state.userId}`
    try {
      await this.redis.setJsonIfVersionNotOlder(
        key,
        INTERNAL_SESSION_CACHE_TTL_SECONDS,
        JSON.stringify(state),
        state.tokenVersion,
      )
    } catch {
      await this.redis.del(key).catch(() => undefined)
    }
  }

  private async auditFailure(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    phase: 'start' | 'resend' | 'verify' | 'commit',
    result: string,
  ): Promise<void> {
    await this.audit.write({
      actorId: admin.userId,
      actorRole: 'admin',
      action: 'org.account.phone_rebind_failed',
      targetType: 'organization',
      targetId: orgId,
      payload: { partnerId, phase, result },
    })
  }

  private async requireRebindTicket(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    rebindTicket: string | undefined,
  ): Promise<RebindTicketBinding> {
    if (!rebindTicket) throw stepUpRequired()
    const binding = await this.loadRebindTicket(rebindTicket)
    if (!binding || binding.adminId !== admin.userId || binding.orgId !== orgId
      || binding.partnerId !== partnerId || binding.action !== 'rebind_phone') throw ticketStale()
    return binding
  }

  private async assertBindingCurrent(admin: AuthedUser, binding: RebindTicketBinding): Promise<void> {
    const state = await this.loadCurrentState(admin, binding.orgId, binding.partnerId)
    if (state.adminTokenVersion !== binding.adminTokenVersion
      || state.partnerTokenVersion !== binding.partnerTokenVersion) throw ticketStale()
    this.trustedNewPhone(binding)
  }

  private async loadCurrentState(admin: AuthedUser, orgId: string, partnerId: string) {
    if (admin.role !== 'admin') throw ticketStale()
    const [adminRow, org, partner] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: admin.userId, role: 'admin', enabled: true, deletedAt: null },
        select: { tokenVersion: true },
      }),
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }),
      this.prisma.user.findFirst({
        where: { id: partnerId, orgId, role: 'partner', deletedAt: null },
        select: { tokenVersion: true },
      }),
    ])
    if (!adminRow || !org || !partner) throw ticketStale()
    return { adminTokenVersion: adminRow.tokenVersion, partnerTokenVersion: partner.tokenVersion }
  }

  private trustedNewPhone(binding: RebindTicketBinding): string {
    let phone: string
    try {
      phone = decryptPhone(binding.newPhoneEnc)
    } catch {
      throw ticketStale()
    }
    if (!isValidCnMobile(phone) || hashPhone(phone) !== binding.newPhoneHash
      || maskPhone(phone) !== binding.phoneMasked) throw ticketStale()
    return phone
  }

  private async assertPhoneAvailable(phoneHash: string): Promise<void> {
    const owner = await this.prisma.user.findFirst({ where: { phoneHash, deletedAt: null }, select: { id: true } })
    if (owner) throw phoneTaken()
  }

  private async loadActionTicket(ticket: string) {
    let digest: string
    try { digest = digestOpaqueTicket(ticket) } catch { return null }
    const raw = await this.redis.get(partnerAccountActionRedisKey('verified', digest))
    return raw ? parseActionTicketBinding(raw) : null
  }

  private async loadRebindTicket(ticket: string): Promise<RebindTicketBinding | null> {
    let digest: string
    try { digest = digestOpaqueTicket(ticket) } catch { return null }
    const raw = await this.redis.get(partnerAccountActionRedisKey('rebind', digest))
    return raw ? parseRebindTicketBinding(raw) : null
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
        if (!retryable || attempt === 2) throw error
      }
    }
    throw new Error('unreachable')
  }
}

interface SessionState {
  userId: string
  role: string
  orgId: string | null
  enabled: boolean
  tokenVersion: number
  deletedAt: null
  orgEnabled: boolean
}

function actionError(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ error: { code, message } }, status)
}

function stepUpRequired(): HttpException {
  return actionError(HttpStatus.FORBIDDEN, 'ACCOUNT_ACTION_STEP_UP_REQUIRED', '请先完成目标账号验证')
}

function ticketStale(): HttpException {
  return actionError(HttpStatus.CONFLICT, 'ACCOUNT_ACTION_TICKET_STALE', '账号状态已变化，请刷新后重新验证')
}

function phoneTaken(): HttpException {
  return actionError(HttpStatus.CONFLICT, 'PHONE_TAKEN', '该手机号已被其他账号使用')
}

function isPhoneUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

function httpErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined
  const response = error.getResponse()
  if (!response || typeof response !== 'object' || !('error' in response)) return undefined
  const envelope = response as { error?: { code?: unknown } }
  return typeof envelope.error?.code === 'string' ? envelope.error.code : undefined
}
