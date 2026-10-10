import { Injectable } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import { InternalOtpService } from '../auth/internal-otp.service'
import { createOpaqueTicket, digestOpaqueTicket } from '../auth/partner-account-action-ticket'
import { PASSWORD_PROOF_STATE } from '../auth/password-proof-state'
import {
  decryptPhone,
  encryptPhone,
  hashPhone,
  isValidCnMobile,
  maskPhone,
  normalizePhone,
} from '../common/crypto/phone-identity'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PartnerAccountActionRedisService } from '../common/redis/partner-account-action-redis.service'
import { RedisService } from '../common/redis/redis.service'
import { isPostgresBusyError } from '../common/prisma/postgres-busy'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { verifyAdminStepUp } from './admin-step-up'
import {
  INTERNAL_ACCOUNT_SELECT,
  internalAccountErrors,
  isSerializationConflict,
  structuredErrorCode,
  toInternalAccountItem,
  uniqueViolationTarget,
  type InternalAccountItem,
  type InternalAccountRequestContext,
} from './internal-accounts.types'

export const BACKUP_ADMIN_CHALLENGE_TTL_SECONDS = 300
export const BACKUP_ADMIN_DISPLAY_NAME = '备用管理员'

interface BackupAdminTicketBinding {
  adminId: string
  adminTokenVersion: number
  phoneHash: string
  phoneEnc: string
}

export interface BackupAdminStartResult {
  ticket: string
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: number
}

export const backupAdminKeys = {
  ticket: (digest: string) => `internal:backup-admin-create:ticket:${digest}`,
  active: (adminId: string) => `internal:backup-admin-create:active:${adminId}`,
}

class BackupRollback extends Error {
  constructor(readonly kind: 'exists' | 'occupied' | 'stale') {
    super(kind)
  }
}

/**
 * 建备用管理员（3.9）：管理员本人密码确认 → 给备用手机号发验证码 → 验证码通过后同一事务建号。
 *
 * 建出来的账号：role=admin、enabled=false、手机号已验证、随机不可知的临时密码
 * （passwordProofState=temporary，没有任何人知道）、isBackupAdmin=true。
 * 手机号必须在建号时验证：启用后本人只能靠这个手机号走「找回密码」设新密码
 * （auth.service 的 findVerifiedUserByPhone 只认已验证手机号），不验就是死胡同。
 *
 * 单独成文件：与名册列表 / 启停是两段独立状态机（Redis 凭证 + 短信），放一起会过 300 行。
 */
