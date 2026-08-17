// ============================================================
// jobs-shared.ts — 共享类型 + 纯函数助手
//
// 被 jobs-kiosk / jobs-admin / jobs-partner / jobs-excel 四个子服务引用。
// 本文件不含任何 NestJS 装饰器或依赖注入。
// ============================================================

import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client'
import { jobValidityWhere, isJobExpiredForAdmin } from './job-validity'
import { screenJob, type JobContentFlag } from './job-content-screening'
import {
  JOB_WORK_TYPE_VALUES,
  mapJobWorkTypeToCategory,
  normalizeJobWorkType,
  type JobWorkTypeValue,
} from './work-type'

// ─── Literal union aliases ────────────────────────────────────────────────────

export type ReviewStatus  = 'pending' | 'reviewing' | 'approved' | 'rejected'
export type PublishStatus = 'draft' | 'published' | 'unpublished' | 'expired'
export type FairStatus    = 'upcoming' | 'ongoing' | 'ended'
export type WorkType      = JobWorkTypeValue
export type ConnStatus    = 'connected' | 'error' | 'disabled'
export type SourceKind    = 'job_platform' | 'hr_company' | 'school' | 'fair_organizer' | 'aggregator' | 'manual'
export type AccessMode    = 'api' | 'excel' | 'csv' | 'json' | 'webhook' | 'manual'
export type SyncFrequency = 'realtime' | 'hourly' | 'daily' | 'weekly' | 'manual'

// ─── Query helpers (internal) ─────────────────────────────────────────────────

export interface PublishedFairsParams {
  status?: string
  keyword?: string
  page?: number
  pageSize?: number
  terminalId?: string
}

export interface PublishedFairQueryGroup {
  where: Prisma.JobFairWhereInput
  orderBy: Array<{ startAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }>
}

// ─── 招聘会公开列表:筛选下推 + 默认排序 ─────────────────────────────────────────
//
// 三条硬约束(改动前这里全部不成立,见 verify:fair-list-integrity):
//   1. status 必须进 where —— 否则「取一页再内存过滤」会让整页被筛空,
//      同时 total 仍是未筛选值,接口自相矛盾。
//   2. keyword 必须进 where —— 与 /jobs 一致做服务端全表检索,
//      而不是让前端在「当前已加载的那一页」里本地过滤。
//   3. 默认排序必须让「还能参加的」在前 —— 招聘会列表以未来活动为主,
//      纯 startAt asc 会把最老的已结束场次顶到第一页。

/** FairStatus 的运行时取值(门禁与入参校验共用,避免各处各写一份硬编码清单)。 */
export const FAIR_STATUS_VALUES = ['upcoming', 'ongoing', 'ended'] as const satisfies readonly FairStatus[]

/** 只接受合法 status;非法/缺省一律返回 null(= 不按状态筛选)。 */
export function parseFairStatusFilter(raw?: string): FairStatus | null {
  const v = raw?.trim()
  return v && (FAIR_STATUS_VALUES as readonly string[]).includes(v) ? (v as FairStatus) : null
}

/**
 * status → 时间条件。必须与 deriveFairStatus() 的判定完全同构,
 * 否则「筛选出来的」和「卡片上显示的状态」会对不上:
 *   deriveFairStatus: now < startAt → upcoming;now > endAt → ended;其余 ongoing
 */
export function buildFairStatusWhere(status: FairStatus, now: Date): Prisma.JobFairWhereInput {
  if (status === 'upcoming') return { startAt: { gt: now } }
  if (status === 'ended')    return { endAt: { lt: now } }
  return { AND: [{ startAt: { lte: now } }, { endAt: { gte: now } }] }
}

/** 招聘会关键词检索字段(对齐前端搜索框提示「招聘会、企业、地点」)。 */
export const FAIR_KEYWORD_FIELDS = ['title', 'sourceName', 'venue', 'city', 'description'] as const

/** 与 /jobs 的 keyword 一致:服务端 OR contains 全表检索。空词返回 null。 */
export function buildFairKeywordWhere(keyword?: string): Prisma.JobFairWhereInput | null {
  const kw = keyword?.trim()
  if (!kw) return null
  return { OR: FAIR_KEYWORD_FIELDS.map((field) => ({ [field]: { contains: kw } })) }
}

