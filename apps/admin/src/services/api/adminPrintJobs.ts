// Admin 打印任务处置 API 客户端
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface AdminPrintJobAbandonResult {
  taskId: string
  previousStatus: string
  newStatus: 'abandoned'
  orderId: string | null
  abandonedAt: string
}

async function postEmpty<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    body: '{}',
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch { /* keep defaults */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

interface AdminPrintJobsService {
  abandonPending(printTaskId: string): Promise<AdminPrintJobAbandonResult>
}

const httpAdapter: AdminPrintJobsService = {
  abandonPending: (printTaskId) =>
    postEmpty<AdminPrintJobAbandonResult>(
      `/admin/print-jobs/${encodeURIComponent(printTaskId)}/abandon`
    ),
}

const mockAdapter: AdminPrintJobsService = {
  async abandonPending(printTaskId) {
    return {
      taskId: printTaskId,
      previousStatus: 'pending',
      newStatus: 'abandoned',
      orderId: null,
      abandonedAt: new Date().toISOString(),
    }
  },
}

export const adminPrintJobsService: AdminPrintJobsService =
  API_MODE === 'http' ? httpAdapter : mockAdapter
