import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type AdminOrderAftercareStatus = 'manual_check_required' | null

export interface AdminOrderReadonlyItem {
  id: string
  orderNo: string
  type: string
  ownerType: 'member' | 'anonymous'
  userLabel: string
  terminalCode: string | null
  amountCents: number
  currency: string
  /** 下单渠道：kiosk | miniapp_cloud；null = 存量单，必须显示「未标注」不得猜成一体机 */
  channel: string | null
  /** 取件状态：一体机单恒 none（现场即时出纸，业务上无取件环节） */
  pickupStatus: string
  pickupCodeExpiresAt: string | null
  payStatus: string
  taskStatus: string
  printFileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
  errorCode: string | null
  printOutcome: 'printed' | 'not_printed' | null
  aftercareStatus: AdminOrderAftercareStatus
  refundEligible: boolean
  retryForbidden: boolean
  createdAt: string
  updatedAt: string
}

export interface AdminOrderReadonlyDetail extends AdminOrderReadonlyItem {
  refundedAt: string | null
  refundReason: string | null
  discountCents: number
  refundedAmountCents: number
  /** PrintTask.id（废弃孤单入口使用；非文件链接，不含敏感信息）。 */
  printTaskId: string | null
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

/**
 * 线下 / 人工确认收款的合法来源。
 *
 * 后端 `AdminMarkPaidDto` 用 `@IsIn(['offline','manual_confirmed'])` 钉死，
 * `AdminOrderActionsController` 再用 `ADMIN_ALLOWED_PAYMENT_SOURCES` 做一层防御。
 * `free` 只由 0 元建单自动产生，`wechat / alipay / sandbox / voucher` 各有专属入账路径，
 * **本前端绝不新增取值**。
 */
export type AdminOrderMarkPaidSource = 'offline' | 'manual_confirmed'

/**
 * `POST /admin/orders/:id/mark-paid` 的返回。
 *
 * 后端返回的是完整 Order 行（含 `pickupCode` / `paidBy` 等只读订单视图刻意裁掉的列）。
 * 这里**只声明本页会读的入账结论字段**，避免把那些列重新带进 Admin 前端。
 * 入账结果一律以这些服务端值为准，前端不推断、不本地拼接。
 */
export interface AdminOrderMarkPaidResult {
  payStatus: string
  paymentSource: string | null
  paidAt: string | null
}

export interface AdminOrderRefundResult {
  refund: {
    refundNo: string
    amountCents: number
    status: string
    channel: string
    channelRefundNo: string | null
    reason: string | null
    createdAt: string
  }
  order: { orderNo: string; payStatus: string; refundedAmountCents: number; refundedAt: string | null }
  idempotent: boolean
}

interface AdminOrdersReadonlyService {
  list(params: ListAdminOrdersReadonlyParams): Promise<AdminOrderReadonlyPage>
  getById(id: string): Promise<AdminOrderReadonlyDetail>
  refundOrder(id: string, refundReason: string): Promise<AdminOrderRefundResult>
  /** 线下 / 人工确认收款入账；仅 `payStatus==='unpaid'` 的订单可成功，其余由后端拒绝并回错误码。 */
  markPaidOrder(id: string, paymentSource: AdminOrderMarkPaidSource): Promise<AdminOrderMarkPaidResult>
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
      const body2 = (await res.json()) as { error?: { code?: string; message?: string } }
      if (body2.error?.code) code = body2.error.code
      if (body2.error?.message) message = body2.error.message
    } catch { /* keep defaults */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
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
  refundOrder: (id, refundReason) =>
    post<AdminOrderRefundResult>(`/admin/orders/${encodeURIComponent(id)}/refund`, { refundReason }),
  markPaidOrder: (id, paymentSource) =>
    post<AdminOrderMarkPaidResult>(`/admin/orders/${encodeURIComponent(id)}/mark-paid`, { paymentSource }),
}

const now = () => new Date().toISOString()

const MOCK_DETAIL: AdminOrderReadonlyDetail = {
  id: 'ord_mock_1',
  orderNo: 'ORD-20260625-MOCKREAD',
  type: 'print',
  ownerType: 'member',
  userLabel: '演示会员',
  terminalCode: 'KSK-001',
  // mock 用 null 而非 'kiosk'：让 mock 模式下也能看到「未标注」这个真实存在的存量态，
  // 避免开发期误以为所有单都有渠道。
  channel: null,
  pickupStatus: 'none',
  pickupCodeExpiresAt: null,
  amountCents: 0,
  currency: 'CNY',
  payStatus: 'unpaid',
  taskStatus: 'completed',
  printFileName: '演示简历.pdf',
  copies: 2,
  colorMode: 'black_white',
  paperSize: 'A4',
  errorCode: null,
  printOutcome: null,
  aftercareStatus: null,
  refundEligible: false,
  retryForbidden: false,
  createdAt: now(),
  updatedAt: now(),
  refundedAt: null,
  refundReason: null,
  discountCents: 0,
  refundedAmountCents: 0,
  printTaskId: null,
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

/**
 * mock 模式下的可变订单态。
 *
 * mock 的 `getById` 原本恒返回同一份冻结对象，若收款入账后仍读回 `unpaid`，
 * 界面会出现「提示已入账、状态却还是未支付」的假象。开发期看到的状态必须和
 * 刚刚执行的动作自洽 —— 但这仍然只是本地假数据，**不能当作端点已验证**。
 */
let mockDetailState: AdminOrderReadonlyDetail = { ...MOCK_DETAIL }
/** 只读订单视图不返回 paymentSource（真实后端亦然），mock 单独记一份用于复刻幂等/冲突分支。 */
let mockPaymentSource: AdminOrderMarkPaidSource | null = null

const mockAdapter: AdminOrdersReadonlyService = {
  async list(params) {
    return {
      items: [mockDetailState],
      pagination: { page: params.page, pageSize: params.pageSize, total: 1, totalPages: 1 },
    }
  },
  async getById() {
    return mockDetailState
  },
  async markPaidOrder(_id, paymentSource) {
    // 复刻后端状态机：仅 unpaid 可入账；已 paid 同来源幂等回放，异来源冲突。
    if (mockDetailState.payStatus === 'paid') {
      if (mockPaymentSource === paymentSource) {
        return { payStatus: 'paid', paymentSource, paidAt: mockDetailState.updatedAt }
      }
      throw new ApiHttpError('ORDER_ALREADY_PAID', '订单已入账', 400)
    }
    if (mockDetailState.payStatus !== 'unpaid') {
      throw new ApiHttpError('ORDER_INVALID_TRANSITION', '当前状态不可入账', 400)
    }
    const paidAt = now()
    mockPaymentSource = paymentSource
    mockDetailState = { ...mockDetailState, payStatus: 'paid', refundEligible: true, updatedAt: paidAt }
    return { payStatus: 'paid', paymentSource, paidAt }
  },
  async refundOrder(_id, refundReason) {
    const refundedAt = now()
    // list/getById 现在读可变态，退款也必须落回同一份，否则会出现「已退款却仍显示已支付」。
    mockDetailState = {
      ...mockDetailState,
      payStatus: 'refunded',
      refundEligible: false,
      refundedAt,
      refundReason,
      refundedAmountCents: mockDetailState.amountCents,
      updatedAt: refundedAt,
    }
    return {
      refund: {
        refundNo: `RFD-${MOCK_DETAIL.orderNo}`,
        amountCents: 0,
        status: 'success',
        channel: 'offline',
        channelRefundNo: null,
        reason: refundReason,
        createdAt: refundedAt,
      },
      order: { orderNo: MOCK_DETAIL.orderNo, payStatus: 'refunded', refundedAmountCents: 0, refundedAt },
      idempotent: false,
    }
  },
}

export const adminOrdersReadonlyService: AdminOrdersReadonlyService =
  API_MODE === 'http' ? httpAdapter : mockAdapter
