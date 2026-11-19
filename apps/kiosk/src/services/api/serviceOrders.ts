// ============================================================
// 一体机按次付款（服务单）客户端：建单、查单、关单，外加受费用接口要带的两个头和状态判定。
//
// 后端：services/api/src/payment/service-order.controller.ts，前缀 /api/v1/kiosk/service-orders，
// 只认终端验签身份（TerminalIdentityGuard）。查单与关单还要带 x-kiosk-session-id，
// 必须是建单时那一次使用的周期编号，对不上一律 404 SERVICE_ORDER_NOT_FOUND。
//
// 建单不幂等：每次 POST 都是新的一张。这一趟的订单号由 services/serviceTrip.ts 记在本机，
// 「再出一张码」是先关旧单再建新单。金额一律用建单返回的 amountCents，本文件不算价。
// 走 terminalProtectedFetch：付款是「没有已验签终端就必须失败」的请求，不降级成匿名。
// ============================================================
import type { ServiceOrderKey } from '@ai-job-print/shared'
import { terminalProtectedFetch } from '../terminalAuth'
import { API_BASE_URL, API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'
import { networkError, readHttpError } from './throwHttpError'

/** 与后端 service-order.service.ts 的 ServiceOrderView 逐字段一致。 */
export interface ServiceOrderView {
  id: string
  serviceKey: string
  serviceName: string
  status: string
  amountCents: number
  expiresAt: string
  qrCodeContent: string | null
  paidAt: string | null
  refundReason: string | null
  refundedAt: string | null
  failureReason: string | null
  retryUntil: string | null
  attemptsUsed: number
  settledAt: string | null
  closeReason: string | null
  paymentFailed: boolean
  checking: boolean
  consumedAt: string | null
  provider: string
}

/** 管理员改价、改向个人收费总开关、改绑机构时被关掉的待付单。屏上一律按「没付成，钱没有扣」。 */
export const SERVICE_ORDER_ADMIN_CLOSE_REASONS: ReadonlySet<string> = new Set([
  'price_changed',
  'personal_charge_changed',
  'org_rebound',
])

const REQUEST_TIMEOUT_MS = 15_000

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function strOrNull(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' ? value : undefined
}

/** 只接受形状完整的服务单视图；缺字段或类型不对就当没拿到，不拿半张单去画屏。 */
export function asServiceOrderView(value: unknown): ServiceOrderView | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = str(row.id)
  const serviceKey = str(row.serviceKey)
  const serviceName = str(row.serviceName)
  const status = str(row.status)
  const expiresAt = str(row.expiresAt)
  const provider = str(row.provider)
  const amountCents = row.amountCents
  const attemptsUsed = row.attemptsUsed
  if (!id || !serviceKey || !serviceName || !status || !expiresAt || !provider) return null
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents < 0) return null
  if (typeof attemptsUsed !== 'number' || !Number.isInteger(attemptsUsed) || attemptsUsed < 0) return null
  if (typeof row.paymentFailed !== 'boolean' || typeof row.checking !== 'boolean') return null
  const nullable = ['qrCodeContent', 'paidAt', 'refundReason', 'refundedAt', 'failureReason', 'retryUntil', 'settledAt', 'closeReason', 'consumedAt'] as const
  const picked: Partial<Record<(typeof nullable)[number], string | null>> = {}
  for (const key of nullable) {
    const read = strOrNull(row[key])
    if (read === undefined) return null
    picked[key] = read
  }
  return {
    id,
    serviceKey,
    serviceName,
    status,
    amountCents,
    expiresAt,
    qrCodeContent: picked.qrCodeContent ?? null,
    paidAt: picked.paidAt ?? null,
    refundReason: picked.refundReason ?? null,
    refundedAt: picked.refundedAt ?? null,
    failureReason: picked.failureReason ?? null,
    retryUntil: picked.retryUntil ?? null,
    attemptsUsed,
    settledAt: picked.settledAt ?? null,
    closeReason: picked.closeReason ?? null,
    paymentFailed: row.paymentFailed,
    checking: row.checking,
    consumedAt: picked.consumedAt ?? null,
    provider,
  }
}

/** 受费用接口（简历优化、开练、建扫描会话及同一趟的子调用）要带的两个头。终端头由取数层另加。 */
export function serviceOrderHeaders(trip: { orderId: string; kioskSessionId: string }): Record<string, string> {
  return {
    'x-kiosk-session-id': trip.kioskSessionId,
    'x-service-order-id': trip.orderId,
  }
}

