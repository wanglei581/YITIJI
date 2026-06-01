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
import type { ImportFairsDto } from './dto/import-fairs.dto'
import type { CreateDataSourceDto } from './dto/data-source.dto'
import {
  JOB_STANDARD_FIELDS,
  JOB_REQUIRED_FIELDS,
  FAIR_STANDARD_FIELDS,
  FAIR_REQUIRED_FIELDS,
  type FieldMapping,
  type ParsedRow,
} from './dto/excel-import.dto'
import * as XLSX from 'xlsx'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { encryptSecret, generateWebhookSecret } from '../common/crypto/secret-cipher'
import { mapFair, mapFairCompany, mapFairZone } from './fair.mapper'
import type { FairDetailResponse } from './fair.types'

// ─── Internal types(契约镜像于 packages/shared/src/types/{job,admin}.ts)─────
//
// 注:services/api 走 commonjs,packages/shared 是 ESM-only(直接指向 .ts)。
// 互操作复杂,采用"本地副本 + SSOT 注释"约定,与 files/file.types.ts 一致。
// 任何字段变更必须同步:
//   1. packages/shared/src/types/job.ts(前端 SSOT,含 PartnerDataSourceView)
//   2. 本文件 PartnerDataSourceDto / ConnStatus / SyncFrequency 等
//
// Phase 7.11 R4 起,本服务返回的 PartnerDataSourceDto 字段集与契约形状
// **必须**与 shared 的 PartnerDataSourceView 等价 — 不允许出现 apiSecret /
// accessToken / webhookSecret 明文,credentialConfigured 为持久标志,
// webhookSecretOnce 只在创建那一次响应里出现。

type ReviewStatus  = 'pending' | 'reviewing' | 'approved' | 'rejected'
type PublishStatus = 'draft' | 'published' | 'unpublished' | 'expired'
type FairStatus    = 'upcoming' | 'ongoing' | 'ended'
type WorkType      = 'full_time' | 'part_time' | 'internship' | 'contract'
type ConnStatus    = 'connected' | 'error' | 'disabled'
type SourceKind    = 'job_platform' | 'hr_company' | 'school' | 'fair_organizer' | 'aggregator' | 'manual'
type AccessMode    = 'api' | 'excel' | 'csv' | 'json' | 'webhook' | 'manual'
type SyncFrequency = 'realtime' | 'hourly' | 'daily' | 'weekly' | 'manual'

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

export interface SyncLogDto {
  id: string
  no: string
  source: string
  dataType: 'job' | 'fair'
  addedCount: number
  updatedCount: number
  errorCount: number
  dupCount: number
  errorFields: string | null
  errorDetail: string | null
  syncTime: string
  status: 'success' | 'partial' | 'failed'
}

export interface ExcelPreviewDto {
  batchId: string
  totalRows: number
  validRows: number
  invalidRows: number
  dupRows: number
  sampleValid: ExcelPreviewRowDto[]
  sampleInvalid: ExcelPreviewRowDto[]
  sampleDup: ExcelPreviewRowDto[]
}

export interface SingleResult<T> {
  data: T | null
  success: boolean
}

export interface ImportResult<T> {
  imported: number
  items: T[]
}

/**
 * Partner 后台数据源管理 DTO。
 *
 * 契约 = packages/shared PartnerDataSourceView(flat UI projection of DataSourceConfig)。
 * - sourceKind / accessMode / syncFreq 使用收口的字面量联合(不是裸 string)
 * - 不包含 apiSecret / accessToken / webhookSecret 明文
 * - credentialConfigured:持久标志(任意 GET 都会返回)
 * - webhookSecretOnce:**只在创建那一次** 出现,后续 GET 不再回显
 */
