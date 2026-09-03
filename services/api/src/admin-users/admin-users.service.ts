import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { isISO8601 } from 'class-validator'
import type { Prisma } from '../generated/prisma/client'
import { AuditService } from '../audit/audit.service'
import { hashPhone, isValidCnMobile, maskPhoneFromEnc, normalizePhone } from '../common/crypto/phone-identity'
import { isVisibleMemberFileWhere } from '../files/retention-policy'
import { PrismaService } from '../prisma/prisma.service'
import type {
  AdminUserActivityItem,
  AdminUserAuditContext,
  AdminUserDetailResult,
  AdminUserListItem,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserManagedStatus,
  AdminUserStatusChangeResult,
  AdminUserStatusIntent,
} from './admin-users.types'

const RETENTION_NOTICE =
  '文件、AI、浏览与外部跳转为当前留存记录，数据会按隐私留存策略清理；打印任务为系统现存记录。'
const ALLOWED_PAGE_SIZES = new Set([10, 20, 50, 100])
const LOGGER = new Logger('AdminUsersService')

const USER_LIST_SELECT = {
  id: true,
  nickname: true,
  phoneEnc: true,
  enabled: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const

const STATUS_SELECT = { ...USER_LIST_SELECT, statusChangedAt: true } as const

interface UserListRow {
  id: string
  nickname: string | null
  phoneEnc: string
  enabled: boolean
  status: string
  lastLoginAt: Date | null
  createdAt: Date
}

/**
 * 管理员可写的两条状态迁移。
 *
 * `from` 是 CAS 的前置条件，不是装饰：它把 closing / anonymized 挡在门外。
 * 已匿名化的账号手机号密文已换成墓碑值，「恢复」无法还原任何东西；
 * 注销中的账号由隐私执行器推进，管理员插一脚会让那条流水线状态错乱。
 */
const STATUS_TRANSITIONS = {
  disable: { from: 'active', to: 'disabled', enabled: false, action: 'admin.user.disable' },
  restore: { from: 'disabled', to: 'active', enabled: true, action: 'admin.user.restore' },
} as const satisfies Record<
  AdminUserStatusIntent,
  { from: AdminUserManagedStatus; to: AdminUserManagedStatus; enabled: boolean; action: string }
>

const STATUS_CONFLICT_MESSAGES: Record<string, string> = {
  closing: '该账号正在注销流程中，不能由管理员改变状态',
  anonymized: '该账号已匿名化注销，无法恢复',
}

/** 仅用于把事务内的 CAS 失败与「审计写不进去」区分开，不会外泄成 HTTP 响应。 */
class StatusTransitionConflictError extends Error {}

function normalizeReason(reason: string): string {
  const trimmed = typeof reason === 'string' ? reason.trim() : ''
  if (trimmed.length < 2 || trimmed.length > 200) {
    throw new BadRequestException({
      error: { code: 'ADMIN_USER_STATUS_REASON_REQUIRED', message: '请填写 2-200 字的操作原因' },
    })
  }
  return trimmed
}

function dateRangeError(): BadRequestException {
  return new BadRequestException({
    error: { code: 'ADMIN_USER_DATE_RANGE_INVALID', message: '注册时间范围无效' },
  })
}

function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined
  if (!isISO8601(value, { strict: true })) throw dateRangeError()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw dateRangeError()
  return parsed
}

function registrationRange(query: AdminUserListQuery): { gte?: Date; lte?: Date } | undefined {
  const gte = parseDate(query.registeredFrom)
  const lte = parseDate(query.registeredTo)
  if (gte && lte && gte.getTime() > lte.getTime()) throw dateRangeError()
  if (!gte && !lte) return undefined
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) }
}

function currentFileWhere(endUserId: string, now: Date): Prisma.FileObjectWhereInput {
  return {
    ...isVisibleMemberFileWhere(endUserId, now),
    purpose: { not: 'signature_image' },
  }
}

