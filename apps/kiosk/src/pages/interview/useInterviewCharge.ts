// ============================================================
// 模拟面试设置页（iv-3）按次付款状态：读本机生效价、核对本趟服务单、
// 付款前先走年满 14 周岁确认、付成返回后自动带头开场、没开成走免费再试或如实提示退款。
// 只复用 P2e-1 导出的服务单与付款屏工具，不另起一套。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { aiDeclarationDeclineMessage } from '../../ai/aiDeclarationErrors'
import { ensureAge14DeclaredForPay } from '../../ai/aiDeclarationGate'
import { helpNeededLine } from '../../copy/unattendedCopy'
import { API_MODE } from '../../services/api/client'
import { InterviewApiError } from '../../services/api/interview'
import {
  getServiceOrder,
  serviceOrderHeaders,
  serviceOrderPhase,
  type ServiceOrderPhase,
  type ServiceOrderView,
} from '../../services/api/serviceOrders'
import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
  refreshKioskTerminalConfig,
} from '../../services/api/terminalConfig'
import { errorCodeOf } from '../../services/api/userErrorMessage'
import {
  forgetServiceTrip,
  readServiceTrip,
  serviceTripOwnerFor,
  type ServiceTrip,
} from '../../services/serviceTrip'
import { PAY_BACK, formatYuan, payServicePath, pricingSaysFree } from '../pay/payServiceModel'
import type { InterviewStartTrip } from './interviewSetupModel'
import type { InterviewStartMode } from './interviewStartControl'

const RETRY_COPY = `这一次没做成。可以免费再试一次；不试了或再不成，钱${PAY_BACK}。`
const REFUND_POLL_MS = 3_000
const REFUND_POLL_MAX = 10

function mockInterviewEffectivePrice(config: unknown): number {
  if (!config || typeof config !== 'object') return 0
  if (pricingSaysFree(config, 'mock_interview')) return 0
  const pricing = (config as { pricing?: { effective?: Record<string, unknown> } }).pricing
  const raw = pricing?.effective?.mock_interview
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 0
}

function toStartTrip(trip: ServiceTrip): InterviewStartTrip {
  return {
    orderId: trip.orderId,
    kioskSessionId: trip.kioskSessionId,
    headers: serviceOrderHeaders(trip),
  }
}

function startFailureHintFor(phase: ServiceOrderPhase | null): string | null {
  if (phase === 'retry_free') return RETRY_COPY
  if (phase === 'refunding') return `这一次没做成。钱在退回原付款账户，到账时间以支付渠道为准。`
  if (phase === 'refunded') return `这一次没做成。钱已经退回原付款账户，到账时间以支付渠道为准。`
  if (phase === 'refund_failed') {
    return `这一次没做成。钱会退回原付款账户，到账时间以支付渠道为准。${helpNeededLine()}。`
  }
  return null
}

function isServiceOrderBounceError(err: unknown): boolean {
  const status = err instanceof InterviewApiError
    ? err.status
    : (err && typeof err === 'object' && 'status' in err ? Number((err as { status?: unknown }).status) : 0)
  const code = errorCodeOf(err)
  return status === 402 || (typeof code === 'string' && code.startsWith('SERVICE_'))
}

export interface InterviewChargeState {
  priceCents: number
  checkingPay: boolean
  paidTrip: InterviewStartTrip | null
  isRetryFree: boolean
  needsPay: boolean
  showChargeBar: boolean
  startFailureHint: string | null
  primaryLabel: (defaultLabel: string) => string
  startPay: () => Promise<void>
  handleStartError: (err: unknown, sentTrip?: InterviewStartTrip) => Promise<boolean>
}

