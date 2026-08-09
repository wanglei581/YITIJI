// ============================================================
// Admin 线下招聘机构管理 Service
//
// API_MODE=http → 真实后端 /admin/offline-agencies/*
// API_MODE=mock → 内存 mock（初始为空列表）
//
// 合规：线下机构展示 = 机构基本信息 + 岗位信息导览，
//       不参与平台内招聘闭环、不收简历、无筛选/面试/Offer。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type OfflineAgencyOrgType =
  | 'recruitment'
  | 'headhunting'
  | 'staffing'
  | 'hr_consulting'

export const ORG_TYPE_LABELS: Record<OfflineAgencyOrgType, string> = {
  recruitment:  '招聘服务机构',
  headhunting:  '猎头机构',
  staffing:     '劳务派遣',
  hr_consulting:'人力资源咨询',
}

export interface AdminOfflineAgencyListItem {
  id: string
  name: string
  orgType: OfflineAgencyOrgType
  address: string | null
  phone: string | null
  reviewStatus: string   // pending | reviewing | approved | rejected
  publishStatus: string  // draft | published | unpublished | expired
  jobCount: number
  createdAt: string
  updatedAt: string
}

export interface AdminOfflineAgencyDetail extends AdminOfflineAgencyListItem {
  description: string | null
  contactEmail: string | null
  website: string | null
  logoUrl: string | null
}

