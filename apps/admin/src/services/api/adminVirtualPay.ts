import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type VirtualPayServiceKind = 'resume_optimize' | 'mock_interview'

export interface VirtualPayGoodsView {
  configured: boolean
  productId: string | null
  priceCents: number | null
}

export interface VirtualPaySettingsResponse {
  enabled: boolean
  personalChargeEnabled: boolean
  canSell: boolean
  goods: Record<VirtualPayServiceKind, VirtualPayGoodsView>
  runtime?: {
    ready: boolean
    block: 'env_missing' | 'env_invalid' | 'sandbox_in_production' | null
    env: 0 | 1 | null
  }
}

export interface VirtualPayCreditView {
  id: string
  status: string
  consumedAt: string | null
  consumedServiceOrderId: string | null
  refundedAt: string | null
  createdAt: string
}

export interface VirtualPayOrderItem {
  id: string
  outTradeNo: string
  serviceKind: string
  productId: string
  priceCents: number
  env: number
  status: string
  wxOrderId: string | null
  paidAt: string | null
  refundOrderId: string | null
  wxRefundId: string | null
  refundReason: string | null
  refundedAt: string | null
  queryFailCount: number
  lastDiagnosticReason: string | null
  createdAt: string
  hasMember: boolean
  hasOpenId: boolean
  credit: VirtualPayCreditView | null
  refundable: boolean
  refundBlockReason: string | null
}