@Injectable()
export class BackupAdminCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly actionRedis: PartnerAccountActionRedisService,
    private readonly otp: InternalOtpService,
    private readonly audit: AuditService,
  ) {}

  async start(
    actor: AuthedUser,
    input: { phone: string; adminCurrentPassword: string },
    context: InternalAccountRequestContext,
  ): Promise<BackupAdminStartResult> {
    const admin = await verifyAdminStepUp(
      { prisma: this.prisma, actionRedis: this.actionRedis, audit: this.audit },
      actor.userId,
      input.adminCurrentPassword,
      context,
      'user.backup_admin_create',
    )
    const phone = normalizePhone(input.phone.trim())
    if (!isValidCnMobile(phone)) throw internalAccountErrors.phoneInvalid()
    await this.assertCreatable(this.prisma, hashPhone(phone))

    const ticket = createOpaqueTicket()
    const binding: BackupAdminTicketBinding = {
      adminId: admin.id,
      adminTokenVersion: admin.tokenVersion,
      phoneHash: hashPhone(phone),
      phoneEnc: encryptPhone(phone),
    }
    // 同一管理员只认最新一张：先作废上一张，再写新的。
    const previous = await this.redis.get(backupAdminKeys.active(admin.id))
    if (previous) await this.redis.del(backupAdminKeys.ticket(previous))
    await this.redis.setEx(backupAdminKeys.ticket(ticket.digest), BACKUP_ADMIN_CHALLENGE_TTL_SECONDS, JSON.stringify(binding))
    await this.redis.setEx(backupAdminKeys.active(admin.id), BACKUP_ADMIN_CHALLENGE_TTL_SECONDS, ticket.digest)

    let cooldownSeconds: number
    try {
      const sent = await this.otp.sendCode({
        phone,
        purpose: 'backup_admin_create',
        ip: context.ip,
        deviceId: context.deviceId,
        shouldDeliver: true,
      })
      cooldownSeconds = sent.cooldownSeconds
    } catch (error) {
      await this.cleanup(admin.id, ticket.digest)
      throw error
    }
    await this.audit.write({
      actorId: admin.id,
      actorRole: 'admin',
      action: 'user.backup_admin_challenge_started',
      targetType: 'user',
      targetId: admin.id,
      payload: { phoneMasked: maskPhone(phone) },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    })
    return {
      ticket: ticket.ticket,
      phoneMasked: maskPhone(phone),
      expiresInSeconds: BACKUP_ADMIN_CHALLENGE_TTL_SECONDS,
      cooldownSeconds,
    }
  }

  async verify(
    actor: AuthedUser,
    input: { ticket: string; code: string },
    context: InternalAccountRequestContext,
  ): Promise<InternalAccountItem> {
    let digest: string
    try {
      digest = digestOpaqueTicket(input.ticket)
    } catch {
      throw internalAccountErrors.backupChallengeUnavailable()
    }
    const raw = await this.redis.get(backupAdminKeys.ticket(digest))
    const binding = raw ? parseBinding(raw) : null
    // 别人的凭证：当作不存在，也不替别人删。
    if (!raw || !binding || binding.adminId !== actor.userId) throw internalAccountErrors.backupChallengeUnavailable()
    if ((await this.redis.get(backupAdminKeys.active(actor.userId))) !== digest) {
      await this.redis.del(backupAdminKeys.ticket(digest))
      throw internalAccountErrors.backupChallengeUnavailable()
    }
    const admin = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, role: true, enabled: true, deletedAt: true, tokenVersion: true, passwordProofState: true },
    })
    if (!admin || admin.role !== 'admin' || !admin.enabled || admin.deletedAt
      || admin.tokenVersion !== binding.adminTokenVersion
      || admin.passwordProofState === PASSWORD_PROOF_STATE.TEMPORARY) {
      await this.cleanup(actor.userId, digest)
      throw internalAccountErrors.backupChallengeUnavailable()
    }
    let phone: string
    try {
      phone = decryptPhone(binding.phoneEnc)
      if (hashPhone(phone) !== binding.phoneHash) throw new Error('phone binding mismatch')
    } catch {
      await this.cleanup(actor.userId, digest)
      throw internalAccountErrors.backupChallengeUnavailable()
    }

    try {
      await this.otp.verifyCode(phone, 'backup_admin_create', input.code)
    } catch (error) {
      const code = structuredErrorCode(error)
      if (code === 'SMS_CODE_INVALID') throw internalAccountErrors.smsCodeInvalid()
      await this.cleanup(actor.userId, digest)
      if (code === 'SMS_CODE_EXPIRED') throw internalAccountErrors.smsCodeExpired()
      throw error
    }
    if ((await this.redis.getAndDelIfEquals(backupAdminKeys.ticket(digest), raw)) !== 'matched') {
      throw internalAccountErrors.backupChallengeUnavailable()
    }
    await this.redis.getAndDelIfEquals(backupAdminKeys.active(actor.userId), digest).catch(() => undefined)

    // 随机 32 字节、不落任何地方：这个密码没有人知道，启用后只能走短信找回密码设新密码。
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 10)
    const username = `backup-admin-${randomBytes(4).toString('hex')}`
    let createdId: string
    try {
      createdId = await withSerializableRetry(() => this.prisma.$transaction(async (tx: PrismaTransactionClient) => {
        await this.assertCreatable(tx, binding.phoneHash)
        const current = await tx.user.findUnique({ where: { id: actor.userId }, select: { enabled: true, tokenVersion: true, deletedAt: true } })
        if (!current || !current.enabled || current.deletedAt || current.tokenVersion !== binding.adminTokenVersion) {
          throw new BackupRollback('stale')
        }
        const created = await tx.user.create({
          data: {
            username,
            name: BACKUP_ADMIN_DISPLAY_NAME,
            passwordHash,
            passwordProofState: PASSWORD_PROOF_STATE.TEMPORARY,
            role: 'admin',
            orgId: null,
            enabled: false,
            phoneHash: binding.phoneHash,
            phoneEnc: binding.phoneEnc,
            phoneVerifiedAt: new Date(),
            isBackupAdmin: true,
          },
          select: { id: true },
        })
        await this.audit.writeRequired(tx, {
          actorId: actor.userId,
          actorRole: 'admin',
          action: 'user.create',
          targetType: 'user',
          targetId: created.id,
          payload: {
            backup: true,
            role: 'admin',
            username,
            enabled: false,
            phoneMasked: maskPhone(phone),
            passwordState: 'temporary',
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          requestId: context.requestId,
        })
        return created.id
      }, { isolationLevel: 'Serializable' }))
    } catch (error) {
      throw this.translateCreateError(error)
    }
    const row = await this.prisma.user.findFirst({ where: { id: createdId }, select: INTERNAL_ACCOUNT_SELECT })
    if (!row) throw internalAccountErrors.notFound()
    return toInternalAccountItem(row)
  }

  /** 已有未删除的备用管理员 → 409；手机号被任何账号（含已删除账号，phoneHash 全表唯一）占用 → 409。 */
  private async assertCreatable(
    db: Pick<PrismaTransactionClient, 'user'>,
    phoneHash: string,
  ): Promise<void> {
    const existing = await db.user.findFirst({ where: { isBackupAdmin: true, deletedAt: null }, select: { id: true } })
    if (existing) throw internalAccountErrors.backupExists()
    const owner = await db.user.findUnique({ where: { phoneHash }, select: { id: true } })
    if (owner) throw internalAccountErrors.phoneOccupied()
  }

  private translateCreateError(error: unknown): unknown {
    if (error instanceof BackupRollback) return internalAccountErrors.backupChallengeUnavailable()
    const target = uniqueViolationTarget(error)
    if (target !== null) {
      if (/phoneHash/i.test(target)) return internalAccountErrors.phoneOccupied()
      return internalAccountErrors.backupExists()
    }
    // 重试三次仍冲突：如实说「刚被修改」，不猜是哪一种冲突。
    if (isSerializationConflict(error)) return internalAccountErrors.stale()
    return error
  }

  private async cleanup(adminId: string, digest: string): Promise<void> {
    await this.redis.del(backupAdminKeys.ticket(digest)).catch(() => undefined)
    await this.redis.getAndDelIfEquals(backupAdminKeys.active(adminId), digest).catch(() => undefined)
  }
}

/** PostgreSQL Serializable 冲突重试（两个并发建号：重试后第二个在 assertCreatable 看到第一个，得到 409）。 */
async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (isPostgresBusyError(error)) throw error
      if (!isSerializationConflict(error) || attempt === 2) throw error
    }
  }
  throw new Error('unreachable')
}

function parseBinding(raw: string): BackupAdminTicketBinding | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (typeof value.adminId !== 'string' || !value.adminId
      || !Number.isSafeInteger(value.adminTokenVersion)
      || typeof value.phoneHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.phoneHash)
      || typeof value.phoneEnc !== 'string' || !value.phoneEnc) return null
    return value as unknown as BackupAdminTicketBinding
  } catch {
    return null
  }
}
