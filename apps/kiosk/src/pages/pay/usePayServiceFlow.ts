// ============================================================
// 付款屏的流程：进屏即出码（稿 beginPay）、轮询、核实、超时、再出一张码、返回关单、付好去下一步。
//
// 四条查单/核实路径（常规轮询、手动刷新、到点自动核实、lookup/close_failed 再查一次）共用
// payPollGuard：普通查单约 3 秒一次；相邻 refresh=1 不少于 10 秒；微信待付期间每 15 秒自动带一次；
// 已过 expiresAt 且服务端仍回 checking:true 时保持轮询续查；60 秒窗口封顶 28 次（留在服务端 30 次/分以内）；
// 遇 429 按 Retry-After 或指数退避。离开本页、或不再等付款时停轮询并清理定时。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { API_MODE } from '../../services/api/client'
import {
  getServiceOrder,
  serviceOrderExpiredLocally,
  serviceOrderPhase,
  type ServiceOrderPhase,
  type ServiceOrderView,
} from '../../services/api/serviceOrders'
import { getTerminalId, refreshKioskTerminalConfig } from '../../services/api/terminalConfig'
import { errorCodeOf } from '../../services/api/userErrorMessage'
import { forgetServiceTrip, readServiceTrip, serviceTripOwnerFor, type ServiceTrip } from '../../services/serviceTrip'
import { keepServiceTripOrder, openServiceTripOrder, retireServiceTripOrder } from '../../services/serviceTripOrder'
import { useMiniappCreditFlow } from './useMiniappCreditFlow'
import {
  PAY_OK_ADVANCE_MS, PAY_POLL_MS, createPayPollGuardState, initialPollDelayMs, isRateLimitedError,
  noteOrderAnchor, planPollRequest, planRefreshOnlyRequest, recordGetRequest, recordGetSuccess, recordRateLimit,
} from './payPollGuard'
import { PAY_SERVICE_KEY, pricingSaysFree, screenForPhase, type PayScreen, type PayWhat } from './payServiceModel'

export {
  PAY_429_BACKOFF_BASE_MS, PAY_429_BACKOFF_MAX_MS, PAY_AUTO_REFRESH_GAP_MS,
  PAY_GET_CAP_PER_MINUTE, PAY_OK_ADVANCE_MS, PAY_POLL_MS, PAY_REFRESH_GAP_MS,
} from './payPollGuard'

interface FlowState {
  screen: PayScreen
  order: ServiceOrderView | null
  phase: ServiceOrderPhase | null
  /** 没出成码或查不到时的那次错误。句子在画屏时才拼：服务电话晚到时跟着更新。 */
  error: unknown
  /** 服务端最新视图处于核实中（checking:true）；收到 checking:false 时立即复位。 */
  checking: boolean
  /** 本地已过 expiresAt 后已发过 refresh=1 且服务端仍返回 checking:true，需保持续查。 */
  postExpiryChecking: boolean
  /** 遇到 429 限流，当前正按 Retry-After 或退避间隔等待下一次核对。 */
  rateLimited: boolean
}

export interface PayFlow extends FlowState {
  /** 屏上实际画的那一态：等待中本地已到点先进入核实态，经 refresh=1 确认后才落超时。 */
  view: PayScreen
  remainMs: number | null
  busy: boolean
  /** 权益被并发抢走或退回后切回扫码的诚实提示。 */
  creditNotice: string | null
  onRefresh: () => void
  onRetry: () => void
  onLeave: (closeOrder: boolean) => void
  onStart: () => void
  onUseCredit: () => void
}

const INITIAL: FlowState = { screen: 'loading', order: null, phase: null, error: null, checking: false, postExpiryChecking: false, rateLimited: false }
const WAITING: ReadonlySet<PayScreen> = new Set(['wait', 'check'])

function settledPatch(screen: PayScreen, error: unknown = null, extra?: Partial<FlowState>): (prev: FlowState) => FlowState {
  return (prev) => ({ ...prev, screen, error, checking: false, postExpiryChecking: false, rateLimited: false, ...extra })
}

