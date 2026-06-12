// ============================================================
// Admin 企业展示管理 Service（CompanyProfile）
//
// API_MODE=http → 真实后端 /admin/companies/*（响应为 {success,data} 信封）
// API_MODE=mock → 内存 mock（初始为空列表，不造任何假企业数据）
//
// 合规（长期红线）：企业展示 = 来源企业与岗位导览，不是招聘平台。
// 不收简历、无平台内投递、无候选人/筛选/面试/Offer 能力；
// 投递一律引导用户走既有「去来源平台投递 / 扫码投递」链路。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ─── 类型（契约 = services/api CompaniesService Admin 返回形状）──────────────

export interface AdminCompanyListItem {
  id: string
  name: string
  sourceOrgId: string
  sourceName: string
  externalId: string
  province: string | null
  city: string | null
  district: string | null
  industry: string | null
  companyType: string | null
  fairParticipant: boolean
  reviewStatus: string
  publishStatus: string
  rejectReason: string | null
  linkedJobCount: number
  syncTime: string
  updatedAt: string
}

export interface CompanyLinkedJob {
  id: string
  title: string
  city: string
  category: string | null
  reviewStatus: string
  publishStatus: string
}

export interface AdminCompanyDetail extends AdminCompanyListItem {
  legalName: string | null
  logoUrl: string | null
  coverImageUrl: string | null
  promoVideoUrl: string | null
  description: string | null
  scale: string | null
  foundedAt: string | null
  address: string | null
  boothNo: string | null
  sourceUrl: string | null
  honorTags: string[]
  tags: string[]
  showOpenJobCount: boolean
  showCity: boolean
  showEmployeeScale: boolean
  showBoothNo: boolean
  linkedJobs: CompanyLinkedJob[]
}

/** 可关联岗位（同来源机构 + 已审核发布 + 未关联本企业）。 */
export interface CompanyLinkableJob {
  id: string
  title: string
  city: string
  category: string | null
  companyProfileId: string | null
}

export interface CompanyListFilters {
  reviewStatus?: string
  publishStatus?: string
  keyword?: string
}

/**
 * 可编辑字段。字符串字段传 null = 清空；传 undefined = 不修改。
 * foundedAt 只支持「不修改 / 改为某天」，不支持置空（后端 new Date(null) 会得到 1970）。
 */
export interface CompanyFieldsInput {
  name?: string
  legalName?: string | null
  logoUrl?: string | null
  coverImageUrl?: string | null
  promoVideoUrl?: string | null
  description?: string | null
  industry?: string | null
  companyType?: string | null
  scale?: string | null
  foundedAt?: string
  province?: string | null
  city?: string | null
  district?: string | null
  address?: string | null
  boothNo?: string | null
  honorTags?: string[]
  tags?: string[]
  fairParticipant?: boolean
  sourceUrl?: string | null
  showOpenJobCount?: boolean
  showCity?: boolean
  showEmployeeScale?: boolean
  showBoothNo?: boolean
}

export interface CreateCompanyInput extends CompanyFieldsInput {
  sourceOrgId: string
  externalId: string
  name: string
}

export interface LinkJobsResult {
  linked: number
  /** 不符合关联条件（非同来源机构或未审核发布）而被拒绝的岗位 ID */
  rejected: string[]
}

export interface CompaniesAdminServiceInterface {
  listCompanies(filters: CompanyListFilters): Promise<AdminCompanyListItem[]>
  getCompany(id: string): Promise<AdminCompanyDetail>
  createCompany(input: CreateCompanyInput): Promise<AdminCompanyDetail>
  updateCompany(id: string, input: CompanyFieldsInput): Promise<AdminCompanyDetail>
  reviewCompany(id: string, action: 'approve' | 'reject', rejectReason?: string): Promise<void>
  publishCompany(id: string, publish: boolean): Promise<void>
  listLinkableJobs(id: string, keyword?: string): Promise<CompanyLinkableJob[]>
  linkJobs(id: string, jobIds: string[]): Promise<LinkJobsResult>
  unlinkJob(id: string, jobId: string): Promise<void>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

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
  } catch {
    /* keep defaults */
  }
  handleAuthFailure(res.status, code)
  throw new ApiHttpError(code, message, res.status)
}

/** /admin/companies/* 响应统一为 {success:true,data} 信封，此处直接解包 data。 */
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) await parseError(res)
  const json = (await res.json()) as { success: boolean; data: T }
  return json.data
}

