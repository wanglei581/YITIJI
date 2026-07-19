import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DataRequestStatus =
  | 'pending'
  | 'handling'
  | 'ready'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'rejected'
  | 'cancelled'

export type DataRequestType = 'export' | 'delete' | 'revoke_consent'

export interface AdminDataRequestItem {
  id: string
  requestType: DataRequestType
  status: DataRequestStatus
  requestedAt: string
  handledAt: string | null
  executionStep: string | null
  exportExpiresAt: string | null
  failureCode: string | null
  canRetry: boolean
  canDownload: boolean
  endUserId: string
  phoneMasked: string
  nickname: string | null
  retryCount: number
  lastAttemptAt: string | null
  handledBy: string | null
  auditRef: string | null
}

export interface AdminDataRequestPage {
  items: AdminDataRequestItem[]
  nextCursor: string | null
}

export interface ListAdminDataRequestsParams {
  status?: DataRequestStatus | ''
  requestType?: DataRequestType | ''
  cursor?: string
  limit?: number
}

// ─── Service interface ─────────────────────────────────────────────────────────

interface AdminPrivacyRequestsService {
  list(params?: ListAdminDataRequestsParams): Promise<AdminDataRequestPage>
  retry(id: string): Promise<AdminDataRequestItem>
  reject(id: string, reason: string): Promise<AdminDataRequestItem>
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

async function apiGet<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const query = params
    ? new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
      ).toString()
    : ''
  const res = await fetch(`${API_BASE_URL}${path}${query ? `?${query}` : ''}`, {
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
  })
  return handleResponse<T>(res)
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeader() },
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return handleResponse<T>(res)
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch {
      /* keep defaults */
    }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  const envelope = (await res.json()) as { data: T }
  return envelope.data
}

// ─── HTTP adapter ──────────────────────────────────────────────────────────────

const httpAdapter: AdminPrivacyRequestsService = {
  list: (params = {}) =>
    apiGet<AdminDataRequestPage>('/admin/member-privacy/data-requests', {
      status: params.status || undefined,
      requestType: params.requestType || undefined,
      cursor: params.cursor,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    }),
  retry: (id) =>
    apiPost<AdminDataRequestItem>(`/admin/member-privacy/data-requests/${encodeURIComponent(id)}/retry`),
  reject: (id, reason) =>
    apiPost<AdminDataRequestItem>(`/admin/member-privacy/data-requests/${encodeURIComponent(id)}/reject`, { reason }),
}

// ─── Mock adapter ──────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()

const MOCK_ITEMS: AdminDataRequestItem[] = [
  {
    id: 'req_mock_1',
    requestType: 'export',
    status: 'pending',
    requestedAt: now(),
    handledAt: null,
    executionStep: null,
    exportExpiresAt: null,
    failureCode: null,
    canRetry: false,
    canDownload: false,
    endUserId: 'user_mock_1',
    phoneMasked: '138****0001',
    nickname: '演示用户甲',
    retryCount: 0,
    lastAttemptAt: null,
    handledBy: null,
    auditRef: null,
  },
  {
    id: 'req_mock_2',
    requestType: 'export',
    status: 'failed',
    requestedAt: now(),
    handledAt: null,
    executionStep: null,
    exportExpiresAt: null,
    failureCode: 'QUEUE_ENQUEUE_FAILED',
    canRetry: true,
    canDownload: false,
    endUserId: 'user_mock_2',
    phoneMasked: '139****0002',
    nickname: null,
    retryCount: 1,
    lastAttemptAt: now(),
    handledBy: null,
    auditRef: null,
  },
  {
    id: 'req_mock_3',
    requestType: 'revoke_consent',
    status: 'completed',
    requestedAt: now(),
    handledAt: now(),
    executionStep: null,
    exportExpiresAt: null,
    failureCode: null,
    canRetry: false,
    canDownload: false,
    endUserId: 'user_mock_3',
    phoneMasked: '137****0003',
    nickname: '演示用户丙',
    retryCount: 0,
    lastAttemptAt: null,
    handledBy: 'system',
    auditRef: 'audit_mock_3',
  },
]

const mockAdapter: AdminPrivacyRequestsService = {
  async list(params = {}) {
    const items = MOCK_ITEMS.filter((item) => {
      if (params.status && item.status !== params.status) return false
      if (params.requestType && item.requestType !== params.requestType) return false
      return true
    })
    return { items, nextCursor: null }
  },
  async retry(id) {
    const item = MOCK_ITEMS.find((i) => i.id === id)
    if (!item) throw new Error('not found')
    return { ...item, status: 'pending', retryCount: item.retryCount + 1, failureCode: null }
  },
  async reject(id) {
    const item = MOCK_ITEMS.find((i) => i.id === id)
    if (!item) throw new Error('not found')
    return { ...item, status: 'rejected', handledAt: now(), activeKey: null }
  },
}

export const adminPrivacyRequestsService: AdminPrivacyRequestsService =
  API_MODE === 'http' ? httpAdapter : mockAdapter
