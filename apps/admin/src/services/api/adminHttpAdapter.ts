import { API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import type {
  AdminJobSourceRecord,
  AdminFairSourceRecord,
  AdminImportBatch,
  AdminPrintersResponse,
  AdminTerminalsResponse,
  AdminOrgOptionsResponse,
  AssignTerminalOrgResult,
  UpdateTerminalProfileInput,
  UpdateTerminalProfileResult,
  AuditLogListResponse,
  AuditLogListQuery,
} from './types'
import type { ReviewAction, PublishAction } from './review-types'

/**
 * Phase C:401 统一处理。后端 token 失效或权限不足时,
 * adapter 不抛业务异常,而是清 token + 跳 /login。
 * 调用方组件不必每个地方都处理 401。
 */
function handleAuthFailure(status: number, code: string): never | void {
  if (status === 401) {
    redirectToLogin()
    // 抛错让上游 Promise reject,避免 .then 链继续执行
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', status)
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
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
    handleAuthFailure(res.status, code)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

/**
 * 用于后端以 ApiResponse<T>(即 { data: T })包装的端点。
 * job-sources / fair-sources 等老端点返回裸数组用 get<T>;
 * audit-logs / terminals 等用 ApiResponse 包装,这里统一拆 .data。
 */
async function getData<T>(path: string): Promise<T> {
  const body = await get<{ data: T }>(path)
  return body.data
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
    handleAuthFailure(res.status, code)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

/** PATCH 到以 ApiResponse<T>({ data: T }) 包装的端点，统一拆 .data。 */
async function patchData<T>(path: string, body: unknown): Promise<T> {
  const res = await patch<{ data: T }>(path, body)
  return res.data
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

  getImportBatches: () =>
    get<AdminImportBatch[]>('/admin/import-batches'),

  // ── 设备管理 — 终端心跳(契约 C1)──────────────────────────────────────────
  getTerminals: () =>
    getData<AdminTerminalsResponse>('/admin/terminals'),

  // ── 终端机构归属（绑定/解绑）──────────────────────────────────────────────
  getOrgOptions: () =>
    getData<AdminOrgOptionsResponse>('/admin/terminals/org-options'),

  assignTerminalOrg: (terminalId: string, orgId: string | null) =>
    patchData<AssignTerminalOrgResult>(`/admin/terminals/${encodeURIComponent(terminalId)}/org`, { orgId }),

  updateTerminalProfile: (terminalId: string, input: UpdateTerminalProfileInput) =>
    patchData<UpdateTerminalProfileResult>(`/admin/terminals/${encodeURIComponent(terminalId)}/profile`, input),

  getPrinters: () =>
    getData<AdminPrintersResponse>('/admin/printers'),

  // ── 日志审计(HIGH-5)──────────────────────────────────────────────────────
  getAuditLogs: (query: AuditLogListQuery = {}) =>
    getData<AuditLogListResponse>(`/admin/audit-logs${buildAuditQuery(query)}`),
}

function buildAuditQuery(q: AuditLogListQuery): string {
  const params = new URLSearchParams()
  if (q.action)     params.set('action', q.action)
  if (q.actorId)    params.set('actorId', q.actorId)
  if (q.targetType) params.set('targetType', q.targetType)
  if (q.targetId)   params.set('targetId', q.targetId)
  if (q.startAt)    params.set('startAt', q.startAt)
  if (q.endAt)      params.set('endAt', q.endAt)
  if (q.limit !== undefined)  params.set('limit', String(q.limit))
  if (q.offset !== undefined) params.set('offset', String(q.offset))
  const s = params.toString()
  return s ? `?${s}` : ''
}