export interface VirtualPayOrderListResponse {
  items: VirtualPayOrderItem[]
  total: number
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export interface VirtualPayOrderListQuery {
  status?: string
  serviceKind?: string
  outTradeNo?: string
  page?: number
  pageSize?: number
}

export interface VirtualPaySyncResponse {
  order: VirtualPayOrderItem
  wxStatus: number | null
  leftFee: number | null
}

interface AdminVirtualPayService {
  getSettings(): Promise<VirtualPaySettingsResponse>
  setEnabled(enabled: boolean, confirm?: boolean): Promise<VirtualPaySettingsResponse>
  setGoods(
    serviceKind: VirtualPayServiceKind,
    input: { productId: string; priceCents: number; confirm: boolean },
  ): Promise<VirtualPaySettingsResponse>
  listOrders(query?: VirtualPayOrderListQuery): Promise<VirtualPayOrderListResponse>
  getOrder(id: string): Promise<VirtualPayOrderItem>
  refundOrder(id: string, input: { confirm: boolean; reason?: string }): Promise<VirtualPayOrderItem>
  syncOrder(id: string): Promise<VirtualPaySyncResponse>
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

const httpAdapter: AdminVirtualPayService = {
  getSettings: () => request('/admin/billing/miniapp-virtual-pay'),
  setEnabled: (enabled, confirm) =>
    request('/admin/billing/miniapp-virtual-pay', {
      method: 'PUT',
      body: JSON.stringify({ enabled, confirm }),
    }),
  setGoods: (serviceKind, input) =>
    request(`/admin/billing/miniapp-virtual-pay/goods/${encodeURIComponent(serviceKind)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  listOrders: (query) => {
    const params = new URLSearchParams()
    if (query?.status) params.set('status', query.status)
    if (query?.serviceKind) params.set('serviceKind', query.serviceKind)
    if (query?.outTradeNo) params.set('outTradeNo', query.outTradeNo)
    if (query?.page) params.set('page', String(query.page))
    if (query?.pageSize) params.set('pageSize', String(query.pageSize))
    const qs = params.toString()
    return request(`/admin/billing/miniapp-virtual-pay/orders${qs ? `?${qs}` : ''}`)
  },
  getOrder: (id) => request(`/admin/billing/miniapp-virtual-pay/orders/${encodeURIComponent(id)}`),
  refundOrder: (id, input) =>
    request(`/admin/billing/miniapp-virtual-pay/orders/${encodeURIComponent(id)}/refund`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  syncOrder: (id) =>
    request(`/admin/billing/miniapp-virtual-pay/orders/${encodeURIComponent(id)}/sync`, {
      method: 'POST',
    }),
}

// ── 演示适配器（本地 mock，不含真实价格与真实道具编号） ──────────────────
const DEMO_SETTINGS: VirtualPaySettingsResponse = {
  enabled: false,
  personalChargeEnabled: false,
  canSell: false,
  goods: {
    resume_optimize: { configured: false, productId: null, priceCents: null },
    mock_interview: { configured: false, productId: null, priceCents: null },
  },
  runtime: { ready: false, block: 'env_missing', env: null },
}

function nowMinus(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

const DEMO_ORDERS: VirtualPayOrderItem[] = [
  {
    id: 'demo-vpo-1',
    outTradeNo: 'vp000000000000000000000001',
    serviceKind: 'resume_optimize',
    productId: 'DEMO_ITEM_A',
    priceCents: 100,
    env: 1,
    status: 'paid',
    wxOrderId: 'wx_demo_001',
    paidAt: nowMinus(40),
    refundOrderId: null,
    wxRefundId: null,
    refundReason: null,
    refundedAt: null,
    queryFailCount: 0,
    lastDiagnosticReason: null,
    createdAt: nowMinus(42),
    hasMember: true,
    hasOpenId: true,
    credit: {
      id: 'demo-crd-1',
      status: 'available',
      consumedAt: null,
      consumedServiceOrderId: null,
      refundedAt: null,
      createdAt: nowMinus(40),
    },
    refundable: true,
    refundBlockReason: null,
  },
  {
    id: 'demo-vpo-2',
    outTradeNo: 'vp000000000000000000000002',
    serviceKind: 'mock_interview',
    productId: 'DEMO_ITEM_B',
    priceCents: 100,
    env: 1,
    status: 'paid',
    wxOrderId: 'wx_demo_002',
    paidAt: nowMinus(90),
    refundOrderId: null,
    wxRefundId: null,
    refundReason: null,
    refundedAt: null,
    queryFailCount: 0,
    lastDiagnosticReason: null,
    createdAt: nowMinus(95),
    hasMember: true,
    hasOpenId: true,
    credit: {
      id: 'demo-crd-2',
      status: 'consumed',
      consumedAt: nowMinus(60),
      consumedServiceOrderId: 'vpcord_demo_used_01',
      refundedAt: null,
      createdAt: nowMinus(90),
    },
    refundable: false,
    refundBlockReason: 'credit_consumed',
  },
  {
    id: 'demo-vpo-3',
    outTradeNo: 'vp000000000000000000000003',
    serviceKind: 'resume_optimize',
    productId: 'DEMO_ITEM_A',
    priceCents: 100,
    env: 1,
    status: 'refunding',
    wxOrderId: 'wx_demo_003',
    paidAt: nowMinus(120),
    refundOrderId: 'vpr000000000000000000000003',
    wxRefundId: null,
    refundReason: '用户未核销申请退款',
    refundedAt: null,
    queryFailCount: 0,
    lastDiagnosticReason: 'refund_in_progress_268490014',
    createdAt: nowMinus(125),
    hasMember: true,
    hasOpenId: true,
    credit: {
      id: 'demo-crd-3',
      status: 'refunding',
      consumedAt: null,
      consumedServiceOrderId: null,
      refundedAt: null,
      createdAt: nowMinus(120),
    },
    refundable: false,
    refundBlockReason: 'refunding',
  },
]

function cloneOrder(row: VirtualPayOrderItem): VirtualPayOrderItem {
  return { ...row, credit: row.credit ? { ...row.credit } : null }
}

const mockAdapter: AdminVirtualPayService = {
  getSettings: async () => ({
    ...DEMO_SETTINGS,
    goods: {
      resume_optimize: { ...DEMO_SETTINGS.goods.resume_optimize },
      mock_interview: { ...DEMO_SETTINGS.goods.mock_interview },
    },
    runtime: DEMO_SETTINGS.runtime ? { ...DEMO_SETTINGS.runtime } : undefined,
  }),
  setEnabled: async (enabled, confirm) => {
    if (enabled && confirm !== true) {
      throw new ApiHttpError('VPAY_CONFIRM_REQUIRED', '打开小程序虚拟支付必须确认', 400)
    }
    DEMO_SETTINGS.enabled = enabled
    DEMO_SETTINGS.canSell = DEMO_SETTINGS.enabled && DEMO_SETTINGS.personalChargeEnabled
    return mockAdapter.getSettings()
  },
  setGoods: async (serviceKind, input) => {
    if (input.confirm !== true) {
      throw new ApiHttpError('VPAY_GOODS_CONFIRM_REQUIRED', '写入虚拟支付道具必须确认', 400)
    }
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(input.productId)) {
      throw new ApiHttpError('VPAY_PRODUCT_ID_INVALID', '道具编号只允许 1 到 20 位字母、数字、下划线或连字符', 400)
    }
    if (!Number.isInteger(input.priceCents) || input.priceCents < 1) {
      throw new ApiHttpError('VPAY_PRICE_INVALID', '单价必须大于 0', 400)
    }
    DEMO_SETTINGS.goods[serviceKind] = {
      configured: true,
      productId: input.productId,
      priceCents: input.priceCents,
    }
    return mockAdapter.getSettings()
  },
  listOrders: async (query) => {
    const filtered = DEMO_ORDERS.filter((row) => {
      if (query?.status && row.status !== query.status) return false
      if (query?.serviceKind && row.serviceKind !== query.serviceKind) return false
      if (query?.outTradeNo && !row.outTradeNo.includes(query.outTradeNo.trim())) return false
      return true
    })
    const page = query?.page ?? 1
    const pageSize = query?.pageSize ?? 20
    const slice = filtered.slice((page - 1) * pageSize, page * pageSize).map(cloneOrder)
    return {
      items: slice,
      total: filtered.length,
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      },
    }
  },
  getOrder: async (id) => {
    const found = DEMO_ORDERS.find((row) => row.id === id)
    if (!found) throw new ApiHttpError('VPAY_ORDER_NOT_FOUND', '没有找到这笔虚拟支付订单', 404)
    return cloneOrder(found)
  },
  refundOrder: async (id, input) => {
    if (input.confirm !== true) {
      throw new ApiHttpError('VPAY_REFUND_CONFIRM_REQUIRED', '发起原路退款必须二次确认', 400)
    }
    const found = DEMO_ORDERS.find((row) => row.id === id)
    if (!found) throw new ApiHttpError('VPAY_ORDER_NOT_FOUND', '没有找到这笔虚拟支付订单', 404)
    if (!found.refundable || found.status !== 'paid' || found.credit?.status !== 'available') {
      throw new ApiHttpError('VPAY_ORDER_NOT_REFUNDABLE', '当前订单不符合退款条件', 409)
    }
    found.status = 'refunding'
    found.refundOrderId = found.refundOrderId ?? `vpr0000000000000000000000${DEMO_ORDERS.indexOf(found) + 10}`
    found.refundReason = input.reason?.trim() || '管理员原路退款'
    found.credit.status = 'refunding'
    found.refundable = false
    found.refundBlockReason = 'refunding'
    return cloneOrder(found)
  },
  syncOrder: async (id) => {
    const found = DEMO_ORDERS.find((row) => row.id === id)
    if (!found) throw new ApiHttpError('VPAY_ORDER_NOT_FOUND', '没有找到这笔虚拟支付订单', 404)
    if (found.status === 'refunding') {
      const now = new Date().toISOString()
      found.status = 'refunded'
      found.wxRefundId = found.wxRefundId ?? 'wxr_demo_synced'
      found.refundedAt = now
      found.lastDiagnosticReason = null
      found.refundable = false
      found.refundBlockReason = 'already_refunded'
      if (found.credit) {
        found.credit.status = 'refunded'
        found.credit.refundedAt = now
      }
      return { order: cloneOrder(found), wxStatus: 6, leftFee: 0 }
    }
    return { order: cloneOrder(found), wxStatus: 4, leftFee: found.priceCents }
  },
}

export const adminVirtualPayService: AdminVirtualPayService =
  API_MODE === 'http' ? httpAdapter : mockAdapter
