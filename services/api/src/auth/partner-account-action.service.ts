import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import { hashPhone, maskPhone } from '../common/crypto/phone-identity'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type {
  ActionChallengeBinding,
  ActionTicketBinding,
  CreateChallengeResponse,
  OtpRequestContext,
  TicketScope,
} from '../common/redis/partner-account-action-redis.types'
import { PartnerAccountActionRedisService } from '../common/redis/partner-account-action-redis.service'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { PASSWORD_PROOF_STATE } from './password-proof-state'
import { InternalOtpService } from './internal-otp.service'
import {
  createChallengeId,
  createOpaqueTicket,
  digestOpaqueTicket,
  availablePartnerVerificationMethods,
  trustedPartnerPhone,
  accountActionError,
  accountActionChallengeUnavailable,
  accountActionStepUpRequired,
  accountActionTicketStale,
  accountCredentialLocked,
  parseActionTicketBinding,
  parseChallengeBinding,
  partnerAccountActionRedisKey,
  type CurrentAccountActionState,
  type CurrentAdmin,
} from './partner-account-action-ticket'
import type {
  CreatePartnerAccountActionChallengeDto,
  VerifyPartnerAccountActionChallengeDto,
} from '../orgs/dto/partner-account-action.dto'
import { assertExactCredentialDto } from '../orgs/dto/partner-account-action.dto'
import { AdminOrgsService } from '../orgs/admin-orgs.service'

