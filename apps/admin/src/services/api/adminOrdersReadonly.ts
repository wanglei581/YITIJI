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
  /** 订单原始计费内容页数，不含份数；多文件为各文件选中页数之和。 */
  billablePages: number | null
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
  refundRequired: boolean
  /**
   * 运营必须看见的三类单：待退款、退款中、渠道已受理但本地确认未落地。
   * 只读信号，不自动出款、不改 payStatus。字段与取值照抄后端
   * `services/api/src/admin-orders-readonly/admin-orders-readonly.types.ts`，
   * 前端不新增第四类取值、不自行推导。
   *
   * 两个字段刻意可选：存量后端（未部署本次只读视图）不返回它们，此时页面
   * 必须什么都不显示，而不是把 `undefined` 当成 false 去编一个「一切正常」。
   */
  opsAttention?: boolean
  opsAttentionCode?: 'refund_required' | 'refunding' | 'channel_accepted_unconfirmed' | null
  createdAt: string
  updatedAt: string
  /** 服务单才有。缺省表示打印订单，列表默认不出现。 */
  recordKind?: 'service'
  serviceKey?: string
  serviceName?: string
  serviceStatus?: string
  paidAt?: string | null
  refundAttempts?: number
  failureReason?: string | null
  closeReason?: string | null
  locationLabel?: string | null
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
  /** 只看一体机服务单。不传时仍是打印订单。 */
  recordKind?: 'service'
  serviceStatus?: string
  refundRequired?: boolean
  /**
   * 需运营关注（服务端 opsAttention 的三支 OR）。
   *
   * **绝不能与 payStatus 一起钉死**：`channel_accepted_unconfirmed` 的订单
   * payStatus 是 paying/closed 而不是 paid（渠道收了钱、本地没转成已支付），
   * 钉死 payStatus=paid 会把这一整类静默挡在筛选外 —— 页面不报错，只是查不到。
   * 这与 refundRequired 上踩过的坑是同一个，见 routes/orders/index.tsx 的长注释。
   */
  opsAttention?: boolean
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
  retryServiceRefund(id: string): Promise<AdminOrderReadonlyDetail>
  /** 卡住的已付或未结案服务单。必须二次确认后才发，请求体带 confirm:true。 */
  refundServiceOrder(id: string): Promise<AdminOrderReadonlyDetail>
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
      refundRequired: params.refundRequired ? 'true' : undefined,
      opsAttention: params.opsAttention ? 'true' : undefined,
      recordKind: params.recordKind,
      serviceStatus: params.serviceStatus,
      page: String(params.page),
      pageSize: String(params.pageSize),
    }),
  getById: (id) => get<AdminOrderReadonlyDetail>(`/admin/orders/${encodeURIComponent(id)}`),
  retryServiceRefund: (id) => post<AdminOrderReadonlyDetail>(`/admin/orders/${encodeURIComponent(id)}/retry-service-refund`, {}),
  refundServiceOrder: (id) => post<AdminOrderReadonlyDetail>(`/admin/orders/${encodeURIComponent(id)}/refund-service`, { confirm: true }),
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
  billablePages: 4,
  printFileName: '演示简历.pdf',
  copies: 2,
  colorMode: 'black_white',
  paperSize: 'A4',
  errorCode: null,
  printOutcome: null,
  aftercareStatus: null,
  refundEligible: false,
  retryForbidden: false,
  refundRequired: false,
  // mock 不造运营关注信号：假的待退款单会让开发期误以为链路已验证。
  opsAttention: false,
  opsAttentionCode: null,
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

/** 存量订单未记录计费页数，供列表和详情验证空值展示。 */
const MOCK_UNRECORDED_DETAIL: AdminOrderReadonlyDetail = {
  ...MOCK_DETAIL,
  id: 'ord_mock_unrecorded',
  orderNo: 'ORD-20260625-UNRECORDED',
  billablePages: null,
  payStatus: 'closed',
}

