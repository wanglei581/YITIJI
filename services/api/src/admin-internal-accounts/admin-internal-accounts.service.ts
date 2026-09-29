import { Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { hashPhone, isValidCnMobile, normalizePhone } from '../common/crypto/phone-identity'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PartnerAccountActionRedisService } from '../common/redis/partner-account-action-redis.service'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { verifyAdminStepUp } from './admin-step-up'
import { publishInternalSessionState } from './internal-account-session'
import {
  INTERNAL_ACCOUNT_ROLES,
  INTERNAL_ACCOUNT_SELECT,
  internalAccountErrors,
  isSerializationConflict,
  toInternalAccountItem,
  type InternalAccountItem,
  type InternalAccountListQuery,
  type InternalAccountListResult,
  type InternalAccountRequestContext,
} from './internal-accounts.types'

export type InternalAccountStatusAction = 'enable' | 'disable'

/** 仅用于把事务里的「最后一个管理员」与其它错误区分，不会外泄。 */
class LastAdminRollback extends Error {}
class StaleRollback extends Error {}

/**
 * 内部账号名册（3.9）：列出 admin / partner / kiosk 内部账号，启停管理员账号。
 *
 * 为什么不放进现有模块：
 * - `admin-users` 管的是 C 端求职者（EndUser），与内部 User 表是两个账号域，混在一起会让
 *   「/admin/users 停用」与「内部账号停用」在审计与权限上互相串味；
 * - `orgs/admin-orgs.service.ts` 已 963 行，且它的启停只管 partner（assertAccountInOrg 限定角色）；
 * - `auth/auth.service.ts` 已 795 行，项目规则不许再往里加。
 */
@Injectable()
export class AdminInternalAccountsService {
  private readonly logger = new Logger(AdminInternalAccountsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly actionRedis: PartnerAccountActionRedisService,
    private readonly audit: AuditService,
  ) {}

  async list(query: InternalAccountListQuery): Promise<InternalAccountListResult> {
    const keyword = query.keyword?.trim()
    const phone = keyword ? normalizePhone(keyword) : ''
    const keywordWhere = !keyword
      ? {}
      : isValidCnMobile(phone)
        ? { phoneHash: hashPhone(phone) }
        : { OR: [{ username: { contains: keyword } }, { name: { contains: keyword } }] }
    const where = {
      deletedAt: null,
      role: query.role ?? { in: [...INTERNAL_ACCOUNT_ROLES] },
      ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      ...(query.orgId ? { orgId: query.orgId } : {}),
      ...keywordWhere,
    }
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: INTERNAL_ACCOUNT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])
    return { items: rows.map(toInternalAccountItem), total, page: query.page, pageSize: query.pageSize }
  }

  async setStatus(
    actor: AuthedUser,
    targetId: string,
    input: { action: InternalAccountStatusAction; reason: string; adminCurrentPassword: string },
    context: InternalAccountRequestContext,
  ): Promise<InternalAccountItem & { sessionInvalidation: 'ok' | 'failed' }> {
    const admin = await verifyAdminStepUp(
      { prisma: this.prisma, actionRedis: this.actionRedis, audit: this.audit },
      actor.userId,
      input.adminCurrentPassword,
      context,
      `user.${input.action}`,
    )
    const target = await this.prisma.user.findFirst({
      where: { id: targetId, deletedAt: null },
      select: { ...INTERNAL_ACCOUNT_SELECT, tokenVersion: true },
    })
    if (!target) throw internalAccountErrors.notFound()
    if (target.role !== 'admin') throw internalAccountErrors.roleUnsupported()
    const toEnabled = input.action === 'enable'
    if (!toEnabled && target.id === admin.id) throw internalAccountErrors.selfDisable()
    if (target.enabled === toEnabled) throw internalAccountErrors.unchanged()

    try {
      await this.withSerializableRetry(() => this.prisma.$transaction(async (tx: PrismaTransactionClient) => {
        const updated = await tx.user.updateMany({
          where: { id: target.id, role: 'admin', deletedAt: null, enabled: !toEnabled, tokenVersion: target.tokenVersion },
          data: { enabled: toEnabled, tokenVersion: { increment: 1 } },
        })
        if (updated.count !== 1) throw new StaleRollback()
        if (!toEnabled) {
          // 在同一事务里、改完之后数：并发互停时 SQLite 靠单写锁串行，PostgreSQL 靠
          // Serializable 冲突重试，第二个提交者一定能看到第一个的结果。
          const remaining = await tx.user.count({ where: { role: 'admin', enabled: true, deletedAt: null } })
          if (remaining < 1) throw new LastAdminRollback()
        }
        await this.audit.writeRequired(tx, {
          actorId: admin.id,
          actorRole: 'admin',
          action: toEnabled ? 'user.enable' : 'user.disable',
          targetType: 'user',
          targetId: target.id,
          payload: {
            username: target.username,
            role: 'admin',
            isBackupAdmin: target.isBackupAdmin,
            reason: input.reason,
            via: 'admin_console',
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          requestId: context.requestId,
        })
      }, { isolationLevel: 'Serializable' }))
    } catch (error) {
      if (error instanceof LastAdminRollback) throw internalAccountErrors.lastAdmin()
      if (error instanceof StaleRollback || isSerializationConflict(error)) throw internalAccountErrors.stale()
      throw error
    }

    const sessionInvalidation = await publishInternalSessionState(this.redis, this.logger, {
      id: target.id,
      role: 'admin',
      orgId: target.orgId,
      enabled: toEnabled,
      tokenVersion: target.tokenVersion + 1,
      deletedAt: null,
    })
    const fresh = await this.prisma.user.findFirst({ where: { id: target.id }, select: INTERNAL_ACCOUNT_SELECT })
    if (!fresh) throw internalAccountErrors.notFound()
    return { ...toInternalAccountItem(fresh), sessionInvalidation }
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        if (!isSerializationConflict(error) || attempt === 2) throw error
      }
    }
    throw new Error('unreachable')
  }
}
