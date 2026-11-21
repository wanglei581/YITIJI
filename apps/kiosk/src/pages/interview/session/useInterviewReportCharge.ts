// ============================================================
// 作答页（iv-run）收费场次的报告失败处理：
// 只在确实是付过钱的那一场且出报告因系统原因失败时，用 P2e-1 的 getServiceOrder 查单：
//   - 后端进入免费再试窗口（consumed/paid 且 retryUntil>now）→ 稿 467 句 + 主按钮「免费再试一次」；
//   - 后端 status 为 refunding / refunded → 才写「钱在退回」（且仅 refunded 才出现「已退回」）；
//   - 后端 status 为 refund_failed → 无人值守标准句，绝不写「钱在退回」与「已退」；
//   - 查单仍非退款态或网络失败 → 只写核对中，绝不提前说「钱在退回」或「已退」。
// 免费机器与无服务单场次完全不启用。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { helpNeededLine } from '../../../copy/unattendedCopy'
import { API_MODE } from '../../../services/api/client'
import { getServiceOrder, type ServiceOrderView } from '../../../services/api/serviceOrders'
import { getTerminalId } from '../../../services/api/screensaver'
import { errorCodeOf } from '../../../services/api/userErrorMessage'
import { forgetServiceTrip, readServiceTrip, serviceTripOwnerFor } from '../../../services/serviceTrip'
import { PAY_BACK } from '../../pay/payServiceModel'
import type { InterviewLiveState } from '../interviewWorkbenchSession'

const REPORT_RETRY_COPY = `报告没生成。可以免费再试一次；不试了或再不成，钱${PAY_BACK}。`
const REPORT_REFUNDING_COPY = `报告没生成。钱在退回原付款账户，到账时间以支付渠道为准。`
const REPORT_REFUNDED_COPY = `报告没生成。钱在退回原付款账户，已退回，到账时间以支付渠道为准。`
const REPORT_CHECKING_COPY = '报告没生成。正在核对这一单的退款状态，请稍候。'
const REPORT_LOOKUP_ERROR_COPY = '报告没生成，暂时查不到这一单的退款状态，请稍后再试。'

const POLL_MS = 3_000
const POLL_MAX = 15

export interface PaidInterviewRef {
  orderId: string
  kioskSessionId: string
}

/** 可免费再试出报告：后端消费态带有效再试截止时刻（或夹具里已付带再试窗口）。 */
export function canRetryInterviewReportFree(view: ServiceOrderView, nowMs: number): boolean {
  const retryAt = view.retryUntil ? Date.parse(view.retryUntil) : Number.NaN
  if (!Number.isFinite(retryAt) || retryAt <= nowMs) return false
  if (view.status === 'consumed') return true
  return view.status === 'paid' && view.attemptsUsed >= 1
}

export function reportFailureCopyForOrder(
  view: ServiceOrderView,
  nowMs: number,
): { message: string; canFreeRetry: boolean; shouldPoll: boolean; finishedRefund: boolean } {
  if (canRetryInterviewReportFree(view, nowMs)) {
    return { message: REPORT_RETRY_COPY, canFreeRetry: true, shouldPoll: false, finishedRefund: false }
  }
  if (view.status === 'refunding') {
    return { message: REPORT_REFUNDING_COPY, canFreeRetry: false, shouldPoll: true, finishedRefund: false }
  }
  if (view.status === 'refunded') {
    return { message: REPORT_REFUNDED_COPY, canFreeRetry: false, shouldPoll: false, finishedRefund: true }
  }
  if (view.status === 'refund_failed') {
    return {
      message: `报告没生成。钱会自动退回原付款账户，到账时间以支付渠道为准。${helpNeededLine()}。`,
      canFreeRetry: false,
      shouldPoll: false,
      finishedRefund: false,
    }
  }
  return { message: REPORT_CHECKING_COPY, canFreeRetry: false, shouldPoll: view.status === 'consumed', finishedRefund: false }
}

