// ============================================================
// Admin 招聘会管理 Service(阶段1A)
//
// API_MODE=http → 真实后端 /admin/fairs/*(内容运营:基本信息/企业/展区/资料/统计)
// API_MODE=mock → 内存 mock(无后端也能走通 UI,数据明示为演示数据)
//
// 分工:整场招聘会的 审核(approve/reject)与 发布(publish/unpublish)
//      走 /admin/fair-sources(sources.ts),本服务不重复实现。
//
// 合规:只管理展示信息与现场服务资料,不含候选人 / 简历 / 报名任何字段。
// ============================================================

import type { FairVenueGuideDTO, SaveFairVenueGuideInput } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import type { ReviewStatus, PublishStatus } from './types'

// ─── 类型(契约 = services/api AdminFairsService 返回形状)──────────────────

export interface AdminFairView {
  id: string
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  title: string
  theme: string
  startAt: string
  endAt: string
  venue: string
  city: string
  address: string | null
  mapImageUrl: string | null
  description: string | null
  coverImageUrl: string | null
  companyCount: number
  jobCount: number
  viewCount: number
  reviewStatus: ReviewStatus | string
  publishStatus: PublishStatus | string
  reviewedBy: string | null
  reviewedAt: string | null
  rejectReason: string | null
  syncTime: string
  createdAt: string
  updatedAt: string
}

export interface AdminFairListItem extends AdminFairView {
  counts: { companies: number; zones: number; materials: number }
}

export interface FairCompanyView {
  id: string
  jobFairId: string
  name: string
  logoUrl: string | null
  industry: string | null
  scale: string | null
  description: string | null
  sourceUrl: string | null
  hiringTags: string[]
  jobsCount: number
  createdAt: string
  updatedAt: string
}

export interface FairZoneView {
  id: string
  jobFairId: string
  name: string
  category: string | null
  city: string | null
  description: string | null
  coverImageUrl: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface FairMaterialView {
  id: string
  fairId: string
  name: string
  type: string
  description?: string
  pageCount: number
  fileSizeKB: number
  printCount: number
  previewUrl?: string
  allowPrint: boolean
  publishStatus: string
  updatedAt?: string
}

export interface AdminFairDetail {
  fair: AdminFairView
  companies: FairCompanyView[]
  zones: FairZoneView[]
  materials: FairMaterialView[]
}

export interface AdminFairStats {
  fairId: string
  companyTotal: number
  zoneTotal: number
  materialTotal: number
  materialPublished: number
  materialPrintCount: number
  snapshot: { companyCount: number; jobCount: number; viewCount: number }
}

export interface UpdateFairInfoInput {
  title?: string
  theme?: string
  startAt?: string
  endAt?: string
  venue?: string
  city?: string
  address?: string
  description?: string
  mapImageUrl?: string
  coverImageUrl?: string
}

export interface SaveFairCompanyInput {
  name: string
  industry?: string
  scale?: string
  description?: string
  sourceUrl?: string
  logoUrl?: string
  hiringTags?: string
  jobsCount?: number
}

export interface SaveFairZoneInput {
  name: string
  category?: string
  city?: string
  description?: string
  coverImageUrl?: string
  sortOrder?: number
}

export type { FairVenueGuideDTO, SaveFairVenueGuideInput }

export interface UpdateFairMaterialInput {
  name?: string
  type?: string
  description?: string
  pageCount?: number
  allowPrint?: boolean
}

export interface FairsAdminServiceInterface {
  listFairs(): Promise<AdminFairListItem[]>
  getFairDetail(fairId: string): Promise<AdminFairDetail>
  updateFairInfo(fairId: string, input: UpdateFairInfoInput): Promise<AdminFairView>
  getStats(fairId: string): Promise<AdminFairStats>

  createCompany(fairId: string, input: SaveFairCompanyInput): Promise<FairCompanyView>
  updateCompany(fairId: string, companyId: string, input: SaveFairCompanyInput): Promise<FairCompanyView>
  deleteCompany(fairId: string, companyId: string): Promise<void>

  createZone(fairId: string, input: SaveFairZoneInput): Promise<FairZoneView>
  updateZone(fairId: string, zoneId: string, input: SaveFairZoneInput): Promise<FairZoneView>
  deleteZone(fairId: string, zoneId: string): Promise<void>

  // ── 场馆导览(Admin 配置;Kiosk 只读走公开端点) ──
  getVenueGuide(fairId: string): Promise<{ data: FairVenueGuideDTO | null }>
  saveVenueGuide(fairId: string, input: SaveFairVenueGuideInput): Promise<FairVenueGuideDTO>
  deleteVenueGuide(fairId: string): Promise<void>

