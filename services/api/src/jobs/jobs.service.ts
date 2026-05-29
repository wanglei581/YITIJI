// ============================================================
// Jobs Service — Phase #4 + #2
//
// 全部读写走 Prisma(0b/#5 起的方向)。in-memory SEED_JOBS / SEED_FAIRS 已删除,
// 测试种子数据走 prisma/seed.ts。
//
// 合规约束:
//   - Kiosk 只能查询 reviewStatus=approved + publishStatus=published
//   - Partner 导入默认 pending + draft,必须经 Admin 审核
//   - Admin approve → approved + draft(不直接发布);独立 publish 动作发布
//   - publish 操作前必须断言 reviewStatus === 'approved'(合规红线)
//   - reject 必须把 publishStatus 强制置回 draft,防"已发布的还挂在 Kiosk"
//   - 终态(approved / rejected)不可回退到 pending(需 reopen,本阶段未实现)
//   - 不返回 apiSecret / accessToken / 凭证字段
//
// Fair 模型暂未落 Prisma(留待 Phase #3):
//   读端点(getPublishedFairs / getAllFairSources / getPartnerFairs)返回空,
//   写端点(reviewFairSource / publishFairSource / importFairs / unpublishPartnerFair)
//   抛 FAIR_NOT_IMPLEMENTED。
// ============================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import type { ReviewAction } from './dto/review.dto'
import type { PublishAction } from './dto/publish.dto'
import type { ImportJobItemDto } from './dto/import-jobs.dto'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'

// ─── Internal types(契约镜像于 packages/shared/src/types/{job,admin}.ts)─────

type ReviewStatus  = 'pending' | 'reviewing' | 'approved' | 'rejected'
type PublishStatus = 'draft' | 'published' | 'unpublished' | 'expired'
type FairStatus    = 'upcoming' | 'ongoing' | 'ended'
type WorkType      = 'full_time' | 'part_time' | 'internship' | 'contract'

// ─── DTO shapes returned to callers ──────────────────────────────────────────

export interface JobListItemDto {
  id: string; title: string; company: string; city: string
  salary?: string; tags: string[]; industry?: string; workType?: WorkType; headcount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; syncTime: string
  description?: string; requirements?: string
  salaryDisplay: string
  dataSourceNote: string
}

export interface FairListItemDto {
  id: string; name: string; organizer: string
  startTime: string; endTime: string; venue: string; status: FairStatus
  description?: string; boothCount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; syncTime: string
  hasManagedData: boolean; managedCompanyCount: number; managedMaterialCount: number
  dataSourceNote: string
}

export interface AdminJobDto {
  id: string
  title: string; company: string; city: string
  salary?: string; tags: string[]; description?: string; requirements?: string
  industry?: string; workType?: WorkType; headcount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; syncTime: string
  reviewStatus: ReviewStatus; publishStatus: PublishStatus
  reviewedBy: string | null
  reviewedAt: string | null
  rejectReason: string | null
}

/** Fair admin DTO 形状保留供 Phase #3 落库后使用 */
export interface AdminFairDto {
  id: string
  name: string; organizer: string; startTime: string; endTime: string; venue: string
  status: FairStatus; description?: string; boothCount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; syncTime: string
  reviewStatus: ReviewStatus; publishStatus: PublishStatus
}

export interface PartnerJobDto {
  id: string; externalId: string; title: string; company: string; city: string
  sourceUrl: string; syncTime: string; reviewStatus: ReviewStatus; publishStatus: PublishStatus
  sourceOrgId: string; sourceName: string
}

export interface PartnerFairDto {
  id: string; externalId: string; name: string; organizer: string
  startTime: string; endTime: string; venue: string; status: FairStatus
  sourceUrl: string; syncTime: string; reviewStatus: ReviewStatus; publishStatus: PublishStatus
  sourceOrgId: string; sourceName: string
}

