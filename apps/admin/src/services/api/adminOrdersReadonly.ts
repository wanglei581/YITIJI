import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import { currentHoldDemo, queryHoldDemo, registerHoldDemo, resolveHoldDemo } from './adminOrdersHoldDemo'
import { findServiceDemo, refundServiceDemo, retryServiceDemoRefund, serviceDemoPage } from './adminOrdersServiceDemo'
import type { ChannelResultRegistrationInput, ChannelResultRegistrationOutcome, QueryPrintReturnChannelOutcome } from './adminOrdersRegistration'

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
   * 运营必须看见的单：待退款、退款中、渠道已受理但本地确认未落地、部分退款、已出纸且退款失败、待人工。
   * 只读信号，不自动出款、不改 payStatus。字段与取值照抄后端
   * `services/api/src/admin-orders-readonly/admin-orders-readonly.types.ts`，
   * 前端不自行推导。
   *
   * 两个字段刻意可选：存量后端（未部署本次只读视图）不返回它们，此时页面
   * 必须什么都不显示，而不是把 `undefined` 当成 false 去编一个「一切正常」。
   */
  opsAttention?: boolean
  opsAttentionCode?: 'refund_required' | 'refunding' | 'channel_accepted_unconfirmed' | 'partial_refunded' | 'paper_refund_failed' | 'print_return_manual' | null
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
  autoRefund: boolean
  refundStatus: string | null
  refundFailureReason: string | null
  printRefundDisposition: 'auto_success' | 'auto_failed' | 'manual' | null
  printRefundReason: string | null
  refundLedgerNo: string | null
  refundLedgerCents: number | null
  /** 应付额（分）。服务端按退款公式算好，按钮只展示这个数。 */
  payableCents: number
  /** 部分退款还没退完的金额（分）。不是部分退款时为 null。 */
  refundRemainderCents?: number | null
  /** 有渠道受理过、还没落定的退款（与服务端三步处置同一个判断）。为 true 时三步按钮都禁用。服务单不返回。 */
  channelInFlight?: boolean
  /** 长期查不到渠道结果、可以按商户平台核实结果登记的那一笔。服务单不返回。 */
  channelResultRegistration?: { refundNo: string; amountCents: number; submittedAt: string } | null
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

export interface PrintReturnResolutionResult {
  orderId: string
  payStatus: string
  refundStatus: string
  taskStatus: string
  refundNo: string
  amountCents: number
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
  resolvePrintReturnHold(id: string, action: 'confirm-refunded' | 'release-paper' | 'close'): Promise<PrintReturnResolutionResult>
  queryPrintReturnChannel(id: string): Promise<QueryPrintReturnChannelOutcome>
  refundAfterPaperCheck(id: string, refundReason: string): Promise<AdminOrderRefundResult>
  registerChannelResult(id: string, input: ChannelResultRegistrationInput): Promise<ChannelResultRegistrationOutcome>
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
  resolvePrintReturnHold: (id, action) =>
    post<PrintReturnResolutionResult>(`/admin/orders/${encodeURIComponent(id)}/print-return/${action}`, {}),
  queryPrintReturnChannel: (id) =>
    post<QueryPrintReturnChannelOutcome>(`/admin/orders/${encodeURIComponent(id)}/print-return/query-channel`, {}),
  refundAfterPaperCheck: (id, refundReason) =>
    post<AdminOrderRefundResult>(`/admin/orders/${encodeURIComponent(id)}/refund-after-paper-check`, { refundReason }),
  registerChannelResult: (id, input) =>
    post<ChannelResultRegistrationOutcome>(`/admin/orders/${encodeURIComponent(id)}/print-return/register-channel-result`, input),
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
  payableCents: 0,
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
  autoRefund: false,
  refundStatus: null,
  refundFailureReason: null,
  printRefundDisposition: null,
  printRefundReason: null,
  refundLedgerNo: null,
  refundLedgerCents: null,
  refundRemainderCents: null,
  channelInFlight: false,
  // 契约门禁要求把服务端可能返回的嵌套字段写全。这张单不在待人工，页面不会显示登记入口。
  channelResultRegistration: { refundNo: 'RFD-MOCK-REGISTRATION', amountCents: 0, submittedAt: now() },
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
    payableCents: scenario === 'zero' ? 0 : 100,
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


const mockAdapter: AdminOrdersReadonlyService = {
  async list(params) {
    if (params.recordKind === 'service') return serviceDemoPage(params)
    const refundDetail = demoRefundDetail()
    const holdDetail = currentHoldDemo()
    const items = [mockDetailState, MOCK_UNRECORDED_DETAIL, ...(refundDetail ? [refundDetail] : []), ...(holdDetail ? [holdDetail] : [])]
    return {
      items,
      pagination: { page: params.page, pageSize: params.pageSize, total: items.length, totalPages: 1 },
    }
  },
  async getById(id) {
    const service = findServiceDemo(id)
    if (service) return service
    const refundDetail = demoRefundDetail()
    if (refundDetail?.id === id) return refundDetail
    const holdDetail = currentHoldDemo()
    if (holdDetail?.id === id) return holdDetail
    return id === MOCK_UNRECORDED_DETAIL.id ? MOCK_UNRECORDED_DETAIL : mockDetailState
  },
  async retryServiceRefund(id) {
    return retryServiceDemoRefund(id)
  },
  async refundServiceOrder(id) {
    return refundServiceDemo(id)
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
  async resolvePrintReturnHold(id, action) {
    const held = resolveHoldDemo(id, action)
    if (held) return held
    if (!mockDetailState.refundLedgerNo) {
      throw new ApiHttpError('REFUND_HOLD_NOT_FOUND', '没有待人工处理的退款，不能做这一步。', 400)
    }
    const payStatus = action === 'confirm-refunded' ? 'refunded' : action === 'close' ? 'closed' : 'paid'
    const refundStatus = action === 'confirm-refunded' ? 'success' : action === 'close' ? 'closed' : 'withdrawn'
    mockDetailState = {
      ...mockDetailState,
      payStatus,
      refundStatus,
      refundEligible: false,
      printRefundDisposition: null,
      updatedAt: now(),
    }
    return {
      orderId: id,
      payStatus,
      refundStatus,
      taskStatus: action === 'release-paper' ? 'pending' : 'cancelled',
      refundNo: mockDetailState.refundLedgerNo ?? '',
      amountCents: mockDetailState.refundLedgerCents ?? 0,
    }
  },
  async queryPrintReturnChannel(id) {
    return queryHoldDemo(id) ?? { orderId: id, outcome: 'no_in_flight', payStatus: mockDetailState.payStatus, refundStatus: mockDetailState.refundStatus, channelInFlight: false, checkedCount: 0, message: '这单目前没有渠道在途退款，无需查询。' }
  },
  async refundAfterPaperCheck(_id, refundReason) {
    return mockAdapter.refundOrder(_id, refundReason)
  },
  async registerChannelResult(id, input) {
    const held = registerHoldDemo(id, input)
    if (held) return held
    throw new ApiHttpError('REGISTRATION_NOT_IN_FLIGHT', '这笔退款不在渠道处理中，不用登记。请刷新后再看。', 400)
  },
}

export const adminOrdersReadonlyService: AdminOrdersReadonlyService =
  API_MODE === 'http' ? httpAdapter : mockAdapter
