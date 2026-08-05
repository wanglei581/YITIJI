// ============================================================
// 线下招聘机构 Service — G1 功能
//
// API 端点：
//   GET /api/v1/kiosk/offline-agencies  → 机构列表（raw 分页响应）
//   GET /api/v1/kiosk/offline-jobs/:id  → 线下岗位详情（raw Prisma 镜像）
//
// 合规约束：只展示来源机构信息与到店指引，不代收简历、不代投递。
// ============================================================

import { API_BASE_URL, API_MODE } from './client'

export interface WireOfflineAgency {
  id: string
  name: string
  orgType: string
  address: string
  district: string | null
  lat: number | null
  lng: number | null
  openHours: string | null
  phone: string | null
  contactEmail: string | null
  website: string | null
  services: string
  description: string | null
  logoUrl: string | null
  status: string
  sourceOrgId: string | null
  externalId: string | null
  syncTime: string | null
  createdAt: string
  updatedAt: string
}

interface WireOfflineAgencyListStats {
  totalAgencies: number
  openAgencies: number
  totalJobs: number
  districts: number
  lastSyncLabel?: string
}

interface WireOfflineAgencyListResponse {
  items: WireOfflineAgency[]
  total: number
  page: number
  pageSize: number
  stats?: WireOfflineAgencyListStats
}

export interface WireOfflineJobAgency {
  id: string
  name: string
  orgType: string
  address: string
  district: string | null
  phone: string | null
  openHours: string | null
  website: string | null
  reviewStatus: string
  publishStatus: string
}

export interface WireOfflineJob {
  id: string
  agencyId: string
  title: string
  jobType: string
  salaryMin: number | null
  salaryMax: number | null
  salaryUnit: string
  requirements: string | null
  description: string | null
  headcount: number
  location: string | null
  education: string | null
  experience: string | null
  externalUrl: string | null
  externalId: string | null
  status: string
  createdAt: string
  updatedAt: string
  agency: WireOfflineJobAgency
}

export interface OfflineAgencyDTO {
  id: string
  name: string
  type: string
  address: string
  district?: string
  hours?: string
  services: string[]
  orgCode?: string
  syncTime?: string
  phone?: string | null
  /** 机构当前状态（'open' | 'rest'），来自后端 status 字段；前端按此渲染徽章 */
  status: 'open' | 'rest' | string
  statusLabel?: string
  /** 当前在招岗位数，由后端聚合返回（仅详情端点提供，列表端点不提供）*/
  jobCount?: number
}

export interface OfflineAgencyListStats {
  totalAgencies: number
  openAgencies: number
  totalJobs: number
  districts: number
  lastSyncLabel?: string
}

export interface OfflineAgencyListResult {
  items: OfflineAgencyDTO[]
  total: number
  page: number
  pageSize: number
  stats: OfflineAgencyListStats
}

export interface OfflineAgencyListParams {
  district?: string
  service?: string
  orgType?: string
  keyword?: string
  page?: number
  pageSize?: number
}

export interface OfflineJobDTO {
  id: string
  title: string
  salary?: string
  jobType?: string
  location?: string
  tags: string[]
  responsibilities: string[]
  requirements: string[]
  agencyId: string
  agencyName: string
  agencyType: string
  agencyAddress: string
  agencyHours?: string
  agencyPhone?: string
  agencyServices: string[]
}

export type OfflineJobDetailDTO = OfflineJobDTO

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') sp.set(key, String(value))
  }
  const query = sp.toString()
  return query ? `?${query}` : ''
}

async function getJson<T>(path: string): Promise<T> {
  if (API_MODE !== 'http') throw new Error('OFFLINE_AGENCIES_REQUIRES_BACKEND')

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  return response.json() as Promise<T>
}

function parseStringList(value?: string | null): string[] {
  const text = value?.trim()
  if (!text) return []

  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    }
  } catch {
    // 普通文本是合法存量值，继续按换行或常见分隔符拆分。
  }

  return text.split(/\r?\n|[、，,；;]/).map((item) => item.trim()).filter(Boolean)
}

function orgTypeLabel(orgType: string): string {
  const labels: Record<string, string> = {
    recruitment: '人力资源服务机构',
    headhunting: '猎头服务机构',
    staffing: '劳务派遣机构',
    hr_consulting: '人力资源咨询机构',
  }
  return labels[orgType] ?? '机构类型以公示为准'
}