  uploadMaterial(fairId: string, file: File, meta: { name: string; type?: string; description?: string; pageCount?: number }): Promise<FairMaterialView>
  updateMaterial(fairId: string, materialId: string, input: UpdateFairMaterialInput): Promise<FairMaterialView>
  publishMaterial(fairId: string, materialId: string, action: 'publish' | 'unpublish'): Promise<FairMaterialView>
  deleteMaterial(fairId: string, materialId: string): Promise<void>
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
    const body = (await res.json()) as { error?: { code?: string; message?: string }; message?: string | string[] }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
    else if (typeof body.message === 'string') message = body.message
    else if (Array.isArray(body.message) && body.message.length > 0) message = body.message.join('；')
  } catch {
    /* keep defaults */
  }
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
  return res.json() as Promise<T>
}

const httpAdapter: FairsAdminServiceInterface = {
  listFairs: () => req<AdminFairListItem[]>('GET', '/admin/fairs'),
  getFairDetail: (fairId) => req<AdminFairDetail>('GET', `/admin/fairs/${fairId}`),
  updateFairInfo: (fairId, input) => req<AdminFairView>('PATCH', `/admin/fairs/${fairId}`, input),
  getStats: (fairId) => req<AdminFairStats>('GET', `/admin/fairs/${fairId}/stats`),

  createCompany: (fairId, input) => req<FairCompanyView>('POST', `/admin/fairs/${fairId}/companies`, input),
  updateCompany: (fairId, companyId, input) => req<FairCompanyView>('PATCH', `/admin/fairs/${fairId}/companies/${companyId}`, input),
  deleteCompany: async (fairId, companyId) => {
    await req<{ success: boolean }>('DELETE', `/admin/fairs/${fairId}/companies/${companyId}`)
  },

  createZone: (fairId, input) => req<FairZoneView>('POST', `/admin/fairs/${fairId}/zones`, input),
  updateZone: (fairId, zoneId, input) => req<FairZoneView>('PATCH', `/admin/fairs/${fairId}/zones/${zoneId}`, input),
  deleteZone: async (fairId, zoneId) => {
    await req<{ success: boolean }>('DELETE', `/admin/fairs/${fairId}/zones/${zoneId}`)
  },

  getVenueGuide: (fairId) => req<{ data: FairVenueGuideDTO | null }>('GET', `/admin/fairs/${fairId}/venue-guide`),
  saveVenueGuide: (fairId, input) => req<FairVenueGuideDTO>('PUT', `/admin/fairs/${fairId}/venue-guide`, input),
  deleteVenueGuide: async (fairId) => {
    await req<{ success: boolean }>('DELETE', `/admin/fairs/${fairId}/venue-guide`)
  },

  async uploadMaterial(fairId, file, meta) {
    const form = new FormData()
    form.append('file', file)
    form.append('name', meta.name)
    if (meta.type) form.append('type', meta.type)
    if (meta.description) form.append('description', meta.description)
    if (meta.pageCount !== undefined) form.append('pageCount', String(meta.pageCount))
    // multipart:不手动设 Content-Type,浏览器自动带 boundary
    const res = await fetch(`${API_BASE_URL}/admin/fairs/${fairId}/materials`, {
      method: 'POST',
      headers: { ...authHeader() },
      credentials: 'include',
      body: form,
    })
    if (!res.ok) await parseError(res)
    return res.json() as Promise<FairMaterialView>
  },
  updateMaterial: (fairId, materialId, input) => req<FairMaterialView>('PATCH', `/admin/fairs/${fairId}/materials/${materialId}`, input),
  publishMaterial: (fairId, materialId, action) =>
    req<FairMaterialView>('PATCH', `/admin/fairs/${fairId}/materials/${materialId}/publish`, { action }),
  deleteMaterial: async (fairId, materialId) => {
    await req<{ success: boolean }>('DELETE', `/admin/fairs/${fairId}/materials/${materialId}`)
  },
}

// ─── Mock adapter(内存可变,演示用)─────────────────────────────────────────

const now = () => new Date().toISOString()
let mockSeq = 100
const nextId = (prefix: string) => `${prefix}-mock-${++mockSeq}`

function makeMockFair(partial: Partial<AdminFairView> & Pick<AdminFairView, 'id' | 'title' | 'startAt' | 'endAt' | 'venue' | 'city'>): AdminFairView {
  return {
    sourceOrgId: 'org-mock-1',
    externalId: `EXT-${partial.id}`,
    sourceName: '市人才服务中心(演示)',
    sourceUrl: 'https://example.org/fairs',
    theme: 'general',
    address: null,
    mapImageUrl: null,
    description: '演示数据:这是 mock 模式下的招聘会,接真实后端后展示真实来源数据。',
    coverImageUrl: null,
    companyCount: 0,
    jobCount: 0,
    viewCount: 0,
    reviewStatus: 'approved',
    publishStatus: 'published',
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    syncTime: now(),
    createdAt: now(),
    updatedAt: now(),
    ...partial,
  }
}

