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
// Fair 模型已落 Prisma(JobFair / FairCompany / FairZone):
//   读端点(getPublishedFairs / getPublishedFairDetail / getFairCompanies /
//   getFairZones / getFairMap / getAllFairSources / getPartnerFairs)走真实查询,
//   写端点(reviewFairSource / publishFairSource / importFairs / unpublishPartnerFair)
//   与 Job 共用同一套审核/发布状态机。
//   说明:招聘会子资源中 materials(资料) / stats(统计) / booth(展位坐标)
//   目前无对应 Prisma 模型,controller 诚实返回空数据,不硬造 mock。
// ============================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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
  isSensitiveColumn,
  type FieldMapping,
  type ParsedRow,
} from './dto/excel-import.dto'
import { Workbook } from 'exceljs'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { encryptSecret, generateWebhookSecret } from '../common/crypto/secret-cipher'
import { JobQualityService } from '../job-ai/job-quality.service'
import { mapFair, mapFairCompany, mapFairZone } from './fair.mapper'
import type { FairDetailResponse, FairCompany, FairZone } from './fair.types'
import type { UpdatePartnerFairDto, UpdatePartnerJobDto } from './dto/partner-edit.dto'

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

interface PublishedFairsParams {
  status?: string
  page?: number
  pageSize?: number
  terminalId?: string
}

interface PublishedFairQueryGroup {
  where: Prisma.JobFairWhereInput
  orderBy: { startAt: 'asc' | 'desc' }
}

// ─── DTO shapes returned to callers ──────────────────────────────────────────

export interface JobListItemDto {
  id: string; title: string; company: string; city: string
  salary?: string; tags: string[]; industry?: string; workType?: WorkType; headcount?: number
  educationRequirement?: string; experienceRequirement?: string; skills?: string[]; benefits?: string[]
  salaryMin?: number; salaryMax?: number; salaryUnit?: string; validThrough?: string
  /** DB category 列原值('fulltime' | 'intern' | 'campus' | 'parttime'),供前端类型 chip 显示/筛选对齐 */
  category?: string
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; syncTime: string
  description?: string; requirements?: string
  salaryDisplay: string
  dataSourceNote: string
  /** 企业展示关联(可选):有值时前端可提供「查看企业」入口(/companies/:id) */
  companyProfileId?: string | null
}

export interface FairIntentSlice { label: string; percent: number }
export interface FairIndustrySlice { label: string; count: number }

export interface FairListItemDto {
  id: string; name: string; organizer: string
  startTime: string; endTime: string; venue: string; status: FairStatus
  description?: string; boothCount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; syncTime: string
  hasManagedData: boolean; managedCompanyCount: number; managedMaterialCount: number
  dataSourceNote: string
  jobCount?: number; theme?: string
  // 详情/导航/预计（对齐 kiosk ExternalJobFairDTO；合规：均展示用，非实时）
  city?: string; address?: string; mapImageUrl?: string
  latitude?: number; longitude?: number; trafficInfo?: string
  expectedAttendance?: number
}

/** 招聘会数据大屏统计（合规：预计/来源数据，非实时）。对齐 kiosk FairLiveStatsDTO。 */
export interface FairStatsDto {
  fairId: string; fairName: string
  totalCompanies: number; checkedInCompanies: number
  totalPositions: number; totalHeadcount: number
  browseCount: number; scanCount: number; printCount: number; checkinCount: number
  zoneBreakdown: { id: string; zoneName: string; boothCount: number; checkedInCount: number }[]
  lastUpdated: string
  expectedAttendance?: number
  seekerIntent: FairIntentSlice[]
  industryDistribution: FairIndustrySlice[]
  dataSourceLabel: string
  isMockData: boolean
}

export interface AdminJobDto {
  id: string
  sourceId?: string
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
  // 阶段1C:编辑表单回填用展示字段(additive,可缺省)
  category?: string; salary?: string; tags?: string[]
  description?: string; requirements?: string
}

