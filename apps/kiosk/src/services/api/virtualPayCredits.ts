import type { ServiceOrderKey } from '@ai-job-print/shared'
import { terminalProtectedFetch } from '../terminalAuth'
import { API_BASE_URL, API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'
import {
  ServiceOrderHttpError,
  asServiceOrderView,
  parseRetryAfterMs,
  type ServiceOrderView,
} from './serviceOrders'
import { networkError, readHttpError } from './throwHttpError'

export const MINIAPP_CREDIT_PROVIDER = 'miniapp_credit'

export type MiniappCreditServiceKey = 'resume_optimize' | 'mock_interview'

export interface MemberServiceCreditItem {
  serviceKind: string
  createdAt: string
}

const CREDIT_CHECK_TIMEOUT_MS = 5_000
const CREDIT_REDEEM_TIMEOUT_MS = 15_000

export function isMiniappCreditServiceKey(serviceKey: ServiceOrderKey): serviceKey is MiniappCreditServiceKey {
  return serviceKey === 'resume_optimize' || serviceKey === 'mock_interview'
}

/**
 * 查询当前登录会员仍可用的小程序虚拟支付权益。
 * 只用于一体机付款屏探测是否进入「手机上买过」态；超时或失败由调用方安静降级回扫码。
 */
export async function listAvailableMiniappCredits(
  token: string,
  externalSignal?: AbortSignal,
): Promise<MemberServiceCreditItem[]> {
  if (API_MODE !== 'http' || !token) return []
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = window.setTimeout(() => controller.abort(), CREDIT_CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE_URL}/member/service-credits`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    })
    if (!res.ok) return []
    const body = (await res.json()) as { items?: unknown } | null
    if (!body || !Array.isArray(body.items)) return []
    return body.items
      .filter((item): item is { serviceKind: string; createdAt: string } =>
        Boolean(
          item &&
          typeof item === 'object' &&
          typeof (item as { serviceKind?: unknown }).serviceKind === 'string' &&
          typeof (item as { createdAt?: unknown }).createdAt === 'string',
        ),
      )
      .map((item) => ({ serviceKind: item.serviceKind, createdAt: item.createdAt }))
  } catch {
    return []
  } finally {
    window.clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onAbort)
  }
}

export async function hasAvailableMiniappCredit(
  token: string,
  serviceKey: MiniappCreditServiceKey,
  signal?: AbortSignal,
): Promise<boolean> {
  const items = await listAvailableMiniappCredits(token, signal)
  return items.some((item) => item.serviceKind === serviceKey)
}

/**
 * 原子核销本人一条可用的小程序虚拟支付权益，返回标准 ServiceOrderView（provider='miniapp_credit'）。
 * 同时走 terminalProtectedFetch（终端身份）与 Bearer token（会员登录态）。
 */
export async function redeemMiniappServiceCredit(input: {
  serviceKey: MiniappCreditServiceKey
  kioskSessionId: string
  token: string
}): Promise<ServiceOrderView> {
  if (API_MODE !== 'http') throw new ApiHttpError('MOCK_MODE', '当前为演示模式，未连接真实服务', 0)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), CREDIT_REDEEM_TIMEOUT_MS)
  let res: Response
  try {
    res = await terminalProtectedFetch(`${API_BASE_URL}/kiosk/service-orders/redeem-credit`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        serviceKey: input.serviceKey,
        kioskSessionId: input.kioskSessionId,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    throw networkError(error)
  } finally {
    window.clearTimeout(timer)
  }
  if (!res.ok) {
    const { code, message } = await readHttpError(res)
    const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'))
    throw new ServiceOrderHttpError(code, message, res.status, retryAfterMs)
  }
  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  const view = asServiceOrderView((payload as { data?: unknown } | null)?.data)
  if (!view) throw new ApiHttpError('SERVICE_ORDER_UNREADABLE', '权益核销结果读不出来', res.status)
  return view
}
