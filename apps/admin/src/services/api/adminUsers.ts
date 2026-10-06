import type {
  AdminUserClosureRequest,
  AdminUserClosureResult,
  AdminUserDetailResult,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserStatusChangeResult,
} from '@ai-job-print/shared'
export type { AdminUserActivityItem, AdminUserListItem } from '@ai-job-print/shared'
import { authHeader, redirectToLogin } from '../auth'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'

export interface ClosureBlockingOrder { orderNo: string; status: string }

export class AdminUserClosureError extends ApiHttpError {
  constructor(code: string, status: number, public readonly orders: ClosureBlockingOrder[] = []) {
    super(code, '注销未完成，请稍后重试', status)
  }
}

interface ErrorBody {
  code?: string
  message?: string
  error?: { code?: string; message?: string; orders?: unknown }
}

async function parse<T>(response: Response, closure = false): Promise<T> {
  if (!response.ok) {
    let code = `HTTP_${response.status}`
    let orders: ClosureBlockingOrder[] = []
    let message = response.statusText || '请求失败'
    try {
      const body = (await response.json()) as ErrorBody
      code = body.error?.code ?? body.code ?? code
      message = body.error?.message ?? body.message ?? message
      if (closure && Array.isArray(body.error?.orders)) {
        orders = body.error.orders.flatMap((row: unknown) => {
          if (!row || typeof row !== 'object') return []
          const item = row as Record<string, unknown>
          return typeof item.orderNo === 'string' && typeof item.status === 'string'
            ? [{ orderNo: item.orderNo, status: item.status }] : []
        })
      }
    } catch {
      // 响应不是 JSON 时保留 HTTP 状态信息。
    }
    if (response.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', response.status)
    }
    if (closure) throw new AdminUserClosureError(code, response.status, orders)
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

/** 写通道仅供停用、恢复与管理员注销，均由服务端执行并写审计。 */
async function post<T>(path: string, body: unknown, closure = false): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeader() },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  return parse<T>(response, closure)
}

function demoModeUnavailable(action: string): Promise<never> {
  return Promise.reject(new ApiHttpError('DEMO_MODE_READONLY', `当前为演示模式，${action}需要连接真实后端`, 501))
}

export function list(query: AdminUserListQuery): Promise<AdminUserListResult> {
  if (API_MODE !== 'http') {
    return Promise.resolve({ items: [], total: 0, page: query.page, pageSize: query.pageSize })
  }
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
  if (query.keyword) params.set('keyword', query.keyword)
  if (query.phone) params.set('phone', query.phone)
  if (query.closure) params.set('closure', query.closure)
  if (query.enabled !== undefined) params.set('enabled', String(query.enabled))
  if (query.registeredFrom) params.set('registeredFrom', query.registeredFrom)
  if (query.registeredTo) params.set('registeredTo', query.registeredTo)
  return get<AdminUserListResult>('/admin/users', params)
}

export function getDetail(endUserId: string): Promise<AdminUserDetailResult> {
  if (API_MODE !== 'http') return demoModeUnavailable('查看用户详情')
  return get<AdminUserDetailResult>(`/admin/users/${encodeURIComponent(endUserId)}`)
}

/** 停用终端用户。reason 必填，服务端会连同操作人一起写入审计。 */
export function disable(endUserId: string, reason: string): Promise<AdminUserStatusChangeResult> {
  if (API_MODE !== 'http') return demoModeUnavailable('停用用户')
  return post<AdminUserStatusChangeResult>(`/admin/users/${encodeURIComponent(endUserId)}/disable`, { reason })
}

/** 恢复被停用的终端用户。已注销 / 注销中的账号会被服务端以 409 拒绝。 */
export function restore(endUserId: string, reason: string): Promise<AdminUserStatusChangeResult> {
  if (API_MODE !== 'http') return demoModeUnavailable('恢复用户')
  return post<AdminUserStatusChangeResult>(`/admin/users/${encodeURIComponent(endUserId)}/restore`, { reason })
}

/** 注销不可逆；演示模式明确拒绝，不伪造执行结果。 */
export function closeUserAccount(endUserId: string, input: AdminUserClosureRequest): Promise<AdminUserClosureResult> {
  if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('DEMO_MODE_READONLY', '演示模式不执行账号注销', 501))
  return post<AdminUserClosureResult>(`/admin/users/${encodeURIComponent(endUserId)}/closure`, input, true)
}