export interface PartnerFairDto {
  id: string; externalId: string; name: string; organizer: string
  startTime: string; endTime: string; venue: string; status: FairStatus
  sourceUrl: string; syncTime: string; reviewStatus: ReviewStatus; publishStatus: PublishStatus
  sourceOrgId: string; sourceName: string
  // 阶段1C:编辑表单回填用展示字段(additive,可缺省)
  theme?: string; city?: string; address?: string; description?: string
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

export interface AdminImportBatchDto {
  id: string
  sourceId: string
  sourceName: string
  orgId: string
  orgName: string
  dataType: 'job' | 'fair'
  fileName: string
  totalRows: number
  validRows: number
  invalidRows: number
  dupRows: number
  status: 'pending' | 'confirmed' | 'cancelled' | 'failed'
  createdBy: string
  confirmedAt: string | null
  createdAt: string
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

/** T1: 某数据源 × dataType 已保存的字段映射规则(供导入向导自动回填) */
export interface FieldMappingRuleDto {
  sourceId: string
  dataType: 'job' | 'fair'
  /** { standardField: excelColumnHeader };未保存过则为空对象 */
  mapping: Record<string, string>
  /** 规则上次更新时间;从未保存过则为 null */
  updatedAt: string | null
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

/**
 * 行业(industry)没有独立 DB 列(避免 schema 迁移),约定存放在 tagsJson 里,
 * 以 `行业:` 前缀命名,例如 "行业:互联网"。
 * - DTO 映射时抽取为 industry 字段,并从展示 tags 中剔除(前端 tag chip 不显示前缀)
 * - 筛选时用 tagsJson contains `"行业:<industry>"` 做 DB 层精确预过滤(分页 total 准确)
 * 后续若切 Postgres / 加 industry 列,只需改这里与 buildJobIndustryTag。
 */
const INDUSTRY_TAG_PREFIX = '行业:'

/** 把行业名拼成存储用 tag(供 import / seed 复用) */
export function buildJobIndustryTag(industry: string): string {
  return `${INDUSTRY_TAG_PREFIX}${industry.trim()}`
}

/** 从 tags 中抽取行业名(第一个 `行业:` 前缀 tag);无则 undefined */
function extractIndustry(tags: string[]): string | undefined {
  const hit = tags.find((t) => t.startsWith(INDUSTRY_TAG_PREFIX))
  return hit ? hit.slice(INDUSTRY_TAG_PREFIX.length) : undefined
}

/** 展示用 tags:剔除行业前缀 tag(行业单独走 industry 字段) */
function displayTags(tags: string[]): string[] {
  return tags.filter((t) => !t.startsWith(INDUSTRY_TAG_PREFIX))
}

/** DB category 列 → 前端 workType 枚举(campus 校招归 full_time 展示) */
function categoryToWorkType(category: string | null): WorkType | undefined {
  switch (category) {
    case 'fulltime': return 'full_time'
    case 'parttime': return 'part_time'
    case 'intern':   return 'internship'
    case 'campus':   return 'full_time'
    default:         return undefined
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
  sourceId:      string | null
  companyProfileId?: string | null
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
  educationRequirement: string | null
  experienceRequirement: string | null
  skillsJson: string
  benefitsJson: string
  salaryMin: number | null
  salaryMax: number | null
  salaryUnit: string | null
  validThrough: Date | null
  reviewStatus:  string
  publishStatus: string
  reviewedBy:    string | null
  reviewedAt:    Date   | null
  rejectReason:  string | null
  syncTime:      Date
}

function prismaJobToListItem(j: PrismaJobRow): JobListItemDto {
  const rawTags = safeJsonArr(j.tagsJson)
  const salaryDisplay = formatSalaryDisplay(j)
  return {
    id: j.id, title: j.title, company: j.company, city: j.city,
    salary: j.salary ?? undefined,
    tags: displayTags(rawTags),
    industry: extractIndustry(rawTags),
    workType: categoryToWorkType(j.category),
    headcount: undefined,
    educationRequirement: j.educationRequirement ?? undefined,
    experienceRequirement: j.experienceRequirement ?? undefined,
    skills: safeJsonArr(j.skillsJson),
    benefits: safeJsonArr(j.benefitsJson),
    salaryMin: j.salaryMin ?? undefined,
    salaryMax: j.salaryMax ?? undefined,
    salaryUnit: j.salaryUnit ?? undefined,
    validThrough: j.validThrough ? j.validThrough.toISOString() : undefined,
    category: j.category ?? undefined,
    sourceOrgId: j.sourceOrgId, externalId: j.externalId,
    sourceName: j.sourceName, sourceUrl: j.sourceUrl,
    syncTime: fmtSyncTime(j.syncTime),
    description: j.description ?? undefined,
    requirements: j.requirements ?? undefined,
    salaryDisplay,
    dataSourceNote: `数据来源：${j.sourceName} · 同步于 ${j.syncTime.toISOString().slice(0, 10)} · 仅供参考`,
    companyProfileId: j.companyProfileId ?? null,
  }
}

function prismaJobToAdminDto(j: PrismaJobRow): AdminJobDto {
  return {
    id: j.id,
    sourceId: j.sourceId ?? undefined,
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
    // 阶段1C:编辑表单回填字段
    category: j.category ?? undefined,
    salary: j.salary ?? undefined,
    tags: safeJsonArr(j.tagsJson),
    description: j.description ?? undefined,
    requirements: j.requirements ?? undefined,
  }
}

function formatSalaryDisplay(j: Pick<PrismaJobRow, 'salary' | 'salaryMin' | 'salaryMax' | 'salaryUnit'>): string {
  if (j.salary?.trim()) return j.salary
  if (j.salaryMin != null && j.salaryMax != null) return `${j.salaryMin}-${j.salaryMax}${formatSalaryUnit(j.salaryUnit)}`
  if (j.salaryMin != null) return `${j.salaryMin}起${formatSalaryUnit(j.salaryUnit)}`
  if (j.salaryMax != null) return `${j.salaryMax}以内${formatSalaryUnit(j.salaryUnit)}`
  return '来源平台未提供'
}

function formatSalaryUnit(unit: string | null): string {
  switch (unit) {
    case 'monthly': return '元/月'
    case 'yearly': return '元/年'
    case 'daily': return '元/天'
    default: return unit ? `/${unit}` : ''
  }
}

function buildJobTags(tags: string[] | undefined, industry?: string): string[] {
  const result = [...(tags ?? [])].map((tag) => tag.trim()).filter(Boolean)
  if (industry?.trim()) result.push(buildJobIndustryTag(industry))
  return [...new Set(result)]
}

function splitMappedList(value: string | undefined): string[] {
  if (!value?.trim()) return []
  return value.split(/[，,;；、\n]/).map((item) => item.trim()).filter(Boolean)
}

function parseMappedNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseMappedDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
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
  // 导航/预计列
  latitude: number | null
  longitude: number | null
  trafficInfo: string | null
  expectedAttendance: number | null
  seekerIntentJson: string | null
  // 关联计数（include _count 时存在）
  _count?: { companies: number }
}

function deriveFairStatus(startAt: Date, endAt: Date, now = new Date()): FairStatus {
  if (now < startAt) return 'upcoming'
  if (now > endAt) return 'ended'
  return 'ongoing'
}

/** 安全解析 seekerIntentJson（机构录入的预计求职意向分布）。脏数据 → 空数组，不抛。 */
function parseSeekerIntent(json: string | null): FairIntentSlice[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x): x is { label: string; percent: number } =>
        !!x && typeof (x as { label?: unknown }).label === 'string' &&
        typeof (x as { percent?: unknown }).percent === 'number')
      .map((x) => ({ label: x.label, percent: x.percent }))
  } catch {
    return []
  }
}

