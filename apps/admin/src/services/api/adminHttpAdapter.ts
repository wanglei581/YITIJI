import { API_BASE_URL, ApiHttpError } from './client'
import type { AdminJobSourceRecord, AdminFairSourceRecord } from './types'
import type { ReviewAction, PublishAction } from './review-types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const body = await res.json() as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch { /* keep defaults */ }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const errBody = await res.json() as { error?: { code?: string; message?: string } }
      if (errBody.error?.code) code = errBody.error.code
      if (errBody.error?.message) message = errBody.error.message
    } catch { /* keep defaults */ }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

export const adminHttpAdapter = {
  getJobSources: () =>
    get<AdminJobSourceRecord[]>('/admin/job-sources'),

  reviewJobSource: (id: string, action: ReviewAction, reason?: string) =>
    patch<AdminJobSourceRecord>(`/admin/job-sources/${id}/review`, { action, reason }),

  publishJobSourceRecord: (id: string, action: PublishAction) =>
    patch<AdminJobSourceRecord>(`/admin/job-sources/${id}/publish`, { action }),

  getFairSources: () =>
    get<AdminFairSourceRecord[]>('/admin/fair-sources'),

  reviewFairSource: (id: string, action: ReviewAction, reason?: string) =>
    patch<AdminFairSourceRecord>(`/admin/fair-sources/${id}/review`, { action, reason }),

  publishFairSourceRecord: (id: string, action: PublishAction) =>
    patch<AdminFairSourceRecord>(`/admin/fair-sources/${id}/publish`, { action }),
}