async function send(path: string, init: { method: 'GET' | 'POST'; body?: unknown; kioskSessionId?: string }): Promise<ServiceOrderView> {
  if (API_MODE !== 'http') throw new ApiHttpError('MOCK_MODE', '当前为演示模式，未连接真实服务', 0)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.kioskSessionId) headers['x-kiosk-session-id'] = init.kioskSessionId
  let res: Response
  try {
    res = await terminalProtectedFetch(`${API_BASE_URL}/kiosk/service-orders${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
  } catch (error) {
    throw networkError(error)
  } finally {
    window.clearTimeout(timer)
  }
  if (!res.ok) {
    const { code, message } = await readHttpError(res)
    throw new ApiHttpError(code, message, res.status)
  }
  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  const view = asServiceOrderView((payload as { data?: unknown } | null)?.data)
  if (!view) throw new ApiHttpError('SERVICE_ORDER_UNREADABLE', '付款单读不出来', res.status)
  return view
}

/** 建单。每次调用都是新的一张；调用方要先关掉这一趟的旧单。 */
export function createServiceOrder(input: {
  serviceKey: ServiceOrderKey
  kioskSessionId: string
  endUserId?: string | null
}): Promise<ServiceOrderView> {
  const body: Record<string, string> = { serviceKey: input.serviceKey, kioskSessionId: input.kioskSessionId }
  if (input.endUserId) body.endUserId = input.endUserId
  return send('', { method: 'POST', body })
}

/**
 * 查单。refresh 为真时服务端会向支付渠道查一次（每台每分钟 30 次的限额里），
 * 普通轮询不要带，只在点「刷新付款结果」或隔够久时用。
 */
export function getServiceOrder(orderId: string, kioskSessionId: string, options?: { refresh?: boolean }): Promise<ServiceOrderView> {
  const query = options?.refresh ? '?refresh=1' : ''
  return send(`/${encodeURIComponent(orderId)}${query}`, { method: 'GET', kioskSessionId })
}

/** 关单。待付的关掉；已付没用的当场原路退；已开始的回 409 SERVICE_ORDER_IN_USE。 */
export function closeServiceOrder(orderId: string, kioskSessionId: string): Promise<ServiceOrderView> {
  return send(`/${encodeURIComponent(orderId)}/close`, { method: 'POST', kioskSessionId })
}

// ── 状态判定 ────────────────────────────────────────────────────────────────

export type ServiceOrderPhase =
  /** 待付：pending，本地还没过 expiresAt，渠道也没说失败。 */
  | 'awaiting'
  /** 核实中：同上，但服务端刚向渠道查过、还没确认到账（checking:true）。 */
  | 'checking'
  /** 付成，一次都还没用。 */
  | 'paid'
  /** 第一次没做成，十分钟内同一张单可以免费再试一次。 */
  | 'retry_free'
  /** 没做成过一次，再试期限已过：不能再用，钱由服务端原路退。 */
  | 'retry_expired'
  /** 已开始（consumed），还没结案。 */
  | 'in_use'
  /** 已开始并且做成了。 */
  | 'done'
  /** 没付成，钱没有扣：渠道说失败，或管理员改价、改开关、改绑把待付单关了。 */
  | 'not_paid'
  /** 超时：本地已过 expiresAt 还没付成，或清扫已按过期关单。 */
  | 'timed_out'
  | 'refunding'
  | 'refunded'
  | 'refund_failed'
  /** 其它关单（自己取消、清场、出码失败）。这张单作废，要用就再建一张。 */
  | 'closed'

function timeOf(iso: string | null): number {
  if (!iso) return Number.NaN
  return Date.parse(iso)
}

/** 本地时钟判超时：服务端清扫最多晚 30 秒才把过期单关掉，屏上不能跟着多等。 */
export function serviceOrderExpiredLocally(view: ServiceOrderView, nowMs: number): boolean {
  const expires = timeOf(view.expiresAt)
  return !Number.isFinite(expires) || nowMs >= expires
}

/** 可免费再试 = status==='paid' && attemptsUsed>=1 && retryUntil>now。 */
export function canRetryServiceOrderFree(view: ServiceOrderView, nowMs: number): boolean {
  return view.status === 'paid' && view.attemptsUsed >= 1 && timeOf(view.retryUntil) > nowMs
}

export function serviceOrderPhase(view: ServiceOrderView, nowMs: number): ServiceOrderPhase {
  switch (view.status) {
    case 'pending':
      if (view.paymentFailed) return 'not_paid'
      if (serviceOrderExpiredLocally(view, nowMs)) return 'timed_out'
      return view.checking ? 'checking' : 'awaiting'
    case 'paid':
      if (view.attemptsUsed === 0) return 'paid'
      return canRetryServiceOrderFree(view, nowMs) ? 'retry_free' : 'retry_expired'
    case 'consumed':
      return view.settledAt ? 'done' : 'in_use'
    case 'refunding':
      return 'refunding'
    case 'refunded':
      return 'refunded'
    case 'refund_failed':
      return 'refund_failed'
    case 'closed':
      if (view.closeReason === 'expired') return 'timed_out'
      if (view.closeReason && SERVICE_ORDER_ADMIN_CLOSE_REASONS.has(view.closeReason)) return 'not_paid'
      return 'closed'
    default:
      return 'closed'
  }
}

export const isServiceOrderAwaitingPayment = (view: ServiceOrderView, nowMs: number): boolean =>
  serviceOrderPhase(view, nowMs) === 'awaiting' || serviceOrderPhase(view, nowMs) === 'checking'
export const isServiceOrderChecking = (view: ServiceOrderView, nowMs: number): boolean =>
  serviceOrderPhase(view, nowMs) === 'checking'
/** 付成：已付（含可免费再试）、已开始或已做成。 */
export const isServiceOrderPaid = (view: ServiceOrderView, nowMs: number): boolean =>
  ['paid', 'retry_free', 'in_use', 'done'].includes(serviceOrderPhase(view, nowMs))
export const isServiceOrderNotPaid = (view: ServiceOrderView, nowMs: number): boolean =>
  serviceOrderPhase(view, nowMs) === 'not_paid'
export const isServiceOrderTimedOut = (view: ServiceOrderView, nowMs: number): boolean =>
  serviceOrderPhase(view, nowMs) === 'timed_out'
export const isServiceOrderRefunding = (view: ServiceOrderView): boolean => view.status === 'refunding'
export const isServiceOrderRefunded = (view: ServiceOrderView): boolean => view.status === 'refunded'
export const isServiceOrderRefundFailed = (view: ServiceOrderView): boolean => view.status === 'refund_failed'