function prismaFairToListItem(f: PrismaJobFairRow): FairListItemDto {
  const companyCount = f._count?.companies ?? 0
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
    hasManagedData: companyCount > 0,
    managedCompanyCount: companyCount,
    managedMaterialCount: 0,
    dataSourceNote: `数据来源:${f.sourceName} · 同步于 ${f.syncTime.toISOString().slice(0, 10)} · 仅供参考`,
    jobCount: f.jobCount,
    theme: f.theme,
    city: f.city,
    address: f.address ?? undefined,
    mapImageUrl: f.mapImageUrl ?? undefined,
    latitude: f.latitude ?? undefined,
    longitude: f.longitude ?? undefined,
    trafficInfo: f.trafficInfo ?? undefined,
    expectedAttendance: f.expectedAttendance ?? undefined,
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
    // 阶段1C:编辑表单回填字段
    theme: f.theme,
    city: f.city,
    address: f.address ?? undefined,
    description: f.description ?? undefined,
  }
}

const PUBLIC_FAIR_DEMO_FILTERS: Prisma.JobFairWhereInput[] = [
  { sourceOrgId: { startsWith: 'org_vff_' } },
  { externalId: { startsWith: 'VFF-' } },
  { sourceUrl: { contains: 'example.org' } },
  { sourceName: { contains: '验证' } },
  { title: { contains: '验证' } },
  { venue: { contains: '验证' } },
  { city: { contains: '验证' } },
]

