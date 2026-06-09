import { API_MODE, API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ─── Types(镜像后端 services/api/src/partner-profile/partner-profile.types.ts)──
//
// 后端各端点以 ApiResponse<T>(即 { data: T })包装,http adapter 内拆 .data。
// 合规:仅机构主体资料维护,不涉招聘闭环;type / enabled 只读(管理员维护)。

export interface PartnerProfile {
  id: string
  name: string
  type: string
  creditCode: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  description: string | null
  websiteUrl: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 可编辑字段（提交体）。name/contactName/contactPhone 必填，其余可空。 */
export interface UpdatePartnerProfileInput {
  name: string
  contactName: string
  contactPhone: string
  creditCode?: string
  contactEmail?: string
  address?: string
  description?: string
  websiteUrl?: string
}

export interface PartnerProfileServiceInterface {
  /** GET /partner/profile — 读取本机构资料 */
  getProfile(): Promise<PartnerProfile>
  /** PATCH /partner/profile — 保存本机构资料(后端写审计) */
  updateProfile(input: UpdatePartnerProfileInput): Promise<PartnerProfile>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeader() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const errBody = (await res.json()) as { error?: { code?: string; message?: string } }
      if (errBody.error?.code) code = errBody.error.code
      if (errBody.error?.message) message = errBody.error.message
    } catch {
      /* keep defaults */
    }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function unwrap<T>(p: Promise<{ data: T }>): Promise<T> {
  return (await p).data
}

export const partnerProfileHttpAdapter: PartnerProfileServiceInterface = {
  getProfile() {
    return unwrap(request<{ data: PartnerProfile }>('GET', '/partner/profile'))
  },
  updateProfile(input) {
    return unwrap(request<{ data: PartnerProfile }>('PATCH', '/partner/profile', input))
  },
}

// ─── Mock adapter(无后端时本地演示,字段形状与后端一致)─────────────────────────

let mockProfile: PartnerProfile | null = null
function getStore(): PartnerProfile {
  if (!mockProfile) {
    mockProfile = {
      id: 'org-mock-1',
      name: '示例就业服务机构',
      type: 'public_employment_service',
      creditCode: '91320000MA1XXXXX00',
      contactName: '张主任',
      contactPhone: '13800000001',
      contactEmail: 'service@example.gov.cn',
      address: '示例市示例区人才大厦 1 楼',
      description: '本机构为示例数据，用于 mock 模式联调。',
      websiteUrl: 'https://example.gov.cn',
      enabled: true,
      createdAt: '2026-01-15T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z',
    }
  }
  return mockProfile
}
const delay = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms))
function norm(v: string | undefined): string | null {
  if (v === undefined || v === null) return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

export const partnerProfileMockAdapter: PartnerProfileServiceInterface = {
  async getProfile() {
    await delay()
    return { ...getStore() }
  },
  async updateProfile(input) {
    await delay()
    const cur = getStore()
    const updated: PartnerProfile = {
      ...cur,
      name: input.name.trim(),
      contactName: input.contactName.trim(),
      contactPhone: input.contactPhone.trim(),
      creditCode: norm(input.creditCode),
      contactEmail: norm(input.contactEmail),
      address: norm(input.address),
      description: norm(input.description),
      websiteUrl: norm(input.websiteUrl),
      updatedAt: '2026-06-09T12:00:00.000Z',
    }
    mockProfile = updated
    return { ...updated }
  },
}

// ─── Selector ───────────────────────────────────────────────────────────────

const adapter: PartnerProfileServiceInterface =
  API_MODE === 'http' ? partnerProfileHttpAdapter : partnerProfileMockAdapter

export const getPartnerProfile = () => adapter.getProfile()
export const updatePartnerProfile = (input: UpdatePartnerProfileInput) => adapter.updateProfile(input)
