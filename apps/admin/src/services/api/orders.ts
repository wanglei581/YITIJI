import { API_MODE, API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ─── Types(镜像后端 services/api/src/admin-orders/admin-orders.types.ts)────────
//
// 后端各端点以 ApiResponse<T>(即 { data: T })包装,http adapter 内拆 .data。
// 合规:线下打印运营订单,不接真实支付;amountCents 本阶段恒为 0(未计费),
// payStatus 默认 unpaid;退款仅置状态 + 原因,不发生真实资金流。

export type AdminOrderType = 'print' | 'scan' | 'photo' | 'ai'
export type AdminPayStatus = 'unpaid' | 'paid' | 'refunded' | 'failed'
export type AdminTaskStatus =
  | 'pending' | 'claimed' | 'printing' | 'completed' | 'failed' | 'cancelled'

export interface AdminOrderListItem {
  id: string
  orderNo: string
  type: string
  endUserId: string | null
  userLabel: string
  terminalId: string | null
  terminalCode: string | null
  amountCents: number
  currency: string
  payStatus: string
  taskStatus: string
  refundedAt: string | null
  createdAt: string
}

export interface AdminOrdersListResponse {
  items: AdminOrderListItem[]
  total: number
  limit: number
  offset: number
}

export interface AdminOrderPrintDetail {
  status: string
  fileName: string | null
  copies: number | null
  colorMode: string | null
  duplex: string | null
  paperSize: string | null
  pageRange: string | null
  createdAt: string
  completedAt: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface AdminOrderStatusLog {
  fromStatus: string
  toStatus: string
  errorCode: string | null
  createdAt: string
}

export interface AdminOrderDetail extends AdminOrderListItem {
  refundReason: string | null
  updatedAt: string
  print: AdminOrderPrintDetail | null
  statusLogs: AdminOrderStatusLog[]
}

export interface ListOrdersOptions {
  type?: string
  payStatus?: string
  taskStatus?: string
  search?: string
  limit?: number
  offset?: number
}

/** 改状态入参：payStatus / taskStatus 至少其一。taskStatus 仅改 Order 运营视图列,不动 PrintTask。 */
export interface UpdateOrderStatusChanges {
  payStatus?: 'paid' | 'failed' | 'unpaid'
  taskStatus?: string
  note?: string
}

export interface AdminOrdersServiceInterface {
  /** GET /admin/orders — 订单列表(筛选 + 分页) */
  listOrders(opts?: ListOrdersOptions): Promise<AdminOrdersListResponse>
  /** GET /admin/orders/:id — 详情(含关联打印任务 + 状态日志) */
  getOrder(id: string): Promise<AdminOrderDetail>
  /** PATCH /admin/orders/:id/status — 改支付状态/运营视图任务状态(不接支付,后端写审计) */
  updateOrderStatus(id: string, changes: UpdateOrderStatusChanges): Promise<AdminOrderDetail>
  /** POST /admin/orders/:id/refund — 标记退款(仅 paid 可标记;只置状态,不动钱,后端写审计) */
  refundOrder(id: string, reason: string): Promise<AdminOrderDetail>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

function handleAuthFailure(status: number, code: string): void {
  if (status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', status)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeader() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
    handleAuthFailure(res.status, code)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function unwrap<T>(p: Promise<{ data: T }>): Promise<T> {
  return (await p).data
}

function buildQuery(opts?: ListOrdersOptions): string {
  const q = new URLSearchParams()
  if (opts?.type) q.set('type', opts.type)
  if (opts?.payStatus) q.set('payStatus', opts.payStatus)
  if (opts?.taskStatus) q.set('taskStatus', opts.taskStatus)
  if (opts?.search && opts.search.trim()) q.set('search', opts.search.trim())
  if (opts?.limit != null) q.set('limit', String(opts.limit))
  if (opts?.offset != null) q.set('offset', String(opts.offset))
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

export const adminOrdersHttpAdapter: AdminOrdersServiceInterface = {
  listOrders(opts) {
    return unwrap(request<{ data: AdminOrdersListResponse }>('GET', `/admin/orders${buildQuery(opts)}`))
  },
  getOrder(id) {
    return unwrap(request<{ data: AdminOrderDetail }>('GET', `/admin/orders/${encodeURIComponent(id)}`))
  },
  updateOrderStatus(id, changes) {
    return unwrap(request<{ data: AdminOrderDetail }>('PATCH', `/admin/orders/${encodeURIComponent(id)}/status`, changes))
  },
  refundOrder(id, reason) {
    return unwrap(request<{ data: AdminOrderDetail }>('POST', `/admin/orders/${encodeURIComponent(id)}/refund`, { reason }))
  },
}

// ─── Mock adapter(无后端时本地演示,字段形状与后端一致)─────────────────────────
// 与真实后端一致:amountCents 恒为 0(未计费),payStatus 默认 unpaid。

interface MockOrder extends AdminOrderListItem {
  refundReason: string | null
  updatedAt: string
  print: AdminOrderPrintDetail
  statusLogs: AdminOrderStatusLog[]
}

function seedMockOrders(): MockOrder[] {
  const mk = (
    n: number, type: string, userLabel: string, endUserId: string | null,
    terminalCode: string | null, terminalId: string | null,
    payStatus: string, taskStatus: string, createdAt: string,
    print: Partial<AdminOrderPrintDetail>, logs: AdminOrderStatusLog[],
  ): MockOrder => ({
    id: `mo-${n}`,
    orderNo: `ORD-20260609-${String(n).padStart(6, '0')}`,
    type,
    endUserId,
    userLabel,
    terminalId,
    terminalCode,
    amountCents: 0,
    currency: 'CNY',
    payStatus,
    taskStatus,
    refundedAt: payStatus === 'refunded' ? '2026-06-09T03:20:00.000Z' : null,
    refundReason: payStatus === 'refunded' ? '用户取消，柜台退现' : null,
    createdAt,
    updatedAt: createdAt,
    print: {
      status: taskStatus,
      fileName: '简历_示例.pdf',
      copies: 1,
      colorMode: 'black_white',
      duplex: 'simplex',
      paperSize: 'A4',
      pageRange: null,
      createdAt,
      completedAt: taskStatus === 'completed' ? createdAt : null,
      errorCode: taskStatus === 'failed' ? 'PRINT_DEVICE_ERROR' : null,
      errorMessage: taskStatus === 'failed' ? '打印机报错（示例）' : null,
      ...print,
    },
    statusLogs: logs,
  })
  return [
    mk(1, 'print', '游客', null, 'KSK-001', 't-001', 'unpaid', 'completed', '2026-06-09T01:12:00.000Z',
      { fileName: '王某某_简历.pdf', copies: 2, colorMode: 'color' },
      [{ fromStatus: 'pending', toStatus: 'claimed', errorCode: null, createdAt: '2026-06-09T01:12:30.000Z' },
       { fromStatus: 'claimed', toStatus: 'printing', errorCode: null, createdAt: '2026-06-09T01:13:00.000Z' },
       { fromStatus: 'printing', toStatus: 'completed', errorCode: null, createdAt: '2026-06-09T01:13:40.000Z' }]),
    mk(2, 'print', '会员', 'eu-mock-1', 'KSK-002', 't-002', 'paid', 'completed', '2026-06-09T02:05:00.000Z',
      { fileName: '求职信.pdf' }, []),
    mk(3, 'print', '游客', null, null, null, 'unpaid', 'pending', '2026-06-09T02:40:00.000Z', {}, []),
    mk(4, 'print', '游客', null, 'KSK-001', 't-001', 'failed', 'failed', '2026-06-09T03:00:00.000Z', {}, []),
    mk(5, 'print', '会员', 'eu-mock-2', 'KSK-003', 't-003', 'refunded', 'cancelled', '2026-06-08T08:20:00.000Z', {}, []),
  ]
}

let mockStore: MockOrder[] | null = null
function getStore(): MockOrder[] {
  if (!mockStore) mockStore = seedMockOrders()
  return mockStore
}
const delay = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms))

function toDetail(o: MockOrder): AdminOrderDetail {
  return { ...o, print: { ...o.print }, statusLogs: o.statusLogs.map((l) => ({ ...l })) }
}

export const adminOrdersMockAdapter: AdminOrdersServiceInterface = {
  async listOrders(opts) {
    await delay()
    let rows = getStore()
    if (opts?.type) rows = rows.filter((o) => o.type === opts.type)
    if (opts?.payStatus) rows = rows.filter((o) => o.payStatus === opts.payStatus)
    if (opts?.taskStatus) rows = rows.filter((o) => o.taskStatus === opts.taskStatus)
    if (opts?.search && opts.search.trim()) {
      const s = opts.search.trim().toUpperCase()
      rows = rows.filter((o) => o.orderNo.toUpperCase().includes(s))
    }
    const total = rows.length
    const limit = opts?.limit ?? 50
    const offset = opts?.offset ?? 0
    const items = rows.slice(offset, offset + limit).map(({ print, statusLogs, refundReason, updatedAt, ...rest }) => {
      void print; void statusLogs; void refundReason; void updatedAt
      return { ...rest }
    })
    return { items, total, limit, offset }
  },
  async getOrder(id) {
    await delay()
    const o = getStore().find((x) => x.id === id)
    if (!o) throw new ApiHttpError('ORDER_NOT_FOUND', '订单不存在', 404)
    return toDetail(o)
  },
  async updateOrderStatus(id, changes) {
    await delay()
    const o = getStore().find((x) => x.id === id)
    if (!o) throw new ApiHttpError('ORDER_NOT_FOUND', '订单不存在', 404)
    if (changes.payStatus === undefined && changes.taskStatus === undefined) {
      throw new ApiHttpError('ORDER_NO_STATUS_CHANGE', '请至少提供 payStatus 或 taskStatus 之一', 400)
    }
    if (changes.payStatus !== undefined) {
      if (o.payStatus === 'refunded') throw new ApiHttpError('ORDER_ALREADY_REFUNDED', '订单已标记退款，支付状态不可再变更', 400)
      o.payStatus = changes.payStatus
    }
    if (changes.taskStatus !== undefined) o.taskStatus = changes.taskStatus // 仅改 Order 运营视图列
    o.updatedAt = '2026-06-09T12:00:00.000Z'
    return toDetail(o)
  },
  async refundOrder(id, reason) {
    await delay()
    const o = getStore().find((x) => x.id === id)
    if (!o) throw new ApiHttpError('ORDER_NOT_FOUND', '订单不存在', 404)
    if (o.payStatus !== 'paid') throw new ApiHttpError('ORDER_NOT_REFUNDABLE', `仅已支付订单可标记退款（当前：${o.payStatus}）`, 400)
    o.payStatus = 'refunded'
    o.refundReason = reason
    o.refundedAt = '2026-06-09T12:00:00.000Z'
    o.updatedAt = '2026-06-09T12:00:00.000Z'
    return toDetail(o)
  },
}

// ─── Selector(编译期按 VITE_API_MODE 选择,与 files.ts 同模式)──────────────────

const adapter: AdminOrdersServiceInterface =
  API_MODE === 'http' ? adminOrdersHttpAdapter : adminOrdersMockAdapter

export const listOrders = (opts?: ListOrdersOptions) => adapter.listOrders(opts)
export const getOrder = (id: string) => adapter.getOrder(id)
export const updateOrderStatus = (id: string, changes: UpdateOrderStatusChanges) =>
  adapter.updateOrderStatus(id, changes)
export const refundOrder = (id: string, reason: string) => adapter.refundOrder(id, reason)