export interface PartnerDataSourceDto {
  id: string
  name: string
  sourceKind: SourceKind
  accessMode: AccessMode
  syncFreq: SyncFrequency
  lastSyncTime: string
  connStatus: ConnStatus
  successCount: number
  failCount: number
  description: string
  credentialConfigured: boolean
  endpoint?: string
  webhookUrl?: string
  webhookSecretOnce?: string
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

interface PrismaJobSourceRow {
  id: string
  name: string
  sourceKind: string
  accessMode: string
  syncFreq: string
  enabled: boolean
  description: string | null
  lastSyncAt: Date | null
  lastSyncStatus: string | null
  endpoint: string | null
  encryptedCredential: string | null
  webhookSecret: string | null
}

function prismaJobSourceToPartnerDto(source: PrismaJobSourceRow): PartnerDataSourceDto {
  const connStatus: ConnStatus = !source.enabled
    ? 'disabled'
    : source.lastSyncStatus === 'failed'
      ? 'error'
      : 'connected'
  // Prisma 列是 string;来源是 CreateDataSourceDto 校验过的字面量
  // (data-source.dto.ts @IsIn(...)),运行时安全。as 仅为类型对齐。
  return {
    id: source.id,
    name: source.name,
    sourceKind: source.sourceKind as SourceKind,
    accessMode: source.accessMode as AccessMode,
    syncFreq: source.syncFreq as SyncFrequency,
    lastSyncTime: source.lastSyncAt ? fmtSyncTime(source.lastSyncAt) : '从未同步',
    connStatus,
    successCount: 0,
    failCount: source.lastSyncStatus === 'failed' ? 1 : 0,
    description: source.description ?? '',
    credentialConfigured: Boolean(source.encryptedCredential || source.webhookSecret),
    endpoint: source.endpoint ?? undefined,
  }
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

// ─── Fair Prisma → 旧 DTO 形状(保持现有前端契约) ──────────────────────────
//
// Day 1 我们建立了 packages/shared/src/types/fair.ts 的新形状(Fair / startAt / endAt /
// title 等,Prisma 列对齐)。但 Kiosk/Admin 现有页面消费的是
// FairListItemDto / AdminFairDto / PartnerFairDto(legacy 字段名 name / startTime
// / endTime / organizer / boothCount 等)。
//
// Day 2 不动既有前端契约,把 Prisma 行映射回旧 DTO 形状。后续(Day 3 校企合作
// 详情页 + W3 Kiosk fair 升级)再走新形状走 FairDetailResponse。

interface PrismaJobFairRow {
  id: string
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  title: string
  theme: string
  startAt: Date
  endAt: Date
  venue: string
  city: string
  address: string | null
  mapImageUrl: string | null
  description: string | null
  coverImageUrl: string | null
  companyCount: number
  jobCount: number
  viewCount: number
  reviewStatus: string
  publishStatus: string
  reviewedBy: string | null
  reviewedAt: Date | null
  rejectReason: string | null
  syncTime: Date
}

function deriveFairStatus(startAt: Date, endAt: Date, now = new Date()): FairStatus {
  if (now < startAt) return 'upcoming'
  if (now > endAt) return 'ended'
  return 'ongoing'
}

function prismaFairToListItem(f: PrismaJobFairRow): FairListItemDto {
  return {
    id: f.id,
    name: f.title,
    organizer: f.sourceName,
    startTime: f.startAt.toISOString(),
    endTime: f.endAt.toISOString(),
    venue: f.venue,
    status: deriveFairStatus(f.startAt, f.endAt),
    description: f.description ?? undefined,
    boothCount: f.companyCount,
    sourceOrgId: f.sourceOrgId,
    externalId: f.externalId,
    sourceName: f.sourceName,
    sourceUrl: f.sourceUrl,
    syncTime: fmtSyncTime(f.syncTime),
    hasManagedData: false,
    managedCompanyCount: 0,
    managedMaterialCount: 0,
    dataSourceNote: `数据来源:${f.sourceName} · 同步于 ${f.syncTime.toISOString().slice(0, 10)} · 仅供参考`,
  }
}

function prismaFairToAdminDto(f: PrismaJobFairRow): AdminFairDto {
  return {
    id: f.id,
    name: f.title,
    organizer: f.sourceName,
    startTime: f.startAt.toISOString(),
    endTime: f.endAt.toISOString(),
    venue: f.venue,
    status: deriveFairStatus(f.startAt, f.endAt),
    description: f.description ?? undefined,
    boothCount: f.companyCount,
    sourceOrgId: f.sourceOrgId,
    externalId: f.externalId,
    sourceName: f.sourceName,
    sourceUrl: f.sourceUrl,
    syncTime: fmtSyncTime(f.syncTime),
    reviewStatus: f.reviewStatus as ReviewStatus,
    publishStatus: f.publishStatus as PublishStatus,
  }
}

function prismaFairToPartnerDto(f: PrismaJobFairRow): PartnerFairDto {
  return {
    id: f.id,
    externalId: f.externalId,
    name: f.title,
    organizer: f.sourceName,
    startTime: f.startAt.toISOString(),
    endTime: f.endAt.toISOString(),
    venue: f.venue,
    status: deriveFairStatus(f.startAt, f.endAt),
    sourceUrl: f.sourceUrl,
    syncTime: fmtSyncTime(f.syncTime),
    reviewStatus: f.reviewStatus as ReviewStatus,
    publishStatus: f.publishStatus as PublishStatus,
    sourceOrgId: f.sourceOrgId,
    sourceName: f.sourceName,
  }
}

function toPreviewRow(r: ParsedRow): ExcelPreviewRowDto {
  return {
    rowIndex: r.rowIndex,
    status: r.status,
    data: r.mapped,
    errors: r.errors,
    externalId: r.externalId,
  }
}

interface ExcelPreviewRowDto {
  rowIndex: number
  status: 'ok' | 'invalid' | 'dup'
  data: Record<string, string>
  errors: string[]
  externalId?: string
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  async getPublishedFairs(params?: { status?: string; page?: number; pageSize?: number }): Promise<PaginatedResult<FairListItemDto>> {
    const page     = Math.max(1, params?.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20))
    const where = {
      reviewStatus: 'approved',
      publishStatus: 'published',
    }
    const [rows, total] = await Promise.all([
      this.prisma.jobFair.findMany({
        where,
        orderBy: { startAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.jobFair.count({ where }),
    ])
    let data = rows.map(prismaFairToListItem)
    // 客户端可选 status 过滤(upcoming / ongoing / ended)
    if (params?.status && (params.status === 'upcoming' || params.status === 'ongoing' || params.status === 'ended')) {
      const filterStatus = params.status as FairStatus
      data = data.filter((d) => d.status === filterStatus)
    }
    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  async getPublishedFairById(id: string): Promise<SingleResult<FairListItemDto>> {
    const f = await this.prisma.jobFair.findFirst({
      where: { id, reviewStatus: 'approved', publishStatus: 'published' },
    })
    return { data: f ? prismaFairToListItem(f) : null, success: true }
  }

  /**
   * 招聘会详情(供校企合作详情页 / 普通招聘会详情页一并使用)。
   *
   * 返回 FairDetailResponse:{ fair, companies, zones } 一次拉到位,
   * 前端首屏不再二次请求 companies 和 zones。
   *
   * Kiosk 公开访问,只放出 approved+published。
   */
  async getPublishedFairDetail(id: string): Promise<FairDetailResponse | null> {
    const f = await this.prisma.jobFair.findFirst({
      where: { id, reviewStatus: 'approved', publishStatus: 'published' },
      include: {
        companies: { orderBy: { jobsCount: 'desc' } },
        zones: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!f) return null
    return {
      fair: mapFair(f),
      companies: f.companies.map(mapFairCompany),
      zones: f.zones.map(mapFairZone),
    }
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
      await this.audit.write({
        actorId: user.userId,
        actorRole: 'admin',
        action: 'job.review',
        targetType: 'job',
        targetId: id,
        payload: { action, reason: data.rejectReason ?? null, fromReviewStatus: job.reviewStatus, toReviewStatus: data.reviewStatus },
      })
      this.logger.log(`reviewJobSource: id=${id} action=${action} by=${user.userId}`)
      return prismaJobToAdminDto(updated)
    } catch (e) {
      this.logger.error(`reviewJobSource failed: id=${id}`, e as Error)
      throw new InternalServerErrorException({ error: { code: 'REVIEW_FAILED', message: '审核动作失败' } })
    }
  }

  async publishJobSource(id: string, action: PublishAction, user: AuthedUser): Promise<AdminJobDto> {
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

    const toStatus = action === 'publish' ? 'published' : 'unpublished'
    const updated = await this.prisma.job.update({
      where: { id },
      data: { publishStatus: toStatus },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action: 'job.publish',
      targetType: 'job',
      targetId: id,
      payload: { action, fromPublishStatus: job.publishStatus, toPublishStatus: toStatus },
    })
    this.logger.log(`publishJobSource: id=${id} action=${action}`)
    return prismaJobToAdminDto(updated)
  }

  async getAllFairSources(): Promise<AdminFairDto[]> {
    const rows = await this.prisma.jobFair.findMany({ orderBy: { createdAt: 'desc' } })
    return rows.map(prismaFairToAdminDto)
  }

  /**
   * Fair 审核 — 状态机与 reviewJobSource 完全一致:
   *   终态 approved / rejected 不可回退;reject 必填 reason 且强制 publishStatus=draft;
   *   approve 清空 rejectReason 并把 publishStatus 重置为 draft 等下一步 publish。
   */
  async reviewFairSource(id: string, action: ReviewAction, reason: string | undefined, user: AuthedUser): Promise<AdminFairDto> {
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }
    if (fair.reviewStatus === 'approved' || fair.reviewStatus === 'rejected') {
      throw new BadRequestException({
        error: { code: 'INVALID_STATE_TRANSITION', message: `审核终态 ${fair.reviewStatus} 不可回退,需走 reopen 流程` },
      })
    }

    let data: { reviewStatus: string; publishStatus?: string; rejectReason?: string | null }
    if (action === 'reviewing') {
      data = { reviewStatus: 'reviewing' }
    } else if (action === 'approve') {
      data = { reviewStatus: 'approved', publishStatus: 'draft', rejectReason: null }
    } else {
      const trimmed = (reason ?? '').trim()
      if (trimmed.length === 0) {
        throw new BadRequestException({ error: { code: 'REJECT_REASON_REQUIRED', message: 'reject 必须提供 reason' } })
      }
      data = { reviewStatus: 'rejected', publishStatus: 'draft', rejectReason: trimmed }
    }

    try {
      const updated = await this.prisma.jobFair.update({
        where: { id },
        data: { ...data, reviewedBy: user.userId, reviewedAt: new Date() },
      })
      await this.audit.write({
        actorId: user.userId,
        actorRole: 'admin',
        action: 'fair.review',
        targetType: 'fair',
        targetId: id,
        payload: { action, reason: data.rejectReason ?? null, fromReviewStatus: fair.reviewStatus, toReviewStatus: data.reviewStatus },
      })
      this.logger.log(`reviewFairSource: id=${id} action=${action} by=${user.userId}`)
      return prismaFairToAdminDto(updated)
    } catch (e) {
      this.logger.error(`reviewFairSource failed: id=${id}`, e as Error)
      throw new InternalServerErrorException({ error: { code: 'REVIEW_FAILED', message: '审核动作失败' } })
    }
  }

  async publishFairSource(id: string, action: PublishAction, user: AuthedUser): Promise<AdminFairDto> {
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }
    if (action === 'publish' && fair.reviewStatus !== 'approved') {
      throw new BadRequestException({
        error: { code: 'PUBLISH_REQUIRES_APPROVAL', message: '未通过审核的招聘会不得发布' },
      })
    }
    const toStatus = action === 'publish' ? 'published' : 'unpublished'
    const updated = await this.prisma.jobFair.update({
      where: { id },
      data: { publishStatus: toStatus },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action: 'fair.publish',
      targetType: 'fair',
      targetId: id,
      payload: { action, fromPublishStatus: fair.publishStatus, toPublishStatus: toStatus },
    })
    this.logger.log(`publishFairSource: id=${id} action=${action}`)
    return prismaFairToAdminDto(updated)
  }

  // ── Partner:本机构数据 ─────────────────────────────────────────────────────

  async getPartnerDataSources(user: AuthedUser): Promise<PartnerDataSourceDto[]> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const sources = await this.prisma.jobSource.findMany({
      where: { orgId: user.orgId },
      orderBy: { updatedAt: 'desc' },
    })
    return sources.map(prismaJobSourceToPartnerDto)
  }

  /**
   * Partner 新增数据源。
   *
   * 敏感字段只在服务端处理：
   * - API credential → encryptedCredential
   * - Webhook credential / 自动生成 secret → webhookSecret（AES-GCM 加密）
   * Webhook 原始 secret 仅在创建响应中返回一次，前端不得持久化展示。
   */
  async createPartnerDataSource(
    dto: CreateDataSourceDto,
    user: AuthedUser,
  ): Promise<PartnerDataSourceDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }

    const accessMode = dto.accessMode ?? 'excel'
    const sourceKind = dto.sourceKind ?? 'manual'
    const syncFreq = dto.syncFreq ?? 'manual'

    if (accessMode === 'api' && !dto.endpoint) {
      throw new BadRequestException({ error: { code: 'API_ENDPOINT_REQUIRED', message: 'API 数据源必须填写 endpoint' } })
    }

    const webhookSecretOnce = accessMode === 'webhook'
      ? (dto.credential ?? generateWebhookSecret())
      : undefined

    const source = await this.prisma.jobSource.create({
      data: {
        orgId: user.orgId,
        name: dto.name.trim(),
        sourceKind,
        accessMode,
        syncFreq,
        description: dto.description,
        endpoint: dto.endpoint,
        authType: dto.authType,
        encryptedCredential: accessMode === 'api' && dto.credential ? encryptSecret(dto.credential) : undefined,
        webhookSecret: webhookSecretOnce ? encryptSecret(webhookSecretOnce) : undefined,
        webhookSecretRotatedAt: webhookSecretOnce ? new Date() : undefined,
      },
    })

    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'data_source.create',
      targetType: 'job_source',
      targetId: source.id,
      payload: { accessMode, sourceKind, credentialConfigured: Boolean(dto.credential || webhookSecretOnce) },
    })