export function usePayServiceFlow(what: PayWhat, targets: { next: string; back: string }): PayFlow {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, getToken } = useAuth()
  const serviceKey = PAY_SERVICE_KEY[what]
  const endUserId = user?.id ?? null
  const [state, setState] = useState<FlowState>(INITIAL)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const tripRef = useRef<ServiceTrip | null>(null)
  const orderRef = useRef<ServiceOrderView | null>(null)
  const genRef = useRef(0)
  const guardRef = useRef(createPayPollGuardState())
  const inflightRef = useRef<Promise<void> | null>(null)
  const rescheduleRef = useRef<((delayMs: number) => void) | null>(null)
  const leavingRef = useRef(false)
  const endUserIdRef = useRef(endUserId)
  endUserIdRef.current = endUserId

  const current = useCallback((gen: number) => gen === genRef.current && !leavingRef.current, [])
  const dropMissingOrder = useCallback((trip: ServiceTrip) => {
    forgetServiceTrip(trip.serviceKey, trip.orderId); tripRef.current = null
    setState(settledPatch('timeout', null, { phase: 'timed_out' }))
  }, [])
  const trackInflight = useCallback(async (task: () => Promise<void>) => {
    const run = task(); inflightRef.current = run
    try { await run } finally { if (inflightRef.current === run) inflightRef.current = null }
  }, [])
  const goNext = useCallback(() => { leavingRef.current = true; navigate(targets.next, { replace: true }) }, [navigate, targets.next])
  const passFree = useCallback(() => { setState({ ...INITIAL, screen: 'free' }); goNext() }, [goNext])

  const applyView = useCallback((view: ServiceOrderView, fromRefresh: boolean) => {
    orderRef.current = view
    const now = Date.now()
    // 剩余时间按这一刻算：进屏到出码之间隔了一两秒，沿用挂载时的时刻会多写一秒（5:01）。
    setNowMs(now)
    const phase = serviceOrderPhase(view, now)
    const expired = serviceOrderExpiredLocally(view, now)
    setState((prev) => {
      // 本地已到点但本次不是 refresh=1 核实、且服务端尚未关单（仍是 pending 无失败）：
      // 不让普通轮询抢先判 timeout，先留核实态等到点或续查的 refresh=1 落定。
      if (phase === 'timed_out' && view.status === 'pending' && !fromRefresh) {
        return { screen: 'check', order: view, phase: 'checking', error: null, checking: true, postExpiryChecking: prev.postExpiryChecking, rateLimited: false }
      }
      // checking 严格跟随服务端最新视图：未过期期间普通查单返回 checking:false 立即复位回 wait，不粘滞假核实。
      const checking = phase === 'checking'
      const postExpiryChecking = checking && expired && (fromRefresh || prev.postExpiryChecking)
      const mapped = screenForPhase(phase)
      const screen: PayScreen = mapped === 'renew' ? 'timeout' : WAITING.has(mapped) ? (checking ? 'check' : 'wait') : mapped
      return { screen, order: view, phase, error: null, checking, postExpiryChecking, rateLimited: false }
    })
  }, [])

  const create = useCallback(async (gen: number) => {
    const startedUserId = endUserId
    const alive = () => current(gen) && endUserIdRef.current === startedUserId
    setState({ ...INITIAL, screen: 'loading' })
    try {
      const opened = await openServiceTripOrder({ serviceKey, pathname, endUserId: startedUserId })
      if (!alive()) {
        // 人已经走了，或已经换成更新的一次/另一个人：这张晚到的单不要了，关掉。
        void retireServiceTripOrder(opened.trip, opened.view.status)
        return
      }
      keepServiceTripOrder(opened.trip)
      tripRef.current = opened.trip
      noteOrderAnchor(guardRef.current, Date.now())
      applyView(opened.view, false)
    } catch (error) {
      if (!alive()) return
      if (errorCodeOf(error) === 'SERVICE_FREE_ON_THIS_TERMINAL') {
        // 这项现在免费：先把本机价目缓存刷成新的，再直接去下一步，下一步就不会再把人送回付款屏。
        const terminalId = getTerminalId()
        if (terminalId) await refreshKioskTerminalConfig(terminalId).catch(() => undefined)
        if (!alive()) return
        passFree()
        return
      }
      setState({ ...INITIAL, screen: 'error', error })
    }
  }, [applyView, current, endUserId, passFree, pathname, serviceKey])

  const { creditNotice, checkOwned, onUseCredit } = useMiniappCreditFlow({
    what, serviceKey, pathname, endUserId, getToken, busy,
    isLeaving: () => leavingRef.current,
    nextGen: () => ++genRef.current,
    isCurrent: current,
    setBusy,
    onClearError: () => setState((prev) => ({ ...prev, error: null })),
    onRedeemError: (error) => setState((prev) => ({ ...prev, error })),
    onRedeemed: (redeemedView, trip) => { tripRef.current = trip; orderRef.current = redeemedView; goNext() },
    onFree: passFree,
    onFallbackQr: create,
  })

  const enter = useCallback(async (gen: number) => {
    const startedUserId = endUserId
    const alive = () => current(gen) && endUserIdRef.current === startedUserId
    const terminalId = getTerminalId()
    // 演示模式与没有终端身份（手机、桌面）不收费：直接前往合法站内下一步。
    if (API_MODE !== 'http' || !terminalId) return passFree()
    try {
      const config = await refreshKioskTerminalConfig(terminalId)
      if (!alive()) return
      if (pricingSaysFree(config, serviceKey)) return passFree()
    } catch {
      // 读不到本机价目就照常建单，由服务端按生效价判；免费时它会回 409。
    }
    const stored = readServiceTrip(serviceKey, { owner: serviceTripOwnerFor(startedUserId) })
    if (stored) {
      try {
        recordGetRequest(guardRef.current, Date.now(), false)
        let view = await getServiceOrder(stored.orderId, stored.kioskSessionId)
        recordGetSuccess(guardRef.current)
        if (!alive()) return
        let fromRefresh = false
        if (view.status === 'pending' && !view.paymentFailed && serviceOrderExpiredLocally(view, Date.now())) {
          const refreshAt = Date.now()
          if (planRefreshOnlyRequest(guardRef.current, refreshAt).allowed) {
            recordGetRequest(guardRef.current, refreshAt, true)
            view = await getServiceOrder(stored.orderId, stored.kioskSessionId, { refresh: true })
            recordGetSuccess(guardRef.current)
            if (!alive()) return
            fromRefresh = true
          }
        }
        const now = Date.now()
        const mapped = screenForPhase(serviceOrderPhase(view, now))
        const expiredNeedsCheck = view.status === 'pending' && !view.paymentFailed && !fromRefresh && serviceOrderExpiredLocally(view, now)
        if (mapped === 'wait' || mapped === 'check' || mapped === 'ok' || expiredNeedsCheck) {
          // 重载、或从别处回来：同一张单、同一张码。
          tripRef.current = stored
          noteOrderAnchor(guardRef.current, now)
          applyView(view, fromRefresh)
          return
        }
        // 没付成、超时、退款中、已关的旧单：用不上了，先确认关掉待付的，关不掉就留住原单号提示核实。
        const retired = await retireServiceTripOrder(stored, view.status)
        if (!alive()) return
        if (!retired.ok) {
          tripRef.current = stored
          orderRef.current = view
          setState({ ...INITIAL, screen: 'close_failed', order: view, phase: serviceOrderPhase(view, Date.now()), error: retired.error })
          return
        }
      } catch (error) {
        if (!alive()) return
        if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') forgetServiceTrip(serviceKey, stored.orderId)
        else {
          const rateLimited = isRateLimitedError(error)
          if (rateLimited) recordRateLimit(guardRef.current, error, Date.now())
          tripRef.current = stored
          setState({ ...INITIAL, screen: 'lookup', error, rateLimited })
          return
        }
      }
    }
    if (await checkOwned()) {
      if (!alive()) return
      setState({ ...INITIAL, screen: 'owned' })
      return
    }
    if (!alive()) return
    await create(gen)
  }, [applyView, checkOwned, create, current, endUserId, passFree, serviceKey])

  // 进屏或切换用户（endUserId 变更）立即作废旧代次、清掉旧人引用并重新判定；开发模式挂两次也会被撤掉。
  useEffect(() => {
    leavingRef.current = false
    tripRef.current = null
    orderRef.current = null
    guardRef.current = createPayPollGuardState()
    setState(INITIAL)
    const gen = ++genRef.current
    const timer = window.setTimeout(() => void enter(gen), 0)
    return () => {
      window.clearTimeout(timer)
      genRef.current += 1
    }
  }, [endUserId]) // eslint-disable-line react-hooks/exhaustive-deps

  const pollOnce = useCallback(async (manual: boolean): Promise<{ nextDelayMs: number; sent: boolean }> => {
    const trip = tripRef.current
    if (!trip || inflightRef.current) return { nextDelayMs: PAY_POLL_MS, sent: false }
    const now = Date.now()
    const order = orderRef.current
    const plan = planPollRequest(guardRef.current, now, {
      manual,
      provider: order?.provider,
      postExpiryChecking: order !== null && serviceOrderExpiredLocally(order, now),
    })
    if (!plan.allowed) {
      if (plan.reason === 'backoff') setState((prev) => (prev.rateLimited ? prev : { ...prev, rateLimited: true }))
      return { nextDelayMs: plan.nextDelayMs, sent: false }
    }
    recordGetRequest(guardRef.current, now, plan.refresh)
    const gen = genRef.current
    let nextDelayMs = PAY_POLL_MS
    await trackInflight(async () => {
      try {
        const view = await getServiceOrder(trip.orderId, trip.kioskSessionId, { refresh: plan.refresh })
        recordGetSuccess(guardRef.current)
        if (current(gen)) applyView(view, plan.refresh)
      } catch (error) {
        if (!current(gen)) return
        if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') return dropMissingOrder(trip)
        if (isRateLimitedError(error)) {
          // 遇到 429 限流：按 Retry-After 或指数退避拉长间隔，不再 3 秒死打，并给出清晰不恐慌提示。
          nextDelayMs = recordRateLimit(guardRef.current, error, Date.now())
          setState((prev) => (prev.rateLimited ? prev : { ...prev, rateLimited: true }))
        }
        // 其它失败（多半是网络）：留着上一次的样子，下一拍再查，不伪造结果。
      }
    })
    return { nextDelayMs, sent: true }
  }, [applyView, current, dropMissingOrder, trackInflight])

  const expiredLocally = WAITING.has(state.screen) && state.order !== null && serviceOrderExpiredLocally(state.order, nowMs)
  // 本地倒计时归零时先保持核实态向服务端发一次 refresh=1，不直接切 timeout。
  const view: PayScreen = expiredLocally ? 'check' : state.screen
  // 已过 expiresAt 且经 refresh=1 收到服务端 checking:true 时保持轮询续查，不关死轮询。
  const polling = WAITING.has(state.screen) && (!expiredLocally || state.postExpiryChecking)
  const pendingExpiryOrderId = expiredLocally && !state.postExpiryChecking ? (state.order?.id ?? null) : null

  useEffect(() => {
    if (!polling) return undefined
    let stopped = false
    let timer = 0
    const schedule = (delayMs: number) => {
      window.clearTimeout(timer)
      if (!stopped) timer = window.setTimeout(() => void tick(), delayMs)
    }
    const tick = async () => {
      const { nextDelayMs } = await pollOnce(false)
      schedule(nextDelayMs)
    }
    rescheduleRef.current = schedule
    schedule(initialPollDelayMs(guardRef.current, Date.now()))
    const clock = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => {
      stopped = true
      rescheduleRef.current = null
      window.clearTimeout(timer)
      window.clearInterval(clock)
    }
  }, [polling, pollOnce])

  useEffect(() => {
    if (!pendingExpiryOrderId) return undefined
    const orderId = pendingExpiryOrderId
    let cancelled = false
    let timer = 0
    const gen = genRef.current
    const schedule = (delayMs: number) => {
      window.clearTimeout(timer)
      if (!cancelled) timer = window.setTimeout(() => void attempt(), delayMs)
    }
    const attempt = async () => {
      const pending = inflightRef.current
      if (pending) await pending.catch(() => undefined)
      if (cancelled || !current(gen)) return
      const latestOrder = orderRef.current
      if (latestOrder && latestOrder.id === orderId && (latestOrder.status !== 'pending' || latestOrder.paymentFailed)) return
      const trip = tripRef.current
      if (!trip || trip.orderId !== orderId) return
      const now = Date.now()
      const plan = planRefreshOnlyRequest(guardRef.current, now)
      if (!plan.allowed) {
        if (plan.reason === 'backoff') setState((prev) => (prev.rateLimited ? prev : { ...prev, rateLimited: true }))
        schedule(plan.waitMs)
        return
      }
      recordGetRequest(guardRef.current, now, true)
      await trackInflight(async () => {
        try {
          const refreshed = await getServiceOrder(trip.orderId, trip.kioskSessionId, { refresh: true })
          recordGetSuccess(guardRef.current)
          if (cancelled || !current(gen)) return
          applyView(refreshed, true)
        } catch (error) {
          if (cancelled || !current(gen)) return
          if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') return dropMissingOrder(trip)
          if (isRateLimitedError(error)) {
            const delayMs = recordRateLimit(guardRef.current, error, Date.now())
            setState((prev) => ({ ...prev, screen: 'check', checking: true, rateLimited: true }))
            const nextPlan = planRefreshOnlyRequest(guardRef.current, Date.now())
            schedule(nextPlan.allowed ? delayMs : nextPlan.waitMs)
            return
          }
          // 到点核实请求失败：保留单号与订单视图，落到可重试核实态，绝不误判为超时。
          setState(settledPatch('lookup', error))
        }
      })
    }
    void attempt()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [applyView, current, dropMissingOrder, pendingExpiryOrderId, trackInflight])

  useEffect(() => {
    if (view !== 'ok') return undefined
    const timer = window.setTimeout(goNext, PAY_OK_ADVANCE_MS)
    return () => window.clearTimeout(timer)
  }, [view, goNext])

  useBusyLock(view === 'loading' || polling || expiredLocally)

  const onRefresh = useCallback(() => {
    if (!polling) return
    void pollOnce(true).then(({ nextDelayMs, sent }) => {
      if (sent) rescheduleRef.current?.(nextDelayMs)
    })
  }, [pollOnce, polling])

  const onRetry = useCallback(() => {
    if (busy) return
    const old = tripRef.current
    if (view === 'lookup' || view === 'close_failed') {
      // 本机记着的单核实或关单失败：过同一套退避/10 秒间隔/28 次上限门禁再发 refresh=1，不另建新单。
      const stored = old ?? readServiceTrip(serviceKey, { owner: serviceTripOwnerFor(endUserId) })
      if (!stored) {
        const gen = ++genRef.current
        setBusy(true)
        void enter(gen).finally(() => setBusy(false))
        return
      }
      const now = Date.now()
      const plan = planRefreshOnlyRequest(guardRef.current, now)
      if (!plan.allowed) {
        if (plan.reason === 'backoff') setState((prev) => (prev.rateLimited ? prev : { ...prev, rateLimited: true }))
        return
      }
      if (inflightRef.current) return
      const gen = ++genRef.current
      setBusy(true)
      recordGetRequest(guardRef.current, now, true)
      void trackInflight(async () => {
        try {
          const refreshed = await getServiceOrder(stored.orderId, stored.kioskSessionId, { refresh: true })
          recordGetSuccess(guardRef.current)
          if (!current(gen)) return
          tripRef.current = stored
          applyView(refreshed, true)
        } catch (error) {
          if (!current(gen)) return
          if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') {
            dropMissingOrder(stored)
          } else if (isRateLimitedError(error)) {
            recordRateLimit(guardRef.current, error, Date.now())
            tripRef.current = stored
            setState(settledPatch('lookup', error, { rateLimited: true }))
          } else {
            tripRef.current = stored
            setState(settledPatch('lookup', error))
          }
        }
      }).finally(() => setBusy(false))
      return
    }
    const gen = ++genRef.current
    setBusy(true)
    void (async () => {
      try {
        if (old) {
          const retired = await retireServiceTripOrder(old, orderRef.current?.status ?? null)
          if (!current(gen)) return
          if (!retired.ok) {
            // 关单失败：绝不静默删掉旧单号再建新单，留在屏上提示原单号已保留。
            tripRef.current = old
            setState(settledPatch('close_failed', retired.error))
            return
          }
          tripRef.current = null
          if (retired.view && (retired.view.status === 'refunding' || retired.view.status === 'refunded' || retired.view.status === 'refund_failed')) {
            applyView(retired.view, true)
            return
          }
        }
        if (!current(gen)) return
        await create(gen)
      } finally {
        setBusy(false)
      }
    })()
  }, [applyView, busy, create, current, dropMissingOrder, endUserId, enter, serviceKey, trackInflight, view])

  const onLeave = useCallback((closeOrder: boolean) => {
    if (leavingRef.current) return
    leavingRef.current = true
    genRef.current += 1
    const trip = tripRef.current
    setBusy(true)
    void (async () => {
      try {
        // 不付了：还在待付的关掉（万一已经付了，服务端会自动原路退）。付好了的返回不关，这一趟还能接着用。
        if (closeOrder && trip) {
          const retired = await retireServiceTripOrder(trip, orderRef.current?.status ?? 'pending')
          if (!retired.ok) {
            // 关单失败：保留本地单号不静默离开，回到可恢复态并允许先返回或再查一次。
            leavingRef.current = false
            tripRef.current = trip
            setState(settledPatch('close_failed', retired.error))
            return
          }
        }
        navigate(targets.back, { replace: true })
      } finally {
        setBusy(false)
      }
    })()
  }, [navigate, targets.back])

  const remainMs = state.order && WAITING.has(view) ? Math.max(0, Date.parse(state.order.expiresAt) - nowMs) : null

  return { ...state, view, remainMs, busy, creditNotice, onRefresh, onRetry, onLeave, onStart: goNext, onUseCredit }
}