const CHALLENGE_TTL_SECONDS = 300 as const
const ACTION_TICKET_TTL_SECONDS = 90 as const
const COMMIT_LOCK_SECONDS = 60 as const
@Injectable()
export class PartnerAccountActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly actionRedis: PartnerAccountActionRedisService,
    private readonly otp: InternalOtpService,
    private readonly adminOrgs: AdminOrgsService,
    private readonly audit: AuditService,
  ) {}
  async createChallenge(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    dto: CreatePartnerAccountActionChallengeDto,
    context: OtpRequestContext,
  ): Promise<CreateChallengeResponse> {
    const state = await this.loadCurrentState(admin, orgId, partnerId)
    const availableMethods = availablePartnerVerificationMethods(state.partner)
    if (!availableMethods.includes(dto.verifyMethod)) throw accountActionError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'ACCOUNT_ACTION_METHOD_UNAVAILABLE',
      '当前验证方式不可用',
      { availableMethods },
    )
    await this.verifyAdminRecentOrPassword(state.admin, dto.adminCurrentPassword)
    const challengeId = createChallengeId()
    const binding: ActionChallengeBinding = {
      challengeId,
      adminId: state.admin.id,
      adminTokenVersion: state.admin.tokenVersion,
      orgId,
      partnerId: state.partner.id,
      partnerTokenVersion: state.partner.tokenVersion,
      action: dto.action,
      verifyMethod: dto.verifyMethod,
    }
    let phoneMasked: string | undefined
    let cooldownSeconds = 0
    if (dto.verifyMethod === 'sms') {
      const phone = trustedPartnerPhone(state.partner)
      const purpose = dto.action === 'delete_account'
        ? 'partner_account_delete' as const
        : 'partner_phone_rebind_authorize' as const
      binding.phoneHash = state.partner.phoneHash!
      binding.otpPurpose = purpose
      const sent = await this.otp.sendCode({
        phone,
        purpose,
        ip: context.ip,
        deviceId: context.deviceId,
        shouldDeliver: true,
      })
      phoneMasked = maskPhone(phone)
      cooldownSeconds = sent.cooldownSeconds
    }
    await this.actionRedis.replaceChallenge(binding, CHALLENGE_TTL_SECONDS)
    await this.auditEvent(admin.userId, orgId, partnerId, 'org.account.action_challenge_started', {
      action: dto.action,
      verifyMethod: dto.verifyMethod,
      result: 'started',
    })
    return {
      challengeId,
      action: dto.action,
      verifyMethod: dto.verifyMethod,
      ...(phoneMasked ? { phoneMasked } : {}),
      availableMethods,
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
      cooldownSeconds,
    }
  }
  async verifyChallenge(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    challengeId: string,
    dto: VerifyPartnerAccountActionChallengeDto,
  ): Promise<{ actionTicket: string; expiresInSeconds: 90 }> {
    const credential = assertExactCredentialDto(dto)
    const challenge = await this.loadChallenge(challengeId)
    if (!challenge || challenge.adminId !== admin.userId || challenge.orgId !== orgId
      || challenge.partnerId !== partnerId) throw accountActionChallengeUnavailable()
    if (('code' in credential) !== (challenge.verifyMethod === 'sms')) {
      throw new HttpException(
        { error: { code: 'VALIDATION_FAILED', message: '提交的凭据与挑战验证方式不一致' } },
        HttpStatus.BAD_REQUEST,
      )
    }
    const state = await this.loadCurrentState(admin, orgId, partnerId)
    if (state.admin.tokenVersion !== challenge.adminTokenVersion
      || state.partner.tokenVersion !== challenge.partnerTokenVersion) throw accountActionTicketStale()

    const ticket = createOpaqueTicket()
    const ticketBinding: ActionTicketBinding = {
      adminId: challenge.adminId,
      adminTokenVersion: challenge.adminTokenVersion,
      orgId: challenge.orgId,
      partnerId: challenge.partnerId,
      partnerTokenVersion: challenge.partnerTokenVersion,
      action: challenge.action,
    }
    const scope = this.challengeScope(challenge)
    let consumeResult: Awaited<ReturnType<PartnerAccountActionRedisService['consumePasswordChallenge']>>
    if ('code' in credential) {
      const phone = trustedPartnerPhone(state.partner)
      if (hashPhone(phone) !== state.partner.phoneHash || challenge.phoneHash !== state.partner.phoneHash) {
        throw accountActionTicketStale()
      }
      consumeResult = await this.actionRedis.consumeSmsChallenge({
        scope,
        challenge,
        actionTicketHash: ticket.digest,
        actionTicketBinding: ticketBinding,
        ticketTtlSeconds: ACTION_TICKET_TTL_SECONDS,
        otp: this.otp.verificationDescriptor(phone, challenge.otpPurpose!, credential.code),
      })
    } else {
      if (state.partner.passwordProofState !== PASSWORD_PROOF_STATE.OWNER_MANAGED) {
        throw accountActionError(
          HttpStatus.CONFLICT,
          'ACCOUNT_PASSWORD_PROOF_NOT_READY',
          '目标账号密码尚未由持有人管理，请先完成本人自助改密',
        )
      }
      await this.assertPasswordNotLocked('partner', partnerId, 'ACCOUNT_CREDENTIAL_LOCKED')
      const valid = await bcrypt.compare(credential.currentPassword, state.partner.passwordHash).catch(() => false)
      if (!valid) {
        const result = await this.actionRedis.recordPasswordFailure('partner', partnerId)
        await this.auditCredentialFailure(admin.userId, orgId, partnerId, challenge, result)
        if (result === 'locked') throw accountCredentialLocked()
        throw accountActionError(HttpStatus.UNPROCESSABLE_ENTITY, 'ACCOUNT_CREDENTIAL_INVALID', '目标账号凭据不正确')
      }
      consumeResult = await this.actionRedis.consumePasswordChallenge({
        scope,
        challenge,
        actionTicketHash: ticket.digest,
        actionTicketBinding: ticketBinding,
        ticketTtlSeconds: ACTION_TICKET_TTL_SECONDS,
      })
    }
    if (consumeResult === 'credential_locked') {
      await this.auditCredentialFailure(admin.userId, orgId, partnerId, challenge, 'locked')
      throw accountCredentialLocked()
    }
    if (consumeResult === 'credential_invalid') {
      await this.auditCredentialFailure(admin.userId, orgId, partnerId, challenge, 'retry')
      throw accountActionError(HttpStatus.UNPROCESSABLE_ENTITY, 'ACCOUNT_CREDENTIAL_INVALID', '目标账号凭据不正确')
    }
    if (consumeResult !== 'consumed') throw accountActionChallengeUnavailable()

    if (challenge.verifyMethod === 'password') {
      await this.actionRedis.clearPasswordFailures('partner', partnerId)
    }
    await this.auditEvent(admin.userId, orgId, partnerId, 'org.account.action_verified', {
      action: challenge.action,
      verifyMethod: challenge.verifyMethod,
      result: 'verified',
    })
    return { actionTicket: ticket.ticket, expiresInSeconds: ACTION_TICKET_TTL_SECONDS }
  }
  async cancelChallenge(admin: AuthedUser, orgId: string, partnerId: string, challengeId: string): Promise<void> {
    const challenge = await this.loadChallenge(challengeId)
    if (challenge && challenge.adminId === admin.userId && challenge.orgId === orgId && challenge.partnerId === partnerId) {
      await this.loadCurrentState(admin, orgId, partnerId)
      await this.actionRedis.cancelChallenge(this.challengeScope(challenge))
      await this.auditEvent(admin.userId, orgId, partnerId, 'org.account.action_cancelled', {
        action: challenge.action,
        verifyMethod: challenge.verifyMethod,
        result: 'cancelled',
      })
    }
  }
  async revokeActionTicket(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    ticket: string | undefined,
  ): Promise<void> {
    if (!ticket) return
    const binding = await this.loadActionTicket(ticket)
    if (!binding) return
    if (binding.adminId !== admin.userId || binding.orgId !== orgId || binding.partnerId !== partnerId) return
    await this.loadCurrentState(admin, orgId, partnerId)
    await this.actionRedis.revokeActionTicket(ticket, this.ticketScope(binding))
  }
  async deleteAccount(
    admin: AuthedUser,
    orgId: string,
    partnerId: string,
    ticket: string | undefined,
  ): Promise<{ success: true }> {
    if (!ticket) throw accountActionStepUpRequired()
    const binding = await this.loadActionTicket(ticket)
    if (!binding) throw accountActionStepUpRequired()
    if (binding.adminId !== admin.userId || binding.orgId !== orgId || binding.partnerId !== partnerId
      || binding.action !== 'delete_account') throw accountActionTicketStale()
    const requestId = randomUUID()
    const consumed = await this.actionRedis.consumeDeleteTicketAndAcquireLock({
      actionTicketHash: digestOpaqueTicket(ticket),
      scope: { adminId: admin.userId, orgId, partnerId, action: 'delete_account' },
      requestId,
      lockSeconds: COMMIT_LOCK_SECONDS,
    })
    if (consumed.kind === 'conflict') throw accountActionError(
      HttpStatus.CONFLICT,
      'ACCOUNT_COMMIT_CONFLICT',
      '当前机构有另一项账号变更正在提交，请稍后重试',
    )
    if (consumed.kind !== 'acquired') throw accountActionStepUpRequired()
    try {
      return await this.adminOrgs.deleteAccount(orgId, partnerId, admin, {
        adminTokenVersion: consumed.binding.adminTokenVersion,
        partnerTokenVersion: consumed.binding.partnerTokenVersion,
      })
    } finally {
      await this.actionRedis.releaseCommitLock(orgId, requestId).catch(() => undefined)
    }
  }
  private async verifyAdminRecentOrPassword(
    admin: CurrentAdmin,
    submittedPassword: string | undefined,
  ): Promise<void> {
    const recentVersion = await this.actionRedis.getAdminRecentVerification(admin.id)
    if (recentVersion === admin.tokenVersion && submittedPassword === undefined) return
    if (submittedPassword === undefined) throw accountActionError(
      HttpStatus.FORBIDDEN,
      'ADMIN_REAUTH_REQUIRED',
      '请先输入管理员本人当前密码',
    )
    await this.assertPasswordNotLocked('admin', admin.id, 'ADMIN_CREDENTIAL_LOCKED')
    const valid = await bcrypt.compare(submittedPassword, admin.passwordHash).catch(() => false)
    if (!valid) {
      const result = await this.actionRedis.recordPasswordFailure('admin', admin.id)
      if (result === 'locked') throw accountActionError(
        HttpStatus.TOO_MANY_REQUESTS,
        'ADMIN_CREDENTIAL_LOCKED',
        '管理员密码尝试次数过多，请稍后再试',
      )
      throw accountActionError(HttpStatus.UNPROCESSABLE_ENTITY, 'ADMIN_CREDENTIAL_INVALID', '管理员本人密码不正确')
    }
    await this.actionRedis.setAdminRecentVerification(admin.id, admin.tokenVersion)
    await this.actionRedis.clearPasswordFailures('admin', admin.id)
  }
  private async loadCurrentState(admin: AuthedUser, orgId: string, partnerId: string): Promise<CurrentAccountActionState> {
    if (admin.role !== 'admin') throw accountActionTicketStale()
    const [adminRow, org, partner] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: admin.userId },
        select: { id: true, role: true, enabled: true, deletedAt: true, tokenVersion: true, passwordHash: true },
      }),
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }),
      this.prisma.user.findFirst({
        where: { id: partnerId, orgId, role: 'partner', deletedAt: null },
        select: {
          id: true,
          enabled: true,
          tokenVersion: true,
          passwordHash: true,
          passwordProofState: true,
          phoneHash: true,
          phoneEnc: true,
          phoneVerifiedAt: true,
        },
      }),
    ])
    if (!adminRow || adminRow.role !== 'admin' || !adminRow.enabled || adminRow.deletedAt) throw accountActionTicketStale()
    if (!org || !partner) throw accountActionError(HttpStatus.NOT_FOUND, 'ACCOUNT_NOT_FOUND', '机构账号不存在')
    return { admin: adminRow, partner }
  }

  private async loadChallenge(challengeId: string): Promise<ActionChallengeBinding | null> {
    const raw = await this.redis.get(partnerAccountActionRedisKey('challenge', challengeId))
    return raw ? parseChallengeBinding(raw) : null
  }

  private async loadActionTicket(ticket: string): Promise<ActionTicketBinding | null> {
    let digest: string
    try {
      digest = digestOpaqueTicket(ticket)
    } catch {
      return null
    }
    const raw = await this.redis.get(partnerAccountActionRedisKey('verified', digest))
    return raw ? parseActionTicketBinding(raw) : null
  }

  private async assertPasswordNotLocked(
    subject: 'admin' | 'partner',
    id: string,
    code: 'ADMIN_CREDENTIAL_LOCKED' | 'ACCOUNT_CREDENTIAL_LOCKED',
  ): Promise<void> {
    if (!await this.actionRedis.isPasswordLocked(subject, id)) return
    if (code === 'ADMIN_CREDENTIAL_LOCKED') throw accountActionError(
      HttpStatus.TOO_MANY_REQUESTS,
      code,
      '管理员密码尝试次数过多，请稍后再试',
    )
    throw accountCredentialLocked()
  }

  private challengeScope(challenge: ActionChallengeBinding) {
    return {
      challengeId: challenge.challengeId,
      adminId: challenge.adminId,
      orgId: challenge.orgId,
      partnerId: challenge.partnerId,
      action: challenge.action,
    }
  }

  private ticketScope(binding: ActionTicketBinding): TicketScope {
    return {
      adminId: binding.adminId,
      orgId: binding.orgId,
      partnerId: binding.partnerId,
      action: binding.action,
    }
  }

  private async auditCredentialFailure(
    adminId: string,
    orgId: string,
    partnerId: string,
    challenge: ActionChallengeBinding,
    result: 'retry' | 'locked',
  ): Promise<void> {
    await this.auditEvent(adminId, orgId, partnerId, 'org.account.action_verification_failed', {
      action: challenge.action,
      verifyMethod: challenge.verifyMethod,
      result,
    })
  }

  private async auditEvent(
    adminId: string,
    orgId: string,
    partnerId: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.write({
      actorId: adminId,
      actorRole: 'admin',
      action,
      targetType: 'organization',
      targetId: orgId,
      payload: { partnerId, ...payload },
    })
  }
}
