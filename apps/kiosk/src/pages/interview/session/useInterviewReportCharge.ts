// ============================================================
// 作答页（iv-run）收费场次的报告失败处理：
// 只在确实是付过钱的那一场且出报告因系统原因失败（或服务端返回过期/已退款 409）时，用 getServiceOrder 查单：
//   - 后端进入免费再试窗口（consumed/paid 且 retryUntil>now）→ 稿 467 句 + 主按钮「免费再试一次」，并装精准到期定时器；
//   - 跨过 retryUntil 瞬间立即撤掉「免费再试一次」、锁定报告入口并立即查单轮询展示真实退款状态；
//   - 后端 status 为 refunding / refunded → 才写「钱在退回」（且仅 refunded 才出现「已退回」），同时隐藏/禁止再次生成报告；
//   - 后端 status 为 refund_failed → 无人值守标准句，绝不写「钱在退回」与「已退」，同时禁止再次生成报告；
//   - 查单仍非退款态或网络失败 → 只写核对中，绝不提前说「钱在退回」或「已退」。
// 免费机器与无服务单场次完全不启用。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { helpNeededLine } from '../../../copy/unattendedCopy'
import { API_MODE } from '../../../services/api/client'
import { getServiceOrder, type ServiceOrderView } from '../../../services/api/serviceOrders'
import { getTerminalId } from '../../../services/api/screensaver'
import { errorCodeOf, userMessageOf } from '../../../services/api/userErrorMessage'
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
): { message: string; canFreeRetry: boolean; reportLocked: boolean; shouldPoll: boolean; finishedRefund: boolean } {
  if (canRetryInterviewReportFree(view, nowMs)) {
    return { message: REPORT_RETRY_COPY, canFreeRetry: true, reportLocked: false, shouldPoll: false, finishedRefund: false }
  }
  if (view.status === 'refunding') {
    return { message: REPORT_REFUNDING_COPY, canFreeRetry: false, reportLocked: true, shouldPoll: true, finishedRefund: false }
  }
  if (view.status === 'refunded') {
    return { message: REPORT_REFUNDED_COPY, canFreeRetry: false, reportLocked: true, shouldPoll: false, finishedRefund: true }
  }
  if (view.status === 'refund_failed') {
    return {
      message: `报告没生成。钱会自动退回原付款账户，到账时间以支付渠道为准。${helpNeededLine()}。`,
      canFreeRetry: false,
      reportLocked: true,
      shouldPoll: false,
      finishedRefund: false,
    }
  }
  const shouldPoll = view.status === 'consumed' || (view.status === 'paid' && view.attemptsUsed >= 1)
  return { message: REPORT_CHECKING_COPY, canFreeRetry: false, reportLocked: true, shouldPoll, finishedRefund: false }
}

function isTerminalReportError(err: unknown): boolean {
  const code = errorCodeOf(err)
  return code === 'SERVICE_RETRY_EXPIRED' || code === 'SERVICE_ORDER_REFUNDED'
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
  /** 收费场次已进入退款中/已退款/退款失败或再试窗已过期：禁止再次触发生成报告。 */
  reportLocked: boolean
  errorMessage: string | null
  clearFailure: () => void
  onReportSucceeded: () => void
  onReportFailed: (err?: unknown) => Promise<boolean>
}

