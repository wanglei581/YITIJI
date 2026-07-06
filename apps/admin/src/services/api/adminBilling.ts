// Admin 计费/对账 API 客户端（W-C part2b-2）。
//
// 端点（admin JwtAuthGuard + RolesGuard）：
//   GET  /admin/billing/price-config              全量价目
//   PUT  /admin/billing/price-config/:serviceKey  改价/启停（唯一合法改价路径）
//   GET  /admin/billing/reconciliation            本地对账报表
//
// 无任何支付凭证字段；改价即时生效（服务端每次报价实时读库）。
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface AdminPriceConfigItem {
  serviceKey: string
  unitCents: number
  unit: string
  active: boolean
  description: string | null
  effectiveFrom: string
  updatedAt: string
}

export interface UpdatePriceConfigInput {
  unitCents?: number
  active?: boolean
  description?: string
}

export interface ReconciliationDiscrepancy {
  code: string
  orderId: string
  orderNo: string
  detail: Record<string, unknown>
}

export interface ReconciliationReport {
  window: { from: string | null; to: string | null }
  summary: {
    paidOrderCount: number
    grossPaidCents: number
    refundedOrderCount: number
    refundedCents: number
    netCents: number
    refundingCount: number
    lateePaidCount: number
    reconciledCount: number
  }
  discrepancies: ReconciliationDiscrepancy[]
  attention: { latePaid: ReconciliationDiscrepancy[]; reconciled: ReconciliationDiscrepancy[] }
}

interface AdminBillingService {
  listPriceConfig(): Promise<{ items: AdminPriceConfigItem[] }>
  updatePriceConfig(serviceKey: string, patch: UpdatePriceConfigInput): Promise<AdminPriceConfigItem>
  reconciliation(params?: { from?: string; to?: string }): Promise<ReconciliationReport>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers ?? {}) },
    credentials: 'include',
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string }; message?: string }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
      else if (typeof body.message === 'string') message = body.message
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

const httpAdapter: AdminBillingService = {
  listPriceConfig: () => request('/admin/billing/price-config'),
  updatePriceConfig: (serviceKey, patch) =>
    request(`/admin/billing/price-config/${encodeURIComponent(serviceKey)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  reconciliation: (params) => {
    const q = new URLSearchParams(
      Object.entries(params ?? {}).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString()
    return request(`/admin/billing/reconciliation${q ? `?${q}` : ''}`)
  },
}

// ── Mock（本地演示，无后端）────────────────────────────────────────────────
const MOCK_PRICES: AdminPriceConfigItem[] = [
  { serviceKey: 'print_bw_page', unitCents: 20, unit: 'page', active: true, description: '黑白打印每页（演示价）', effectiveFrom: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { serviceKey: 'print_color_page', unitCents: 50, unit: 'page', active: true, description: '彩色打印每页（演示价）', effectiveFrom: new Date().toISOString(), updatedAt: new Date().toISOString() },
]
const mockAdapter: AdminBillingService = {
  listPriceConfig: async () => ({ items: MOCK_PRICES.map((p) => ({ ...p })) }),
  updatePriceConfig: async (serviceKey, patch) => {
    const row = MOCK_PRICES.find((p) => p.serviceKey === serviceKey)
    if (!row) throw new ApiHttpError('PRICE_CONFIG_NOT_FOUND', '价目不存在', 404)
    if (patch.unitCents !== undefined) row.unitCents = patch.unitCents
    if (patch.active !== undefined) row.active = patch.active
    if (patch.description !== undefined) row.description = patch.description
    row.updatedAt = new Date().toISOString()
    return { ...row }
  },
  reconciliation: async () => ({
    window: { from: null, to: null },
    summary: { paidOrderCount: 12, grossPaidCents: 3600, refundedOrderCount: 2, refundedCents: 400, netCents: 3200, refundingCount: 0, lateePaidCount: 1, reconciledCount: 1 },
    discrepancies: [],
    attention: { latePaid: [], reconciled: [] },
  }),
}

export const adminBillingService: AdminBillingService = API_MODE === 'http' ? httpAdapter : mockAdapter
