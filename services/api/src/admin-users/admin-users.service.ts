import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
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
  lastLoginAt: true,
  createdAt: true,
} as const

interface UserListRow {
  id: string
  nickname: string | null
  phoneEnc: string
  enabled: boolean
  lastLoginAt: Date | null
  createdAt: Date
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
