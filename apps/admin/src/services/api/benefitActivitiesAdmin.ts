import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type AdminBenefitActivityStatus = 'draft' | 'published' | 'ended'
export type AdminBenefitActivityType = 'coupon' | 'free_quota' | 'package_entitlement' | 'subsidy_eligibility_hint'
export type AdminBenefitActivitySourceType = 'platform' | 'campus' | 'gov' | 'fair' | 'partner'

export interface AdminBenefitActivityItem {
  id: string
  title: string
  description: string | null
  rulesText: string | null
  benefitType: AdminBenefitActivityType
  sourceType: AdminBenefitActivitySourceType
  quantityTotal: number | null
  stockTotal: number | null
  stockRemaining: number | null
  claimLimitPerUser: number
  status: AdminBenefitActivityStatus
  validFrom: string | null
  validUntil: string | null
  grantValidDays: number | null
  claimable: boolean
  claimed: boolean
  soldOut: boolean
  ended: boolean
  createdAt: string
  updatedAt: string
}

export interface AdminBenefitActivityClaimItem {
  id: string
  activityId: string
  endUserId: string
  phoneMasked: string
  benefitGrantId: string
  grantStatus: string
  createdAt: string
}

export interface UpsertBenefitActivityInput {
  title: string
  description?: string | null
  rulesText?: string | null
  benefitType: AdminBenefitActivityType
  sourceType: AdminBenefitActivitySourceType
  quantityTotal?: number | null
  stockTotal?: number | null
  validFrom?: string | null
  validUntil?: string | null
  grantValidDays?: number | null
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
    } catch {
      /* keep defaults */
    }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

const EMPTY = { items: [] }

export const benefitActivitiesAdminApi = {
  list(params?: { status?: AdminBenefitActivityStatus; source?: AdminBenefitActivitySourceType }): Promise<{ items: AdminBenefitActivityItem[] }> {
    if (API_MODE !== 'http') return Promise.resolve(EMPTY)
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.source) q.set('source', params.source)
    const qs = q.toString()
    return request(`/admin/benefit-activities${qs ? `?${qs}` : ''}`)
  },
  create(input: UpsertBenefitActivityInput): Promise<AdminBenefitActivityItem> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持创建权益活动', 400))
    return request('/admin/benefit-activities', { method: 'POST', body: input })
  },
  update(id: string, input: UpsertBenefitActivityInput): Promise<AdminBenefitActivityItem> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持编辑权益活动', 400))
    return request(`/admin/benefit-activities/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })
  },
  publish(id: string): Promise<AdminBenefitActivityItem> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持发布权益活动', 400))
    return request(`/admin/benefit-activities/${encodeURIComponent(id)}/publish`, { method: 'PATCH' })
  },
  end(id: string): Promise<AdminBenefitActivityItem> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持下架权益活动', 400))
    return request(`/admin/benefit-activities/${encodeURIComponent(id)}/end`, { method: 'PATCH' })
  },
  claims(id: string): Promise<{ items: AdminBenefitActivityClaimItem[] }> {
    if (API_MODE !== 'http') return Promise.resolve(EMPTY)
    return request(`/admin/benefit-activities/${encodeURIComponent(id)}/claims`)
  },
}
