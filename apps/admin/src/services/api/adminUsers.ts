import type {
  AdminUserDetailResult,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserStatusChangeResult,
} from '@ai-job-print/shared'
export type { AdminUserActivityItem, AdminUserListItem } from '@ai-job-print/shared'
import { authHeader, redirectToLogin } from '../auth'
import { API_BASE_URL, ApiHttpError } from './client'

interface ErrorBody {
  code?: string
  message?: string
  error?: { code?: string; message?: string }
}

async function parse<T>(response: Response): Promise<T> {
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

async function get<T>(path: string, query?: URLSearchParams): Promise<T> {
  const queryString = query?.toString()
  const response = await fetch(`${API_BASE_URL}${path}${queryString ? `?${queryString}` : ''}`, {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
  })
  return parse<T>(response)
}

/**
 * 本适配器唯一的写方法通道。
 *
 * 只服务于 disable / restore 两条账号状态路径 —— 用户管理面的其余能力保持只读。
 * verify-admin-users-ui.mjs 会断言这一点：新增第三条写路径会让门禁转红，
 * 那是设计意图，不是需要绕开的障碍。
 */
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeader() },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  return parse<T>(response)
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

/** 停用终端用户。reason 必填，服务端会连同操作人一起写入审计。 */
export function disable(endUserId: string, reason: string): Promise<AdminUserStatusChangeResult> {
  return post<AdminUserStatusChangeResult>(`/admin/users/${encodeURIComponent(endUserId)}/disable`, { reason })
}

/** 恢复被停用的终端用户。已注销 / 注销中的账号会被服务端以 409 拒绝。 */
export function restore(endUserId: string, reason: string): Promise<AdminUserStatusChangeResult> {
  return post<AdminUserStatusChangeResult>(`/admin/users/${encodeURIComponent(endUserId)}/restore`, { reason })
}
