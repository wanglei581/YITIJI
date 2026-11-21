// ============================================================
// 模拟面试设置页（iv-3）按次付款状态：读本机生效价、核对本趟服务单、
// 付款前先走年满 14 周岁确认、付成返回后自动带头开场、没开成走免费再试或如实提示退款。
// 价目与查单未就绪前禁止开场/付款/删旧单；跨用户与清场代次守卫拦截全部晚到异步回调；
// 免费再试窗按真实时间装精准到期定时器，到期瞬间自动切回收费入口。
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
import { errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'
import {
  forgetServiceTrip,
  onServiceTripsCleared,
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
const KEEP_TRIP_PHASES: ReadonlySet<ServiceOrderPhase> = new Set(['awaiting', 'checking', 'paid', 'retry_free', 'in_use'])

interface PriceState {
  cents: number
  ready: boolean
}

interface TripLookupState {
  /** undefined 表示当前用户本趟单仍在核对中；等于当前 endUserId 表示已完成初始核对。 */
  resolvedFor: string | null | undefined
  trip: ServiceTrip | null
  order: ServiceOrderView | null
}

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
  if (phase === 'retry_expired') return `免费再试时间已过。钱${PAY_BACK}。`
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

function tripMatchesCurrentOwner(
  target: { orderId: string; kioskSessionId: string },
  expectedEndUserId: string | null,
): boolean {
  const stored = readServiceTrip('mock_interview', { owner: serviceTripOwnerFor(expectedEndUserId) })
  return Boolean(stored && stored.orderId === target.orderId && stored.kioskSessionId === target.kioskSessionId)
}

export interface InterviewChargeState {
  priceCents: number
  priceReady: boolean
  tripResolved: boolean
  chargeReady: boolean
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

  const [priceState, setPriceState] = useState<PriceState>(() => {
    if (API_MODE !== 'http') return { cents: 0, ready: true }
    const terminalId = getTerminalId()
    if (!terminalId) return { cents: 0, ready: true }
    const cached = peekCachedKioskTerminalConfig(terminalId)
    return cached ? { cents: mockInterviewEffectivePrice(cached), ready: true } : { cents: 0, ready: false }
  })
  const [tripState, setTripState] = useState<TripLookupState>(() => {
    if (API_MODE !== 'http' || !getTerminalId()) return { resolvedFor: endUserId, trip: null, order: null }
    const stored = readServiceTrip('mock_interview', { owner: serviceTripOwnerFor(endUserId) })
    return stored ? { resolvedFor: undefined, trip: null, order: null } : { resolvedFor: endUserId, trip: null, order: null }
  })
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [checkingAge, setCheckingAge] = useState(false)
  const busyPayRef = useRef(false)
  const autoStartedRef = useRef(false)
  const mountedRef = useRef(true)
  const genRef = useRef(0)
  const endUserIdRef = useRef<string | null>(endUserId)

  // 同步响应切换用户：render 期立即自增代次，确保切人后任意旧异步回调立即可识别为过期。
  if (endUserIdRef.current !== endUserId) {
    endUserIdRef.current = endUserId
    genRef.current += 1
  }
  const renderGen = genRef.current

  const isCurrentGen = useCallback(
    (gen: number, expectedEndUserId: string | null): boolean =>
      mountedRef.current && gen === genRef.current && endUserIdRef.current === expectedEndUserId,
    [],
  )

  useEffect(() => {
    mountedRef.current = true
    const unsubscribe = onServiceTripsCleared(() => {
      genRef.current += 1
      setTripState({ resolvedFor: endUserIdRef.current, trip: null, order: null })
    })
    return () => {
      mountedRef.current = false
      genRef.current += 1
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (API_MODE !== 'http') { setPriceState({ cents: 0, ready: true }); return undefined }
    const terminalId = getTerminalId()
    if (!terminalId) { setPriceState({ cents: 0, ready: true }); return undefined }
    let cancelled = false
    void getCachedKioskTerminalConfig(terminalId)
      .then((config) => {
        if (!cancelled && mountedRef.current) {
          setPriceState({ cents: mockInterviewEffectivePrice(config), ready: true })
        }
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) {
          setPriceState((prev) => ({ cents: prev.cents, ready: true }))
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const lookupGen = genRef.current
    const lookupUser = endUserId
    const owner = serviceTripOwnerFor(lookupUser)
    const stored = readServiceTrip('mock_interview', { owner })
    const terminalId = getTerminalId()
    if (!stored || API_MODE !== 'http' || !terminalId) {
      setTripState({ resolvedFor: lookupUser, trip: null, order: null })
      return undefined
    }
    let cancelled = false
    setTripState({ resolvedFor: undefined, trip: null, order: null })
    void getServiceOrder(stored.orderId, stored.kioskSessionId)
      .then((view) => {
        if (cancelled || !isCurrentGen(lookupGen, lookupUser)) return
        if (!tripMatchesCurrentOwner(stored, lookupUser)) {
          setTripState({ resolvedFor: lookupUser, trip: null, order: null })
          return
        }
        setTripState({ resolvedFor: lookupUser, trip: stored, order: view })
        setNowMs(Date.now())
      })
      .catch((err) => {
        if (cancelled || !isCurrentGen(lookupGen, lookupUser)) return
        if (errorCodeOf(err) === 'SERVICE_ORDER_NOT_FOUND') {
          forgetServiceTrip('mock_interview', stored.orderId)
          setTripState({ resolvedFor: lookupUser, trip: null, order: null })
        } else {
          setTripState({ resolvedFor: lookupUser, trip: stored, order: null })
        }
      })
    return () => { cancelled = true }
  }, [endUserId, isCurrentGen])

  const priceCents = priceState.cents
  const priceReady = priceState.ready
  const tripResolved = tripState.resolvedFor === endUserId
  const chargeReady = priceReady && tripResolved
  const checkingPay = checkingAge || !chargeReady
  const trip = tripResolved ? tripState.trip : null
  const order = tripResolved ? tripState.order : null

  const effectiveNowMs = Math.max(nowMs, Date.now())
  const phase: ServiceOrderPhase | null = order ? serviceOrderPhase(order, effectiveNowMs) : null
  const usableTrip = trip && (phase === 'paid' || phase === 'retry_free') ? trip : null
  const paidTrip = usableTrip ? toStartTrip(usableTrip) : null
  const isRetryFree = paidTrip !== null && phase === 'retry_free'
  const needsPay = chargeReady && priceCents > 0 && paidTrip === null
  const showChargeBar = needsPay && !creating && controlMode === 'start' && !(aiOutage && hasPendingSession)

  const chargeReadyRef = useRef(chargeReady)
  chargeReadyRef.current = chargeReady
  const priceReadyRef = useRef(priceReady)
  priceReadyRef.current = priceReady
  const tripResolvedRef = useRef(tripResolved)
  tripResolvedRef.current = tripResolved

  // 免费再试窗精准到期定时器：跨过 retryUntil 瞬间立即撤掉「免费再试一次」，切回收费入口。
  const retryAtMs = order?.retryUntil ? Date.parse(order.retryUntil) : Number.NaN
  const activeRetryWindow = Boolean(trip && order && phase === 'retry_free' && Number.isFinite(retryAtMs))
  useEffect(() => {
    if (!activeRetryWindow || !Number.isFinite(retryAtMs)) return undefined
    const delay = Math.max(0, retryAtMs - Date.now())
    const timer = window.setTimeout(() => {
      if (!mountedRef.current) return
      setNowMs(Math.max(Date.now(), retryAtMs))
    }, delay)
    return () => { window.clearTimeout(timer) }
  }, [activeRetryWindow, retryAtMs, trip?.orderId])

  // 二次失败进入退款中时温和轮询，后端真正退成后才切已退句。
  useEffect(() => {
    if (!trip || phase !== 'refunding') return undefined
    let cancelled = false
    let polls = 0
    let timer = 0
    const pollGen = genRef.current
    const pollUser = endUserId
    const tick = async () => {
      polls += 1
      try {
        const latest = await getServiceOrder(trip.orderId, trip.kioskSessionId)
        if (cancelled || !isCurrentGen(pollGen, pollUser)) return
        setTripState({ resolvedFor: pollUser, trip, order: latest })
        setNowMs(Date.now())
        if (latest.status === 'refunding' && polls < REFUND_POLL_MAX) {
          timer = window.setTimeout(() => void tick(), REFUND_POLL_MS)
        }
      } catch {
        if (!cancelled && isCurrentGen(pollGen, pollUser) && polls < REFUND_POLL_MAX) {
          timer = window.setTimeout(() => void tick(), REFUND_POLL_MS)
        }
      }
    }
    timer = window.setTimeout(() => void tick(), REFUND_POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [endUserId, isCurrentGen, phase, trip])

  useEffect(() => {
    if (!autoStartAfterPay || !chargeReady || step !== 3 || creating || autoStartedRef.current) return
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
  }, [autoStartAfterPay, chargeReady, controlMode, creating, onAutoStart, onClearAutoStart, paidTrip, phase, step])

  const startPay = useCallback(async () => {
    // 价目与查单未就绪前绝不允许开场、删旧单或导航付款屏，防止重复建单。
    if (!chargeReadyRef.current || !priceReadyRef.current || !tripResolvedRef.current) return
    if (busyPayRef.current || !isCurrentGen(renderGen, endUserId)) return
    const invalid = validateBasics()
    if (invalid) { setError(invalid); return }
    busyPayRef.current = true
    setCheckingAge(true)
    setError(null)
    try {
      await ensureAge14DeclaredForPay(getToken())
    } catch (err) {
      if (isCurrentGen(renderGen, endUserId)) {
        const declined = aiDeclarationDeclineMessage(err)
        if (declined) setError(declined)
      }
      return
    } finally {
      busyPayRef.current = false
      if (mountedRef.current) setCheckingAge(false)
    }
    if (!isCurrentGen(renderGen, endUserId) || !tripResolvedRef.current) return
    const existing = readServiceTrip('mock_interview', { owner: serviceTripOwnerFor(endUserId) })
    if (existing && order && existing.orderId === order.id && phase !== null && !KEEP_TRIP_PHASES.has(phase)) {
      forgetServiceTrip('mock_interview', existing.orderId)
    }
    onBeforeNavigatePay(true)
    navigate(payServicePath('interview', { next: 'setup', back: 'setup' }))
  }, [endUserId, getToken, isCurrentGen, navigate, onBeforeNavigatePay, order, phase, renderGen, setError, validateBasics])

  const handleStartError = useCallback(async (err: unknown, sentTrip?: InterviewStartTrip): Promise<boolean> => {
    if (!isCurrentGen(renderGen, endUserId)) return true
    if (isServiceOrderBounceError(err)) {
      const code = errorCodeOf(err)
      const status = err instanceof InterviewApiError
        ? err.status
        : (err && typeof err === 'object' && 'status' in err ? Number((err as { status?: unknown }).status) : 0)
      if (sentTrip && code !== 'SERVICE_ORDER_IN_USE' && tripMatchesCurrentOwner(sentTrip, endUserId)) {
        forgetServiceTrip('mock_interview', sentTrip.orderId)
        setTripState({ resolvedFor: endUserId, trip: null, order: null })
      }
      let nextPrice = priceCents
      const terminalId = getTerminalId()
      if (terminalId) {
        const fresh = await refreshKioskTerminalConfig(terminalId).catch(() => null)
        if (!isCurrentGen(renderGen, endUserId)) return true
        if (fresh) {
          nextPrice = mockInterviewEffectivePrice(fresh)
          setPriceState({ cents: nextPrice, ready: true })
        }
      }
      // 防 402 循环：刷新后价格仍为 0，或已带付款单仍被 402 拒收时停在当前页，不再自动重入付款屏。
      if (status === 402 || code === 'SERVICE_PAYMENT_REQUIRED') {
        if (nextPrice <= 0 || sentTrip) {
          setError(userMessageOf(err, '当前费用状态发生变化，请核对后重新开始'))
          return true
        }
        try {
          await ensureAge14DeclaredForPay(getToken())
        } catch (declErr) {
          if (isCurrentGen(renderGen, endUserId)) {
            const declined = aiDeclarationDeclineMessage(declErr)
            if (declined) setError(declined)
          }
          return true
        }
      }
      if (!isCurrentGen(renderGen, endUserId)) return true
      onBeforeNavigatePay(code !== 'SERVICE_ORDER_IN_USE')
      navigate(payServicePath('interview', { next: 'setup', back: 'setup' }))
      return true
    }
    if (sentTrip) {
      if (!tripMatchesCurrentOwner(sentTrip, endUserId)) return false
      try {
        const latest = await getServiceOrder(sentTrip.orderId, sentTrip.kioskSessionId)
        if (!isCurrentGen(renderGen, endUserId)) return true
        if (!tripMatchesCurrentOwner(sentTrip, endUserId)) return false
        setTripState({
          resolvedFor: endUserId,
          trip: {
            serviceKey: 'mock_interview',
            orderId: sentTrip.orderId,
            kioskSessionId: sentTrip.kioskSessionId,
            owner: serviceTripOwnerFor(endUserId),
            savedAt: Date.now(),
          },
          order: latest,
        })
        setNowMs(Date.now())
      } catch (lookupErr) {
        if (!isCurrentGen(renderGen, endUserId)) return true
        if (!tripMatchesCurrentOwner(sentTrip, endUserId)) return false
        if (errorCodeOf(lookupErr) === 'SERVICE_ORDER_NOT_FOUND') {
          forgetServiceTrip('mock_interview', sentTrip.orderId)
          setTripState({ resolvedFor: endUserId, trip: null, order: null })
        }
      }
    }
    return false
  }, [endUserId, getToken, isCurrentGen, navigate, onBeforeNavigatePay, priceCents, renderGen, setError])

  const primaryLabel = useCallback((defaultLabel: string): string => {
    if (!chargeReady && controlMode !== 'sheet' && !(aiOutage && hasPendingSession)) {
      return '正在确认费用'
    }
    if (isRetryFree) return '免费再试一次'
    if (controlMode === 'start' && needsPay && !(aiOutage && hasPendingSession)) {
      return `付 ${formatYuan(priceCents)}开始练`
    }
    return defaultLabel
  }, [aiOutage, chargeReady, controlMode, hasPendingSession, isRetryFree, needsPay, priceCents])

  return {
    priceCents,
    priceReady,
    tripResolved,
    chargeReady,
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