const mockFairs: AdminFairView[] = [
  makeMockFair({
    id: 'fair-mock-1',
    title: '2026 春季高校毕业生双选会(演示)',
    theme: 'campus',
    startAt: '2026-06-20T01:00:00.000Z',
    endAt: '2026-06-20T09:00:00.000Z',
    venue: '市人才交流中心 A 展厅',
    city: '青岛',
  }),
  makeMockFair({
    id: 'fair-mock-2',
    title: '先进制造业专场招聘会(演示)',
    theme: 'industry',
    startAt: '2026-06-12T01:00:00.000Z',
    endAt: '2026-06-12T08:00:00.000Z',
    venue: '国际会展中心 3 号馆',
    city: '青岛',
  }),
]

const mockCompanies: FairCompanyView[] = [
  {
    id: 'fc-mock-1', jobFairId: 'fair-mock-1', name: '演示智能科技有限公司', logoUrl: null,
    industry: '互联网/软件', scale: '500-2000', description: '演示数据', sourceUrl: 'https://example.com',
    hiringTags: ['校招', '实习'], jobsCount: 12, createdAt: now(), updatedAt: now(),
  },
]

const mockZones: FairZoneView[] = [
  {
    id: 'fz-mock-1', jobFairId: 'fair-mock-1', name: 'A区 数字经济', category: 'innovation',
    city: '青岛', description: '演示数据', coverImageUrl: null, sortOrder: 0, createdAt: now(), updatedAt: now(),
  },
]

const mockVenueGuides = new Map<string, FairVenueGuideDTO>()

const mockMaterials: FairMaterialView[] = [
  {
    id: 'fm-mock-1', fairId: 'fair-mock-1', name: '活动日程(演示)', type: 'schedule',
    description: '演示数据,mock 模式无真实文件', pageCount: 1, fileSizeKB: 120, printCount: 0,
    previewUrl: undefined, allowPrint: true, publishStatus: 'published', updatedAt: now(),
  },
]

