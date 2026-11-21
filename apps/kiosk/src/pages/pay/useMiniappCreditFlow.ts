import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServiceOrderKey } from '@ai-job-print/shared'
import { closeServiceOrder, type ServiceOrderView } from '../../services/api/serviceOrders'
import type { ServiceTrip } from '../../services/serviceTrip'
import { keepServiceTripOrder } from '../../services/serviceTripOrder'
import { checkOwnedCreditForPayScreen, runMiniappCreditRedeem } from './payCreditFlow'
import type { PayWhat } from './payServiceModel'

export { checkOwnedCreditForPayScreen }

interface MiniappCreditFlowDeps {
  what: PayWhat
  serviceKey: ServiceOrderKey
  pathname: string
  endUserId: string | null
  getToken: (() => string | null) | undefined
  busy: boolean
  isLeaving: () => boolean
  nextGen: () => number
  isCurrent: (gen: number) => boolean
  setBusy: (busy: boolean) => void
  onClearError: () => void
  onRedeemError: (error: unknown) => void
  onRedeemed: (view: ServiceOrderView, trip: ServiceTrip) => void
  onFree: () => void
  onFallbackQr: (gen: number) => Promise<void>
}

export function useMiniappCreditFlow(deps: MiniappCreditFlowDeps) {
  const {
    what,
    serviceKey,
    pathname,
    endUserId,
    getToken,
    busy,
    isLeaving,
    nextGen,
    isCurrent,
    setBusy,
    onClearError,
    onRedeemError,
    onRedeemed,
    onFree,
    onFallbackQr,
  } = deps
  const [creditNotice, setCreditNotice] = useState<string | null>(null)
  // 同步防重入锁：同一拍连续点击主按钮在 React 重绘 busy 之前就立即拦截，严格只发 1 次核销请求。
  const redeemingRef = useRef(false)
  const activeRedeemGenRef = useRef<number | null>(null)
  const endUserIdRef = useRef(endUserId)
  endUserIdRef.current = endUserId
  const setBusyRef = useRef(setBusy)
  setBusyRef.current = setBusy

  useEffect(() => {
    setCreditNotice(null)
    redeemingRef.current = false
    activeRedeemGenRef.current = null
    setBusyRef.current(false)
    return () => {
      redeemingRef.current = false
      activeRedeemGenRef.current = null
    }
  }, [endUserId])

  const checkOwned = useCallback(
    () => checkOwnedCreditForPayScreen({ what, serviceKey, endUserId, token: getToken?.() ?? null }),
    [endUserId, getToken, serviceKey, what],
  )

  const onUseCredit = useCallback(() => {
    if (redeemingRef.current || busy || isLeaving()) return
    redeemingRef.current = true
    const startedUserId = endUserId
    const gen = nextGen()
    activeRedeemGenRef.current = gen
    setBusy(true)
    onClearError()
    void runMiniappCreditRedeem({ serviceKey, pathname, endUserId: startedUserId, token: getToken?.() ?? null })
      .then(async (outcome) => {
        const stale = !isCurrent(gen) || endUserIdRef.current !== startedUserId
        if (stale) {
          if (outcome.kind === 'redeemed') {
            // 离页、卸载或切换用户后晚到的核销单：绝不留存本机或替他人跳转，立即关单把权益退回 available。
            void closeServiceOrder(outcome.trip.orderId, outcome.trip.kioskSessionId).catch(() => undefined)
          }
          return
        }
        if (outcome.kind === 'redeemed') {
          keepServiceTripOrder(outcome.trip)
          onRedeemed(outcome.view, outcome.trip)
        } else if (outcome.kind === 'free') {
          onFree()
        } else if (outcome.kind === 'fallback_qr') {
          setCreditNotice(outcome.notice)
          await onFallbackQr(gen)
        } else {
          onRedeemError(outcome.error)
        }
      })
      .finally(() => {
        if (activeRedeemGenRef.current === gen) {
          activeRedeemGenRef.current = null
          redeemingRef.current = false
          setBusy(false)
        }
      })
  }, [
    busy,
    endUserId,
    getToken,
    isCurrent,
    isLeaving,
    nextGen,
    onClearError,
    onFallbackQr,
    onFree,
    onRedeemError,
    onRedeemed,
    pathname,
    serviceKey,
    setBusy,
  ])

  return { creditNotice, checkOwned, onUseCredit }
}
