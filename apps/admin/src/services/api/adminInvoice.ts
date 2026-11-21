import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface AdminInvoiceView {
  id: string
  orderKind: string
  orderId: string
  titleType: string
  title: string
  taxId: string | null
  email: string | null
  amountCents: number
  status: string
  issuedAt: string | null
  invoiceNo: string | null
  returnReason: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...authHeader(), ...init?.headers },
    credentials: 'include',
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch {
      /* 保留状态码 */
    }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

export const adminInvoiceService = {
  getByOrder(orderId: string, orderKind: 'print' | 'service'): Promise<AdminInvoiceView> {
    if (API_MODE !== 'http') {
      return Promise.reject(new ApiHttpError('INVOICE_NOT_FOUND', '没有开票申请', 404))
    }
    const query = new URLSearchParams({ orderKind })
    return request<AdminInvoiceView>(`/admin/orders/${encodeURIComponent(orderId)}/invoice?${query.toString()}`)
  },
  markIssued(id: string, invoiceNo: string): Promise<AdminInvoiceView> {
    return request<AdminInvoiceView>(`/admin/invoice-requests/${encodeURIComponent(id)}/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceNo: invoiceNo.trim() || undefined }),
    })
  },
  returnRequest(id: string, reason: string): Promise<AdminInvoiceView> {
    return request<AdminInvoiceView>(`/admin/invoice-requests/${encodeURIComponent(id)}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
  },
}
