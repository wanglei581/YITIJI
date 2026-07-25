import type {
  AdminUserDetailResult,
  AdminUserListQuery,
  AdminUserListResult,
} from '@ai-job-print/shared'
export type { AdminUserActivityItem, AdminUserListItem } from '@ai-job-print/shared'
import { authHeader, redirectToLogin } from '../auth'
import { API_BASE_URL, ApiHttpError } from './client'

interface ErrorBody {
  code?: string
  message?: string
  error?: { code?: string; message?: string }
}

async function get<T>(path: string, query?: URLSearchParams): Promise<T> {
  const queryString = query?.toString()
  const response = await fetch(`${API_BASE_URL}${path}${queryString ? `?${queryString}` : ''}`, {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
  })

  if (!response.ok) {
    let code = `HTTP_${response.status}`
    let message = response.statusText || '请求失败'
    try {
      const body = (await response.json()) as ErrorBody
      code = body.error?.code ?? body.code ?? code
      message = body.error?.message ?? body.message ?? message
    } catch {
      // 响应不是 JSON 时保留 HTTP 状态信息。
    }
    if (response.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', response.status)
    }
    throw new ApiHttpError(code, message, response.status)
  }

  return response.json() as Promise<T>
}

export function list(query: AdminUserListQuery): Promise<AdminUserListResult> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
  if (query.keyword) params.set('keyword', query.keyword)
  if (query.phone) params.set('phone', query.phone)
  if (query.enabled !== undefined) params.set('enabled', String(query.enabled))
  if (query.registeredFrom) params.set('registeredFrom', query.registeredFrom)
  if (query.registeredTo) params.set('registeredTo', query.registeredTo)
  return get<AdminUserListResult>('/admin/users', params)
}

export function getDetail(endUserId: string): Promise<AdminUserDetailResult> {
  return get<AdminUserDetailResult>(`/admin/users/${encodeURIComponent(endUserId)}`)
}
