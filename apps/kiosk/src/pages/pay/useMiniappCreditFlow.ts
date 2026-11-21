import { useCallback, useState } from 'react'
import type { ServiceOrderKey } from '@ai-job-print/shared'
import type { ServiceOrderView } from '../../services/api/serviceOrders'
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

  const checkOwned = useCallback(
    () => checkOwnedCreditForPayScreen({ what, serviceKey, endUserId, token: getToken?.() ?? null }),
    [endUserId, getToken, serviceKey, what],
  )

  const onUseCredit = useCallback(() => {
    if (busy || isLeaving()) return
    const gen = nextGen()
    setBusy(true)
    onClearError()
    void runMiniappCreditRedeem({ serviceKey, pathname, endUserId, token: getToken?.() ?? null })
      .then(async (outcome) => {
        if (!isCurrent(gen)) return
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
      .finally(() => setBusy(false))
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