export interface OfflineAgencyJob {
  id: string
  title: string
  jobType: 'fulltime' | 'parttime' | 'internship'
  salaryMin: number | null
  salaryMax: number | null
  salaryUnit: 'month' | 'day' | 'hour'
  location: string | null
  description: string | null
  requirements: string | null
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

export interface OfflineAgencyListFilters {
  orgType?: string
  reviewStatus?: string
  publishStatus?: string
  keyword?: string
  page?: number
  pageSize?: number
}

export interface OfflineAgencyListResult {
  data: AdminOfflineAgencyListItem[]
  total: number
  page: number
  pageSize: number
}

export interface OfflineAgencyInput {
  name: string
  orgType: OfflineAgencyOrgType
  address: string
  phone?: string | null
  contactEmail?: string | null
  description?: string | null
  website?: string | null
  logoUrl?: string | null
}

export interface OfflineAgencyJobInput {
  title: string
  jobType?: 'fulltime' | 'parttime' | 'internship'
  salaryMin?: number | null
  salaryMax?: number | null
  salaryUnit?: 'month' | 'day' | 'hour'
  location?: string | null
  description?: string | null
  requirements?: string | null
}

export interface OfflineAgenciesAdminServiceInterface {
  listAgencies(filters: OfflineAgencyListFilters): Promise<OfflineAgencyListResult>
  getAgency(id: string): Promise<AdminOfflineAgencyDetail>
  createAgency(input: OfflineAgencyInput): Promise<AdminOfflineAgencyDetail>
  updateAgency(id: string, input: Partial<OfflineAgencyInput>): Promise<AdminOfflineAgencyDetail>
  deleteAgency(id: string): Promise<void>
  reviewAgency(id: string, action: 'approve' | 'reject', rejectReason?: string): Promise<void>
  publishAgency(id: string, publish: boolean): Promise<void>
  listJobs(agencyId: string): Promise<OfflineAgencyJob[]>
  createJob(agencyId: string, input: OfflineAgencyJobInput): Promise<OfflineAgencyJob>
  updateJob(agencyId: string, jobId: string, input: Partial<OfflineAgencyJobInput>): Promise<OfflineAgencyJob>
  deleteJob(agencyId: string, jobId: string): Promise<void>
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function handleAuthFailure(status: number, code: string): void {
  if (status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', status)
  }
}

async function parseError(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`
  let message = res.statusText
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: string[] }
      message?: string | string[]
    }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
    else if (typeof body.message === 'string') message = body.message
    else if (Array.isArray(body.message) && body.message.length > 0) message = body.message.join('；')
    if (body.error?.details?.length) message = `${message}：${body.error.details.join('；')}`
  } catch { /* keep defaults */ }
  handleAuthFailure(res.status, code)
  throw new ApiHttpError(code, message, res.status)
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) await parseError(res)
  if (res.status === 204) return undefined as T
  const json = (await res.json()) as { success: boolean; data: T }
  return json.data
}

function listQuery(filters: OfflineAgencyListFilters): string {
  const params = new URLSearchParams()
  if (filters.orgType) params.set('orgType', filters.orgType)
  if (filters.reviewStatus) params.set('reviewStatus', filters.reviewStatus)
  if (filters.publishStatus) params.set('publishStatus', filters.publishStatus)
  if (filters.keyword?.trim()) params.set('keyword', filters.keyword.trim())
  if (filters.page) params.set('page', String(filters.page))
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

const BASE = '/admin/offline-agencies'

interface RawOfflineAgency extends Omit<AdminOfflineAgencyDetail, 'jobCount'> {
  _count?: { jobs: number }
  jobs?: RawOfflineJob[]
}

type RawOfflineJob = OfflineAgencyJob

interface RawPage<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

function mapAgency(raw: RawOfflineAgency): AdminOfflineAgencyDetail {
  return { ...raw, jobCount: raw._count?.jobs ?? raw.jobs?.length ?? 0 }
}

function mapJob(raw: RawOfflineJob): OfflineAgencyJob {
  return raw
}

const httpAdapter: OfflineAgenciesAdminServiceInterface = {
  async listAgencies(f) {
    const page = await req<RawPage<RawOfflineAgency>>('GET', `${BASE}${listQuery(f)}`)
    return { ...page, data: page.data.map(mapAgency) }
  },
  async getAgency(id) { return mapAgency(await req<RawOfflineAgency>('GET', `${BASE}/${id}`)) },
  async createAgency(input) { return mapAgency(await req<RawOfflineAgency>('POST', BASE, input)) },
  async updateAgency(id, input) { return mapAgency(await req<RawOfflineAgency>('PUT', `${BASE}/${id}`, input)) },
  deleteAgency: async (id) => { await req<unknown>('DELETE', `${BASE}/${id}`) },
  reviewAgency: async (id, action, rejectReason) => {
    await req<unknown>('PATCH', `${BASE}/${id}/review`, { action, ...(rejectReason !== undefined ? { reason: rejectReason } : {}) })
  },
  publishAgency: async (id, publish) => {
    await req<unknown>('PATCH', `${BASE}/${id}/publish`, { publishStatus: publish ? 'published' : 'unpublished' })
  },
  async listJobs(agencyId) {
    const page = await req<RawPage<RawOfflineJob>>('GET', `${BASE}/${agencyId}/jobs?pageSize=100`)
    return page.data.map(mapJob)
  },
  async createJob(agencyId, input) { return mapJob(await req<RawOfflineJob>('POST', `${BASE}/${agencyId}/jobs`, input)) },
  async updateJob(agencyId, jobId, input) { return mapJob(await req<RawOfflineJob>('PUT', `${BASE}/${agencyId}/jobs/${jobId}`, input)) },
  deleteJob: async (agencyId, jobId) => { await req<unknown>('DELETE', `${BASE}/${agencyId}/jobs/${jobId}`) },
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()
let mockSeq = 0
const nextId = (prefix: string) => `${prefix}-mock-${++mockSeq}`

const mockAgencies: AdminOfflineAgencyDetail[] = []
const mockJobs: Map<string, OfflineAgencyJob[]> = new Map()

function mustFindAgency(id: string): AdminOfflineAgencyDetail {
  const found = mockAgencies.find((a) => a.id === id)
  if (!found) throw new ApiHttpError('AGENCY_NOT_FOUND', '机构不存在', 404)
  return found
}

function toListItem(a: AdminOfflineAgencyDetail): AdminOfflineAgencyListItem {
  return {
    id: a.id, name: a.name, orgType: a.orgType, address: a.address,
    phone: a.phone,
    reviewStatus: a.reviewStatus, publishStatus: a.publishStatus,
    jobCount: mockJobs.get(a.id)?.length ?? 0,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  }
}

const mockAdapter: OfflineAgenciesAdminServiceInterface = {
  async listAgencies(filters) {
    const kw = filters.keyword?.trim().toLowerCase()
    const all = mockAgencies
      .filter((a) =>
        (!filters.orgType || a.orgType === filters.orgType) &&
        (!filters.reviewStatus || a.reviewStatus === filters.reviewStatus) &&
        (!filters.publishStatus || a.publishStatus === filters.publishStatus) &&
        (!kw || a.name.toLowerCase().includes(kw))
      )
      .map(toListItem)
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    return {
      data: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      page,
      pageSize,
    }
  },
  async getAgency(id) { return mustFindAgency(id) },
  async createAgency(input) {
    const created: AdminOfflineAgencyDetail = {
      id: nextId('agency'),
      name: input.name,
      orgType: input.orgType,
      address: input.address,
      phone: input.phone ?? null,
      contactEmail: input.contactEmail ?? null,
      description: input.description ?? null,
      website: input.website ?? null,
      logoUrl: input.logoUrl ?? null,
      reviewStatus: 'pending',
      publishStatus: 'draft',
      jobCount: 0,
      createdAt: now(),
      updatedAt: now(),
    }
    mockAgencies.unshift(created)
    mockJobs.set(created.id, [])
    return created
  },
  async updateAgency(id, input) {
    const a = mustFindAgency(id)
    Object.assign(a, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), {
      reviewStatus: 'pending', publishStatus: 'draft', updatedAt: now(),
    })
    return a
  },
  async deleteAgency(id) {
    const idx = mockAgencies.findIndex((a) => a.id === id)
    if (idx < 0) throw new ApiHttpError('AGENCY_NOT_FOUND', '机构不存在', 404)
    mockAgencies.splice(idx, 1)
    mockJobs.delete(id)
  },
  async reviewAgency(id, action, rejectReason) {
    const a = mustFindAgency(id)
    if (action === 'reject' && !rejectReason?.trim()) {
      throw new ApiHttpError('REJECT_REASON_REQUIRED', '驳回必须填写原因', 400)
    }
    if (action === 'approve') {
      a.reviewStatus = 'approved'
    } else {
      a.reviewStatus = 'rejected'
      a.publishStatus = 'draft'
    }
    a.updatedAt = now()
  },
  async publishAgency(id, publish) {
    const a = mustFindAgency(id)
    if (publish && a.reviewStatus !== 'approved') {
      throw new ApiHttpError('AGENCY_NOT_APPROVED', '机构未通过审核，不能发布', 400)
    }
    a.publishStatus = publish ? 'published' : 'unpublished'
    a.updatedAt = now()
  },
  async listJobs(agencyId) {
    mustFindAgency(agencyId)
    return mockJobs.get(agencyId) ?? []
  },
  async createJob(agencyId, input) {
    const agency = mustFindAgency(agencyId)
    const job: OfflineAgencyJob = {
      id: nextId('job'),
      title: input.title,
      jobType: input.jobType ?? 'fulltime',
      salaryMin: input.salaryMin ?? null,
      salaryMax: input.salaryMax ?? null,
      salaryUnit: input.salaryUnit ?? 'month',
      location: input.location ?? null,
      description: input.description ?? null,
      requirements: input.requirements ?? null,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    }
    const list = mockJobs.get(agencyId) ?? []
    list.unshift(job)
    mockJobs.set(agencyId, list)
    Object.assign(agency, { reviewStatus: 'pending', publishStatus: 'draft', updatedAt: now() })
    return job
  },
  async updateJob(agencyId, jobId, input) {
    mustFindAgency(agencyId)
    const list = mockJobs.get(agencyId) ?? []
    const job = list.find((j) => j.id === jobId)
    if (!job) throw new ApiHttpError('JOB_NOT_FOUND', '岗位不存在', 404)
    Object.assign(job, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), { updatedAt: now() })
    Object.assign(mustFindAgency(agencyId), { reviewStatus: 'pending', publishStatus: 'draft', updatedAt: now() })
    return job
  },
  async deleteJob(agencyId, jobId) {
    const list = mockJobs.get(agencyId) ?? []
    const idx = list.findIndex((j) => j.id === jobId)
    if (idx < 0) throw new ApiHttpError('JOB_NOT_FOUND', '岗位不存在', 404)
    list.splice(idx, 1)
  },
}

// ─── Facade ───────────────────────────────────────────────────────────────────

export const offlineAgenciesAdminService: OfflineAgenciesAdminServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
