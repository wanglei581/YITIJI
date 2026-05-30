import { API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import type { AdminAiUsage, AdminAiLogsResult } from './types'

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

  getAiLogs: (limit = 100): Promise<AdminAiLogsResult> =>
    get<AdminAiLogsResult>(`/admin/ai/logs?limit=${limit}`),
}