export interface PaginatedResult<T> {
  data: T[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export interface SingleResult<T> {
  data: T | null
  success: boolean
}

export interface ImportResult<T> {
  imported: number
  items: T[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeJsonArr(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function fmtSyncTime(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16)
}

/** Prisma Job 行的最小形状(避免在源文件深度依赖 Prisma 命名空间类型) */
interface PrismaJobRow {
  id:            string
  sourceOrgId:   string
  externalId:    string
  sourceName:    string
  sourceUrl:     string
  title:         string
  company:       string
  city:          string
  category:      string | null
  salary:        string | null
  description:   string | null
  requirements:  string | null
  tagsJson:      string
  reviewStatus:  string
  publishStatus: string
  reviewedBy:    string | null
  reviewedAt:    Date   | null
  rejectReason:  string | null
  syncTime:      Date
}

function prismaJobToListItem(j: PrismaJobRow): JobListItemDto {
  const tags = safeJsonArr(j.tagsJson)
  return {
    id: j.id, title: j.title, company: j.company, city: j.city,
    salary: j.salary ?? undefined, tags,
    industry: undefined,
    workType: undefined,
    headcount: undefined,
    sourceOrgId: j.sourceOrgId, externalId: j.externalId,
    sourceName: j.sourceName, sourceUrl: j.sourceUrl,
    syncTime: fmtSyncTime(j.syncTime),
    description: j.description ?? undefined,
    requirements: j.requirements ?? undefined,
    salaryDisplay: j.salary ?? '薪资面议',
    dataSourceNote: `数据来源：${j.sourceName} · 同步于 ${j.syncTime.toISOString().slice(0, 10)} · 仅供参考`,
  }
}

function prismaJobToAdminDto(j: PrismaJobRow): AdminJobDto {
  return {
    id: j.id,
    title: j.title, company: j.company, city: j.city,
    salary: j.salary ?? undefined,
    tags: safeJsonArr(j.tagsJson),
    description: j.description ?? undefined,
    requirements: j.requirements ?? undefined,
    industry: undefined,
    workType: undefined,
    headcount: undefined,
    sourceOrgId: j.sourceOrgId, externalId: j.externalId,
    sourceName: j.sourceName, sourceUrl: j.sourceUrl,
    syncTime: fmtSyncTime(j.syncTime),
    reviewStatus:  j.reviewStatus  as ReviewStatus,
    publishStatus: j.publishStatus as PublishStatus,
    reviewedBy: j.reviewedBy,
    reviewedAt: j.reviewedAt ? j.reviewedAt.toISOString() : null,
    rejectReason: j.rejectReason,
  }
}

function prismaJobToPartnerDto(j: PrismaJobRow): PartnerJobDto {
  return {
    id: j.id, externalId: j.externalId, title: j.title, company: j.company, city: j.city,
    sourceUrl: j.sourceUrl,
    syncTime: fmtSyncTime(j.syncTime),
    reviewStatus:  j.reviewStatus  as ReviewStatus,
    publishStatus: j.publishStatus as PublishStatus,
    sourceOrgId: j.sourceOrgId, sourceName: j.sourceName,
  }
}

/**
 * Import DTO 的 workType('full_time' / 'part_time' / 'internship' / 'contract')
 * 映射到 Prisma Job.category('fulltime' / 'parttime' / 'intern' / 'campus')。
 * 'contract' 暂归 'fulltime'(接近全职合同制,后续可独立分类)。
 */
function mapWorkTypeToCategory(workType: string): string {
  switch (workType) {
    case 'full_time':  return 'fulltime'
    case 'part_time':  return 'parttime'
    case 'internship': return 'intern'
    case 'contract':   return 'fulltime'
    default:           return 'fulltime'
  }
}

const FAIR_NOT_IMPLEMENTED = {
  error: {
    code: 'FAIR_NOT_IMPLEMENTED',
    message: '招聘会模块尚未接入数据库,见 docs/progress/next-tasks.md Phase #3',
  },
} as const

function emptyPaginated<T>(page = 1, pageSize = 20): PaginatedResult<T> {
  return { data: [], pagination: { page, pageSize, total: 0, totalPages: 1 } }
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ── Kiosk:只读 approved+published ───────────────────────────────────────────

  async getPublishedJobs(params?: { tag?: string; city?: string; page?: number; pageSize?: number }): Promise<PaginatedResult<JobListItemDto>> {
    const page     = Math.max(1, params?.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20))
    const where = {
      reviewStatus:  'approved',
      publishStatus: 'published',
      ...(params?.city ? { city: params.city } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { syncTime: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.job.count({ where }),
    ])
    // tag 过滤:SQLite tagsJson 是字符串,在应用层 filter。Postgres 切 String[] 后改 DB 层。
    const filtered = params?.tag
      ? rows.filter((j) => safeJsonArr(j.tagsJson).includes(params.tag!))
      : rows
    return {
      data: filtered.map(prismaJobToListItem),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  async getPublishedJobById(id: string): Promise<SingleResult<JobListItemDto>> {
    const j = await this.prisma.job.findFirst({
      where: { id, reviewStatus: 'approved', publishStatus: 'published' },
    })
    return { data: j ? prismaJobToListItem(j) : null, success: true }
  }

  async getPublishedFairs(_params?: { status?: string; page?: number; pageSize?: number }): Promise<PaginatedResult<FairListItemDto>> {
    // TODO Phase #3:Fair Prisma model 落地后改 prisma.fair.findMany
    return emptyPaginated<FairListItemDto>(_params?.page ?? 1, _params?.pageSize ?? 20)
  }

  async getPublishedFairById(_id: string): Promise<SingleResult<FairListItemDto>> {
    return { data: null, success: true }
  }

  // ── Admin:全集合 + 审核/发布(状态机)─────────────────────────────────────

  async getAllJobSources(): Promise<AdminJobDto[]> {
    const rows = await this.prisma.job.findMany({ orderBy: { createdAt: 'desc' } })
    return rows.map(prismaJobToAdminDto)
  }

  /**
   * 状态机:
   *   - 终态 approved / rejected 不可回退到 pending(需独立 reopen 接口,未实现)
   *   - approve   → reviewStatus=approved,publishStatus 重置为 draft(等下一步 publish 动作)
   *                rejectReason 清空
   *   - reject    → reviewStatus=rejected,publishStatus 强制 draft(防"已发布的还挂在 Kiosk")
   *                reason 必填
   *   - reviewing → 只把状态标记为 reviewing,其他不动
   */
  async reviewJobSource(id: string, action: ReviewAction, reason: string | undefined, user: AuthedUser): Promise<AdminJobDto> {
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }
    if (job.reviewStatus === 'approved' || job.reviewStatus === 'rejected') {
      throw new BadRequestException({
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `审核终态 ${job.reviewStatus} 不可回退,需走 reopen 流程`,
        },
      })
    }

    let data: {
      reviewStatus:  string
      publishStatus?: string
      rejectReason?:  string | null
    }
    if (action === 'reviewing') {
      data = { reviewStatus: 'reviewing' }
    } else if (action === 'approve') {
      data = { reviewStatus: 'approved', publishStatus: 'draft', rejectReason: null }
    } else {
      // reject:reason 必填
      const trimmed = (reason ?? '').trim()
      if (trimmed.length === 0) {
        throw new BadRequestException({
          error: { code: 'REJECT_REASON_REQUIRED', message: 'reject 必须提供 reason' },
        })
      }
      data = { reviewStatus: 'rejected', publishStatus: 'draft', rejectReason: trimmed }
    }

    try {
      const updated = await this.prisma.job.update({
        where: { id },
        data: { ...data, reviewedBy: user.userId, reviewedAt: new Date() },
      })
      this.logger.log(`reviewJobSource: id=${id} action=${action} by=${user.userId}`)
      return prismaJobToAdminDto(updated)
    } catch (e) {
      this.logger.error(`reviewJobSource failed: id=${id}`, e as Error)
      throw new InternalServerErrorException({ error: { code: 'REVIEW_FAILED', message: '审核动作失败' } })
    }
  }

  async publishJobSource(id: string, action: PublishAction, _user: AuthedUser): Promise<AdminJobDto> {
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }

    if (action === 'publish') {
      // 合规红线:必须通过审核才能发布
      if (job.reviewStatus !== 'approved') {
        throw new BadRequestException({
          error: { code: 'PUBLISH_REQUIRES_APPROVAL', message: '未通过审核的岗位不得发布' },
        })
      }
    }

    const updated = await this.prisma.job.update({
      where: { id },
      data: { publishStatus: action === 'publish' ? 'published' : 'unpublished' },
    })
    this.logger.log(`publishJobSource: id=${id} action=${action}`)
    return prismaJobToAdminDto(updated)
  }

  async getAllFairSources(): Promise<AdminFairDto[]> {
    return [] // TODO Phase #3
  }

  async reviewFairSource(_id: string, _action: ReviewAction, _reason: string | undefined, _user: AuthedUser): Promise<AdminFairDto> {
    throw new BadRequestException(FAIR_NOT_IMPLEMENTED)
  }

  async publishFairSource(_id: string, _action: PublishAction, _user: AuthedUser): Promise<AdminFairDto> {
    throw new BadRequestException(FAIR_NOT_IMPLEMENTED)
  }

  // ── Partner:本机构数据 ─────────────────────────────────────────────────────

  async getPartnerJobs(user: AuthedUser): Promise<PartnerJobDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.job.findMany({
      where: { sourceOrgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(prismaJobToPartnerDto)
  }

  /**
   * Phase #5 — Partner 导入岗位,落 Job 表。
   *
   * 安全约束:
   *  - sourceOrgId 强制取自 JWT 的 user.orgId,不读 body
   *  - sourceName 来自 DB 中机构当前名,不读 body
   *  - 默认 reviewStatus='pending' / publishStatus='draft'
   *  - 重复(sourceOrgId, externalId)走 upsert 幂等:只刷新展示字段,
   *    审核/发布状态不动(防"刷字段绕审核")
   */
  async importJobs(items: ImportJobItemDto[], user: AuthedUser): Promise<ImportResult<PartnerJobDto>> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({
        error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' },
      })
    }

    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({
        error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' },
      })
    }

    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()

    const out: PartnerJobDto[] = []
    for (const item of items) {
      try {
        const job = await this.prisma.job.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId, externalId: item.externalId } },
          create: {
            sourceOrgId, externalId: item.externalId, sourceName,
            sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(item.tags ?? []),
            reviewStatus: 'pending', publishStatus: 'draft',
            syncTime: sync,
          },
          update: {
            sourceName, sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(item.tags ?? []),
            syncTime: sync,
          },
        })
        out.push(prismaJobToPartnerDto(job))
      } catch (e) {
        this.logger.error(`importJobs upsert failed: orgId=${sourceOrgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({
          error: { code: 'IMPORT_FAILED', message: '岗位导入失败,请稍后重试' },
        })
      }
    }

    this.logger.log(`importJobs: orgId=${sourceOrgId} count=${out.length}`)
    return { imported: out.length, items: out }
  }

  async unpublishPartnerJob(id: string, user: AuthedUser): Promise<PartnerJobDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const job = await this.prisma.job.findUnique({ where: { id } })
    // 找不到 OR 不属于本机构 — 不区分原因,防机构枚举
    if (!job || job.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }
    const updated = await this.prisma.job.update({
      where: { id },
      data: { publishStatus: 'unpublished' },
    })
    return prismaJobToPartnerDto(updated)
  }

  async getPartnerFairs(_user: AuthedUser): Promise<PartnerFairDto[]> {
    return [] // TODO Phase #3
  }

  async importFairs(_dto: unknown, _user: AuthedUser): Promise<ImportResult<PartnerFairDto>> {
    throw new BadRequestException(FAIR_NOT_IMPLEMENTED)
  }

  async unpublishPartnerFair(_id: string, _user: AuthedUser): Promise<PartnerFairDto> {
    throw new BadRequestException(FAIR_NOT_IMPLEMENTED)
  }
}