function listQuery(filters: CompanyListFilters): string {
  const params = new URLSearchParams()
  if (filters.reviewStatus) params.set('reviewStatus', filters.reviewStatus)
  if (filters.publishStatus) params.set('publishStatus', filters.publishStatus)
  if (filters.keyword?.trim()) params.set('keyword', filters.keyword.trim())
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

const httpAdapter: CompaniesAdminServiceInterface = {
  listCompanies: (filters) => req<AdminCompanyListItem[]>('GET', `/admin/companies${listQuery(filters)}`),
  getCompany: (id) => req<AdminCompanyDetail>('GET', `/admin/companies/${id}`),
  createCompany: (input) => req<AdminCompanyDetail>('POST', '/admin/companies', input),
  updateCompany: (id, input) => req<AdminCompanyDetail>('PATCH', `/admin/companies/${id}`, input),
  reviewCompany: async (id, action, rejectReason) => {
    await req<unknown>('PATCH', `/admin/companies/${id}/review`, { action, ...(rejectReason !== undefined ? { rejectReason } : {}) })
  },
  publishCompany: async (id, publish) => {
    await req<unknown>('PATCH', `/admin/companies/${id}/publish`, { publish })
  },
  listLinkableJobs: (id, keyword) =>
    req<CompanyLinkableJob[]>('GET', `/admin/companies/${id}/linkable-jobs${keyword?.trim() ? `?keyword=${encodeURIComponent(keyword.trim())}` : ''}`),
  linkJobs: (id, jobIds) => req<LinkJobsResult>('POST', `/admin/companies/${id}/jobs`, { jobIds }),
  unlinkJob: async (id, jobId) => {
    await req<unknown>('DELETE', `/admin/companies/${id}/jobs/${jobId}`)
  },
}

// ─── Mock adapter（初始为空，不造假数据；仅保证 UI 可走通）────────────────────

const now = () => new Date().toISOString()
let mockSeq = 0
const nextId = () => `company-mock-${++mockSeq}`

/** mock 模式不预置任何企业：空列表即真实空态。 */
const mockCompanies: AdminCompanyDetail[] = []

function toListItem(c: AdminCompanyDetail): AdminCompanyListItem {
  return {
    id: c.id, name: c.name, sourceOrgId: c.sourceOrgId, sourceName: c.sourceName, externalId: c.externalId,
    province: c.province, city: c.city, district: c.district,
    industry: c.industry, companyType: c.companyType, fairParticipant: c.fairParticipant,
    reviewStatus: c.reviewStatus, publishStatus: c.publishStatus, rejectReason: c.rejectReason,
    linkedJobCount: c.linkedJobs.length, syncTime: c.syncTime, updatedAt: c.updatedAt,
  }
}

function mustFind(id: string): AdminCompanyDetail {
  const found = mockCompanies.find((c) => c.id === id)
  if (!found) throw new ApiHttpError('COMPANY_NOT_FOUND', '企业不存在', 404)
  return found
}

const mockAdapter: CompaniesAdminServiceInterface = {
  async listCompanies(filters) {
    const keyword = filters.keyword?.trim().toLowerCase()
    return mockCompanies
      .filter((c) => (!filters.reviewStatus || c.reviewStatus === filters.reviewStatus)
        && (!filters.publishStatus || c.publishStatus === filters.publishStatus)
        && (!keyword || c.name.toLowerCase().includes(keyword)))
      .map(toListItem)
  },
  async getCompany(id) {
    return mustFind(id)
  },
  async createCompany(input) {
    const created: AdminCompanyDetail = {
      id: nextId(),
      name: input.name,
      sourceOrgId: input.sourceOrgId,
      sourceName: '（mock 模式：来源机构名称接真实后端后展示）',
      externalId: input.externalId,
      province: input.province ?? null,
      city: input.city ?? null,
      district: input.district ?? null,
      industry: input.industry ?? null,
      companyType: input.companyType ?? null,
      fairParticipant: input.fairParticipant ?? false,
      reviewStatus: 'pending',
      publishStatus: 'draft',
      rejectReason: null,
      linkedJobCount: 0,
      syncTime: now(),
      updatedAt: now(),
      legalName: input.legalName ?? null,
      logoUrl: input.logoUrl ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      promoVideoUrl: input.promoVideoUrl ?? null,
      description: input.description ?? null,
      scale: input.scale ?? null,
      foundedAt: input.foundedAt ?? null,
      address: input.address ?? null,
      boothNo: input.boothNo ?? null,
      sourceUrl: input.sourceUrl ?? null,
      honorTags: input.honorTags ?? [],
      tags: input.tags ?? [],
      showOpenJobCount: input.showOpenJobCount ?? true,
      showCity: input.showCity ?? true,
      showEmployeeScale: input.showEmployeeScale ?? true,
      showBoothNo: input.showBoothNo ?? true,
      linkedJobs: [],
    }
    mockCompanies.unshift(created)
    return created
  },
  async updateCompany(id, input) {
    const c = mustFind(id)
    const entries = Object.entries(input).filter(([, v]) => v !== undefined)
    Object.assign(c, Object.fromEntries(entries), { updatedAt: now() })
    return c
  },
  async reviewCompany(id, action, rejectReason) {
    const c = mustFind(id)
    if (action === 'reject' && !rejectReason?.trim()) {
      throw new ApiHttpError('COMPANY_REJECT_REASON_REQUIRED', '拒绝必须填写原因', 400)
    }
    if (action === 'approve') {
      c.reviewStatus = 'approved'
      c.rejectReason = null
    } else {
      c.reviewStatus = 'rejected'
      c.rejectReason = rejectReason!.trim()
      c.publishStatus = 'draft'
    }
    c.updatedAt = now()
  },
  async publishCompany(id, publish) {
    const c = mustFind(id)
    if (publish && c.reviewStatus !== 'approved') {
      throw new ApiHttpError('COMPANY_NOT_APPROVED', '企业未审核通过，不能发布', 400)
    }
    c.publishStatus = publish ? 'published' : 'unpublished'
    c.updatedAt = now()
  },
  async listLinkableJobs(id) {
    mustFind(id)
    // mock 模式无岗位数据源，返回空列表（真实可关联岗位接 http 后端后出现）
    return []
  },
  async linkJobs(id, jobIds) {
    mustFind(id)
    return { linked: 0, rejected: jobIds }
  },
  async unlinkJob(id, jobId) {
    const c = mustFind(id)
    const idx = c.linkedJobs.findIndex((j) => j.id === jobId)
    if (idx < 0) throw new ApiHttpError('COMPANY_JOB_NOT_LINKED', '该岗位未关联本企业', 404)
    c.linkedJobs.splice(idx, 1)
  },
}

// ─── Facade ───────────────────────────────────────────────────────────────────

export const companiesAdminService: CompaniesAdminServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