export function useInterviewReportCharge(args: {
  sessionId: string | null
  storedLive: InterviewLiveState | undefined
  endUserId: string | null
}): InterviewReportCharge {
  const [paidTrip] = useState<PaidInterviewRef | null>(() =>
    resolveInitialPaidRef(args.sessionId, args.storedLive, args.endUserId),
  )
  const [orderView, setOrderView] = useState<ServiceOrderView | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lockedByError, setLockedByError] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [pollSession, setPollSession] = useState<{ active: boolean; immediate: boolean; token: number }>({
    active: false,
    immediate: false,
    token: 0,
  })
  const mountedRef = useRef(true)
  const genRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      genRef.current += 1
    }
  }, [])

  const effectiveNowMs = Math.max(nowMs, Date.now())
  const outcome = orderView ? reportFailureCopyForOrder(orderView, effectiveNowMs) : null
  const canFreeRetry = !lockedByError && Boolean(outcome?.canFreeRetry)
  const reportLocked = lockedByError || Boolean(outcome?.reportLocked)
  const errorMessage = outcome ? outcome.message : lookupError

  const reportLockedRef = useRef(reportLocked)
  reportLockedRef.current = reportLocked

  // 免费再试窗精准到期定时器：跨过 retryUntil 瞬间立即撤掉「免费再试一次」，并启动查单展示真实退款状态。
  const retryAtMs = orderView?.retryUntil ? Date.parse(orderView.retryUntil) : Number.NaN
  const hasActiveRetryWindow = Boolean(paidTrip && orderView && canFreeRetry && Number.isFinite(retryAtMs))
  useEffect(() => {
    if (!hasActiveRetryWindow || !Number.isFinite(retryAtMs)) return undefined
    const delay = Math.max(0, retryAtMs - Date.now())
    const timer = window.setTimeout(() => {
      if (!mountedRef.current) return
      setNowMs(Math.max(Date.now(), retryAtMs))
      setPollSession((prev) => ({ active: true, immediate: true, token: prev.token + 1 }))
    }, delay)
    return () => {
      window.clearTimeout(timer)
    }
  }, [hasActiveRetryWindow, paidTrip?.orderId, retryAtMs])

  useEffect(() => {
    if (!pollSession.active || !paidTrip) return undefined
    let cancelled = false
    let polls = 0
    let timer = 0
    const gen = genRef.current
    const tick = async () => {
      polls += 1
      try {
        const latest = await getServiceOrder(paidTrip.orderId, paidTrip.kioskSessionId)
        if (cancelled || !mountedRef.current || gen !== genRef.current) return
        const now = Date.now()
        const next = reportFailureCopyForOrder(latest, now)
        setOrderView(latest)
        setLookupError(null)
        setNowMs(now)
        if (next.finishedRefund) forgetServiceTrip('mock_interview', paidTrip.orderId)
        if (next.shouldPoll && polls < POLL_MAX) {
          timer = window.setTimeout(() => void tick(), POLL_MS)
        } else {
          setPollSession((prev) => (prev.active ? { ...prev, active: false, immediate: false } : prev))
        }
      } catch {
        if (cancelled || !mountedRef.current || gen !== genRef.current) return
        if (polls < POLL_MAX) timer = window.setTimeout(() => void tick(), POLL_MS)
        else setPollSession((prev) => (prev.active ? { ...prev, active: false, immediate: false } : prev))
      }
    }
    if (pollSession.immediate) {
      void tick()
    } else {
      timer = window.setTimeout(() => void tick(), POLL_MS)
    }
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [paidTrip, pollSession.active, pollSession.immediate, pollSession.token])

  const clearFailure = useCallback(() => {
    if (reportLockedRef.current) return
    genRef.current += 1
    setOrderView(null)
    setLookupError(null)
    setPollSession((prev) => ({ active: false, immediate: false, token: prev.token + 1 }))
  }, [])

  const onReportSucceeded = useCallback(() => {
    genRef.current += 1
    setOrderView(null)
    setLookupError(null)
    setLockedByError(false)
    setPollSession((prev) => ({ active: false, immediate: false, token: prev.token + 1 }))
    if (paidTrip) forgetServiceTrip('mock_interview', paidTrip.orderId)
  }, [paidTrip])

  const onReportFailed = useCallback(async (err?: unknown): Promise<boolean> => {
    const terminalCode = isTerminalReportError(err)
    if (!paidTrip) {
      if (!terminalCode) return false
      genRef.current += 1
      setLockedByError(true)
      setOrderView(null)
      setLookupError(userMessageOf(err, '这一次已进入退款流程，不再继续生成练习报告'))
      setPollSession((prev) => ({ active: false, immediate: false, token: prev.token + 1 }))
      return true
    }
    const gen = ++genRef.current
    if (terminalCode) setLockedByError(true)
    setPollSession((prev) => ({ active: false, immediate: false, token: prev.token + 1 }))
    try {
      const view = await getServiceOrder(paidTrip.orderId, paidTrip.kioskSessionId)
      if (!mountedRef.current || gen !== genRef.current) return true
      const now = Date.now()
      const next = reportFailureCopyForOrder(view, now)
      setOrderView(view)
      setLookupError(null)
      setNowMs(now)
      if (next.finishedRefund) forgetServiceTrip('mock_interview', paidTrip.orderId)
      if (next.shouldPoll) {
        setPollSession((prev) => ({ active: true, immediate: false, token: prev.token + 1 }))
      }
      return true
    } catch (lookupErr) {
      if (!mountedRef.current || gen !== genRef.current) return true
      if (errorCodeOf(lookupErr) === 'SERVICE_ORDER_NOT_FOUND') {
        forgetServiceTrip('mock_interview', paidTrip.orderId)
      }
      setOrderView(null)
      setLookupError(terminalCode ? userMessageOf(err, REPORT_LOOKUP_ERROR_COPY) : REPORT_LOOKUP_ERROR_COPY)
      setPollSession((prev) => ({ active: false, immediate: false, token: prev.token + 1 }))
      return true
    }
  }, [paidTrip])

  return {
    paidTrip,
    canFreeRetry,
    reportLocked,
    errorMessage,
    clearFailure,
    onReportSucceeded,
    onReportFailed,
  }
}
