import type { ServiceOrderKey } from '@ai-job-print/shared'
import { kioskVisitReadyForCharge } from '../../auth/useKioskSessionReporting'
import type { ServiceOrderView } from '../../services/api/serviceOrders'
import { getTerminalId, refreshKioskTerminalConfig } from '../../services/api/terminalConfig'
import { errorCodeOf } from '../../services/api/userErrorMessage'
import {
  hasAvailableMiniappCredit,
  isMiniappCreditServiceKey,
  redeemMiniappServiceCredit,
  type MiniappCreditServiceKey,
} from '../../services/api/virtualPayCredits'
import { serviceTripOwnerFor, type ServiceTrip } from '../../services/serviceTrip'
import { SERVICE_SESSION_RETRY_DELAY_MS } from '../../services/serviceTripOrder'
import { PAY_CREDIT_TAKEN_LINE, type PayWhat } from './payServiceModel'

export type UseCreditOutcome =
  | { kind: 'redeemed'; view: ServiceOrderView; trip: ServiceTrip }
  | { kind: 'fallback_qr'; notice: string }
  | { kind: 'free' }
  | { kind: 'error'; error: unknown }

/**
 * 仅当进入 /pay/resume 或 /pay/interview、已登录、且尚未持有进行中同项服务单时探查小程序可用权益。
 * 扫描（scan）绝不查虚拟支付权益；接口故障或超时安静返回 false 降级回扫码，不阻断用户付款。
 */
export async function checkOwnedCreditForPayScreen(input: {
  what: PayWhat
  serviceKey: ServiceOrderKey
  endUserId: string | null
  token: string | null
}): Promise<boolean> {
  if (input.what === 'scan') return false
  if (!isMiniappCreditServiceKey(input.serviceKey)) return false
  if (!input.endUserId || !input.token) return false
  try {
    return await hasAvailableMiniappCredit(input.token, input.serviceKey)
  } catch {
    return false
  }
}

/**
 * 点击「用这一次」后原子核销权益。与 openServiceTripOrder 同口径：会话未落库时等 1.5 秒重试一次。
 */
export async function redeemServiceTripCredit(input: {
  serviceKey: MiniappCreditServiceKey
  pathname: string
  endUserId: string | null
  token: string
}): Promise<{ view: ServiceOrderView; trip: ServiceTrip }> {
  let kioskSessionId = await kioskVisitReadyForCharge(input.pathname)
  let view: ServiceOrderView
  try {
    view = await redeemMiniappServiceCredit({
      serviceKey: input.serviceKey,
      kioskSessionId,
      token: input.token,
    })
  } catch (error) {
    if (errorCodeOf(error) !== 'SERVICE_SESSION_REQUIRED') throw error
    await new Promise<void>((resolve) => window.setTimeout(resolve, SERVICE_SESSION_RETRY_DELAY_MS))
    kioskSessionId = await kioskVisitReadyForCharge(input.pathname)
    view = await redeemMiniappServiceCredit({
      serviceKey: input.serviceKey,
      kioskSessionId,
      token: input.token,
    })
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

/**
 * 执行一次点击「用这一次」的完整分支判定：
 * - 成功 → 返回 redeemed
 * - 409 VPAY_CREDIT_UNAVAILABLE → 诚实提示并切回现场扫码
 * - 409 SERVICE_FREE_ON_THIS_TERMINAL → 刷新本机价目后免费放行
 * - 其它错误 → 留在 owned 态并展示提示（不误导或重复出码）
 */
export async function runMiniappCreditRedeem(input: {
  serviceKey: ServiceOrderKey
  pathname: string
  endUserId: string | null
  token: string | null
}): Promise<UseCreditOutcome> {
  if (!isMiniappCreditServiceKey(input.serviceKey) || !input.token) {
    return { kind: 'fallback_qr', notice: PAY_CREDIT_TAKEN_LINE }
  }
  try {
    const result = await redeemServiceTripCredit({
      serviceKey: input.serviceKey,
      pathname: input.pathname,
      endUserId: input.endUserId,
      token: input.token,
    })
    return { kind: 'redeemed', view: result.view, trip: result.trip }
  } catch (error) {
    const code = errorCodeOf(error)
    if (code === 'VPAY_CREDIT_UNAVAILABLE') {
      return { kind: 'fallback_qr', notice: PAY_CREDIT_TAKEN_LINE }
    }
    if (code === 'SERVICE_FREE_ON_THIS_TERMINAL') {
      const terminalId = getTerminalId()
      if (terminalId) await refreshKioskTerminalConfig(terminalId).catch(() => undefined)
      return { kind: 'free' }
    }
    return { kind: 'error', error }
  }
}