function toListItem(row: UserListRow): AdminUserListItem {
  let maskedPhone = '***'
  try {
    maskedPhone = maskPhoneFromEnc(row.phoneEnc)
  } catch {
    LOGGER.warn(`手机号密文解密失败，已降级脱敏展示 endUserId=${row.id}`)
  }

  return {
    id: row.id,
    nickname: row.nickname,
    maskedPhone,
    enabled: row.enabled,
    status: row.status as AdminUserListItem['status'],
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function validatePagination(query: AdminUserListQuery): void {
  const pageIsValid = Number.isSafeInteger(query.page) && query.page >= 1 && query.page <= 10_000
  const pageSizeIsValid = Number.isSafeInteger(query.pageSize) && ALLOWED_PAGE_SIZES.has(query.pageSize)
  if (!pageIsValid || !pageSizeIsValid) {
    throw new BadRequestException({
      error: { code: 'ADMIN_USER_PAGE_INVALID', message: '分页参数无效' },
    })
  }
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminUserListQuery, auditContext: AdminUserAuditContext): Promise<AdminUserListResult> {
    validatePagination(query)
    const keyword = query.keyword?.trim() || undefined
    const hasPhoneQuery = query.phone !== undefined
    if (hasPhoneQuery && keyword) {
      throw new BadRequestException({
        error: { code: 'ADMIN_USER_SEARCH_CONFLICT', message: '昵称与手机号不能同时查询' },
      })
    }

    const normalizedPhone = hasPhoneQuery ? normalizePhone(query.phone ?? '') : undefined
    if (normalizedPhone !== undefined && !isValidCnMobile(normalizedPhone)) {
      throw new BadRequestException({
        error: { code: 'ADMIN_USER_PHONE_INVALID', message: '请输入有效的完整大陆手机号' },
      })
    }

    const createdAt = registrationRange(query)
    const exactPhoneHash = normalizedPhone ? hashPhone(normalizedPhone) : undefined
    const where: Prisma.EndUserWhereInput = {
      ...(exactPhoneHash ? { phoneHash: exactPhoneHash } : {}),
      ...(keyword ? { nickname: { contains: keyword } } : {}),
      ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      ...(createdAt ? { createdAt } : {}),
    }

    const [rows, total, exactPhoneMatch] = await Promise.all([
      this.prisma.endUser.findMany({
        where,
        select: USER_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.endUser.count({ where }),
      exactPhoneHash
        ? this.prisma.endUser.findUnique({ where: { phoneHash: exactPhoneHash }, select: { id: true } })
        : Promise.resolve(null),
    ])
    const items = rows.map(toListItem)

    if (normalizedPhone !== undefined) {
      await this.writeRequiredAudit({
        ...auditContext,
        action: 'admin.user.phone_search',
        targetType: 'EndUser',
        targetId: exactPhoneMatch?.id ?? null,
        payload: { matched: Boolean(exactPhoneMatch), queryType: 'exact_phone' },
      })
    }

    return { items, total, page: query.page, pageSize: query.pageSize }
  }

  async getDetail(endUserId: string, auditContext: AdminUserAuditContext): Promise<AdminUserDetailResult> {
    const row = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { ...USER_LIST_SELECT, updatedAt: true },
    })
    if (!row) {
      throw new NotFoundException({
        error: { code: 'ADMIN_USER_NOT_FOUND', message: '用户不存在' },
      })
    }

    const user = { ...toListItem(row), updatedAt: row.updatedAt.toISOString() }
    const now = new Date()
    const fileWhere = currentFileWhere(endUserId, now)
    const [stats, recentActivities] = await Promise.all([
      this.loadStats(endUserId, now, fileWhere),
      this.loadRecentActivities(endUserId, now, fileWhere),
    ])

    await this.writeRequiredAudit({
      ...auditContext,
      action: 'admin.user.detail.view',
      targetType: 'EndUser',
      targetId: endUserId,
      payload: { sections: ['summary', 'stats', 'recent_activity'] },
    })

    return { user, stats, recentActivities, retentionNotice: RETENTION_NOTICE }
  }

  /**
   * 停用 / 恢复终端用户。
   *
   * 三条不变量，改这个方法前请先读懂它们：
   *
   * 1. `enabled`、`status`、`statusChangedAt` 必须同事务一起写。
   *    `statusChangedAt` 被 member-step-up.service.ts:216 编进 step-up 授权票据并逐字比对，
   *    漏写会让被停用者手里的票据继续有效 —— 状态改了，权限没收回。
   *
   * 2. 审计与状态变更同事务（audit.writeRequired，不是 write）。
   *    权限动作没有「改了但查不到是谁改的」这种中间态：审计插不进去就连状态一起回滚。
   *
   * 3. CAS 的 where 带 `status: from`。这是挡住 closing / anonymized 的唯一屏障，
   *    别把它简化成 `where: { id }`。
   */
  async setStatus(
    endUserId: string,
    intent: AdminUserStatusIntent,
    reason: string,
    auditContext: AdminUserAuditContext,
  ): Promise<AdminUserStatusChangeResult> {
    const transition = STATUS_TRANSITIONS[intent]
    const normalizedReason = normalizeReason(reason)

    const current = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: STATUS_SELECT,
    })
    if (!current) {
      throw new NotFoundException({
        error: { code: 'ADMIN_USER_NOT_FOUND', message: '用户不存在' },
      })
    }

    // 幂等：已经是目标状态就直接回执，不报错也不写审计。
    // 重复点击不产生新事实；为它补一条审计只会稀释真正那次停用记录的追责价值。
    if (current.status === transition.to) {
      return {
        user: toListItem(current),
        changed: false,
        statusChangedAt: current.statusChangedAt?.toISOString() ?? null,
      }
    }
    if (current.status !== transition.from) throw this.statusConflict(current.status)

    const now = new Date()
    let updated: (UserListRow & { statusChangedAt: Date | null }) | null
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.endUser.updateMany({
          where: { id: endUserId, status: transition.from },
          data: { enabled: transition.enabled, status: transition.to, statusChangedAt: now },
        })
        if (changed.count !== 1) throw new StatusTransitionConflictError()

        await this.audit.writeRequired(tx, {
          ...auditContext,
          action: transition.action,
          targetType: 'EndUser',
          targetId: endUserId,
          payload: {
            reason: normalizedReason,
            fromStatus: transition.from,
            toStatus: transition.to,
          },
        })

        return tx.endUser.findUnique({ where: { id: endUserId }, select: STATUS_SELECT })
      })
    } catch (error) {
      if (error instanceof StatusTransitionConflictError) throw this.statusConflict(current.status)
      // 走到这里说明事务已回滚，账号状态没有变。审计不可用时宁可拒绝操作，
      // 也不留下一次无法追责的停用。
      LOGGER.error(`账号状态变更事务失败 endUserId=${endUserId} intent=${intent}: ${(error as Error).message}`)
      throw new ServiceUnavailableException({
        error: { code: 'ADMIN_USER_AUDIT_UNAVAILABLE', message: '状态变更未能写入审计，已回滚，请稍后重试' },
      })
    }

    if (!updated) {
      throw new NotFoundException({
        error: { code: 'ADMIN_USER_NOT_FOUND', message: '用户不存在' },
      })
    }
    return {
      user: toListItem(updated),
      changed: true,
      statusChangedAt: updated.statusChangedAt?.toISOString() ?? null,
    }
  }

  private statusConflict(currentStatus: string): ConflictException {
    return new ConflictException({
      error: {
        code: 'ADMIN_USER_STATUS_CONFLICT',
        message: STATUS_CONFLICT_MESSAGES[currentStatus] ?? '账号当前状态不支持该操作，请刷新后重试',
      },
    })
  }

  private async writeRequiredAudit(args: Parameters<AuditService['write']>[0]): Promise<void> {
    const auditId = await this.audit.write(args)
    if (auditId === null) {
      throw new ServiceUnavailableException({
        error: { code: 'ADMIN_USER_AUDIT_UNAVAILABLE', message: '审计服务暂不可用，请稍后重试' },
      })
    }
  }

  private async loadStats(
    endUserId: string,
    now: Date,
    fileWhere: Prisma.FileObjectWhereInput,
  ): Promise<AdminUserDetailResult['stats']> {
    const [fileCount, printTaskCount, aiResultCount, browseCount, externalJumpCount] = await Promise.all([
      this.prisma.fileObject.count({ where: fileWhere }),
      this.prisma.printTask.count({ where: { endUserId } }),
      this.prisma.aiResumeResult.count({ where: { endUserId, expiresAt: { gt: now } } }),
      this.prisma.browseLog.count({ where: { endUserId, expiresAt: { gt: now } } }),
      this.prisma.externalJumpLog.count({ where: { endUserId, expiresAt: { gt: now } } }),
    ])
    return { fileCount, printTaskCount, aiResultCount, browseCount, externalJumpCount }
  }

  private async loadRecentActivities(
    endUserId: string,
    now: Date,
    fileWhere: Prisma.FileObjectWhereInput,
  ): Promise<AdminUserActivityItem[]> {
    const [files, printTasks, aiResults, browseLogs, externalJumps] = await Promise.all([
      this.prisma.fileObject.findMany({
        where: fileWhere,
        select: { id: true, purpose: true, status: true, mimeType: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
      this.prisma.printTask.findMany({
        where: { endUserId },
        select: { id: true, status: true, terminalId: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
      this.prisma.aiResumeResult.findMany({
        where: { endUserId, expiresAt: { gt: now } },
        select: { id: true, kind: true, status: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
      this.prisma.browseLog.findMany({
        where: { endUserId, expiresAt: { gt: now } },
        select: { id: true, targetType: true, terminalId: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
      this.prisma.externalJumpLog.findMany({
        where: { endUserId, expiresAt: { gt: now } },
        select: { id: true, targetType: true, action: true, terminalId: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
    ])

    const activities: AdminUserActivityItem[] = [
      ...files.map((item) => ({
        id: item.id, type: 'file' as const, occurredAt: item.createdAt.toISOString(),
        status: item.status, terminalId: null, category: `${item.purpose}:${item.mimeType}`, action: null,
      })),
      ...printTasks.map((item) => ({
        id: item.id, type: 'print' as const, occurredAt: item.createdAt.toISOString(),
        status: item.status, terminalId: item.terminalId, category: null, action: null,
      })),
      ...aiResults.map((item) => ({
        id: item.id, type: 'ai' as const, occurredAt: item.createdAt.toISOString(),
        status: item.status, terminalId: null, category: item.kind, action: null,
      })),
      ...browseLogs.map((item) => ({
        id: item.id, type: 'browse' as const, occurredAt: item.createdAt.toISOString(),
        status: null, terminalId: item.terminalId, category: item.targetType, action: null,
      })),
      ...externalJumps.map((item) => ({
        id: item.id, type: 'external_jump' as const, occurredAt: item.createdAt.toISOString(),
        status: null, terminalId: item.terminalId, category: item.targetType, action: item.action,
      })),
    ]

    return [...activities]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
      .slice(0, 20)
  }
}
