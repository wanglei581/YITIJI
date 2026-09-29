// ============================================================
// Print Jobs API — W6
//
// Thin fetch wrappers around:
//   POST /api/v1/print/jobs          — create a job, get taskId
//   GET  /api/v1/print/jobs/:taskId  — poll task status
//
// Only used when API_MODE === 'http' and file.fileUrl is set.
// Callers should handle errors (network failure, 404, etc.)
// and fall back to simulation as needed.
// ============================================================

import { API_BASE_URL } from '../api/client'
import { ApiHttpError } from '../api/httpAdapter'
import { getTerminalId } from '../api/screensaver'
import { networkError, throwHttpError } from '../api/throwHttpError'
import { terminalProtectedFetch } from '../terminalAuth'
import type {
  BillingPageSource,
  OrderPayStatus,
  PrintJobParams,
  PrintJobRetryResult,
  PrintJobTakeawayUrl,
  PrintPriceLine,
} from '@ai-job-print/shared'

export interface CreatePrintJobInput {
  fileUrl:   string
  /**
   * 文件哈希（hex）。方案②：字段名保留 `fileMd5`，但应传入上传返回的 **SHA-256**
   * （KioskUploadResult.sha256）。后端原样存储，Terminal Agent 用 SHA-256 比对。
   */
  fileMd5?:  string
  fileName?: string
  params:    PrintJobParams
  /**
   * 用户在确认页看到并确认的应付金额（分）。服务端只拿它做一致性断言、绝不按它计价；
   * 与服务端按最终文件重算的金额不一致 → 409，抛 PrintPriceChangedError，本次不建单。
   */
  quotedAmountCents: number
  token?:    string | null
}

export interface PrintJobCreated {
  taskId:    string
  status:    string
  createdAt: string
  // ── C5-3 收银/履约衔接（后端 additive 返回；镜像 print-jobs.service PrintJobCreated）──
  /** 关联订单 id（收银出码 / 支付轮询用；不可猜 cuid，鉴权口径同 taskId）。 */
  orderId:   string
  /** 运营订单号（展示用）。 */
  orderNo:   string
  /** 应付金额（分），>= 0；0 表示免费单（已 paid）。Kiosk 据此分流：>0 进收银页，==0 直接履约。 */
  amountCents: number
  /** 建单即时支付状态：付费单 `unpaid`，免费单 `paid`（free）。 */
  payStatus: OrderPayStatus
  /** 计费明细快照（收银页「价目明细」展示）。 */
  priceLines: PrintPriceLine[]
  /** 后端识别的计费页数。 */
  billablePages: number
  /** 计费页数来源。 */
  billingPageSource: BillingPageSource
  /** 短期支付会话 token：只用于本次订单出码 / 支付状态查询。 */
  paymentSessionToken: string
  /** 建单时后端是否认了会员会话；不能用本机 token 自行判断。 */
  hasEndUser: boolean
}

/** Backend status values — subset of shared PrintTaskStatus */
/** Backend status values — subset of shared PrintTaskStatus plus admin abandoned. */
export type BackendJobStatus =
  | 'pending'
  | 'claimed'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'abandoned'

export interface PrintJobStatusResult {
  taskId:        string
  status:        BackendJobStatus
  errorCode?:    string
  /**
   * 后端已收口为**安全用户文案**（不再是 Agent 原始错误）。展示失败原因时优先用
   * `failureReasonForUser`，本字段仅作兼容保留，不应直接透出。
   */
  errorMessage?: string
  /** 后端下发的安全中文失败原因（仅失败时有值）。前台展示失败原因的首选来源。 */
  failureReasonForUser?: string
  completedAt?:  string
  /** 关联文件保留字段是否读取到。取不到时前台不得编造保留时长。 */
  fileRetentionAvailable?: boolean
  fileExpiresAt?: string | null
  fileRetentionPolicy?: string | null
  fileDeletedAt?: string | null
  fileDeleteReason?: string | null
  fileStorageDeletedAt?: string | null
}

/** POST /orders/quote 响应（与后端 PrintPriceQuote 对齐；金额为分）。 */
export interface PrintOrderQuote {
  amountCents: number
  billablePages: number
  billingPageSource: BillingPageSource
  priceLines: PrintPriceLine[]
}

export interface QuotePrintOrderInput {
  fileUrl: string
  params: PrintJobParams
  /** 彩色 / 双面报价必填：后端据此按该终端的能力登记 fail-closed 复核。 */
  terminalId?: string
}

/** DTO 只接受数字页码范围；'all' / 空串统一成 undefined，与建单口径一致。 */
function normalizePrintParams(params: PrintJobParams): PrintJobParams {
  const pageRange =
    !params.pageRange || params.pageRange === 'all' ? undefined : params.pageRange
  return { ...params, pageRange }
}

/**
 * 打印计价预览（不落库）。金额 / 计费页数以后端为准，绝不信任本地估算。
 * 仅 API_MODE=http 且有真实签名 fileUrl 时调用。
 */
export async function quotePrintOrder(input: QuotePrintOrderInput): Promise<PrintOrderQuote> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/orders/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileUrl: input.fileUrl,
        params: normalizePrintParams(input.params),
        ...(input.terminalId ? { terminalId: input.terminalId } : {}),
      }),
    })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) await throwHttpError(res)
  const body = (await res.json()) as PrintOrderQuote & { lines?: PrintPriceLine[]; data?: PrintOrderQuote & { lines?: PrintPriceLine[] } }
  // 兼容裸对象与偶发 ApiResponse 包装；契约字段为 lines（后端）→ 前端统一成 priceLines。
  const raw = body.data ?? body
  const lines = raw.priceLines ?? raw.lines ?? []
  return {
    amountCents: raw.amountCents,
    billablePages: raw.billablePages,
    billingPageSource: raw.billingPageSource,
    priceLines: lines,
  }
}