    return {
      ...prismaJobSourceToPartnerDto(source),
      webhookUrl: accessMode === 'webhook' ? `/api/v1/sync/webhook?source=${source.id}` : undefined,
      webhookSecretOnce,
    }
  }

  async togglePartnerDataSource(id: string, user: AuthedUser): Promise<PartnerDataSourceDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const source = await this.prisma.jobSource.findUnique({ where: { id } })
    if (!source || source.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }
    const updated = await this.prisma.jobSource.update({
      where: { id },
      data: { enabled: !source.enabled },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'data_source.toggle',
      targetType: 'job_source',
      targetId: id,
      payload: { enabled: updated.enabled },
    })
    return prismaJobSourceToPartnerDto(updated)
  }

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

    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'job.import',
      targetType: 'job',
      targetId: null,
      payload: { count: out.length, externalIds: out.map((o) => o.externalId).slice(0, 20) },
    })

    this.logger.log(`importJobs: orgId=${sourceOrgId} count=${out.length}`)
    return { imported: out.length, items: out }
  }

  /**
   * Webhook 入口的导入(BE-8 W3)。
   *
   * 与 importJobs 共用同一套 upsert 状态机,但:
   *   - 不读 JWT,sourceOrgId 由调用方(SyncService)从 JobSource 取
   *   - 不写自己的 audit(由 SyncService 统一写 webhook 上下文的 audit)
   *   - 不做 partner 角色 / orgId 校验(已在 SyncService 验签阶段完成)
   *
   * 字段集 = WebhookJobItemDto,与 ImportJobItemDto 字段高度重叠,
   * 故内部转换后调用 importJobs 的内部 upsert 路径。
   */
  async importJobsFromWebhook(
    orgId: string,
    sourceId: string,
    items: ImportJobItemDto[],
  ): Promise<ImportResult<PartnerJobDto>> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const sourceName = org.name
    const sync = new Date()
    const out: PartnerJobDto[] = []

    for (const item of items) {
      try {
        const job = await this.prisma.job.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId: orgId, externalId: item.externalId } },
          create: {
            sourceOrgId: orgId, sourceId, externalId: item.externalId, sourceName,
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
            sourceId,
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
        this.logger.error(`importJobsFromWebhook upsert failed: orgId=${orgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({ error: { code: 'IMPORT_FAILED', message: 'Webhook 导入失败,请稍后重试' } })
      }
    }
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

  async getPartnerFairs(user: AuthedUser): Promise<PartnerFairDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.jobFair.findMany({
      where: { sourceOrgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(prismaFairToPartnerDto)
  }

  /**
   * Partner 批量导入招聘会(BE-7 W2)。
   *
   * 同 importJobs:
   *   sourceOrgId 强制 from JWT,不读 body
   *   sourceName 从 DB 取当前机构名,不读 body
   *   默认 pending + draft
   *   (sourceOrgId, externalId) upsert 幂等;审核/发布状态不刷
   */
  async importFairs(dto: ImportFairsDto, user: AuthedUser): Promise<ImportResult<PartnerFairDto>> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()

    const out: PartnerFairDto[] = []
    for (const item of dto.items) {
      const startAt = new Date(item.startAt)
      const endAt   = new Date(item.endAt)
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        throw new BadRequestException({
          error: { code: 'INVALID_DATETIME', message: `招聘会 ${item.externalId} 的时间格式无效(需 ISO 8601)` },
        })
      }
      if (endAt.getTime() <= startAt.getTime()) {
        throw new BadRequestException({
          error: { code: 'INVALID_DATE_RANGE', message: `招聘会 ${item.externalId} 的结束时间必须晚于开始时间` },
        })
      }
      try {
        const fair = await this.prisma.jobFair.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId, externalId: item.externalId } },
          create: {
            sourceOrgId, externalId: item.externalId, sourceName,
            sourceUrl: item.sourceUrl,
            title: item.title,
            theme: item.theme ?? 'general',
            startAt, endAt,
            venue: item.venue, city: item.city,
            address: item.address,
            mapImageUrl: item.mapImageUrl,
            coverImageUrl: item.coverImageUrl,
            description: item.description,
            companyCount: item.companyCount ?? 0,
            jobCount: item.jobCount ?? 0,
            reviewStatus: 'pending', publishStatus: 'draft',
            syncTime: sync,
          },
          update: {
            sourceName, sourceUrl: item.sourceUrl,
            title: item.title,
            theme: item.theme ?? 'general',
            startAt, endAt,
            venue: item.venue, city: item.city,
            address: item.address,
            mapImageUrl: item.mapImageUrl,
            coverImageUrl: item.coverImageUrl,
            description: item.description,
            companyCount: item.companyCount ?? undefined,
            jobCount: item.jobCount ?? undefined,
            syncTime: sync,
            // 审核/发布状态故意不更新,防"刷字段绕审核"
          },
        })
        out.push(prismaFairToPartnerDto(fair))
      } catch (e) {
        this.logger.error(`importFairs upsert failed: orgId=${sourceOrgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({ error: { code: 'IMPORT_FAILED', message: '招聘会导入失败,请稍后重试' } })
      }
    }

    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'fair.import',
      targetType: 'fair',
      targetId: null,
      payload: { count: out.length, externalIds: out.map((o) => o.externalId).slice(0, 20) },
    })

    this.logger.log(`importFairs: orgId=${sourceOrgId} count=${out.length}`)
    return { imported: out.length, items: out }
  }

  async unpublishPartnerFair(id: string, user: AuthedUser): Promise<PartnerFairDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair || fair.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }
    const updated = await this.prisma.jobFair.update({
      where: { id },
      data: { publishStatus: 'unpublished' },
    })
    return prismaFairToPartnerDto(updated)
  }

  // ── Partner 同步日志 ───────────────────────────────────────────────────────

  async getPartnerSyncLogs(user: AuthedUser): Promise<SyncLogDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.syncLog.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return rows.map((r, i) => ({
      id: r.id,
      no: `SYNC-${r.createdAt.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(4, '0')}`,
      source: r.sourceId,
      dataType: r.dataType as 'job' | 'fair',
      addedCount: r.addedCount,
      updatedCount: r.updatedCount,
      errorCount: r.errorCount,
      dupCount: r.dupCount,
      errorFields: r.errorFields === '[]' ? null : r.errorFields,
      errorDetail: r.errorDetail,
      syncTime: fmtSyncTime(r.createdAt),
      status: r.result as 'success' | 'partial' | 'failed',
    }))
  }

  /** 内部：写同步日志（import 成功后调用）。不抛错，写失败只记日志。 */
  private async writeSyncLog(args: {
    sourceId: string
    orgId: string
    dataType: 'job' | 'fair'
    syncMode: 'manual' | 'webhook' | 'api' | 'excel'
    addedCount: number
    updatedCount: number
    dupCount: number
    errorCount: number
    errorFields?: string[]
    errorDetail?: string
  }): Promise<string | null> {
    try {
      const result: 'success' | 'partial' | 'failed' =
        args.errorCount === 0 ? 'success' :
        args.addedCount > 0 || args.updatedCount > 0 ? 'partial' : 'failed'
      const log = await this.prisma.syncLog.create({
        data: {
          sourceId: args.sourceId,
          orgId: args.orgId,
          dataType: args.dataType,
          syncMode: args.syncMode,
          totalCount: args.addedCount + args.updatedCount + args.dupCount + args.errorCount,
          addedCount: args.addedCount,
          updatedCount: args.updatedCount,
          dupCount: args.dupCount,
          errorCount: args.errorCount,
          errorFields: JSON.stringify(args.errorFields ?? []),
          errorDetail: args.errorDetail ?? null,
          result,
        },
      })
      return log.id
    } catch (e) {
      this.logger.warn(`writeSyncLog failed: ${(e as Error).message}`)
      return null
    }
  }

  // ── Excel 导入 ────────────────────────────────────────────────────────────

  /**
   * 解析 Excel 文件，返回列名 + 样例行（无 DB 写入，纯内存操作）。
   */
  parseExcelColumns(buffer: Buffer): { columns: string[]; sampleRows: Record<string, string>[] } {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) {
      throw new BadRequestException({ error: { code: 'EXCEL_EMPTY', message: 'Excel 文件为空或格式不正确' } })
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
    if (rows.length < 2) {
      throw new BadRequestException({ error: { code: 'EXCEL_NO_DATA', message: 'Excel 文件缺少数据行（至少需要表头行 + 1 行数据）' } })
    }
    const headerRow = rows[0] as unknown[]
    const columns = headerRow.map((c) => String(c ?? '').trim()).filter(Boolean)
    const sampleRows = rows.slice(1, 6).map((row) => {
      const obj: Record<string, string> = {}
      columns.forEach((col, i) => { obj[col] = String((row as unknown[])[i] ?? '').trim() })
      return obj
    })
    return { columns, sampleRows }
  }

  /**
   * 解析 Excel + 字段映射 → 创建 ImportBatch + ImportRecord，返回预览数据。
   */
  async previewExcelImport(args: {
    buffer: Buffer
    fileName: string
    sourceId: string
    dataType: 'job' | 'fair'
    fieldMapping: FieldMapping
    user: AuthedUser
  }): Promise<ExcelPreviewDto> {
    if (!args.user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }

    // Verify source belongs to this org
    const source = await this.prisma.jobSource.findUnique({ where: { id: args.sourceId } })
    if (!source || source.orgId !== args.user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }

    const wb = XLSX.read(args.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) {
      throw new BadRequestException({ error: { code: 'EXCEL_EMPTY', message: 'Excel 文件为空' } })
    }
    const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
    if (allRows.length < 2) {
      throw new BadRequestException({ error: { code: 'EXCEL_NO_DATA', message: 'Excel 缺少数据行' } })
    }
    const headers = (allRows[0] as string[]).map((h) => String(h ?? '').trim())
    const dataRows = allRows.slice(1)

    const standardFields = args.dataType === 'job' ? JOB_STANDARD_FIELDS : FAIR_STANDARD_FIELDS
    const requiredFields = args.dataType === 'job' ? JOB_REQUIRED_FIELDS : FAIR_REQUIRED_FIELDS

    // Validate mapping contains only whitelisted standard fields
    const illegalFields = Object.keys(args.fieldMapping).filter(
      (f) => !(standardFields as readonly string[]).includes(f),
    )
    if (illegalFields.length > 0) {
      throw new BadRequestException({
        error: { code: 'ILLEGAL_FIELD_MAPPING', message: `字段映射包含非法字段: ${illegalFields.join(', ')}` },
      })
    }

    // Collect existing externalIds for dup detection
    const orgId = args.user.orgId
    const existingExtIds = new Set<string>()
    if (args.dataType === 'job') {
      const existing = await this.prisma.job.findMany({
        where: { sourceOrgId: orgId },
        select: { externalId: true },
      })
      existing.forEach((j) => existingExtIds.add(j.externalId))
    } else {
      const existing = await this.prisma.jobFair.findMany({
        where: { sourceOrgId: orgId },
        select: { externalId: true },
      })
      existing.forEach((f) => existingExtIds.add(f.externalId))
    }

    const parsed: ParsedRow[] = dataRows.map((rawRow, idx) => {
      const rawArr = rawRow as unknown[]
      const rawData: Record<string, string> = {}
      headers.forEach((h, i) => { rawData[h] = String(rawArr[i] ?? '').trim() })

      const mapped: Record<string, string> = {}
      for (const [stdField, colName] of Object.entries(args.fieldMapping)) {
        mapped[stdField] = rawData[colName] ?? ''
      }

      const errors: string[] = []
      for (const req of requiredFields) {
        if (!mapped[req] || mapped[req].trim() === '') {
          errors.push(`${req} 不能为空`)
        }
      }
      // sourceUrl basic format check
      if (mapped.sourceUrl && !mapped.sourceUrl.startsWith('http')) {
        errors.push('sourceUrl 必须以 http 开头')
      }
      // date check for fairs
      if (args.dataType === 'fair') {
        if (mapped.startAt && Number.isNaN(Date.parse(mapped.startAt))) {
          errors.push('startAt 日期格式无效')
        }
        if (mapped.endAt && Number.isNaN(Date.parse(mapped.endAt))) {
          errors.push('endAt 日期格式无效')
        }
      }

      let status: 'ok' | 'invalid' | 'dup' = 'ok'
      if (errors.length > 0) {
        status = 'invalid'
      } else if (mapped.externalId && existingExtIds.has(mapped.externalId)) {
        status = 'dup'
      }

      return {
        rowIndex: idx + 2, // 1-indexed, skipping header
        rawData,
        mapped,
        status,
        errors,
        externalId: mapped.externalId || undefined,
      }
    })

    const validRows   = parsed.filter((r) => r.status === 'ok').length
    const invalidRows = parsed.filter((r) => r.status === 'invalid').length
    const dupRows     = parsed.filter((r) => r.status === 'dup').length

    // Persist ImportBatch + ImportRecord
    const batch = await this.prisma.importBatch.create({
      data: {
        sourceId: args.sourceId,
        orgId,
        dataType: args.dataType,
        fileName: args.fileName,
        totalRows: parsed.length,
        validRows,
        invalidRows,
        dupRows,
        status: 'pending',
        mappingJson: JSON.stringify(args.fieldMapping),
        createdBy: args.user.userId,
      },
    })

    // Bulk create records (chunked to avoid SQLite limits)
    const CHUNK = 50
    for (let i = 0; i < parsed.length; i += CHUNK) {
      await this.prisma.importRecord.createMany({
        data: parsed.slice(i, i + CHUNK).map((r) => ({
          batchId: batch.id,
          rowIndex: r.rowIndex,
          rawDataJson: JSON.stringify(r.rawData),
          mappedJson: JSON.stringify(r.mapped),
          status: r.status,
          errorsJson: JSON.stringify(r.errors),
          externalId: r.externalId ?? null,
        })),
      })
    }

    return {
      batchId: batch.id,
      totalRows: parsed.length,
      validRows,
      invalidRows,
      dupRows,
      sampleValid: parsed.filter((r) => r.status === 'ok').slice(0, 5).map(toPreviewRow),
      sampleInvalid: parsed.filter((r) => r.status === 'invalid').slice(0, 5).map(toPreviewRow),
      sampleDup: parsed.filter((r) => r.status === 'dup').slice(0, 5).map(toPreviewRow),
    }
  }

  /**
   * 确认导入：将 ImportBatch 中 status='ok' 的行 upsert 到 Job/JobFair 表，
   * 写 SyncLog，更新 ImportBatch.status → 'confirmed'。
   */
  async confirmExcelImport(batchId: string, user: AuthedUser): Promise<{ imported: number; syncLogId: string | null }> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }

    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { records: { where: { status: 'ok' } } },
    })
    if (!batch || batch.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'BATCH_NOT_FOUND', message: '导入批次不存在' } })
    }
    if (batch.status !== 'pending') {
      throw new BadRequestException({
        error: { code: 'BATCH_ALREADY_PROCESSED', message: `批次已处于 ${batch.status} 状态，无法重复确认` },
      })
    }

    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }

    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()
    let imported      = 0

    for (const record of batch.records) {
      const mapped = JSON.parse(record.mappedJson) as Record<string, string>
      try {
        if (batch.dataType === 'job') {
          await this.prisma.job.upsert({
            where: { sourceOrgId_externalId: { sourceOrgId, externalId: mapped.externalId } },
            create: {
              sourceOrgId, sourceId: batch.sourceId, externalId: mapped.externalId, sourceName,
              sourceUrl: mapped.sourceUrl ?? '',
              title: mapped.title ?? '', company: mapped.company ?? '', city: mapped.city ?? '',
              salary: mapped.salary || null,
              description: mapped.description || null, requirements: mapped.requirements || null,
              tagsJson: '[]',
              reviewStatus: 'pending', publishStatus: 'draft',
              syncTime: sync,
            },
            update: {
              sourceName, sourceUrl: mapped.sourceUrl ?? '',
              title: mapped.title ?? '', company: mapped.company ?? '', city: mapped.city ?? '',
              salary: mapped.salary || null,
              description: mapped.description || null, requirements: mapped.requirements || null,
              syncTime: sync,
            },
          })
        } else {
          const startAt = new Date(mapped.startAt)
          const endAt   = new Date(mapped.endAt)
          await this.prisma.jobFair.upsert({
            where: { sourceOrgId_externalId: { sourceOrgId, externalId: mapped.externalId } },
            create: {
              sourceOrgId, externalId: mapped.externalId, sourceName,
              sourceUrl: mapped.sourceUrl ?? '',
              title: mapped.title ?? '',
              theme: mapped.theme || 'general',
              startAt, endAt,
              venue: mapped.venue ?? '', city: mapped.city ?? '',
              address: mapped.address || null,
              description: mapped.description || null,
              companyCount: Number(mapped.companyCount) || 0,
              jobCount: Number(mapped.jobCount) || 0,
              reviewStatus: 'pending', publishStatus: 'draft',
              syncTime: sync,
            },
            update: {
              sourceName, sourceUrl: mapped.sourceUrl ?? '',
              title: mapped.title ?? '',
              theme: mapped.theme || 'general',
              startAt, endAt,
              venue: mapped.venue ?? '', city: mapped.city ?? '',
              address: mapped.address || null,
              description: mapped.description || null,
              syncTime: sync,
            },
          })
        }
        imported++
      } catch (e) {
        this.logger.error(`confirmExcelImport upsert failed: batchId=${batchId} rowIndex=${record.rowIndex}`, e as Error)
      }
    }

    // Write SyncLog
    const syncLogId = await this.writeSyncLog({
      sourceId: batch.sourceId,
      orgId: user.orgId,
      dataType: batch.dataType as 'job' | 'fair',
      syncMode: 'excel',
      addedCount: imported,
      updatedCount: 0,
      dupCount: batch.dupRows,
      errorCount: batch.invalidRows,
    })

    // Update batch status
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'confirmed', confirmedAt: new Date() },
    })

    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'excel.import.confirm',
      targetType: 'job_source',
      targetId: batch.sourceId,
      payload: { batchId, dataType: batch.dataType, imported, syncLogId },
    })

    this.logger.log(`confirmExcelImport: batchId=${batchId} imported=${imported}`)
    return { imported, syncLogId }
  }

  /** 取消待确认批次 */
  async cancelExcelImport(batchId: string, user: AuthedUser): Promise<void> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } })
    if (!batch || batch.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'BATCH_NOT_FOUND', message: '导入批次不存在' } })
    }
    if (batch.status !== 'pending') {
      throw new BadRequestException({ error: { code: 'BATCH_ALREADY_PROCESSED', message: '只能取消 pending 状态的批次' } })
    }
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'cancelled' },
    })
  }
}