function salaryLabel(min: number | null, max: number | null, unit: string): string | undefined {
  if (min === null && max === null) return undefined
  const unitLabel = unit === 'day' ? '元/天' : unit === 'hour' ? '元/小时' : '元/月'
  const format = (value: number) => value.toLocaleString('zh-CN')
  if (min !== null && max !== null) {
    return min === max ? `${format(min)} ${unitLabel}` : `${format(min)}–${format(max)} ${unitLabel}`
  }
  if (min !== null) return `${format(min)} ${unitLabel}起`
  if (max !== null) return `最高 ${format(max)} ${unitLabel}`
  return undefined
}

export interface OfflineAgencyJobSummary {
  id: string
  title: string
  jobType?: string
  location?: string
  salaryMin?: number | null
  salaryMax?: number | null
  status?: string
}

export interface OfflineAgencyDetailDTO extends OfflineAgencyDTO {
  phone?: string | null
  description?: string | null
  website?: string | null
  jobs: OfflineAgencyJobSummary[]
}

export function mapWireOfflineAgency(agency: WireOfflineAgency): OfflineAgencyDTO {
  const isOpen = agency.status === 'active'
  return {
    id: agency.id,
    name: agency.name,
    type: orgTypeLabel(agency.orgType),
    address: agency.address,
    district: agency.district ?? undefined,
    hours: agency.openHours ?? undefined,
    services: parseStringList(agency.services),
    orgCode: agency.externalId ?? agency.sourceOrgId ?? undefined,
    syncTime: agency.syncTime ?? undefined,
    phone: agency.phone ?? null,
    status: agency.status,
    statusLabel: agency.statusLabel ?? '正常收录',
  }
}

/** 线下机构详情（含在招岗位）。 */
export function getOfflineAgencyById(id: string): Promise<OfflineAgencyDetailDTO> {
  return getJson(`/kiosk/offline-agencies/${encodeURIComponent(id)}`)
}

export function mapWireOfflineJob(job: WireOfflineJob): OfflineJobDetailDTO {
  return {
    id: job.id,
    title: job.title,
    salary: salaryLabel(job.salaryMin, job.salaryMax, job.salaryUnit),
    jobType: job.jobType,
    location: job.location ?? undefined,
    tags: [
      job.education ? `学历：${job.education}` : undefined,
      job.experience ? `经验：${job.experience}` : undefined,
    ].filter((item): item is string => Boolean(item)),
    responsibilities: parseStringList(job.description),
    requirements: parseStringList(job.requirements),
    agencyId: job.agencyId,
    agencyName: job.agency.name,
    agencyType: orgTypeLabel(job.agency.orgType),
    agencyAddress: job.agency.address,
    agencyHours: job.agency.openHours ?? undefined,
    agencyPhone: job.agency.phone ?? undefined,
    agencyServices: [],
  }
}

/** 线下招聘机构列表（带分页和服务端支持的筛选）。 */
export async function getOfflineAgencies(
  params?: OfflineAgencyListParams,
): Promise<OfflineAgencyListResult> {
  const response = await getJson<WireOfflineAgencyListResponse>(
    `/kiosk/offline-agencies${qs({ ...params })}`,
  )
  if (!Array.isArray(response.items)) throw new Error('INVALID_OFFLINE_AGENCY_RESPONSE')
  return {
    items: response.items.map(mapWireOfflineAgency),
    total: response.total,
    page: response.page,
    pageSize: response.pageSize,
    stats: response.stats ?? {
      totalAgencies: response.total,
      openAgencies: 0,
      totalJobs: 0,
      districts: 0,
    },
  }
}

/** 线下岗位详情；生产端点直接返回 raw Prisma 镜像。 */
export async function getOfflineJobDetail(id: string): Promise<OfflineJobDetailDTO> {
  const response = await getJson<WireOfflineJob>(
    `/kiosk/offline-jobs/${encodeURIComponent(id)}`,
  )
  return mapWireOfflineJob(response)
}

/** @deprecated 使用 getOfflineJobDetail。 */
export function getOfflineJobById(id: string): Promise<OfflineJobDTO> {
  return getOfflineJobDetail(id)
}
