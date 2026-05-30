import { API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import type {
  PartnerDataSource,
  PartnerJobRecord,
  PartnerFairRecord,
  PartnerSyncLog,
  ImportJobItem,
  ImportFairItem,
  ImportResult,
} from './types'

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeader() },
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
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
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
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
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
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const partnerHttpAdapter = {
  // Data Sources
  getDataSources: () =>
    get<PartnerDataSource[]>('/partner/data-sources'),
  toggleDataSource: (id: string) =>
    patch<PartnerDataSource>(`/partner/data-sources/${id}/toggle`, {}),
  createDataSource: (name: string) =>
    post<PartnerDataSource>('/partner/data-sources', {
      name,
      sourceKind: 'manual',
      accessMode: 'excel',
      syncFreq: 'manual',
    }),

  // Jobs
  getPartnerJobs: () =>
    get<PartnerJobRecord[]>('/partner/jobs'),
  unpublishPartnerJob: (id: string) =>
    patch<PartnerJobRecord>(`/partner/jobs/${id}/publish`, { action: 'unpublish' }),
  importPartnerJobs: (
    items: ImportJobItem[],
    sourceOrgId: string,
    sourceName: string,
  ) =>
    post<ImportResult<PartnerJobRecord>>('/partner/jobs/import', { sourceOrgId, sourceName, items }),

  // Fairs
  getPartnerFairs: () =>
    get<PartnerFairRecord[]>('/partner/fairs'),
  unpublishPartnerFair: (id: string) =>
    patch<PartnerFairRecord>(`/partner/fairs/${id}/publish`, { action: 'unpublish' }),
  importPartnerFairs: (
    items: ImportFairItem[],
    sourceOrgId: string,
    sourceName: string,
  ) =>
    post<ImportResult<PartnerFairRecord>>('/partner/fairs/import', { sourceOrgId, sourceName, items }),

  // Sync Logs (read-only)
  getSyncLogs: () =>
    get<PartnerSyncLog[]>('/partner/sync-logs'),
}
