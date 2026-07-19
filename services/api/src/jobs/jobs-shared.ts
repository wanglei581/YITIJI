// ============================================================
// jobs-shared.ts — 共享类型 + 纯函数助手
//
// 被 jobs-kiosk / jobs-admin / jobs-partner / jobs-excel 四个子服务引用。
// 本文件不含任何 NestJS 装饰器或依赖注入。
// ============================================================

import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client'
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
  page?: number
  pageSize?: number
  terminalId?: string
}

export interface PublishedFairQueryGroup {
  where: Prisma.JobFairWhereInput
  orderBy: { startAt: 'asc' | 'desc' }
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

export interface AdminFairDto {
  id: string
  name: string; organizer: string; startTime: string; endTime: string; venue: string
  status: FairStatus; description?: string; boothCount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; checkinUrl?: string; syncTime: string
  reviewStatus: ReviewStatus; publishStatus: PublishStatus
}

export interface PartnerJobDto {
  id: string; externalId: string; title: string; company: string; city: string
  sourceUrl: string; syncTime: string; reviewStatus: ReviewStatus; publishStatus: PublishStatus
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
}

// ─── Pure helper functions ────────────────────────────────────────────────────

export const INDUSTRY_TAG_PREFIX = '行业:'

export function buildJobIndustryTag(industry: string): string {
  return `${INDUSTRY_TAG_PREFIX}${industry.trim()}`
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

export function prismaJobSourceToPartnerDto(source: PrismaJobSourceRow): PartnerDataSourceDto {
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
    successCount: 0,
    failCount: source.lastSyncStatus === 'failed' ? 1 : 0,
    description: source.description ?? '',
    credentialConfigured: Boolean(source.encryptedCredential || source.webhookSecret),
    endpoint: source.endpoint ?? undefined,
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
  latitude: number | null
  longitude: number | null
  trafficInfo: string | null
  expectedAttendance: number | null
  seekerIntentJson: string | null
  _count?: { companies: number }
}
