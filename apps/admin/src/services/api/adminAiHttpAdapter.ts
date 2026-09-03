import { API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import type { AdminAiUsage, AdminAiLogsQuery, AdminAiLogsResult, JobSourceQualitySummary } from './types'

/** 只把**真的有值**的筛选项拼进 query，避免 `?operation=` 这类空参数。 */
function aiLogsQueryString(query: AdminAiLogsQuery): string {
  const params = new URLSearchParams()
  if (query.operation) params.set('operation', query.operation)
  if (query.status) params.set('status', query.status)
  if (query.startAt) params.set('startAt', query.startAt)
  if (query.endAt) params.set('endAt', query.endAt)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined && query.offset > 0) params.set('offset', String(query.offset))
  return params.toString()
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
      if (body.error?.code)    code    = body.error.code
      if (body.error?.message) message = body.error.message
    } catch { /* keep defaults */ }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

export const adminAiHttpAdapter = {
  getAiUsage: (): Promise<AdminAiUsage> =>
    get<AdminAiUsage>('/admin/ai/usage'),

  getAiLogs: (query: AdminAiLogsQuery = {}): Promise<AdminAiLogsResult> =>
    get<AdminAiLogsResult>(`/admin/ai/logs?${aiLogsQueryString({ limit: 100, ...query })}`),

  getAdminJobQualitySummary: (): Promise<JobSourceQualitySummary[]> =>
    get<JobSourceQualitySummary[]>('/admin/jobs/quality-summary'),
}
