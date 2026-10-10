import type {
  AdminUserActivityItem,
  AdminUserClosureRequest,
  AdminUserClosureResult,
  AdminUserDetailResult,
  AdminUserListItem,
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

const DEMO_USER_ID = 'eu_demo_activity'
const DEMO_RETENTION_NOTICE = '文件、AI、浏览与外部跳转为当前留存记录，数据会按隐私留存策略清理；打印任务为系统现存记录。'

const DEMO_USER: AdminUserListItem = {
  id: DEMO_USER_ID,
  nickname: '演示用户',
  maskedPhone: '138****8000',
  enabled: true,
  status: 'active',
  lastLoginAt: '2026-10-05T08:00:00.000Z',
  createdAt: '2026-09-01T08:00:00.000Z',
}

const DEMO_ACTIVITIES: AdminUserActivityItem[] = [
  { id: 'act_file', type: 'file', occurredAt: '2026-10-05T01:00:00.000Z', status: 'active', terminalId: null, category: 'resume_upload:application/pdf', action: null },
  { id: 'act_print', type: 'print', occurredAt: '2026-10-05T02:00:00.000Z', status: 'completed', terminalId: 't_09fd272201b6588e', category: null, action: null },
  { id: 'act_confirmed', type: 'ai', occurredAt: '2026-10-05T03:00:00.000Z', status: 'completed', terminalId: null, category: 'optimize_confirmed', action: null },
  { id: 'act_intent', type: 'ai', occurredAt: '2026-10-05T04:00:00.000Z', status: 'completed', terminalId: null, category: 'parse_intent', action: null },
]

function demoUserMatches(query: AdminUserListQuery): boolean {
  if (query.phone) return false
  if (query.enabled === false) return false
  if (query.keyword && !DEMO_USER.nickname?.includes(query.keyword)) return false
  return true
}

export function list(query: AdminUserListQuery): Promise<AdminUserListResult> {
  if (API_MODE !== 'http') {
    const matched = demoUserMatches(query)
    return Promise.resolve({
      items: matched ? [DEMO_USER] : [],
      total: matched ? 1 : 0,
      page: query.page,
      pageSize: query.pageSize,
    })
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
  if (API_MODE !== 'http') {
    if (endUserId !== DEMO_USER_ID) {
      return Promise.reject(new ApiHttpError('ADMIN_USER_NOT_FOUND', '用户不存在', 404))
    }
    return Promise.resolve({
      user: { ...DEMO_USER, updatedAt: '2026-10-05T08:00:00.000Z' },
      stats: { fileCount: 1, printTaskCount: 1, aiResultCount: 2, browseCount: 0, externalJumpCount: 0 },
      recentActivities: DEMO_ACTIVITIES,
      retentionNotice: DEMO_RETENTION_NOTICE,
    })
  }
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
