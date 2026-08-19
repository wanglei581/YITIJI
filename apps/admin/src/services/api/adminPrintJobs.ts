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

export interface AdminPrintJobVerifyOutcomeResult {
  taskId: string
  orderId: string | null
  printOutcome: 'printed' | 'not_printed'
  idempotent: boolean
  verifiedAt: string
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  return readOk(res)
}

async function postEmpty<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    body: '{}',
  })
  return readOk(res)
}

async function readOk<T>(res: Response): Promise<T> {
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
  verifyOutcome(
    printTaskId: string,
    input: { outcome: 'printed' | 'not_printed'; confirm: string },
  ): Promise<AdminPrintJobVerifyOutcomeResult>
}

const httpAdapter: AdminPrintJobsService = {
  abandonPending: (printTaskId) =>
    postEmpty<AdminPrintJobAbandonResult>(
      `/admin/print-jobs/${encodeURIComponent(printTaskId)}/abandon`
    ),
  verifyOutcome: (printTaskId, input) =>
    postJson<AdminPrintJobVerifyOutcomeResult>(
      `/admin/print-jobs/${encodeURIComponent(printTaskId)}/verify-outcome`,
      input,
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
  async verifyOutcome(printTaskId, input) {
    return {
      taskId: printTaskId,
      orderId: null,
      printOutcome: input.outcome,
      idempotent: false,
      verifiedAt: new Date().toISOString(),
    }
  },
}

export const adminPrintJobsService: AdminPrintJobsService =
  API_MODE === 'http' ? httpAdapter : mockAdapter