const FAIR_ORDER_ASC  = [{ startAt: 'asc'  as const }, { id: 'asc' as const }]
const FAIR_ORDER_DESC = [{ startAt: 'desc' as const }, { id: 'asc' as const }]

/**
 * 构造公开招聘会的分组查询。
 *
 * 分桶顺序 = 展示顺序,组内各自排序,组间拼接:
 *   [本校优先(可选)] × [未结束 startAt 升序 → 已结束 startAt 倒序]
 *
 * 未结束(endAt >= now)升序 = 最近一场能参加的排最前;
 * 已结束(endAt < now)倒序 = 刚结束的排在很久以前的前面,整体沉底。
 *
 * 两个维度都是「互斥且穷尽」的划分,所以各组 count 之和 = 真实总数,
 * total 不会虚高也不会漏计。
 */
export function buildPublishedFairGroups(opts: {
  base: Prisma.JobFairWhereInput
  now: Date
  status: FairStatus | null
  keyword?: string
  preferredOrgId: string | null
}): PublishedFairQueryGroup[] {
  const { base, now, status, keyword, preferredOrgId } = opts

  const narrowing: Prisma.JobFairWhereInput[] = []
  if (status) narrowing.push(buildFairStatusWhere(status, now))
  const keywordWhere = buildFairKeywordWhere(keyword)
  if (keywordWhere) narrowing.push(keywordWhere)

  const scope = (...parts: Prisma.JobFairWhereInput[]): Prisma.JobFairWhereInput => ({
    AND: [base, ...parts, ...narrowing].filter((p) => Object.keys(p).length > 0),
  })

  const active: Prisma.JobFairWhereInput = { endAt: { gte: now } }
  const ended:  Prisma.JobFairWhereInput = { endAt: { lt: now } }

  // 注意:即使已按 status 收窄,两个时间桶也都保留。
  // 剪掉「理论上必为空」的桶会在脏数据(endAt < startAt)时漏计,
  // 宁可多两次 count,也不让 total 少算。
  const orgBuckets: Prisma.JobFairWhereInput[] = preferredOrgId
    ? [{ sourceOrgId: preferredOrgId }, { NOT: { sourceOrgId: preferredOrgId } }]
    : [{}]

  return orgBuckets.flatMap((org) => [
    { where: scope(org, active), orderBy: FAIR_ORDER_ASC },
    { where: scope(org, ended),  orderBy: FAIR_ORDER_DESC },
  ])
}

// ─── Exported DTO types ───────────────────────────────────────────────────────

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
  /** 企业展示关联(可选) */
  companyProfileId?: string | null
}

export interface FairIntentSlice { label: string; percent: number }
export interface FairIndustrySlice { label: string; count: number }

export interface FairListItemDto {
  id: string; name: string; organizer: string
  startTime: string; endTime: string; venue: string; status: FairStatus
  description?: string; boothCount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; checkinUrl?: string; syncTime: string
  hasManagedData: boolean; managedCompanyCount: number; managedMaterialCount: number
  dataSourceNote: string
  jobCount?: number; theme?: string
  city?: string; address?: string; mapImageUrl?: string
  latitude?: number; longitude?: number; trafficInfo?: string
  expectedAttendance?: number
}

export interface FairStatsDto {
  fairId: string; fairName: string
  totalCompanies: number
  /** null 表示无可证明统计源 */
  checkedInCompanies: number | null
  totalPositions: number; totalHeadcount: number
  /** null 表示无可证明统计源 */
  browseCount: number | null
  /** null 表示无可证明统计源 */
  scanCount: number | null
  /** null 表示无可证明统计源 */
  printCount: number | null
  /** null 表示无可证明统计源 */
  checkinCount: number | null
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
  /** 来源标注的有效期限；null = 来源未提供。 */
  validThrough: string | null
  /**
   * 派生（不落库）：已发布但 validThrough 已过。
   *
   * 与 publishStatus **并列**而不是取代它 —— publishStatus 保持库里真值 'published'，
   * 否则 Admin 表的「下架」按钮（按 publishStatus === 'published' 显示）会消失，
   * 运营反而失去处置过期岗位的唯一动作。详见 job-validity.ts。
   */
  expired: boolean
  /**
   * 派生（不落库）：岗位正文命中的歧视性 / 限制流动表述，供审核员人工复核。
   *
   * **命中不等于违规，系统不据此自动拒绝**（见 job-content-screening.ts 顶部约束 1）。
   * 空数组 = 本次扫描无命中，不代表内容一定合规。
   */
  contentFlags: JobContentFlag[]
  reviewedBy: string | null
  reviewedAt: string | null
  rejectReason: string | null
}

