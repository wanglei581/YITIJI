/**
 * 一体机按次付款（服务单）的浏览器用例夹具。只造后端 ServiceOrderView 会给的样子：
 * cuid 样子的单号、建单时冻结的金额（0.50 / 1.00 / 2.00 元这类真实价位）、建单时刻起 5 分钟有效，
 * 沙箱码是 sandboxpay://，微信码是 Native 的 weixin://wxpay/bizpayurl。不含任何个人信息。
 */
import type { Page, Request } from '@playwright/test'

export const SERVICE_ORDERS_PATH = '/api/v1/kiosk/service-orders'
export const serviceOrderPath = (id: string): string => `${SERVICE_ORDERS_PATH}/${id}`
export const serviceOrderClosePath = (id: string): string => `${SERVICE_ORDERS_PATH}/${id}/close`

export type FixtureServiceKey = 'resume_optimize' | 'mock_interview' | 'scan'

const NAMES: Record<FixtureServiceKey, string> = {
  resume_optimize: 'AI 简历优化',
  mock_interview: 'AI 模拟面试',
  scan: '扫描',
}

/** 服务单有效期，与后端 SERVICE_PAY_TTL_MS 一致。 */
export const SERVICE_PAY_TTL_MS = 5 * 60 * 1000

export interface FixtureOrder {
  id: string
  providerOrderNo: string
  serviceKey: FixtureServiceKey
  amountCents: number
  createdAt: number
  provider: 'sandbox' | 'wechat'
}

/** 下面几张单的号码、渠道单号都按后端格式写（cuid、svc + 24 位十六进制）。 */
export const ORDER_A: Omit<FixtureOrder, 'createdAt'> = {
  id: 'cmi5k2v8w0003s6h9q4d1x7pe',
  providerOrderNo: 'svc3f9a1c07be52d84e6f190a2b',
  serviceKey: 'resume_optimize',
  amountCents: 100,
  provider: 'sandbox',
}

export const ORDER_B: Omit<FixtureOrder, 'createdAt'> = {
  id: 'cmi5k9t2q0011s6h97c3w5r8ma',
  providerOrderNo: 'svc8b24e61f0d93a7c5e2014bd9',
  serviceKey: 'resume_optimize',
  amountCents: 200,
  provider: 'sandbox',
}

export const ORDER_WECHAT: Omit<FixtureOrder, 'createdAt'> = {
  id: 'cmi5kd6m40019s6h9x2p7k1v3c',
  providerOrderNo: 'svc5d71c9a2e48f063b1d7e95ca',
  serviceKey: 'mock_interview',
  amountCents: 50,
  provider: 'wechat',
}

function qrFor(order: FixtureOrder): string {
  if (order.provider === 'wechat') return 'weixin://wxpay/bizpayurl?pr=K9dQ2xT'
  const prepay = `sbx_${order.providerOrderNo.slice(3, 27)}`
  return `sandboxpay://qr?attempt=${order.providerOrderNo}&prepay=${prepay}&order=${order.providerOrderNo}&amount=${order.amountCents}`
}

/** 后端 ServiceOrderView 的完整形状。overrides 只改状态类字段。 */
export function serviceOrderView(order: FixtureOrder, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: order.id,
    serviceKey: order.serviceKey,
    serviceName: NAMES[order.serviceKey],
    status: 'pending',
    amountCents: order.amountCents,
    expiresAt: new Date(order.createdAt + SERVICE_PAY_TTL_MS).toISOString(),
    qrCodeContent: qrFor(order),
    paidAt: null,
    refundReason: null,
    refundedAt: null,
    failureReason: null,
    retryUntil: null,
    attemptsUsed: 0,
    settledAt: null,
    closeReason: null,
    paymentFailed: false,
    checking: false,
    consumedAt: null,
    provider: order.provider,
    ...overrides,
  }
}

export function ok(json: Record<string, unknown>): { status: number; json: unknown } {
  return { status: 200, json: { success: true, data: json } }
}

export function apiError(status: number, code: string, message: string): { status: number; json: unknown } {
  return { status, json: { success: false, error: { code, message }, requestId: 'req-svc-fixture' } }
}

export interface ServiceOrderCall {
  method: string
  path: string
  refresh: boolean
  sessionHeader: string | null
  body: Record<string, unknown> | null
  /** 页面时钟上的时刻（装了 page.clock 时是假时钟）。 */
  at: number
}

/** 记下页面发出的每一条服务单请求（方法、路径、是否带 refresh=1、会话头、请求体）。 */
export function recordServiceOrderCalls(page: Page, clockNow: () => number = Date.now): ServiceOrderCall[] {
  const calls: ServiceOrderCall[] = []
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith(SERVICE_ORDERS_PATH)) return
    let body: Record<string, unknown> | null = null
    try {
      body = request.postDataJSON() as Record<string, unknown> | null
    } catch {
      body = null
    }
    calls.push({
      method: request.method(),
      path: url.pathname,
      refresh: url.searchParams.get('refresh') === '1',
      sessionHeader: request.headers()['x-kiosk-session-id'] ?? null,
      body,
      at: clockNow(),
    })
  })
  return calls
}
