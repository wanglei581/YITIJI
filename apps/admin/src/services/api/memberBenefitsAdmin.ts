import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type AdminBenefitType = 'coupon' | 'free_quota' | 'package_entitlement' | 'subsidy_eligibility_hint'
export type AdminBenefitSourceType = 'platform' | 'campus' | 'gov' | 'fair' | 'partner'
export type AdminBenefitStatus = 'active' | 'used_up' | 'expired' | 'revoked'

export interface AdminEndUserSearchItem {
  endUserId: string
  phoneMasked: string
  nickname: string | null
  enabled: boolean
}

export interface AdminBenefitGrantItem {
  id: string
  endUserId: string
  phoneMasked: string
  nickname: string | null
  benefitType: AdminBenefitType
  title: string
  description: string | null
  quantityTotal: number | null
  quantityRemaining: number | null
  status: AdminBenefitStatus
  sourceType: AdminBenefitSourceType
  validFrom: string | null
  validUntil: string | null
  createdAt: string
}

export interface GrantBenefitInput {
  endUserId: string
  benefitType: AdminBenefitType
  sourceType: AdminBenefitSourceType
  title: string
  description?: string | null
  quantityTotal?: number | null
  validFrom?: string | null
  validUntil?: string | null
}

interface Envelope<T> {
  data: T
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...authHeader(),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'include',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText || '请求失败'
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

const EMPTY = { items: [] }

export const memberBenefitsAdminApi = {
  searchUsers(phone: string): Promise<{ items: AdminEndUserSearchItem[] }> {
    if (API_MODE !== 'http') return Promise.resolve(EMPTY)
    return request(`/admin/member-benefits/users?phone=${encodeURIComponent(phone)}`)
  },
  list(endUserId: string): Promise<{ items: AdminBenefitGrantItem[] }> {
    if (API_MODE !== 'http' || !endUserId) return Promise.resolve(EMPTY)
    return request(`/admin/member-benefits?endUserId=${encodeURIComponent(endUserId)}`)
  },
  grant(input: GrantBenefitInput): Promise<AdminBenefitGrantItem> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持发放权益', 400))
    return request('/admin/member-benefits', { method: 'POST', body: input })
  },
  revoke(id: string, reason: string): Promise<AdminBenefitGrantItem> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持撤销权益', 400))
    return request(`/admin/member-benefits/${encodeURIComponent(id)}/revoke`, { method: 'PATCH', body: { reason } })
  },
}