export interface AdminFairDto {
  id: string
  name: string; organizer: string; startTime: string; endTime: string; venue: string
  status: FairStatus; description?: string; boothCount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; checkinUrl?: string; syncTime: string
  reviewStatus: ReviewStatus; publishStatus: PublishStatus
  rejectReason?: string | null
}

export interface PartnerJobDto {
  id: string; externalId: string; title: string; company: string; city: string
  sourceUrl: string; syncTime: string; reviewStatus: ReviewStatus; publishStatus: PublishStatus
  /** 来源标注的有效期限；null = 来源未提供。 */
  validThrough: string | null
  /** 派生（不落库）：已发布但 validThrough 已过。与 publishStatus 并列，见 job-validity.ts。 */
  expired: boolean
  sourceOrgId: string; sourceName: string
  category?: string; salary?: string; tags?: string[]
  description?: string; requirements?: string
}

export interface PartnerFairDto {
  id: string; externalId: string; name: string; organizer: string
  startTime: string; endTime: string; venue: string; status: FairStatus
  sourceUrl: string; checkinUrl?: string; syncTime: string; reviewStatus: ReviewStatus; publishStatus: PublishStatus
  sourceOrgId: string; sourceName: string
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

export interface ExcelPreviewRowDto {
  rowIndex: number
  status: 'ok' | 'invalid' | 'dup'
  data: Record<string, string>
  errors: string[]
  externalId?: string
}

export interface FieldMappingRuleDto {
  sourceId: string
  dataType: 'job' | 'fair'
  mapping: Record<string, string>
  updatedAt: string | null
}

export interface SingleResult<T> {
  data: T | null
  success: boolean
}

export interface ImportResult<T> {
  imported: number
  items: T[]
  added?: number
  updated?: number
}

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
  activationManagedBy?: 'admin' | 'partner'
}

// ─── Pure helper functions ────────────────────────────────────────────────────

export const INDUSTRY_TAG_PREFIX = '行业:'

export function buildJobIndustryTag(industry: string): string {
  return `${INDUSTRY_TAG_PREFIX}${industry.trim()}`
}

/** Kiosk 公开岗位的筛选条件（approved + published）。 */
export interface PublishedJobFilter {
  keyword?: string
  city?: string
  industry?: string
  category?: string
  sourceOrgId?: string
  tag?: string
}

/**
 * 已发布岗位的 where 条件。
 *
 * 抽出来是为了让「岗位列表」和「岗位要求计数」永远描述**同一批岗位** ——
 * 计数表说的是「你在这台机器上能看到的这批岗位普遍要求什么」，
 * 两处 where 一旦漂移，计数就会变成对一批用户看不到的岗位的统计。
 *
 * 有效期条件走 jobValidityWhere（见 job-validity.ts）：
 * publishStatus 永远不会被写成 'expired'，过期只能按 validThrough 实时派生。
 * 它必须进 AND 数组而不是顶层 —— 顶层已被 keyword 的 OR 占用，
 * 再写一个同级 OR 会把有效期条件覆盖掉（对象字面量后者胜），
 * 那样过期岗位会在带关键词搜索时重新漏出来。
 */
export function buildPublishedJobWhere(params?: PublishedJobFilter, now: Date = new Date()) {
  const kw = params?.keyword?.trim()
  const and: Prisma.JobWhereInput[] = []
  if (params?.tag)      and.push({ tagsJson: { contains: `"${params.tag}"` } })
  if (params?.industry) and.push({ tagsJson: { contains: `"${buildJobIndustryTag(params.industry)}"` } })
  and.push(jobValidityWhere(now))
  return {
    reviewStatus:  'approved',
    publishStatus: 'published',
    ...(params?.city        ? { city: params.city }               : {}),
    ...(params?.category    ? { category: params.category }       : {}),
    ...(params?.sourceOrgId ? { sourceOrgId: params.sourceOrgId } : {}),
    AND: and,
    ...(kw ? {
      OR: [
        { title:       { contains: kw } },
        { company:     { contains: kw } },
        { description: { contains: kw } },
      ],
    } : {}),
  }
}

