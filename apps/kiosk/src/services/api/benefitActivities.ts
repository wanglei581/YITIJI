import type { BenefitActivityListItem, BenefitActivitySourceType, MemberBenefitItem } from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
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
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      /* keep defaults */
    }
    if (isMemberSessionInvalidError(res.status, code, Boolean(token))) notifyMemberSessionExpired(token ?? undefined)
    throw new BenefitActivitiesApiError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

export async function listBenefitActivities(
  token?: string | null,
  source?: BenefitActivitySourceType,
): Promise<{ items: BenefitActivityListItem[]; total: number }> {
  if (API_MODE !== 'http') return Promise.resolve({ items: [], total: 0 })
  const params = new URLSearchParams()
  if (source) params.set('source', source)
  const q = params.toString()
  // 这里的返回类型此前是在说谎：`request` 拿到什么就返回什么，而调用方直接把
  // `res.total` 渲染进「共 N 个活动」。服务端漏 total（或返回裸数组）时，
  // 求职者会在一体机上看到「共 undefined 个活动」——全路由扫描抓到的就是这条。
  // 在这一层收敛成真实形状：total 缺失时退回条目数，条目非数组时按空列表处理。
  const raw = (await request(`/activities${q ? `?${q}` : ''}`, token)) as unknown
  const body = (raw ?? {}) as { items?: unknown; total?: unknown }
  const items = Array.isArray(body.items) ? (body.items as BenefitActivityListItem[]) : []
  const total = typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : items.length
  return { items, total }
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