function withPublicFairDemoExclusion(where: Prisma.JobFairWhereInput): Prisma.JobFairWhereInput {
  if (process.env['EXCLUDE_DEMO_PUBLIC_DATA'] !== 'true') return where
  return {
    AND: [
      where,
      { NOT: { OR: PUBLIC_FAIR_DEMO_FILTERS } },
    ],
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
    private readonly jobQuality: JobQualityService,
  ) {}

  private async refreshJobQualitySnapshots(jobIds: string[]): Promise<void> {
    try {
      await this.jobQuality.refreshJobQualitySnapshots(jobIds)
    } catch (error) {
      this.logger.warn(`refresh job quality snapshots failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  // ── Kiosk:只读 approved+published ───────────────────────────────────────────

  /**
   * Kiosk 岗位列表 — 全部筛选都落到 DB 层(分页 total 准确):
   *   - keyword:  title / company / description 任一 contains(SQLite LIKE,ASCII 大小写不敏感)
   *   - city:     精确匹配
   *   - category: 精确匹配('fulltime' | 'intern' | 'campus' | 'parttime')
   *   - sourceOrgId: 精确匹配(来源机构筛选)
   *   - tag:      tagsJson contains `"<tag>"`(带引号边界 → 等价精确)
   *   - industry: tagsJson contains `"行业:<industry>"`(行业以前缀 tag 存储)
   * tag + industry 同时存在时用 AND 数组(同一 tagsJson 字段不能写两次 key)。
   */
  async getPublishedJobs(params?: {
    keyword?: string
    city?: string
    industry?: string
    category?: string
    sourceOrgId?: string
    tag?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResult<JobListItemDto>> {
    const page     = Math.max(1, params?.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20))
    const kw = params?.keyword?.trim()

    // 带引号边界的 contains:`"运营"` 不会误匹配 `"运营总监"`,等价精确匹配。
    const tagContains: { tagsJson: { contains: string } }[] = []
    if (params?.tag)      tagContains.push({ tagsJson: { contains: `"${params.tag}"` } })
    if (params?.industry) tagContains.push({ tagsJson: { contains: `"${buildJobIndustryTag(params.industry)}"` } })

    const where = {
      reviewStatus:  'approved',
      publishStatus: 'published',
      ...(params?.city        ? { city: params.city }                 : {}),
      ...(params?.category     ? { category: params.category }         : {}),
      ...(params?.sourceOrgId  ? { sourceOrgId: params.sourceOrgId }   : {}),
      ...(tagContains.length   ? { AND: tagContains }                  : {}),
      ...(kw ? {
        OR: [
          { title:       { contains: kw } },
          { company:     { contains: kw } },
          { description: { contains: kw } },
        ],
      } : {}),
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
    return {
      data: rows.map(prismaJobToListItem),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  async getPublishedJobById(id: string): Promise<SingleResult<JobListItemDto>> {
    const j = await this.prisma.job.findFirst({
      where: { id, reviewStatus: 'approved', publishStatus: 'published' },
    })
    return { data: j ? prismaJobToListItem(j) : null, success: true }
  }

  private async resolveCampusPreferredOrgId(terminalId?: string): Promise<string | null> {
    const id = terminalId?.trim()
    if (!id) return null
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id }, { terminalCode: id }] },
      select: {
        org: { select: { id: true, type: true, enabled: true } },
      },
    })
    const org = terminal?.org
    if (!org || !org.enabled || org.type !== 'school_employment_center') return null
    return org.id
  }

  private async getPublishedFairRowsByGroups(
    groups: PublishedFairQueryGroup[],
    skip: number,
    pageSize: number,
  ): Promise<{ rows: PrismaJobFairRow[]; total: number }> {
    // 分组穷尽性依赖 JobFair.sourceOrgId / endAt 在 Prisma schema 中为非空字段。
    const totals = await Promise.all(groups.map((group) => this.prisma.jobFair.count({ where: group.where })))
    const total = totals.reduce((sum, count) => sum + count, 0)
    const rows: PrismaJobFairRow[] = []
    let remainingSkip = skip
    let remainingTake = pageSize
    for (let i = 0; i < groups.length && remainingTake > 0; i++) {
      const groupTotal = totals[i]
      if (remainingSkip >= groupTotal) {
        remainingSkip -= groupTotal
        continue
      }
      const take = Math.min(remainingTake, groupTotal - remainingSkip)
      const pageRows = await this.prisma.jobFair.findMany({
        where: groups[i].where,
        orderBy: groups[i].orderBy,
        skip: remainingSkip,
        take,
        include: { _count: { select: { companies: true } } },
      })
      rows.push(...pageRows)
      remainingTake -= take
      remainingSkip = 0
    }
    return { rows, total }
  }

  async getPublishedFairs(params?: PublishedFairsParams): Promise<PaginatedResult<FairListItemDto>> {
    const page     = Math.max(1, params?.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20))
    const where = withPublicFairDemoExclusion({
      reviewStatus: 'approved',
      publishStatus: 'published',
    })
    const skip = (page - 1) * pageSize
    const hasTerminalScope = !!params?.terminalId?.trim()
    const preferredOrgId = await this.resolveCampusPreferredOrgId(params?.terminalId)
    let rows: PrismaJobFairRow[]
    let total: number
    if (!preferredOrgId) {
      if (!hasTerminalScope) {
        const result = await Promise.all([
          this.prisma.jobFair.findMany({
            where,
            orderBy: { startAt: 'asc' },
            skip,
            take: pageSize,
            include: { _count: { select: { companies: true } } },
          }),
          this.prisma.jobFair.count({ where }),
        ])
        rows = result[0]
        total = result[1]
      } else {
        const now = new Date()
        const result = await this.getPublishedFairRowsByGroups([
          { where: { ...where, endAt: { gte: now } }, orderBy: { startAt: 'asc' } },
          { where: { ...where, endAt: { lt: now } }, orderBy: { startAt: 'desc' } },
        ], skip, pageSize)
        rows = result.rows
        total = result.total
      }
    } else {
      const now = new Date()
      const result = await this.getPublishedFairRowsByGroups([
        { where: { ...where, sourceOrgId: preferredOrgId, endAt: { gte: now } }, orderBy: { startAt: 'asc' } },
        { where: { ...where, sourceOrgId: preferredOrgId, endAt: { lt: now } }, orderBy: { startAt: 'desc' } },
        { where: { ...where, NOT: { sourceOrgId: preferredOrgId }, endAt: { gte: now } }, orderBy: { startAt: 'asc' } },
        { where: { ...where, NOT: { sourceOrgId: preferredOrgId }, endAt: { lt: now } }, orderBy: { startAt: 'desc' } },
      ], skip, pageSize)
      rows = result.rows
      total = result.total
    }
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
      where: withPublicFairDemoExclusion({ id, reviewStatus: 'approved', publishStatus: 'published' }),
      include: { _count: { select: { companies: true } } },
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
      where: withPublicFairDemoExclusion({ id, reviewStatus: 'approved', publishStatus: 'published' }),
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

  /**
   * 招聘会子资源 — 参展企业列表(分页)。
   *
   * 接真 Prisma:仅放出 approved+published 招聘会下的 FairCompany 真实录入数据。
   * 招聘会不存在 / 未发布 → 返回空集(前端 EmptyState 兜底,不抛 404)。
   */
  async getFairCompanies(
    fairId: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: FairCompany[]; total: number; page: number; pageSize: number }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      select: { id: true },
    })
    if (!fair) return { data: [], total: 0, page, pageSize }

    const [rows, total] = await Promise.all([
      this.prisma.fairCompany.findMany({
        where: { jobFairId: fairId },
        orderBy: { jobsCount: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { positions: { orderBy: { sortOrder: 'asc' } } },
      }),
      this.prisma.fairCompany.count({ where: { jobFairId: fairId } }),
    ])
    return { data: rows.map(mapFairCompany), total, page, pageSize }
  }

  /** 招聘会子资源 — 单个参展企业详情。需归属该已发布招聘会。 */
  async getFairCompanyById(fairId: string, companyId: string): Promise<{ data: FairCompany | null }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      select: { id: true },
    })
    if (!fair) return { data: null }
    const company = await this.prisma.fairCompany.findFirst({
      where: { id: companyId, jobFairId: fairId },
      include: { positions: { orderBy: { sortOrder: 'asc' } } },
    })
    return { data: company ? mapFairCompany(company) : null }
  }

  /** 招聘会子资源 — 展区列表(sortOrder 升序)。 */
  async getFairZones(fairId: string): Promise<{ data: FairZone[] }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      select: { id: true },
    })
    if (!fair) return { data: [] }
    const zones = await this.prisma.fairZone.findMany({
      where: { jobFairId: fairId },
      orderBy: { sortOrder: 'asc' },
    })
    return { data: zones.map(mapFairZone) }
  }

  /**
   * 招聘会子资源 — 导览图数据。
   *
   * 模型限制:当前 schema 无独立"展位(booth)"模型,展位坐标 / 编号未落库。
   * 因此 booths 诚实返回空数组(绝不硬造假坐标),zones 返回真实展区,
   * mapImageUrl 返回招聘会录入的导览底图(可空)。
   */
  async getFairMap(fairId: string): Promise<{ data: { mapImageUrl: string | null; zones: FairZone[]; booths: [] } | null }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      select: { id: true, mapImageUrl: true },
    })
    if (!fair) return { data: null }
    const zones = await this.prisma.fairZone.findMany({
      // 创新特色展区(category=innovation)不是展位区,不进展馆地图
      where: { jobFairId: fairId, NOT: { category: 'innovation' } },
      orderBy: { sortOrder: 'asc' },
    })
    return {
      data: {
        mapImageUrl: fair.mapImageUrl,
        zones: zones.map(mapFairZone),
        // 模型限制:无 FairBooth 模型,展位坐标未录入 → 诚实空,不硬造
        booths: [],
      },
    }
  }

  /**
   * 招聘会子资源 — 数据大屏统计。
   *
   * 合规：我们是第三方信息入口，无真实时数据。返回的规模/分布为
   * 「预计 / 来源数据」(机构录入预计值 + 按已录企业/岗位聚合)，统一标注，非实时；
   * 系统真实拥有的服务行为(浏览量)如实返回，其余计数器未落库则诚实置 0。
   */
  async getFairStats(fairId: string): Promise<{ data: FairStatsDto | null }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      include: { companies: { include: { positions: true } } },
    })
    if (!fair) return { data: null }

    const companies = fair.companies
    const totalCompanies = companies.length
    const totalPositions = companies.reduce((s, c) => s + c.positions.length, 0)
    const totalHeadcount = companies.reduce(
      (s, c) => s + c.positions.reduce((ps, p) => ps + (p.headcount ?? 0), 0),
      0,
    )

    // 行业分布(按已录企业 industry 聚合;已知行业键映射为中文展示标签)
    const INDUSTRY_LABEL: Record<string, string> = {
      internet: '互联网/IT', ai: '人工智能', finance: '金融', manufacturing: '智能制造',
      consumer: '消费电子', service: '生活服务', education: '教育', medical: '医疗健康',
    }
    const industryMap = new Map<string, number>()
    for (const c of companies) {
      const raw = c.industry?.trim() || '其他'
      const key = INDUSTRY_LABEL[raw] ?? raw
      industryMap.set(key, (industryMap.get(key) ?? 0) + 1)
    }
    const industryDistribution: FairIndustrySlice[] = [...industryMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)

    return {
      data: {
        fairId: fair.id,
        fairName: fair.title,
        totalCompanies,
        checkedInCompanies: 0, // 合规：不做现场签到
        totalPositions,
        totalHeadcount,
        browseCount: fair.viewCount, // 系统真实服务数据
        scanCount: 0,
        printCount: 0,
        checkinCount: 0,
        zoneBreakdown: [], // 无展位计数模型 → 诚实空
        lastUpdated: new Date().toISOString(),
        expectedAttendance: fair.expectedAttendance ?? undefined,
        seekerIntent: parseSeekerIntent(fair.seekerIntentJson),
        industryDistribution,
        dataSourceLabel: '预计 / 来源数据 · 非实时',
        isMockData: false,
      },
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
    const touchedJobIds: string[] = []
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
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            reviewStatus: 'pending', publishStatus: 'draft',
            syncTime: sync,
          },
          update: {
            sourceName, sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            syncTime: sync,
          },
        })
        touchedJobIds.push(job.id)
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
    await this.refreshJobQualitySnapshots(touchedJobIds)
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
    const touchedJobIds: string[] = []

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
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
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
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            syncTime: sync,
          },
        })
        touchedJobIds.push(job.id)
        out.push(prismaJobToPartnerDto(job))
      } catch (e) {
        this.logger.error(`importJobsFromWebhook upsert failed: orgId=${orgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({ error: { code: 'IMPORT_FAILED', message: 'Webhook 导入失败,请稍后重试' } })
      }
    }
    await this.refreshJobQualitySnapshots(touchedJobIds)
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

  /**
   * 阶段1C — Partner 编辑本机构岗位。
   *
   * 安全/合规:
   *   - 只能改本机构数据(找不到/不属于本机构统一 404,防机构枚举)
   *   - 机构必须存在且 enabled(与导入路径同闸)
   *   - externalId / sourceOrgId / sourceName 不可改(来源可溯源)
   *   - 编辑后强制 reviewStatus='pending'、publishStatus='draft'、清拒绝原因
   *     —— 内容修订必须重新过审,防"先过审后改内容"
   */
  async updatePartnerJob(id: string, dto: UpdatePartnerJobDto, user: AuthedUser): Promise<PartnerJobDto> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job || job.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }

    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.company !== undefined ? { company: dto.company } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.sourceUrl !== undefined ? { sourceUrl: dto.sourceUrl } : {}),
        ...(dto.salary !== undefined ? { salary: dto.salary } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.requirements !== undefined ? { requirements: dto.requirements } : {}),
        ...(dto.tags !== undefined ? { tagsJson: JSON.stringify(dto.tags) } : {}),
        ...(dto.workType !== undefined ? { category: mapWorkTypeToCategory(dto.workType) } : {}),
        // 状态机:内容修订 → 强制重审
        reviewStatus: 'pending',
        publishStatus: 'draft',
        rejectReason: null,
        reviewedBy: null,
        reviewedAt: null,
        syncTime: new Date(),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'job.partner_update',
      targetType: 'job',
      targetId: id,
      payload: { changedFields, fromReviewStatus: job.reviewStatus, fromPublishStatus: job.publishStatus },
    })
    await this.refreshJobQualitySnapshots([updated.id])
    this.logger.log(`updatePartnerJob: id=${id} orgId=${user.orgId} fields=${changedFields.join(',')}`)
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

  /** 阶段1C — Partner 编辑本机构招聘会(规则同 updatePartnerJob:本机构 + 重审 + 来源不可改)。 */
  async updatePartnerFair(id: string, dto: UpdatePartnerFairDto, user: AuthedUser): Promise<PartnerFairDto> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair || fair.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }

    const startAt = dto.startAt ? new Date(dto.startAt) : fair.startAt
    const endAt   = dto.endAt ? new Date(dto.endAt) : fair.endAt
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException({ error: { code: 'INVALID_DATE_RANGE', message: '结束时间必须晚于开始时间' } })
    }

    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    const updated = await this.prisma.jobFair.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
        ...(dto.startAt !== undefined ? { startAt } : {}),
        ...(dto.endAt !== undefined ? { endAt } : {}),
        ...(dto.venue !== undefined ? { venue: dto.venue } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.sourceUrl !== undefined ? { sourceUrl: dto.sourceUrl } : {}),
        // 状态机:内容修订 → 强制重审
        reviewStatus: 'pending',
        publishStatus: 'draft',
        rejectReason: null,
        reviewedBy: null,
        reviewedAt: null,
        syncTime: new Date(),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'fair.partner_update',
      targetType: 'fair',
      targetId: id,
      payload: { changedFields, fromReviewStatus: fair.reviewStatus, fromPublishStatus: fair.publishStatus },
    })
    this.logger.log(`updatePartnerFair: id=${id} orgId=${user.orgId} fields=${changedFields.join(',')}`)
    return prismaFairToPartnerDto(updated)
  }

  // ── Partner 同步日志 ───────────────────────────────────────────────────────

  /**
   * Partner 工作台聚合（审计修复）：全部为真实计数 / 最近同步，不返回任何无埋点支撑的
   * 「展示次数 / 跳转次数」类指标（没有的数据不编造）。只统计本机构（orgId）数据。
   */
  async getPartnerDashboard(user: AuthedUser) {
    if (!user.orgId) {
      throw new ForbiddenException({ error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' } })
    }
    const orgId = user.orgId
    const [
      jobsTotal, jobsPublished, jobsPending,
      fairsTotal, fairsPublished, fairsPending,
      policiesTotal, policiesPublished, policiesPending,
      sourcesTotal, sourcesEnabled,
      recentSyncRows,
    ] = await Promise.all([
      this.prisma.job.count({ where: { sourceOrgId: orgId } }),
      this.prisma.job.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.job.count({ where: { sourceOrgId: orgId, reviewStatus: 'pending' } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId, reviewStatus: 'pending' } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId, reviewStatus: 'pending' } }),
      this.prisma.jobSource.count({ where: { orgId } }),
      this.prisma.jobSource.count({ where: { orgId, enabled: true } }),
      this.prisma.syncLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { source: { select: { name: true } } },
      }),
    ])
    return {
      jobs: { total: jobsTotal, published: jobsPublished, pending: jobsPending },
      fairs: { total: fairsTotal, published: fairsPublished, pending: fairsPending },
      policies: { total: policiesTotal, published: policiesPublished, pending: policiesPending },
      pendingTotal: jobsPending + fairsPending + policiesPending,
      sources: { total: sourcesTotal, enabled: sourcesEnabled },
      recentSyncs: recentSyncRows.map((r) => ({
        id: r.id,
        source: r.source?.name ?? r.sourceId,
        dataType: r.dataType,
        status: r.result,
        addedCount: r.addedCount,
        updatedCount: r.updatedCount,
        errorCount: r.errorCount,
        syncTime: fmtSyncTime(r.createdAt),
      })),
    }
  }

  async getPartnerSyncLogs(user: AuthedUser): Promise<SyncLogDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.syncLog.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { source: { select: { name: true } } },
    })
    return rows.map((r, i) => ({
      id: r.id,
      no: `SYNC-${r.createdAt.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(4, '0')}`,
      source: r.source?.name ?? r.sourceId,   // Fix 5a: display source name, not raw UUID
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
  async parseExcelColumns(buffer: Buffer): Promise<{ columns: string[]; sampleRows: Record<string, string>[] }> {
    const rows = await this.loadExcelRows(buffer)
    if (rows.length < 2) {
      throw new BadRequestException({ error: { code: 'EXCEL_NO_DATA', message: 'Excel 文件缺少数据行（至少需要表头行 + 1 行数据）' } })
    }
    const columns = (rows[0] ?? []).map((c) => c.trim()).filter(Boolean)

    // 敏感列检测：命中任何一个敏感词 → 拒绝，不落 DB
    const sensitiveHeaders = columns.filter((c) => isSensitiveColumn(c))
    if (sensitiveHeaders.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'SENSITIVE_COLUMN_DETECTED',
          message: `Excel 包含敏感列，禁止导入求职者个人信息: ${sensitiveHeaders.join(', ')}`,
        },
      })
    }

    const sampleRows = rows.slice(1, 6).map((row) => {
      const obj: Record<string, string> = {}
      columns.forEach((col, i) => { obj[col] = row[i] ?? '' })
      return obj
    })
    return { columns, sampleRows }
  }

  /**
   * 用 exceljs 读取 Excel buffer，返回逐行字符串数组（等价于 xlsx sheet_to_json header:1）。
   * 替换了有 CVE-2023-30533 的 xlsx@0.18.5。
   */
  private async loadExcelRows(buffer: Buffer): Promise<string[][]> {
    const wb = new Workbook()
    try {
      // exceljs types use old-style Buffer; cast via ArrayBuffer to satisfy TS without runtime cost
      await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    } catch {
      throw new BadRequestException({ error: { code: 'EXCEL_EMPTY', message: 'Excel 文件为空或格式不正确' } })
    }
    const ws = wb.getWorksheet(1)
    if (!ws) {
      throw new BadRequestException({ error: { code: 'EXCEL_EMPTY', message: 'Excel 文件为空或格式不正确' } })
    }
    const colCount = ws.columnCount
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      rows.push(Array.from({ length: colCount }, (_, i) => row.getCell(i + 1).text))
    })
    return rows
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

    const allRows = await this.loadExcelRows(args.buffer)
    if (allRows.length < 2) {
      throw new BadRequestException({ error: { code: 'EXCEL_NO_DATA', message: 'Excel 缺少数据行' } })
    }
    const headers = (allRows[0] ?? []).map((h) => h.trim())
    const dataRows = allRows.slice(1)

    // Fix 2: 敏感列检测（两层）
    // 1. Excel 原始表头
    const sensitiveHeaders = headers.filter((h) => isSensitiveColumn(h))
    if (sensitiveHeaders.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'SENSITIVE_COLUMN_DETECTED',
          message: `Excel 包含敏感列，禁止导入求职者个人信息: ${sensitiveHeaders.join(', ')}`,
        },
      })
    }
    // 2. fieldMapping 中选中的 Excel 列名
    const sensitiveMapped = Object.values(args.fieldMapping).filter((col) => isSensitiveColumn(col))
    if (sensitiveMapped.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'SENSITIVE_COLUMN_IN_MAPPING',
          message: `字段映射中包含敏感列，禁止导入: ${sensitiveMapped.join(', ')}`,
        },
      })
    }

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

    // Collect existing externalIds for dup detection (DB level)
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

    // Fix 4: intra-batch dup detection
    const seenInBatch = new Set<string>()

    const parsed: ParsedRow[] = dataRows.map((rawRow, idx) => {
      // Fix 1: never persist raw row data — only extract mapped fields
      const rawData: Record<string, string> = {}
      headers.forEach((h, i) => { rawData[h] = (rawRow[i] ?? '').trim() })

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
      } else if (mapped.externalId) {
        // Fix 4: check both intra-batch and DB-level dups
        if (seenInBatch.has(mapped.externalId) || existingExtIds.has(mapped.externalId)) {
          status = 'dup'
        } else {
          seenInBatch.add(mapped.externalId)
        }
      }

      return {
        rowIndex: idx + 2, // 1-indexed, skipping header
        rawData: {},       // Fix 1: discard raw row — never store PII in rawDataJson
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
          rawDataJson: '{}',   // Fix 1: never persist raw PII; only mappedJson is stored
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
    const totalValid  = batch.records.length
    const touchedJobIds: string[] = []

    // Fix 3: 事务化写入 — 任一行失败则整批回滚，状态标记 failed
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const record of batch.records) {
          const mapped = JSON.parse(record.mappedJson) as Record<string, string>
          if (batch.dataType === 'job') {
            const job = await tx.job.upsert({
              where: { sourceOrgId_externalId: { sourceOrgId, externalId: mapped.externalId } },
              create: {
                sourceOrgId, sourceId: batch.sourceId, externalId: mapped.externalId, sourceName,
                sourceUrl: mapped.sourceUrl ?? '',
                title: mapped.title ?? '', company: mapped.company ?? '', city: mapped.city ?? '',
                salary: mapped.salary || null,
                description: mapped.description || null, requirements: mapped.requirements || null,
                tagsJson: JSON.stringify(buildJobTags([], mapped.industry)),
                educationRequirement: mapped.educationRequirement || null,
                experienceRequirement: mapped.experienceRequirement || null,
                skillsJson: JSON.stringify(splitMappedList(mapped.skills)),
                benefitsJson: JSON.stringify(splitMappedList(mapped.benefits)),
                salaryMin: parseMappedNumber(mapped.salaryMin),
                salaryMax: parseMappedNumber(mapped.salaryMax),
                salaryUnit: mapped.salaryUnit || null,
                validThrough: parseMappedDate(mapped.validThrough),
                reviewStatus: 'pending', publishStatus: 'draft',
                syncTime: sync,
              },
              update: {
                sourceName, sourceUrl: mapped.sourceUrl ?? '',
                title: mapped.title ?? '', company: mapped.company ?? '', city: mapped.city ?? '',
                salary: mapped.salary || null,
                description: mapped.description || null, requirements: mapped.requirements || null,
                tagsJson: JSON.stringify(buildJobTags([], mapped.industry)),
                educationRequirement: mapped.educationRequirement || null,
                experienceRequirement: mapped.experienceRequirement || null,
                skillsJson: JSON.stringify(splitMappedList(mapped.skills)),
                benefitsJson: JSON.stringify(splitMappedList(mapped.benefits)),
                salaryMin: parseMappedNumber(mapped.salaryMin),
                salaryMax: parseMappedNumber(mapped.salaryMax),
                salaryUnit: mapped.salaryUnit || null,
                validThrough: parseMappedDate(mapped.validThrough),
                syncTime: sync,
              },
            })
            touchedJobIds.push(job.id)
          } else {
            const startAt = new Date(mapped.startAt)
            const endAt   = new Date(mapped.endAt)
            await tx.jobFair.upsert({
              where: { sourceOrgId_externalId: { sourceOrgId, externalId: mapped.externalId } },
              create: {
                sourceOrgId, externalId: mapped.externalId, sourceName,
                sourceId: batch.sourceId,
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
        }
      })
    } catch (e) {
      this.logger.error(`confirmExcelImport transaction failed: batchId=${batchId}`, e as Error)
      // 整批失败：标记 batch failed，不写 SyncLog
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { status: 'failed' },
      })
      throw new InternalServerErrorException({
        error: { code: 'IMPORT_TRANSACTION_FAILED', message: 'Excel 导入事务失败，数据已回滚，请检查数据后重试' },
      })
    }

    const imported = totalValid

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

    // Update batch status → confirmed
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'confirmed', confirmedAt: new Date() },
    })

    if (batch.dataType === 'job') {
      await this.refreshJobQualitySnapshots(touchedJobIds)
    }

    // T1: 保存/更新该数据源的字段映射规则,供下次导入自动回填。
    // 用本批次实际使用的 mappingJson;空映射不落库(无可复用内容)。
    await this.saveMappingRule({
      sourceId: batch.sourceId,
      orgId: batch.orgId,
      dataType: batch.dataType,
      mappingJson: batch.mappingJson,
      updatedBy: user.userId,
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

  // ── Admin: 导入批次列表 ─────────────────────────────────────────────────────

  async getAdminImportBatches(): Promise<AdminImportBatchDto[]> {
    const batches = await this.prisma.importBatch.findMany({
      include: { source: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    const orgIds = [...new Set(batches.map((b) => b.orgId))]
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    })
    const orgMap = new Map(orgs.map((o) => [o.id, o.name]))

    return batches.map((b) => ({
      id: b.id,
      sourceId: b.sourceId,
      sourceName: b.source.name,
      orgId: b.orgId,
      orgName: orgMap.get(b.orgId) ?? b.orgId,
      dataType: b.dataType as 'job' | 'fair',
      fileName: b.fileName,
      totalRows: b.totalRows,
      validRows: b.validRows,
      invalidRows: b.invalidRows,
      dupRows: b.dupRows,
      status: b.status as AdminImportBatchDto['status'],
      createdBy: b.createdBy,
      confirmedAt: b.confirmedAt ? b.confirmedAt.toISOString() : null,
      createdAt: b.createdAt.toISOString(),
    }))
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

  // ── T1: 字段映射规则复用 ─────────────────────────────────────────────────────

  /**
   * 读取某数据源 × dataType 上次保存的字段映射规则,供前端导入向导自动回填。
   * 未保存过则返回空映射(mapping={}, updatedAt=null),前端回退到模糊自动识别。
   * 校验数据源归属当前 partner 机构,防止越权读取他机构映射。
   */
  async getMappingRule(
    sourceId: string,
    dataType: 'job' | 'fair',
    user: AuthedUser,
  ): Promise<FieldMappingRuleDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const source = await this.prisma.jobSource.findUnique({ where: { id: sourceId } })
    if (!source || source.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }

    const rule = await this.prisma.fieldMappingRule.findUnique({
      where: { sourceId_dataType: { sourceId, dataType } },
    })

    let mapping: Record<string, string> = {}
    if (rule) {
      try {
        const parsed = JSON.parse(rule.mappingJson) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          mapping = parsed as Record<string, string>
        }
      } catch {
        mapping = {}
      }
    }

    return {
      sourceId,
      dataType,
      mapping,
      updatedAt: rule ? rule.updatedAt.toISOString() : null,
    }
  }

  /**
   * upsert 某数据源 × dataType 的字段映射规则(confirm 导入成功后调用)。
   * 空映射('{}' 或解析后无键)不落库,避免覆盖已有规则为空。
   * 失败只 warn 不抛错:映射规则是便利特性,不应阻断已成功的导入。
   */
  private async saveMappingRule(args: {
    sourceId: string
    orgId: string
    dataType: string
    mappingJson: string
    updatedBy: string
  }): Promise<void> {
    let hasKeys = false
    try {
      const parsed = JSON.parse(args.mappingJson) as unknown
      hasKeys = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0
    } catch {
      hasKeys = false
    }
    if (!hasKeys) return

    try {
      await this.prisma.fieldMappingRule.upsert({
        where: { sourceId_dataType: { sourceId: args.sourceId, dataType: args.dataType } },
        create: {
          sourceId: args.sourceId,
          orgId: args.orgId,
          dataType: args.dataType,
          mappingJson: args.mappingJson,
          updatedBy: args.updatedBy,
        },
        update: {
          mappingJson: args.mappingJson,
          updatedBy: args.updatedBy,
        },
      })
    } catch (e) {
      this.logger.warn(`saveMappingRule failed (non-fatal): sourceId=${args.sourceId} dataType=${args.dataType} ${(e as Error).message}`)
    }
  }
}
