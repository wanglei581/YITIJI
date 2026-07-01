import { API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import type {
  PartnerDataSource,
  PartnerJobRecord,
  PartnerJobQualitySummary,
  PartnerFairRecord,
  PartnerSyncLog,
  ImportJobItem,
  ImportFairItem,
  ImportResult,
  UpdatePartnerJobInput,
  UpdatePartnerFairInput,
  CreateDataSourcePayload,
  ExcelPreviewResult,
  ExcelConfirmResult,
  FieldMappingRuleResult,
  PartnerSmartCampusTerminal,
  SaveSmartCampusConfigPayload,
  TerminalSmartCampusConfigView,
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

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
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

function getDownloadFileName(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1])
    } catch {
      return fallback
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(contentDisposition)
  return plain?.[1] ?? fallback
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const partnerHttpAdapter = {
  // Smart Campus
  getSmartCampusTerminals: () =>
    get<PartnerSmartCampusTerminal[]>('/partner/smart-campus/terminals'),
  saveSmartCampusConfig: (terminalId: string, payload: SaveSmartCampusConfigPayload) =>
    put<TerminalSmartCampusConfigView>(`/partner/smart-campus/terminals/${encodeURIComponent(terminalId)}/config`, payload),

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
  getPartnerJobQualitySummary: () =>
    get<PartnerJobQualitySummary[]>('/partner/jobs/quality-summary'),
  unpublishPartnerJob: (id: string) =>
    patch<PartnerJobRecord>(`/partner/jobs/${id}/publish`, { action: 'unpublish' }),
  // 阶段1C:编辑本机构岗位(后端强制回 pending+draft 重审)
  updatePartnerJob: (id: string, input: UpdatePartnerJobInput) =>
    patch<PartnerJobRecord>(`/partner/jobs/${id}`, input),
  // sourceOrgId / sourceName 由后端从 JWT 推断，前端只传 items
  importPartnerJobs: (items: ImportJobItem[]) =>
    post<ImportResult<PartnerJobRecord>>('/partner/jobs/import', { items }),

  // Fairs
  getPartnerFairs: () =>
    get<PartnerFairRecord[]>('/partner/fairs'),
  unpublishPartnerFair: (id: string) =>
    patch<PartnerFairRecord>(`/partner/fairs/${id}/publish`, { action: 'unpublish' }),
  // 阶段1C:编辑本机构招聘会(后端强制回 pending+draft 重审)
  updatePartnerFair: (id: string, input: UpdatePartnerFairInput) =>
    patch<PartnerFairRecord>(`/partner/fairs/${id}`, input),
  // sourceOrgId / sourceName 由后端从 JWT 推断，前端只传 items
  importPartnerFairs: (items: ImportFairItem[]) =>
    post<ImportResult<PartnerFairRecord>>('/partner/fairs/import', { items }),

  // Sync Logs (read-only)
  getSyncLogs: () =>
    get<PartnerSyncLog[]>('/partner/sync-logs'),

  // Excel Import
  downloadExcelTemplate: async (dataType: 'job' | 'fair') => {
    const url = new URL(`${API_BASE_URL}/partner/excel/template`, window.location.origin)
    url.searchParams.set('dataType', dataType)
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ...authHeader(),
      },
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
    const blob = await res.blob()
    const fallback = dataType === 'job' ? '岗位数据导入模板.xlsx' : '招聘会数据导入模板.xlsx'
    saveBlob(blob, getDownloadFileName(res.headers.get('Content-Disposition'), fallback))
  },

  // T1: 读取上次保存的字段映射规则(自动回填)
  getMappingRule: (sourceId: string, dataType: 'job' | 'fair') =>
    get<FieldMappingRuleResult>('/partner/excel/mapping-rule', { sourceId, dataType }),

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
