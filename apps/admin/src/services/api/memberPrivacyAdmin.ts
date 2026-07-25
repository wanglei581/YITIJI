import {
  ADMIN_DATA_REQUEST_DELETE_COMPLETE_CONFIRM,
  ADMIN_DATA_REQUEST_EXPORT_COMPLETE_HINT,
  ADMIN_DATA_REQUEST_REJECT_HINT,
  MEMBER_DATA_REQUEST_SCOPE,
  MEMBER_DATA_REQUEST_STATUS_LABEL,
  MEMBER_DATA_REQUEST_TYPE_LABEL,
  type AdminMemberDataRequestItem,
  type MemberDataRequestStatus,
} from '@ai-job-print/shared'
import { API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

interface Envelope<T> {
  data: T
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
}

interface AdminListPage {
  items: AdminMemberDataRequestItem[]
  nextCursor: string | null
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
    } catch {
      /* keep defaults */
    }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

export const memberPrivacyAdminApi = {
  list(status?: MemberDataRequestStatus | 'all'): Promise<AdminMemberDataRequestItem[]> {
    const query =
      status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''
    return request<AdminListPage>(`/admin/member-privacy/data-requests${query}`).then((page) => page.items)
  },

  retry(id: string): Promise<AdminMemberDataRequestItem> {
    return request(`/admin/member-privacy/data-requests/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: {},
    })
  },

  reject(id: string, reason: string): Promise<AdminMemberDataRequestItem> {
    return request(`/admin/member-privacy/data-requests/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: { reason },
    })
  },
}

export const MEMBER_PRIVACY_ADMIN_COPY = {
  scope: MEMBER_DATA_REQUEST_SCOPE,
  rejectHint: ADMIN_DATA_REQUEST_REJECT_HINT,
  deleteConfirm: ADMIN_DATA_REQUEST_DELETE_COMPLETE_CONFIRM,
  exportHint: ADMIN_DATA_REQUEST_EXPORT_COMPLETE_HINT,
  typeLabel: MEMBER_DATA_REQUEST_TYPE_LABEL,
  statusLabel: MEMBER_DATA_REQUEST_STATUS_LABEL,
}