function resolveInitialPaidRef(
  sessionId: string | null,
  storedLive: InterviewLiveState | undefined,
  endUserId: string | null,
): PaidInterviewRef | null {
  if (API_MODE !== 'http' || !getTerminalId()) return null
  if (sessionId && storedLive?.sessionId === sessionId && storedLive.paidOrderId && storedLive.paidKioskSessionId) {
    return { orderId: storedLive.paidOrderId, kioskSessionId: storedLive.paidKioskSessionId }
  }
  const trip = readServiceTrip('mock_interview', { owner: serviceTripOwnerFor(endUserId) })
  if (!trip) return null
  return { orderId: trip.orderId, kioskSessionId: trip.kioskSessionId }
}

export interface InterviewReportCharge {
  paidTrip: PaidInterviewRef | null
  canFreeRetry: boolean
  errorMessage: string | null
  clearFailure: () => void
  onReportSucceeded: () => void
  onReportFailed: () => Promise<boolean>
}

export function useInterviewReportCharge(args: {
  sessionId: string | null
  storedLive: InterviewLiveState | undefined
  endUserId: string | null
}): InterviewReportCharge {
  const [paidTrip] = useState<PaidInterviewRef | null>(() =>
    resolveInitialPaidRef(args.sessionId, args.storedLive, args.endUserId),
  )
  const [canFreeRetry, setCanFreeRetry] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const mountedRef = useRef(true)
  const genRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      genRef.current += 1
    }
  }, [])

  const applyView = useCallback((view: ServiceOrderView, ref: PaidInterviewRef) => {
    const outcome = reportFailureCopyForOrder(view, Date.now())
    setCanFreeRetry(outcome.canFreeRetry)
    setErrorMessage(outcome.message)
    setPolling(outcome.shouldPoll)
    if (outcome.finishedRefund) forgetServiceTrip('mock_interview', ref.orderId)
  }, [])

  useEffect(() => {
    if (!polling || !paidTrip) return undefined
    let cancelled = false
    let polls = 0
    let timer = 0
    const gen = genRef.current
    const tick = async () => {
      polls += 1
      try {
        const latest = await getServiceOrder(paidTrip.orderId, paidTrip.kioskSessionId)
        if (cancelled || !mountedRef.current || gen !== genRef.current) return
        const outcome = reportFailureCopyForOrder(latest, Date.now())
        setCanFreeRetry(outcome.canFreeRetry)
        setErrorMessage(outcome.message)
        if (outcome.finishedRefund) forgetServiceTrip('mock_interview', paidTrip.orderId)
        if (outcome.shouldPoll && polls < POLL_MAX) {
          timer = window.setTimeout(() => void tick(), POLL_MS)
        } else {
          setPolling(false)
        }
      } catch {
        if (cancelled || !mountedRef.current || gen !== genRef.current) return
        if (polls < POLL_MAX) timer = window.setTimeout(() => void tick(), POLL_MS)
        else setPolling(false)
      }
    }
    timer = window.setTimeout(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [paidTrip, polling])

  const clearFailure = useCallback(() => {
    genRef.current += 1
    setCanFreeRetry(false)
    setErrorMessage(null)
    setPolling(false)
  }, [])

  const onReportSucceeded = useCallback(() => {
    genRef.current += 1
    setCanFreeRetry(false)
    setErrorMessage(null)
    setPolling(false)
    if (paidTrip) forgetServiceTrip('mock_interview', paidTrip.orderId)
  }, [paidTrip])

  const onReportFailed = useCallback(async (): Promise<boolean> => {
    if (!paidTrip) return false
    const gen = ++genRef.current
    setPolling(false)
    try {
      const view = await getServiceOrder(paidTrip.orderId, paidTrip.kioskSessionId)
      if (!mountedRef.current || gen !== genRef.current) return true
      applyView(view, paidTrip)
      return true
    } catch (err) {
      if (!mountedRef.current || gen !== genRef.current) return true
      if (errorCodeOf(err) === 'SERVICE_ORDER_NOT_FOUND') {
        forgetServiceTrip('mock_interview', paidTrip.orderId)
      }
      setCanFreeRetry(false)
      setErrorMessage(REPORT_LOOKUP_ERROR_COPY)
      setPolling(false)
      return true
    }
  }, [applyView, paidTrip])

  return {
    paidTrip,
    canFreeRetry,
    errorMessage,
    clearFailure,
    onReportSucceeded,
    onReportFailed,
  }
}
