import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type SystemBroadcastCategory = 'system' | 'maintenance' | 'notice'

export interface AdminBroadcastItem {
  id: string
  title: string
  content: string
  category: SystemBroadcastCategory
  deletedAt: string | null
  createdBy: string | null
  createdAt: string
}

export interface CreateBroadcastInput {
  title: string
  content: string
  category: SystemBroadcastCategory
}

interface Envelope<T> {
  data: T
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
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
      const body = (await res.json()) as ErrorEnvelope
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

const EMPTY = { items: [] as AdminBroadcastItem[] }

export const memberNotificationsAdminApi = {
  listBroadcasts(): Promise<{ items: AdminBroadcastItem[] }> {
    if (API_MODE !== 'http') return Promise.resolve(EMPTY)
    return request('/admin/notifications/broadcasts')
  },
  createBroadcast(input: CreateBroadcastInput): Promise<AdminBroadcastItem> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持创建广播', 400))
    return request('/admin/notifications/broadcasts', { method: 'POST', body: input })
  },
  deleteBroadcast(id: string): Promise<{ deleted: true }> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持撤回广播', 400))
    return request(`/admin/notifications/broadcasts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}
