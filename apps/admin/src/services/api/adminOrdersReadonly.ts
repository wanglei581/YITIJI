import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface AdminOrderReadonlyItem {
  id: string
  orderNo: string
  type: string
  ownerType: 'member' | 'anonymous'
  userLabel: string
  terminalCode: string | null
  amountCents: number
  currency: string
  payStatus: string
  taskStatus: string
  printFileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
  errorCode: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminOrderReadonlyDetail extends AdminOrderReadonlyItem {
  refundedAt: string | null
  refundReason: string | null
  print: {
    fileName: string | null
    copies: number | null
    colorMode: 'black_white' | 'color' | null
    duplex: string | null
    paperSize: string | null
    pageRange: string | null
    status: string
    createdAt: string
    completedAt: string | null
    errorCode: string | null
  } | null
  statusLogs: Array<{
    fromStatus: string
    toStatus: string
    errorCode: string | null
    createdAt: string
  }>
}

export interface AdminOrderReadonlyPage {
  items: AdminOrderReadonlyItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export interface ListAdminOrdersReadonlyParams {
  type?: string
  payStatus?: string
  taskStatus?: string
  search?: string
  page: number
  pageSize: number
}

interface AdminOrdersReadonlyService {
  list(params: ListAdminOrdersReadonlyParams): Promise<AdminOrderReadonlyPage>
  getById(id: string): Promise<AdminOrderReadonlyDetail>
}

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const query = params
    ? new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined) as [string, string][]).toString()
    : ''
  const res = await fetch(`${API_BASE_URL}${path}${query ? `?${query}` : ''}`, {
    headers: { Accept: 'application/json', ...authHeader() },
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

const httpAdapter: AdminOrdersReadonlyService = {
  list: (params) =>
    get<AdminOrderReadonlyPage>('/admin/orders', {
      type: params.type,
      payStatus: params.payStatus,
      taskStatus: params.taskStatus,
      search: params.search,
      page: String(params.page),
      pageSize: String(params.pageSize),
    }),
  getById: (id) => get<AdminOrderReadonlyDetail>(`/admin/orders/${encodeURIComponent(id)}`),
}

const now = () => new Date().toISOString()

const MOCK_DETAIL: AdminOrderReadonlyDetail = {
  id: 'ord_mock_1',
  orderNo: 'ORD-20260625-MOCKREAD',
  type: 'print',
  ownerType: 'member',
  userLabel: '演示会员',
  terminalCode: 'KSK-001',
  amountCents: 0,
  currency: 'CNY',
  payStatus: 'unpaid',
  taskStatus: 'completed',
  printFileName: '演示简历.pdf',
  copies: 2,
  colorMode: 'black_white',
  paperSize: 'A4',
  errorCode: null,
  createdAt: now(),
  updatedAt: now(),
  refundedAt: null,
  refundReason: null,
  print: {
    fileName: '演示简历.pdf',
    copies: 2,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    pageRange: null,
    status: 'completed',
    createdAt: now(),
    completedAt: now(),
    errorCode: null,
  },
  statusLogs: [
    { fromStatus: 'pending', toStatus: 'claimed', errorCode: null, createdAt: now() },
    { fromStatus: 'claimed', toStatus: 'completed', errorCode: null, createdAt: now() },
  ],
}

const mockAdapter: AdminOrdersReadonlyService = {
  async list(params) {
    return {
      items: [MOCK_DETAIL],
      pagination: { page: params.page, pageSize: params.pageSize, total: 1, totalPages: 1 },
    }
  },
  async getById() {
    return MOCK_DETAIL
  },
}

export const adminOrdersReadonlyService: AdminOrdersReadonlyService =
  API_MODE === 'http' ? httpAdapter : mockAdapter