const mockAdapter: FairsAdminServiceInterface = {
  async listFairs() {
    return mockFairs.map((f) => ({
      ...f,
      counts: {
        companies: mockCompanies.filter((c) => c.jobFairId === f.id).length,
        zones: mockZones.filter((z) => z.jobFairId === f.id).length,
        materials: mockMaterials.filter((m) => m.fairId === f.id).length,
      },
    }))
  },
  async getFairDetail(fairId) {
    const fair = mockFairs.find((f) => f.id === fairId)
    if (!fair) throw new ApiHttpError('FAIR_NOT_FOUND', '招聘会不存在', 404)
    return {
      fair,
      companies: mockCompanies.filter((c) => c.jobFairId === fairId),
      zones: mockZones.filter((z) => z.jobFairId === fairId),
      materials: mockMaterials.filter((m) => m.fairId === fairId),
    }
  },
  async updateFairInfo(fairId, input) {
    const fair = mockFairs.find((f) => f.id === fairId)
    if (!fair) throw new ApiHttpError('FAIR_NOT_FOUND', '招聘会不存在', 404)
    Object.assign(fair, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), { updatedAt: now() })
    return fair
  },
  async getStats(fairId) {
    const fair = mockFairs.find((f) => f.id === fairId)
    if (!fair) throw new ApiHttpError('FAIR_NOT_FOUND', '招聘会不存在', 404)
    const materials = mockMaterials.filter((m) => m.fairId === fairId)
    return {
      fairId,
      companyTotal: mockCompanies.filter((c) => c.jobFairId === fairId).length,
      zoneTotal: mockZones.filter((z) => z.jobFairId === fairId).length,
      materialTotal: materials.length,
      materialPublished: materials.filter((m) => m.publishStatus === 'published').length,
      materialPrintCount: materials.reduce((s, m) => s + m.printCount, 0),
      snapshot: { companyCount: fair.companyCount, jobCount: fair.jobCount, viewCount: fair.viewCount },
    }
  },

  async createCompany(fairId, input) {
    const created: FairCompanyView = {
      id: nextId('fc'), jobFairId: fairId, name: input.name, logoUrl: input.logoUrl ?? null,
      industry: input.industry ?? null, scale: input.scale ?? null, description: input.description ?? null,
      sourceUrl: input.sourceUrl ?? null,
      hiringTags: (input.hiringTags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      jobsCount: input.jobsCount ?? 0, createdAt: now(), updatedAt: now(),
    }
    mockCompanies.push(created)
    return created
  },
  async updateCompany(fairId, companyId, input) {
    const company = mockCompanies.find((c) => c.id === companyId && c.jobFairId === fairId)
    if (!company) throw new ApiHttpError('COMPANY_NOT_FOUND', '参展企业不存在', 404)
    Object.assign(company, {
      name: input.name,
      industry: input.industry ?? null,
      scale: input.scale ?? null,
      description: input.description ?? null,
      sourceUrl: input.sourceUrl ?? null,
      logoUrl: input.logoUrl ?? null,
      hiringTags: (input.hiringTags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      jobsCount: input.jobsCount ?? 0,
      updatedAt: now(),
    })
    return company
  },
  async deleteCompany(fairId, companyId) {
    const idx = mockCompanies.findIndex((c) => c.id === companyId && c.jobFairId === fairId)
    if (idx >= 0) mockCompanies.splice(idx, 1)
  },

  async createZone(fairId, input) {
    const created: FairZoneView = {
      id: nextId('fz'), jobFairId: fairId, name: input.name, category: input.category ?? null,
      city: input.city ?? null, description: input.description ?? null, coverImageUrl: input.coverImageUrl ?? null,
      sortOrder: input.sortOrder ?? 0, createdAt: now(), updatedAt: now(),
    }
    mockZones.push(created)
    return created
  },
  async updateZone(fairId, zoneId, input) {
    const zone = mockZones.find((z) => z.id === zoneId && z.jobFairId === fairId)
    if (!zone) throw new ApiHttpError('ZONE_NOT_FOUND', '展区不存在', 404)
    Object.assign(zone, {
      name: input.name,
      category: input.category ?? null,
      city: input.city ?? null,
      description: input.description ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      sortOrder: input.sortOrder ?? 0,
      updatedAt: now(),
    })
    return zone
  },
  async deleteZone(fairId, zoneId) {
    const idx = mockZones.findIndex((z) => z.id === zoneId && z.jobFairId === fairId)
    if (idx >= 0) mockZones.splice(idx, 1)
  },

  async getVenueGuide(fairId) {
    return { data: mockVenueGuides.get(fairId) ?? null }
  },
  async saveVenueGuide(fairId, input) {
    const dto: FairVenueGuideDTO = {
      fairId,
      venueName: input.venueName,
      halls: input.halls.map((h, i) => ({
        hallId: `vh-mock-${i}`,
        hallCode: h.hallCode.toUpperCase(),
        hallName: h.hallName,
        industryCategory: h.industryCategory,
        description: h.description,
        boothRange: h.boothRange,
        companyCount: h.companies.length,
        companies: h.companies.map((c) => {
          const found = mockCompanies.find((mc) => mc.id === c.fairCompanyId)
          return {
            companyId: c.fairCompanyId,
            companyName: found?.name ?? '演示企业',
            boothNo: c.boothNo,
            industry: found?.industry ?? undefined,
            jobCount: found?.jobsCount ?? 0,
            jobTitles: [],
          }
        }),
      })),
      facilities: input.facilities.map((f, i) => ({ id: `vf-mock-${i}`, type: f.type, name: f.name, locationLabel: f.locationLabel, relatedHallCode: f.relatedHallCode })),
    }
    mockVenueGuides.set(fairId, dto)
    return dto
  },
  async deleteVenueGuide(fairId) {
    mockVenueGuides.delete(fairId)
  },

  async uploadMaterial(fairId, file, meta) {
    const created: FairMaterialView = {
      id: nextId('fm'), fairId, name: meta.name, type: meta.type ?? 'other',
      description: meta.description, pageCount: meta.pageCount ?? 0,
      fileSizeKB: Math.max(1, Math.round(file.size / 1024)), printCount: 0,
      previewUrl: undefined, allowPrint: true, publishStatus: 'draft', updatedAt: now(),
    }
    mockMaterials.push(created)
    return created
  },
  async updateMaterial(fairId, materialId, input) {
    const material = mockMaterials.find((m) => m.id === materialId && m.fairId === fairId)
    if (!material) throw new ApiHttpError('MATERIAL_NOT_FOUND', '资料不存在', 404)
    Object.assign(material, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), { updatedAt: now() })
    return material
  },
  async publishMaterial(fairId, materialId, action) {
    const material = mockMaterials.find((m) => m.id === materialId && m.fairId === fairId)
    if (!material) throw new ApiHttpError('MATERIAL_NOT_FOUND', '资料不存在', 404)
    material.publishStatus = action === 'publish' ? 'published' : 'unpublished'
    material.updatedAt = now()
    return material
  },
  async deleteMaterial(fairId, materialId) {
    const idx = mockMaterials.findIndex((m) => m.id === materialId && m.fairId === fairId)
    if (idx >= 0) mockMaterials.splice(idx, 1)
  },
}

// ─── Facade ───────────────────────────────────────────────────────────────────

const adapter: FairsAdminServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter

export const fairsAdminService = adapter
