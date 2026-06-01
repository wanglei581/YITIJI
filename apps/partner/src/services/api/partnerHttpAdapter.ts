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
  CreateDataSourcePayload,
  ExcelPreviewResult,
  ExcelConfirmResult,
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
  createDataSource: (payload: CreateDataSourcePayload) =>
    post<PartnerDataSource>('/partner/data-sources', payload),

  // Jobs
  getPartnerJobs: () =>
    get<PartnerJobRecord[]>('/partner/jobs'),
  unpublishPartnerJob: (id: string) =>
    patch<PartnerJobRecord>(`/partner/jobs/${id}/publish`, { action: 'unpublish' }),
  // sourceOrgId / sourceName 由后端从 JWT 推断，前端只传 items
  importPartnerJobs: (items: ImportJobItem[]) =>
    post<ImportResult<PartnerJobRecord>>('/partner/jobs/import', { items }),

  // Fairs
  getPartnerFairs: () =>
    get<PartnerFairRecord[]>('/partner/fairs'),
  unpublishPartnerFair: (id: string) =>
    patch<PartnerFairRecord>(`/partner/fairs/${id}/publish`, { action: 'unpublish' }),
  // sourceOrgId / sourceName 由后端从 JWT 推断，前端只传 items
  importPartnerFairs: (items: ImportFairItem[]) =>
    post<ImportResult<PartnerFairRecord>>('/partner/fairs/import', { items }),

  // Sync Logs (read-only)
  getSyncLogs: () =>
    get<PartnerSyncLog[]>('/partner/sync-logs'),

  // Excel Import
  parseExcel: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${API_BASE_URL}/partner/excel/parse`, {
      method: 'POST',
      headers: { Accept: 'application/json', ...authHeader() },
      credentials: 'include',
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
        if (res.status === 401) redirectToLogin()
        throw new ApiHttpError(body.error?.code ?? `HTTP_${res.status}`, body.error?.message ?? res.statusText, res.status)
      }
      return res.json() as Promise<{ columns: string[]; sampleRows: Record<string, string>[] }>
    })
  },

  previewExcel: (
    file: File,
    sourceId: string,
    dataType: 'job' | 'fair',
    fieldMapping: Record<string, string>,
  ) => {
    const form = new FormData()
    form.append('file', file)
    form.append('sourceId', sourceId)
    form.append('dataType', dataType)
    form.append('fieldMapping', JSON.stringify(fieldMapping))
    return fetch(`${API_BASE_URL}/partner/excel/preview`, {
      method: 'POST',
      headers: { Accept: 'application/json', ...authHeader() },
      credentials: 'include',
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
        if (res.status === 401) redirectToLogin()
        throw new ApiHttpError(body.error?.code ?? `HTTP_${res.status}`, body.error?.message ?? res.statusText, res.status)
      }
      return res.json() as Promise<ExcelPreviewResult>
    })
  },

  confirmExcelImport: (batchId: string) =>
    post<ExcelConfirmResult>(`/partner/excel/${batchId}/confirm`, {}),

  cancelExcelImport: (batchId: string) =>
    fetch(`${API_BASE_URL}/partner/excel/${batchId}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', ...authHeader() },
      credentials: 'include',
    }).then(async (res) => {
      if (!res.ok) {
        if (res.status === 401) redirectToLogin()
        throw new ApiHttpError(`HTTP_${res.status}`, res.statusText, res.status)
      }
      return res.json() as Promise<{ success: boolean }>
    }),
}
