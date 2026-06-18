import type { BenefitActivityListItem, BenefitActivitySourceType, MemberBenefitItem } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'

export class BenefitActivitiesApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'BenefitActivitiesApiError'
  }
}

interface Envelope<T> {
  success: boolean
  data: T
}

async function request<T>(
  path: string,
  token?: string | null,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'include',
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    throw new BenefitActivitiesApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
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
    throw new BenefitActivitiesApiError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

export function listBenefitActivities(
  token?: string | null,
  source?: BenefitActivitySourceType,
): Promise<{ items: BenefitActivityListItem[] }> {
  if (API_MODE !== 'http') return Promise.resolve({ items: [] })
  const params = new URLSearchParams()
  if (source) params.set('source', source)
  const q = params.toString()
  return request(`/activities${q ? `?${q}` : ''}`, token)
}

export function getBenefitActivity(id: string, token?: string | null): Promise<BenefitActivityListItem> {
  if (API_MODE !== 'http') {
    return Promise.reject(new BenefitActivitiesApiError('MOCK_DISABLED', 'mock 模式暂无权益活动详情', 400))
  }
  return request(`/activities/${encodeURIComponent(id)}`, token)
}

export function claimBenefitActivity(id: string, token: string | null | undefined): Promise<MemberBenefitItem> {
  if (API_MODE !== 'http') {
    return Promise.reject(new BenefitActivitiesApiError('MOCK_DISABLED', 'mock 模式不支持领取权益活动', 400))
  }
  if (!token) {
    return Promise.reject(new BenefitActivitiesApiError('LOGIN_REQUIRED', '请先登录后领取', 401))
  }
  return request(`/activities/${encodeURIComponent(id)}/claim`, token, { method: 'POST' })
}