export function safeJsonArr(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function extractIndustry(tags: string[]): string | undefined {
  const hit = tags.find((t) => t.startsWith(INDUSTRY_TAG_PREFIX))
  return hit ? hit.slice(INDUSTRY_TAG_PREFIX.length) : undefined
}

export function displayTags(tags: string[]): string[] {
  return tags.filter((t) => !t.startsWith(INDUSTRY_TAG_PREFIX))
}

export function categoryToWorkType(category: string | null): WorkType | undefined {
  switch (category) {
    case 'fulltime': return 'full_time'
    case 'parttime': return 'part_time'
    case 'intern':   return 'internship'
    case 'campus':   return 'campus'
    default:         return undefined
  }
}

export function fmtSyncTime(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16)
}

export function normalizeOptionalHttpUrl(value: string | undefined, fieldName: string): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new BadRequestException({ error: { code: 'INVALID_URL', message: `${fieldName} 必须是有效 http(s) 链接` } })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException({ error: { code: 'INVALID_URL', message: `${fieldName} 必须以 http:// 或 https:// 开头` } })
  }
  return trimmed
}

export function deriveFairStatus(startAt: Date, endAt: Date, now = new Date()): FairStatus {
  if (now < startAt) return 'upcoming'
  if (now > endAt) return 'ended'
  return 'ongoing'
}

export function parseSeekerIntent(json: string | null): FairIntentSlice[] {
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

export function formatSalaryUnit(unit: string | null): string {
  switch (unit) {
    case 'monthly': return '元/月'
    case 'yearly': return '元/年'
    case 'daily': return '元/天'
    default: return unit ? `/${unit}` : ''
  }
}

export function formatSalaryDisplay(j: Pick<PrismaJobRow, 'salary' | 'salaryMin' | 'salaryMax' | 'salaryUnit'>): string {
  if (j.salary?.trim()) return j.salary
  if (j.salaryMin != null && j.salaryMax != null) return `${j.salaryMin}-${j.salaryMax}${formatSalaryUnit(j.salaryUnit)}`
  if (j.salaryMin != null) return `${j.salaryMin}起${formatSalaryUnit(j.salaryUnit)}`
  if (j.salaryMax != null) return `${j.salaryMax}以内${formatSalaryUnit(j.salaryUnit)}`
  return '来源平台未提供'
}

export function buildJobTags(tags: string[] | undefined, industry?: string): string[] {
  const result = [...(tags ?? [])].map((tag) => tag.trim()).filter(Boolean)
  if (industry?.trim()) result.push(buildJobIndustryTag(industry))
  return [...new Set(result)]
}

export function splitMappedList(value: string | undefined): string[] {
  if (!value?.trim()) return []
  return value.split(/[，,;；、\n]/).map((item) => item.trim()).filter(Boolean)
}

export function parseMappedNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseMappedDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function mapWorkTypeToCategory(workType: string | undefined): string | undefined {
  return mapJobWorkTypeToCategory(workType)
}

export function normalizeMappedWorkType(workType: string | undefined): JobWorkTypeValue | undefined {
  if (!workType?.trim()) return undefined
  const normalized = normalizeJobWorkType(workType)
  return typeof normalized === 'string' && (JOB_WORK_TYPE_VALUES as readonly string[]).includes(normalized)
    ? normalized as JobWorkTypeValue
    : undefined
}

export function prismaJobSourceToPartnerDto(
  source: PrismaJobSourceRow,
  syncSummary?: {
    successCount: number
    failCount: number
  },
): PartnerDataSourceDto {
  const connStatus: ConnStatus = !source.enabled
    ? 'disabled'
    : source.lastSyncStatus === 'failed'
      ? 'error'
      : 'connected'
  return {
    id: source.id,
    name: source.name,
    sourceKind: source.sourceKind as SourceKind,
    accessMode: source.accessMode as AccessMode,
    syncFreq: source.syncFreq as SyncFrequency,
    lastSyncTime: source.lastSyncAt ? fmtSyncTime(source.lastSyncAt) : '从未同步',
    connStatus,
    successCount: syncSummary?.successCount ?? 0,
    failCount: syncSummary?.failCount ?? 0,
    description: source.description ?? '',
    credentialConfigured: Boolean(source.encryptedCredential || source.webhookSecret),
    endpoint: source.endpoint ?? undefined,
    activationManagedBy: source.accessMode === 'api' || source.accessMode === 'webhook' ? 'admin' : 'partner',
  }
}

export function prismaJobToListItem(j: PrismaJobRow): JobListItemDto {
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

export function prismaJobToAdminDto(j: PrismaJobRow): AdminJobDto {
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
    validThrough: j.validThrough ? j.validThrough.toISOString() : null,
    expired: isJobExpiredForAdmin(j.publishStatus, j.validThrough),
    contentFlags: screenJob(j),
    reviewedBy: j.reviewedBy,
    reviewedAt: j.reviewedAt ? j.reviewedAt.toISOString() : null,
    rejectReason: j.rejectReason,
  }
}

export function prismaJobToPartnerDto(j: PrismaJobRow): PartnerJobDto {
  return {
    id: j.id, externalId: j.externalId, title: j.title, company: j.company, city: j.city,
    sourceUrl: j.sourceUrl,
    syncTime: fmtSyncTime(j.syncTime),
    reviewStatus:  j.reviewStatus  as ReviewStatus,
    publishStatus: j.publishStatus as PublishStatus,
    validThrough: j.validThrough ? j.validThrough.toISOString() : null,
    expired: isJobExpiredForAdmin(j.publishStatus, j.validThrough),
    sourceOrgId: j.sourceOrgId, sourceName: j.sourceName,
    category: j.category ?? undefined,
    salary: j.salary ?? undefined,
    tags: safeJsonArr(j.tagsJson),
    description: j.description ?? undefined,
    requirements: j.requirements ?? undefined,
  }
}

export function prismaFairToListItem(f: PrismaJobFairRow): FairListItemDto {
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
    checkinUrl: f.checkinUrl ?? undefined,
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

export function prismaFairToAdminDto(f: PrismaJobFairRow): AdminFairDto {
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
    checkinUrl: f.checkinUrl ?? undefined,
    syncTime: fmtSyncTime(f.syncTime),
    reviewStatus: f.reviewStatus as ReviewStatus,
    publishStatus: f.publishStatus as PublishStatus,
    rejectReason: f.rejectReason,
  }
}

export function prismaFairToPartnerDto(f: PrismaJobFairRow): PartnerFairDto {
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
    checkinUrl: f.checkinUrl ?? undefined,
    syncTime: fmtSyncTime(f.syncTime),
    reviewStatus: f.reviewStatus as ReviewStatus,
    publishStatus: f.publishStatus as PublishStatus,
    sourceOrgId: f.sourceOrgId,
    sourceName: f.sourceName,
    theme: f.theme,
    city: f.city,
    address: f.address ?? undefined,
    description: f.description ?? undefined,
  }
}

