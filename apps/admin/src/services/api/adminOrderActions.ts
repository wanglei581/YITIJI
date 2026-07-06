import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface AdminPrintOrderActionResult {
  orderId: string
  orderNo: string
  printTaskId: string
  taskStatus: string
  terminalId: string | null
  terminalCode: string | null
  payStatus: string
  updatedAt: string
}

interface AdminOrderActionsService {
  cancelOrder(id: string, reason?: string): Promise<AdminPrintOrderActionResult>
  reassignOrder(id: string, terminalId: string, reason?: string): Promise<AdminPrintOrderActionResult>
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
      const errBody = (await res.json()) as { error?: { code?: string; message?: string } }
      if (errBody.error?.code) code = errBody.error.code
      if (errBody.error?.message) message = errBody.error.message
    } catch {
      /* keep defaults */
    }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

const httpAdapter: AdminOrderActionsService = {
  cancelOrder: (id, reason) =>
    post<AdminPrintOrderActionResult>(`/admin/orders/${encodeURIComponent(id)}/cancel`, { reason }),
  reassignOrder: (id, terminalId, reason) =>
    post<AdminPrintOrderActionResult>(`/admin/orders/${encodeURIComponent(id)}/reassign`, { terminalId, reason }),
}

const mockAdapter: AdminOrderActionsService = {
  async cancelOrder(id) {
    return {
      orderId: id,
      orderNo: 'ORD-MOCK-ACTION',
      printTaskId: 'pt-mock-action',
      taskStatus: 'cancelled',
      terminalId: 't1',
      terminalCode: 'KSK-001',
      payStatus: 'unpaid',
      updatedAt: new Date().toISOString(),
    }
  },
  async reassignOrder(id, terminalId) {
    return {
      orderId: id,
      orderNo: 'ORD-MOCK-ACTION',
      printTaskId: 'pt-mock-action',
      taskStatus: 'pending',
      terminalId,
      terminalCode: terminalId,
      payStatus: 'paid',
      updatedAt: new Date().toISOString(),
    }
  },
}

export const adminOrderActionsService: AdminOrderActionsService =
  API_MODE === 'http' ? httpAdapter : mockAdapter