/** 按需启用同一条演示订单的退款场景，不改变默认列表和原有收款/退款模拟行为。 */
function demoRefundDetail(): AdminOrderReadonlyDetail | null {
  let scenario: string | null = null
  try { scenario = localStorage.getItem('mock:order-refund') } catch { /* 未启用演示场景 */ }
  if (!['zero', 'paid', 'pending-refund'].includes(scenario ?? '')) return null
  const createdAt = '2026-11-05T09:30:00+08:00'
  return {
    ...MOCK_DETAIL,
    id: 'ord_mock_refund',
    orderNo: 'ORD-20261105-7A3C91E204',
    amountCents: scenario === 'zero' ? 0 : 100,
    payStatus: 'paid',
    taskStatus: 'failed',
    refundEligible: true,
    refundRequired: scenario === 'pending-refund',
    refundReason: scenario === 'pending-refund' ? 'PAID_UNFULFILLED_PENDING_REFUND' : null,
    printOutcome: 'not_printed',
    createdAt,
    updatedAt: '2026-11-05T09:31:00+08:00',
    print: { ...MOCK_DETAIL.print!, status: 'failed', createdAt, completedAt: null },
    statusLogs: [{ fromStatus: 'pending', toStatus: 'failed', errorCode: null, createdAt: '2026-11-05T09:31:00+08:00' }],
  }
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

/**
 * 演示服务单。金额只是演示数，不是价目。自营点位，青岛真实区名。
 * 默认列表不返回这些行，避免盖住原来的打印演示单。
 */
function demoServiceOrders(): AdminOrderReadonlyDetail[] {
  const paidAt = '2026-11-13T09:12:00+08:00'
  const base = {
    ownerType: 'anonymous' as const,
    userLabel: '现场用户',
    currency: 'CNY',
    channel: 'kiosk',
    pickupStatus: 'none',
    pickupCodeExpiresAt: null,
    billablePages: null,
    printFileName: null,
    copies: null,
    colorMode: null,
    paperSize: null,
    errorCode: null,
    printOutcome: null,
    aftercareStatus: null,
    refundEligible: false,
    refundRequired: false,
    discountCents: 0,
    printTaskId: null,
    print: null,
    statusLogs: [],
    recordKind: 'service' as const,
    createdAt: '2026-11-13T09:10:00+08:00',
    updatedAt: paidAt,
  }
  return [
    {
      ...base,
      id: 'svc_demo_used',
      orderNo: 'SVC-DEMO-SN-01',
      type: 'resume_optimize',
      serviceKey: 'resume_optimize',
      serviceName: 'AI 简历优化',
      serviceStatus: 'consumed',
      terminalCode: 'ZYD-SN-01',
      locationLabel: '市南 · 香港中路',
      amountCents: 100,
      payStatus: 'paid',
      taskStatus: 'completed',
      paidAt,
      refundReason: null,
      refundedAt: null,
      refundedAmountCents: 0,
      refundAttempts: 0,
      retryForbidden: true,
      opsAttention: false,
      opsAttentionCode: null,
      failureReason: null,
      closeReason: null,
    },
    {
      ...base,
      id: 'svc_demo_refunded',
      orderNo: 'SVC-DEMO-SB-02',
      type: 'scan',
      serviceKey: 'scan',
      serviceName: '扫描',
      serviceStatus: 'refunded',
      terminalCode: 'ZYD-SB-02',
      locationLabel: '市北 · 辽宁路',
      amountCents: 100,
      payStatus: 'refunded',
      taskStatus: 'cancelled',
      paidAt: '2026-11-13T10:02:00+08:00',
      refundReason: '扫描没出文件',
      refundedAt: '2026-11-13T10:14:00+08:00',
      refundedAmountCents: 100,
      refundAttempts: 0,
      retryForbidden: true,
      opsAttention: false,
      opsAttentionCode: null,
      failureReason: '扫描没出文件',
      closeReason: null,
      updatedAt: '2026-11-13T10:14:00+08:00',
    },
    {
      ...base,
      id: 'svc_demo_refunding',
      orderNo: 'SVC-DEMO-LC-03',
      type: 'mock_interview',
      serviceKey: 'mock_interview',
      serviceName: 'AI 模拟面试',
      serviceStatus: 'refunding',
      terminalCode: 'ZYD-LC-03',
      locationLabel: '李沧 · 九水路',
      amountCents: 200,
      payStatus: 'refunding',
      taskStatus: 'failed',
      paidAt: '2026-11-13T11:20:00+08:00',
      refundReason: '面试没开起来',
      refundedAt: null,
      refundedAmountCents: 0,
      refundAttempts: 2,
      retryForbidden: false,
      opsAttention: true,
      opsAttentionCode: 'refunding',
      failureReason: '面试没开起来',
      closeReason: null,
      updatedAt: '2026-11-13T11:28:00+08:00',
    },
    {
      ...base,
      id: 'svc_demo_paid',
      orderNo: 'SVC-DEMO-HD-04',
      type: 'scan',
      serviceKey: 'scan',
      serviceName: '扫描',
      serviceStatus: 'paid',
      terminalCode: 'ZYD-HD-04',
      locationLabel: '黄岛 · 长江路',
      amountCents: 100,
      payStatus: 'paid',
      taskStatus: 'pending',
      paidAt: '2026-11-13T12:05:00+08:00',
      refundReason: null,
      refundedAt: null,
      refundedAmountCents: 0,
      refundAttempts: 0,
      retryForbidden: true,
      opsAttention: false,
      opsAttentionCode: null,
      failureReason: null,
      closeReason: null,
      updatedAt: '2026-11-13T12:05:00+08:00',
    },
    {
      ...base,
      id: 'svc_demo_running',
      orderNo: 'SVC-DEMO-SN-05',
      type: 'scan',
      serviceKey: 'scan',
      serviceName: '扫描',
      serviceStatus: 'consumed',
      terminalCode: 'ZYD-SN-01',
      locationLabel: '市南 · 香港中路',
      amountCents: 100,
      payStatus: 'paid',
      taskStatus: 'in_progress',
      paidAt: '2026-11-13T12:20:00+08:00',
      refundReason: null,
      refundedAt: null,
      refundedAmountCents: 0,
      refundAttempts: 0,
      retryForbidden: true,
      opsAttention: false,
      opsAttentionCode: null,
      failureReason: null,
      closeReason: null,
      updatedAt: '2026-11-13T12:21:00+08:00',
    },
  ]
}

let serviceDemoState = demoServiceOrders()

const mockAdapter: AdminOrdersReadonlyService = {
  async list(params) {
    if (params.recordKind === 'service') {
      const items = serviceDemoState.filter((row) => {
        if (params.type && row.serviceKey !== params.type) return false
        if (params.serviceStatus && row.serviceStatus !== params.serviceStatus) return false
        if (params.search && !`${row.orderNo} ${row.terminalCode ?? ''} ${row.locationLabel ?? ''}`.includes(params.search)) return false
        return true
      })
      return {
        items,
        pagination: { page: params.page, pageSize: params.pageSize, total: items.length, totalPages: 1 },
      }
    }
    const refundDetail = demoRefundDetail()
    const items = [mockDetailState, MOCK_UNRECORDED_DETAIL, ...(refundDetail ? [refundDetail] : [])]
    return {
      items,
      pagination: { page: params.page, pageSize: params.pageSize, total: items.length, totalPages: 1 },
    }
  },
  async getById(id) {
    const service = serviceDemoState.find((row) => row.id === id)
    if (service) return service
    const refundDetail = demoRefundDetail()
    if (refundDetail?.id === id) return refundDetail
    return id === MOCK_UNRECORDED_DETAIL.id ? MOCK_UNRECORDED_DETAIL : mockDetailState
  },
  async retryServiceRefund(id) {
    const index = serviceDemoState.findIndex((row) => row.id === id)
    const row = index >= 0 ? serviceDemoState[index] : undefined
    if (!row || (row.serviceStatus !== 'refunding' && row.serviceStatus !== 'refund_failed')) {
      throw new ApiHttpError('SERVICE_REFUND_NOT_RETRYABLE', '这张单现在不在退款中', 409)
    }
    const refundedAt = now()
    const next: AdminOrderReadonlyDetail = {
      ...row,
      serviceStatus: 'refunded',
      payStatus: 'refunded',
      taskStatus: 'cancelled',
      refundedAt,
      refundedAmountCents: row.amountCents,
      opsAttention: false,
      opsAttentionCode: null,
      retryForbidden: true,
      updatedAt: refundedAt,
    }
    serviceDemoState = serviceDemoState.map((item, i) => (i === index ? next : item))
    return next
  },
  async refundServiceOrder(id) {
    const index = serviceDemoState.findIndex((row) => row.id === id)
    const row = index >= 0 ? serviceDemoState[index] : undefined
    const stuck = row?.serviceStatus === 'paid' || (row?.serviceStatus === 'consumed' && row.taskStatus === 'in_progress')
    if (!row || !stuck) {
      throw new ApiHttpError('SERVICE_REFUND_NOT_RETRYABLE', '这张单现在不能原路退款', 409)
    }
    const refundedAt = now()
    const next: AdminOrderReadonlyDetail = {
      ...row,
      serviceStatus: 'refunded',
      payStatus: 'refunded',
      taskStatus: 'cancelled',
      refundReason: '管理员原路退款',
      refundedAt,
      refundedAmountCents: row.amountCents,
      opsAttention: false,
      opsAttentionCode: null,
      retryForbidden: true,
      updatedAt: refundedAt,
    }
    serviceDemoState = serviceDemoState.map((item, i) => (i === index ? next : item))
    return next
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
      refundRequired: false,
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