export const PUBLIC_FAIR_DEMO_FILTERS: Prisma.JobFairWhereInput[] = [
  { sourceOrgId: { startsWith: 'org_vff_' } },
  { externalId: { startsWith: 'VFF-' } },
  { sourceUrl: { contains: 'example.org' } },
  { sourceName: { contains: '验证' } },
  { title: { contains: '验证' } },
  { venue: { contains: '验证' } },
  { city: { contains: '验证' } },
]

export function withPublicFairDemoExclusion(where: Prisma.JobFairWhereInput): Prisma.JobFairWhereInput {
  if (process.env['EXCLUDE_DEMO_PUBLIC_DATA'] !== 'true') return where
  return {
    AND: [
      where,
      { NOT: { OR: PUBLIC_FAIR_DEMO_FILTERS } },
    ],
  }
}

export function toPreviewRow(r: { rowIndex: number; status: 'ok' | 'invalid' | 'dup'; mapped: Record<string, string>; errors: string[]; externalId?: string }): ExcelPreviewRowDto {
  return {
    rowIndex: r.rowIndex,
    status: r.status,
    data: r.mapped,
    errors: r.errors,
    externalId: r.externalId,
  }
}

// ─── Internal Prisma row shapes ───────────────────────────────────────────────

export interface PrismaJobSourceRow {
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

export interface PrismaJobRow {
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

export interface PrismaJobFairRow {
  id: string
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  checkinUrl: string | null
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
  updatedAt: Date
  latitude: number | null
  longitude: number | null
  trafficInfo: string | null
  expectedAttendance: number | null
  seekerIntentJson: string | null
  _count?: { companies: number }
}