/** 409 PRICE_CHANGED 带回的服务端现价（按最终打印文件重算）。 */
export type PrintPriceChangedQuote = Pick<PrintOrderQuote, 'amountCents' | 'billablePages' | 'priceLines'>

/**
 * 服务端重算金额与用户确认的不一致，本次**没有**建单、没有支付会话。
 * `currentQuote` 解析不出时为 null：调用方必须重新报价，不得沿用旧价，也不得自动重试建单。
 */
export class PrintPriceChangedError extends ApiHttpError {
  constructor(message: string, public readonly currentQuote: PrintPriceChangedQuote | null) {
    super('PRICE_CHANGED', message, 409)
    this.name = 'PrintPriceChangedError'
  }
}

/** 解析 details 里的 `key=value` 串（格式见 services/api print-jobs.service 的 priceChanged）。 */
function parsePriceChangedQuote(details: unknown): PrintPriceChangedQuote | null {
  if (!Array.isArray(details)) return null
  const items = details.filter((d): d is string => typeof d === 'string')
  const intOf = (key: string): number | null => {
    const raw = items.find((d) => d.startsWith(`${key}=`))?.slice(key.length + 1)
    return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null
  }
  const priceLines: PrintPriceLine[] = []
  for (const item of items) {
    const m = /^line=([a-z_]+):(\d+):(\d+):(\d+)$/.exec(item)
    if (m) priceLines.push({ serviceKey: m[1]!, unitCents: Number(m[2]), quantity: Number(m[3]), subtotalCents: Number(m[4]) })
  }
  const amountCents = intOf('currentAmountCents')
  const billablePages = intOf('billablePages')
  if (amountCents === null || billablePages === null || priceLines.length === 0) return null
  // 明细对不上总额就当解析失败，宁可重新报价也不展示自相矛盾的价格。
  if (priceLines.reduce((sum, line) => sum + line.subtotalCents, 0) !== amountCents) return null
  return { amountCents, billablePages, priceLines }
}

export async function createPrintJob(input: CreatePrintJobInput): Promise<PrintJobCreated> {
  const { token, ...body } = input
  const terminalId = getTerminalId()
  if (!terminalId) {
    throw new ApiHttpError('TERMINAL_NOT_READY', '本机设备未就绪，请联系现场工作人员后再试', 0)
  }
  let res: Response
  try {
    res = await terminalProtectedFetch(`${API_BASE_URL}/print/jobs`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body:    JSON.stringify({ ...body, params: normalizePrintParams(body.params) }),
    })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) {
    if (res.status === 409) {
      const conflict = (await res.clone().json().catch(() => null)) as
        | { error?: { code?: string; message?: string; details?: unknown } }
        | null
      if (conflict?.error?.code === 'PRICE_CHANGED') {
        throw new PrintPriceChangedError(
          conflict.error.message || '价格已更新，请核对新价格后再确认',
          parsePriceChangedQuote(conflict.error.details),
        )
      }
    }
    await throwHttpError(res, token)
  }
  return res.json() as Promise<PrintJobCreated>
}

function paymentSessionHeaders(
  paymentSessionToken?: string | null,
  token?: string | null,
): Record<string, string> {
  return {
    ...(paymentSessionToken ? { 'x-payment-session-token': paymentSessionToken } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function issuePrintJobTakeawayUrl(input: {
  taskId: string
  paymentSessionToken?: string | null
  token?: string | null
}): Promise<PrintJobTakeawayUrl> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/print/jobs/${encodeURIComponent(input.taskId)}/takeaway-url`, {
      method: 'POST',
      headers: paymentSessionHeaders(input.paymentSessionToken, input.token),
    })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) await throwHttpError(res, input.token)
  return res.json() as Promise<PrintJobTakeawayUrl>
}

export async function retryPrintJob(input: {
  taskId: string
  paymentSessionToken?: string | null
  token?: string | null
}): Promise<PrintJobRetryResult> {
  const terminalId = getTerminalId()
  if (!terminalId) {
    throw new ApiHttpError('TERMINAL_NOT_READY', '本机设备未就绪，请联系现场工作人员后再试', 0)
  }
  let res: Response
  try {
    res = await terminalProtectedFetch(`${API_BASE_URL}/print/jobs/${encodeURIComponent(input.taskId)}/retry`, {
      method: 'POST',
      headers: paymentSessionHeaders(input.paymentSessionToken, input.token),
    })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) await throwHttpError(res, input.token)
  return res.json() as Promise<PrintJobRetryResult>
}

export async function getPrintJobStatus(taskId: string): Promise<PrintJobStatusResult> {
  // 限流按台计数用（后端 @TerminalScopedThrottle）。PrintProgressPage 每 3 秒轮询、
  // 最长 10 分钟；不带这个头时同一大厅第 3 台机器就会把 IP 桶打满，前端会把 429
  // 显示成「无法连接打印服务」。
  //
  // 与 createPrintJob 不同，这里**不**因缺少终端身份而抛错：查状态不需要设备身份，
  // 硬要求会把「Agent 未就绪」变成看不到打印进度。取不到就不发，后端退化回按 IP 计数。
  const terminalId = getTerminalId()
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/print/jobs/${taskId}`, {
      headers: terminalId ? { 'X-Terminal-Id': terminalId } : {},
    })
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) await throwHttpError(res)
  return res.json() as Promise<PrintJobStatusResult>
}
