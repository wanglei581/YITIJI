// ============================================================
// Partner 企业资料管理 Service（feature/company-profiles）
//
// API_MODE=http → 真实后端 /partner/companies*（响应为 {success,data} 信封，需解包）
// API_MODE=mock → 内存 mock（初始为空列表，不写死企业数据）
//
// 数据流：本页导入/编辑（一律回 pending+draft 强制重审）→ Admin 审核/发布 → Kiosk 展示。
// 合规定位：本页是来源机构维护「企业展示资料」的后台，不是企业 HR 后台；
// 不涉及任何求职者数据，岗位关联仅按本机构岗位外部 ID 做展示性关联。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import type { CompanyType, CompanyIndustry } from '@ai-job-print/shared'
import type { ReviewStatus, PublishStatus } from './types'

/** GET /partner/companies 行（后端 adminRow 投影）。 */
export interface PartnerCompanyRecord {
  id: string
  name: string
  sourceOrgId: string
  sourceName: string
  externalId: string
  province: string | null
  city: string | null
  district: string | null
  industry: CompanyIndustry | null
  companyType: CompanyType | null
  fairParticipant: boolean
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  rejectReason: string | null
  linkedJobCount: number
  syncTime: string
  updatedAt: string
}

/** 企业展示字段（与后端 CompanyFieldsDto 白名单一致；超出白名单后端直接 400）。 */
export interface CompanyFieldsInput {
  name?: string
  legalName?: string
  logoUrl?: string
  coverImageUrl?: string
  promoVideoUrl?: string
  description?: string
  industry?: CompanyIndustry
  companyType?: CompanyType
  scale?: string
  foundedAt?: string
  province?: string
  city?: string
  district?: string
  address?: string
  boothNo?: string
  honorTags?: string[]
  tags?: string[]
  fairParticipant?: boolean
  sourceUrl?: string
}

/** POST /partner/companies/import 单条（导入即 upsert，回 pending+draft）。 */
export interface ImportCompanyItem extends CompanyFieldsInput {
  externalId: string
  name: string
  /** 按本机构岗位外部 ID 关联（跨机构 ID 查不到，后端天然隔离） */
  jobExternalIds?: string[]
}

/** PATCH /partner/companies/:id（编辑后强制回 pending+draft 重审）。 */
export interface UpdatePartnerCompanyInput extends CompanyFieldsInput {
  jobExternalIds?: string[]
}

export interface CompanyImportResult {
  total: number
  created: number
  updated: number
}

export interface PartnerCompaniesServiceInterface {
  getPartnerCompanies(): Promise<PartnerCompanyRecord[]>
  importPartnerCompanies(items: ImportCompanyItem[]): Promise<CompanyImportResult>
  updatePartnerCompany(id: string, input: UpdatePartnerCompanyInput): Promise<PartnerCompanyRecord | undefined>
}

// ─── HTTP adapter（/partner/companies* 返回 {success,data} 信封）────────────────

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string; details?: string[] } }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
      if (Array.isArray(data.error?.details) && data.error.details.length > 0) {
        message = `${message}：${data.error.details.join('；')}`
      }
    } catch { /* keep defaults */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  const envelope = (await res.json()) as { success: boolean; data: T }
  return envelope.data
}

const httpAdapter: PartnerCompaniesServiceInterface = {
  getPartnerCompanies: () => req<PartnerCompanyRecord[]>('GET', '/partner/companies'),
  importPartnerCompanies: (items) =>
    req<CompanyImportResult>('POST', '/partner/companies/import', { items }),
  updatePartnerCompany: (id, input) =>
    req<PartnerCompanyRecord | undefined>('PATCH', `/partner/companies/${id}`, input),
}

// ─── Mock adapter（初始空列表；导入/编辑镜像后端 pending+draft 语义）────────────

const now = () => new Date().toISOString()
let mockSeq = 0
const mockRows: PartnerCompanyRecord[] = []

function applyFields(row: PartnerCompanyRecord, input: CompanyFieldsInput) {
  if (input.name !== undefined) row.name = input.name
  if (input.province !== undefined) row.province = input.province
  if (input.city !== undefined) row.city = input.city
  if (input.district !== undefined) row.district = input.district
  if (input.industry !== undefined) row.industry = input.industry
  if (input.companyType !== undefined) row.companyType = input.companyType
  if (input.fairParticipant !== undefined) row.fairParticipant = input.fairParticipant
}

const mockAdapter: PartnerCompaniesServiceInterface = {
  async getPartnerCompanies() {
    return [...mockRows]
  },
  async importPartnerCompanies(items) {
    let created = 0
    let updated = 0
    for (const item of items) {
      const hit = mockRows.find((r) => r.externalId === item.externalId)
      if (hit) {
        applyFields(hit, item)
        hit.reviewStatus = 'pending'
        hit.publishStatus = 'draft'
        hit.rejectReason = null
        hit.syncTime = now()
        hit.updatedAt = now()
        updated += 1
      } else {
        const row: PartnerCompanyRecord = {
          id: `pc-mock-${++mockSeq}`,
          name: item.name,
          sourceOrgId: 'mock-org',
          sourceName: '测试机构',
          externalId: item.externalId,
          province: item.province ?? null,
          city: item.city ?? null,
          district: item.district ?? null,
          industry: item.industry ?? null,
          companyType: item.companyType ?? null,
          fairParticipant: item.fairParticipant ?? false,
          reviewStatus: 'pending',
          publishStatus: 'draft',
          rejectReason: null,
          linkedJobCount: 0,
          syncTime: now(),
          updatedAt: now(),
        }
        mockRows.unshift(row)
        created += 1
      }
    }
    return { total: items.length, created, updated }
  },
  async updatePartnerCompany(id, input) {
    const hit = mockRows.find((r) => r.id === id)
    if (!hit) throw new ApiHttpError('COMPANY_NOT_FOUND', '企业不存在', 404)
    applyFields(hit, input)
    hit.reviewStatus = 'pending'
    hit.publishStatus = 'draft'
    hit.rejectReason = null
    hit.updatedAt = now()
    return { ...hit }
  },
}

export const partnerCompaniesService: PartnerCompaniesServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