export function useInterviewCharge(params: {
  step: 1 | 2 | 3
  creating: boolean
  controlMode: InterviewStartMode
  aiOutage: string | null
  hasPendingSession: boolean
  autoStartAfterPay: boolean
  endUserId: string | null
  getToken: () => string | null
  navigate: NavigateFunction
  validateBasics: () => string | null
  setError: (message: string | null) => void
  onBeforeNavigatePay: (autoStart: boolean) => void
  onClearAutoStart: () => void
  onAutoStart: (trip: InterviewStartTrip) => void
}): InterviewChargeState {
  const {
    step, creating, controlMode, aiOutage, hasPendingSession,
    autoStartAfterPay, endUserId, getToken, navigate,
    validateBasics, setError, onBeforeNavigatePay, onClearAutoStart, onAutoStart,
  } = params

  const [priceCents, setPriceCents] = useState<number>(() => {
    if (API_MODE !== 'http') return 0
    const terminalId = getTerminalId()
    if (!terminalId) return 0
    return mockInterviewEffectivePrice(peekCachedKioskTerminalConfig(terminalId))
  })
  const [trip, setTrip] = useState<ServiceTrip | null>(null)
  const [order, setOrder] = useState<ServiceOrderView | null>(null)
  const [tripResolved, setTripResolved] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [checkingPay, setCheckingPay] = useState(false)
  const busyPayRef = useRef(false)
  const autoStartedRef = useRef(false)

  useEffect(() => {
    if (API_MODE !== 'http') { setPriceCents(0); return }
    const terminalId = getTerminalId()
    if (!terminalId) { setPriceCents(0); return }
    let cancelled = false
    void getCachedKioskTerminalConfig(terminalId)
      .then((config) => { if (!cancelled) setPriceCents(mockInterviewEffectivePrice(config)) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const owner = serviceTripOwnerFor(endUserId)
    const stored = readServiceTrip('mock_interview', { owner })
    const terminalId = getTerminalId()
    if (!stored || API_MODE !== 'http' || !terminalId) {
      setTrip(null)
      setOrder(null)
      setTripResolved(true)
      return
    }
    let cancelled = false
    setTripResolved(false)
    void getServiceOrder(stored.orderId, stored.kioskSessionId)
      .then((view) => {
        if (cancelled) return
        setTrip(stored)
        setOrder(view)
        setNowMs(Date.now())
        setTripResolved(true)
      })
      .catch((err) => {
        if (cancelled) return
        if (errorCodeOf(err) === 'SERVICE_ORDER_NOT_FOUND') {
          forgetServiceTrip('mock_interview', stored.orderId)
          setTrip(null)
          setOrder(null)
        } else {
          setTrip(stored)
        }
        setTripResolved(true)
      })
    return () => { cancelled = true }
  }, [endUserId])

  const phase: ServiceOrderPhase | null = order ? serviceOrderPhase(order, nowMs) : null
  const usableTrip = trip && (phase === 'paid' || phase === 'retry_free') ? trip : null
  const paidTrip = usableTrip ? toStartTrip(usableTrip) : null
  const isRetryFree = paidTrip !== null && phase === 'retry_free'
  const needsPay = priceCents > 0 && paidTrip === null
  const showChargeBar = needsPay && !creating && controlMode === 'start' && !(aiOutage && hasPendingSession)

  // 二次失败进入退款中时温和轮询，后端真正退成后才切已退句。
  useEffect(() => {
    if (!trip || phase !== 'refunding') return undefined
    let cancelled = false
    let polls = 0
    let timer = 0
    const tick = async () => {
      polls += 1
      try {
        const latest = await getServiceOrder(trip.orderId, trip.kioskSessionId)
        if (cancelled) return
        setOrder(latest)
        setNowMs(Date.now())
        if (latest.status === 'refunding' && polls < REFUND_POLL_MAX) {
          timer = window.setTimeout(() => void tick(), REFUND_POLL_MS)
        }
      } catch {
        if (!cancelled && polls < REFUND_POLL_MAX) {
          timer = window.setTimeout(() => void tick(), REFUND_POLL_MS)
        }
      }
    }
    timer = window.setTimeout(() => void tick(), REFUND_POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase, trip])

  useEffect(() => {
    if (!autoStartAfterPay || !tripResolved || step !== 3 || creating || autoStartedRef.current) return
    if (controlMode === 'wait') return
    if (controlMode !== 'start') {
      onClearAutoStart()
      return
    }
    if (paidTrip && phase === 'paid') {
      autoStartedRef.current = true
      onClearAutoStart()
      onAutoStart(paidTrip)
      return
    }
    onClearAutoStart()
  }, [autoStartAfterPay, controlMode, creating, onAutoStart, onClearAutoStart, paidTrip, phase, step, tripResolved])

  const startPay = useCallback(async () => {
    if (busyPayRef.current) return
    const invalid = validateBasics()
    if (invalid) { setError(invalid); return }
    busyPayRef.current = true
    setCheckingPay(true)
    setError(null)
    try {
      await ensureAge14DeclaredForPay(getToken())
    } catch (err) {
      const declined = aiDeclarationDeclineMessage(err)
      if (declined) setError(declined)
      return
    } finally {
      busyPayRef.current = false
      setCheckingPay(false)
    }
    const existing = readServiceTrip('mock_interview', { owner: serviceTripOwnerFor(endUserId) })
    if (existing && phase !== 'awaiting' && phase !== 'checking' && phase !== 'paid' && phase !== 'retry_free') {
      forgetServiceTrip('mock_interview', existing.orderId)
    }
    onBeforeNavigatePay(true)
    navigate(payServicePath('interview', { next: 'setup', back: 'setup' }))
  }, [endUserId, getToken, navigate, onBeforeNavigatePay, phase, setError, validateBasics])

  const handleStartError = useCallback(async (err: unknown, sentTrip?: InterviewStartTrip): Promise<boolean> => {
    if (isServiceOrderBounceError(err)) {
      const code = errorCodeOf(err)
      const status = err instanceof InterviewApiError ? err.status : 0
      if (sentTrip && code !== 'SERVICE_ORDER_IN_USE') {
        forgetServiceTrip('mock_interview', sentTrip.orderId)
        setTrip(null)
        setOrder(null)
      }
      const terminalId = getTerminalId()
      if (terminalId) {
        const fresh = await refreshKioskTerminalConfig(terminalId).catch(() => null)
        if (fresh) setPriceCents(mockInterviewEffectivePrice(fresh))
      }
      if (status === 402 || code === 'SERVICE_PAYMENT_REQUIRED') {
        try {
          await ensureAge14DeclaredForPay(getToken())
        } catch (declErr) {
          const declined = aiDeclarationDeclineMessage(declErr)
          if (declined) setError(declined)
          return true
        }
      }
      onBeforeNavigatePay(code !== 'SERVICE_ORDER_IN_USE')
      navigate(payServicePath('interview', { next: 'setup', back: 'setup' }))
      return true
    }
    if (sentTrip) {
      try {
        const latest = await getServiceOrder(sentTrip.orderId, sentTrip.kioskSessionId)
        setTrip({
          serviceKey: 'mock_interview',
          orderId: sentTrip.orderId,
          kioskSessionId: sentTrip.kioskSessionId,
          owner: serviceTripOwnerFor(endUserId),
          savedAt: Date.now(),
        })
        setOrder(latest)
        setNowMs(Date.now())
      } catch (lookupErr) {
        if (errorCodeOf(lookupErr) === 'SERVICE_ORDER_NOT_FOUND') {
          forgetServiceTrip('mock_interview', sentTrip.orderId)
          setTrip(null)
          setOrder(null)
        }
      }
    }
    return false
  }, [endUserId, getToken, navigate, onBeforeNavigatePay, setError])

  const primaryLabel = useCallback((defaultLabel: string): string => {
    if (isRetryFree) return '免费再试一次'
    if (controlMode === 'start' && needsPay && !(aiOutage && hasPendingSession)) {
      return `付 ${formatYuan(priceCents)}开始练`
    }
    return defaultLabel
  }, [aiOutage, controlMode, hasPendingSession, isRetryFree, needsPay, priceCents])

  return {
    priceCents,
    checkingPay,
    paidTrip,
    isRetryFree,
    needsPay,
    showChargeBar,
    startFailureHint: startFailureHintFor(phase),
    primaryLabel,
    startPay,
    handleStartError,
  }
}
