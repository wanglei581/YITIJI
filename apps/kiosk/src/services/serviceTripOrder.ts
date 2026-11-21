// ============================================================
// 开、换这一趟的服务单。付款屏用；记单本身在 serviceTrip.ts（那里只管存取，不发请求）。
//
// 建单前先等这一使用周期的 start 落库（kioskVisitReadyForCharge）。服务端仍回
// 400 SERVICE_SESSION_REQUIRED 时稍等再建一次；第二次还不成就把错误交给调用方出标准句，
// 不在这里循环。
// ============================================================
import type { ServiceOrderKey } from '@ai-job-print/shared'
import { kioskVisitReadyForCharge } from '../auth/useKioskSessionReporting'
import { closeServiceOrder, createServiceOrder, type ServiceOrderView } from './api/serviceOrders'
import { errorCodeOf } from './api/userErrorMessage'
import { forgetServiceTrip, rememberServiceTrip, serviceTripOwnerFor, type ServiceTrip } from './serviceTrip'

/** 服务端说「这一次使用还没开始」之后，等多久再建第二次。 */
export const SERVICE_SESSION_RETRY_DELAY_MS = 1_500

export interface OpenServiceTripDeps {
  ready: (pathname: string) => Promise<string>
  create: typeof createServiceOrder
  sleep: (ms: number) => Promise<void>
}

const defaultDeps: OpenServiceTripDeps = {
  ready: kioskVisitReadyForCharge,
  create: createServiceOrder,
  sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
}

/**
 * 开这一趟的一张新单。会话还没落库时最多再建一次。
 * 失败原样抛出（ApiHttpError），由调用方按错误码出句子。
 * 这里不记单：调用方确认自己还在（没离开、没换成更新的一次）再 rememberServiceTrip，
 * 否则晚到的旧结果会盖掉新记的单。
 */
export async function openServiceTripOrder(
  input: { serviceKey: ServiceOrderKey; pathname: string; endUserId?: string | null },
  deps: OpenServiceTripDeps = defaultDeps,
): Promise<{ view: ServiceOrderView; trip: ServiceTrip }> {
  let kioskSessionId = await deps.ready(input.pathname)
  let view: ServiceOrderView
  try {
    view = await deps.create({ serviceKey: input.serviceKey, kioskSessionId, endUserId: input.endUserId })
  } catch (error) {
    if (errorCodeOf(error) !== 'SERVICE_SESSION_REQUIRED') throw error
    await deps.sleep(SERVICE_SESSION_RETRY_DELAY_MS)
    kioskSessionId = await deps.ready(input.pathname)
    view = await deps.create({ serviceKey: input.serviceKey, kioskSessionId, endUserId: input.endUserId })
  }
  return {
    view,
    trip: {
      serviceKey: input.serviceKey,
      orderId: view.id,
      kioskSessionId,
      owner: serviceTripOwnerFor(input.endUserId),
      savedAt: Date.now(),
    },
  }
}

/** 记下这一趟的单（调用方确认这次结果仍有效之后）。 */
export function keepServiceTripOrder(trip: ServiceTrip): void {
  rememberServiceTrip(
    { serviceKey: trip.serviceKey, orderId: trip.orderId, kioskSessionId: trip.kioskSessionId, owner: trip.owner },
    trip.savedAt,
  )
}

export type RetireServiceTripResult =
  | { ok: true; view: ServiceOrderView | null }
  | { ok: false; error: unknown }

/**
 * 不要这张单了（返回、再出一张码）：还在待付的先关掉，确认关掉或 404 不存在后才从本机忘掉。
 * 关单失败时绝不静默删掉本机单号（防止孤儿单），由调用方保留凭据并提示用户核实/重试。
 * 已付、已开始的单不在这里关——那要退钱或已经在办，不是「换一张码」能处理的。
 */
export async function retireServiceTripOrder(
  trip: ServiceTrip,
  lastSeenStatus: string | null,
  close: typeof closeServiceOrder = closeServiceOrder,
): Promise<RetireServiceTripResult> {
  let closed: ServiceOrderView | null = null
  if (lastSeenStatus === 'pending' || lastSeenStatus === null) {
    try {
      closed = await close(trip.orderId, trip.kioskSessionId)
    } catch (error) {
      if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') {
        forgetServiceTrip(trip.serviceKey, trip.orderId)
        return { ok: true, view: null }
      }
      return { ok: false, error }
    }
  }
  forgetServiceTrip(trip.serviceKey, trip.orderId)
  return { ok: true, view: closed }
}
