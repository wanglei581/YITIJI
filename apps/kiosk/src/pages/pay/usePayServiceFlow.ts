// ============================================================
// 付款屏的流程：进屏即出码（稿 beginPay）、轮询、核实、超时、再出一张码、返回关单、付好去下一步。
//
// 轮询：普通查单约 3 秒一次；refresh=1（向渠道查）只在点「刷新付款结果」时、且离上一次不少于
// 10 秒才带；微信通道另外每 15 秒自动带一次（沙箱没有渠道账本，不自动带）。每分钟查单总数封顶
// 28 次，留在服务端每台每分钟 30 次以内。离开本页、或这一态不再等付款，轮询就停。
// 超时按本地时钟对 expiresAt 判：服务端清扫最多晚 30 秒才关单，屏上不跟着多等。
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
import {
  PAY_SERVICE_KEY,
  pricingSaysFree,
  screenForPhase,
  type PayScreen,
  type PayWhat,
} from './payServiceModel'

export const PAY_POLL_MS = 3_000
export const PAY_REFRESH_GAP_MS = 10_000
export const PAY_AUTO_REFRESH_GAP_MS = 15_000
export const PAY_GET_CAP_PER_MINUTE = 28
/** 稿：付款成功在屏上停 1.6 秒再进入下一步。 */
export const PAY_OK_ADVANCE_MS = 1_600

interface FlowState {
  screen: PayScreen
  order: ServiceOrderView | null
  phase: ServiceOrderPhase | null
  /** 没出成码或查不到时的那次错误。句子在画屏时才拼：服务电话晚到时跟着更新。 */
  error: unknown
  /** 向渠道核实过、还没确认到账。普通查单不清它，只有下一次核实或状态变了才清。 */
  checking: boolean
}

export interface PayFlow extends FlowState {
  /** 屏上实际画的那一态：等待中本地已过期就是超时。 */
  view: PayScreen
  remainMs: number | null
  busy: boolean
  onRefresh: () => void
  onRetry: () => void
  onLeave: (closeOrder: boolean) => void
  onStart: () => void
}

const INITIAL: FlowState = { screen: 'loading', order: null, phase: null, error: null, checking: false }
const WAITING: ReadonlySet<PayScreen> = new Set(['wait', 'check'])

export function usePayServiceFlow(what: PayWhat, targets: { next: string; back: string }): PayFlow {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user } = useAuth()
  const serviceKey = PAY_SERVICE_KEY[what]
  const endUserId = user?.id ?? null
  const [state, setState] = useState<FlowState>(INITIAL)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const tripRef = useRef<ServiceTrip | null>(null)
  const orderRef = useRef<ServiceOrderView | null>(null)
  const genRef = useRef(0)
  const getLogRef = useRef<number[]>([])
  const lastRefreshRef = useRef(0)
  const inflightRef = useRef<Promise<void> | null>(null)
  const expiryCheckedOrderIdRef = useRef<string | null>(null)
  const leavingRef = useRef(false)

  /** 这一次结果还算不算数：人没走，也没换成更新的一次。 */
  const current = useCallback((gen: number) => gen === genRef.current && !leavingRef.current, [])

  const applyView = useCallback((view: ServiceOrderView, fromRefresh: boolean) => {
    orderRef.current = view
    const now = Date.now()
    // 剩余时间按这一刻算：进屏到出码之间隔了一两秒，沿用挂载时的时刻会多写一秒（5:01）。
    setNowMs(now)
    const phase = serviceOrderPhase(view, now)
    setState((prev) => {
      // 本地已到点但本次不是 refresh=1 核实、且服务端尚未关单（仍是 pending 无失败）：
      // 不让普通轮询抢先判 timeout，先留核实态等到点那一次 refresh=1 落定。
      if (phase === 'timed_out' && view.status === 'pending' && !fromRefresh) {
        return { screen: 'check', order: view, phase: 'checking', error: null, checking: true }
      }
      let checking = false
      if (phase === 'checking') checking = true
      else if (phase === 'awaiting') checking = fromRefresh ? false : prev.checking
      const mapped = screenForPhase(phase)
      const screen: PayScreen = mapped === 'renew' ? 'timeout' : WAITING.has(mapped) ? (checking ? 'check' : 'wait') : mapped
      return { screen, order: view, phase, error: null, checking }
    })
  }, [])

  const goNext = useCallback(() => {
    leavingRef.current = true
    navigate(targets.next, { replace: true })
  }, [navigate, targets.next])

  const passFree = useCallback(() => {
    setState({ ...INITIAL, screen: 'free' })
    goNext()
  }, [goNext])

  const create = useCallback(async (gen: number) => {
    setState({ ...INITIAL, screen: 'loading' })
    try {
      const opened = await openServiceTripOrder({ serviceKey, pathname, endUserId })
      if (!current(gen)) {
        // 人已经走了，或已经换成更新的一次：这张晚到的单不要了，关掉。
        void retireServiceTripOrder(opened.trip, opened.view.status)
        return
      }
      keepServiceTripOrder(opened.trip)
      tripRef.current = opened.trip
      lastRefreshRef.current = Date.now()
      applyView(opened.view, false)
    } catch (error) {
      if (!current(gen)) return
      if (errorCodeOf(error) === 'SERVICE_FREE_ON_THIS_TERMINAL') {
        // 这项现在免费：先把本机价目缓存刷成新的，再直接去下一步，下一步就不会再把人送回付款屏。
        const terminalId = getTerminalId()
        if (terminalId) await refreshKioskTerminalConfig(terminalId).catch(() => undefined)
        if (!current(gen)) return
        passFree()
        return
      }
      setState({ ...INITIAL, screen: 'error', error })
    }
  }, [applyView, current, endUserId, passFree, pathname, serviceKey])

  const enter = useCallback(async (gen: number) => {
    const terminalId = getTerminalId()
    // 演示模式与没有终端身份（手机、桌面）不收费：直接前往合法站内下一步。
    if (API_MODE !== 'http' || !terminalId) return passFree()
    try {
      const config = await refreshKioskTerminalConfig(terminalId)
      if (!current(gen)) return
      if (pricingSaysFree(config, serviceKey)) return passFree()
    } catch {
      // 读不到本机价目就照常建单，由服务端按生效价判；免费时它会回 409。
    }
    const stored = readServiceTrip(serviceKey, { owner: serviceTripOwnerFor(endUserId) })
    if (stored) {
      try {
        let view = await getServiceOrder(stored.orderId, stored.kioskSessionId)
        if (!current(gen)) return
        let fromRefresh = false
        if (view.status === 'pending' && !view.paymentFailed && serviceOrderExpiredLocally(view, Date.now())) {
          view = await getServiceOrder(stored.orderId, stored.kioskSessionId, { refresh: true })
          if (!current(gen)) return
          fromRefresh = true
        }
        const mapped = screenForPhase(serviceOrderPhase(view, Date.now()))
        if (mapped === 'wait' || mapped === 'check' || mapped === 'ok') {
          // 重载、或从别处回来：同一张单、同一张码。
          tripRef.current = stored
          lastRefreshRef.current = Date.now()
          applyView(view, fromRefresh)
          return
        }
        // 没付成、超时、退款中、已关的旧单：用不上了，先确认关掉待付的，关不掉就留住原单号提示核实。
        const retired = await retireServiceTripOrder(stored, view.status)
        if (!current(gen)) return
        if (!retired.ok) {
          tripRef.current = stored
          orderRef.current = view
          setState({ screen: 'close_failed', order: view, phase: serviceOrderPhase(view, Date.now()), error: retired.error, checking: false })
          return
        }
      } catch (error) {
        if (!current(gen)) return
        if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') forgetServiceTrip(serviceKey, stored.orderId)
        else {
          tripRef.current = stored
          setState({ ...INITIAL, screen: 'lookup', error })
          return
        }
      }
    }
    await create(gen)
  }, [applyView, create, current, endUserId, passFree, serviceKey])

  // 进屏即出码。挂上之后隔一拍再开始：开发模式下组件会挂两次，第一次在这一拍之前就被撤掉，不会多建一张单。
  useEffect(() => {
    leavingRef.current = false
    const gen = ++genRef.current
    const timer = window.setTimeout(() => void enter(gen), 0)
    return () => {
      window.clearTimeout(timer)
      genRef.current += 1
    }
    // 只在进屏时跑一次。
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pollOnce = useCallback(async (manual: boolean) => {
    const trip = tripRef.current
    if (!trip || inflightRef.current) return
    const now = Date.now()
    const log = getLogRef.current.filter((at) => now - at < 60_000)
    getLogRef.current = log
    if (log.length >= PAY_GET_CAP_PER_MINUTE) return
    const sinceRefresh = now - lastRefreshRef.current
    const provider = orderRef.current?.provider
    const refresh = manual ? sinceRefresh >= PAY_REFRESH_GAP_MS : provider !== 'sandbox' && sinceRefresh >= PAY_AUTO_REFRESH_GAP_MS
    if (refresh) lastRefreshRef.current = now
    log.push(now)
    const gen = genRef.current
    const run = (async () => {
      try {
        const view = await getServiceOrder(trip.orderId, trip.kioskSessionId, { refresh })
        if (current(gen)) applyView(view, refresh)
      } catch (error) {
        if (!current(gen)) return
        if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') {
          // 这张单服务端不认了：按超时说（没收到钱，万一扣了自动退），再出一张码会建新的。
          forgetServiceTrip(trip.serviceKey, trip.orderId)
          tripRef.current = null
          setState((prev) => ({ ...prev, screen: 'timeout', checking: false }))
        }
        // 其它失败（多半是网络）：留着上一次的样子，下一拍再查，不伪造结果。
      }
    })()
    inflightRef.current = run
    try {
      await run
    } finally {
      if (inflightRef.current === run) inflightRef.current = null
    }
  }, [applyView, current])

  const expiredLocally = WAITING.has(state.screen) && state.order !== null && serviceOrderExpiredLocally(state.order, nowMs)
  // 本地倒计时归零时先保持核实态向服务端发一次 refresh=1，不直接切 timeout。
  const view: PayScreen = expiredLocally ? 'check' : state.screen
  const polling = WAITING.has(state.screen) && !expiredLocally

  useEffect(() => {
    if (!polling) return undefined
    let stopped = false
    let timer = 0
    const tick = async () => {
      await pollOnce(false)
      if (!stopped) timer = window.setTimeout(() => void tick(), PAY_POLL_MS)
    }
    timer = window.setTimeout(() => void tick(), PAY_POLL_MS)
    const clock = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      window.clearInterval(clock)
    }
  }, [polling, pollOnce])

  useEffect(() => {
    if (!expiredLocally || !state.order) return undefined
    const orderId = state.order.id
    if (expiryCheckedOrderIdRef.current === orderId) return undefined
    expiryCheckedOrderIdRef.current = orderId
    const gen = genRef.current
    void (async () => {
      const pending = inflightRef.current
      if (pending) await pending.catch(() => undefined)
      if (!current(gen)) return
      const latestOrder = orderRef.current
      if (latestOrder && latestOrder.id === orderId && (latestOrder.status !== 'pending' || latestOrder.paymentFailed)) return
      const trip = tripRef.current
      if (!trip || trip.orderId !== orderId) return
      const run = (async () => {
        const now = Date.now()
        lastRefreshRef.current = now
        getLogRef.current = [...getLogRef.current.filter((at) => now - at < 60_000), now]
        try {
          const refreshed = await getServiceOrder(trip.orderId, trip.kioskSessionId, { refresh: true })
          if (!current(gen)) return
          applyView(refreshed, true)
        } catch (error) {
          if (!current(gen)) return
          if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') {
            forgetServiceTrip(trip.serviceKey, trip.orderId)
            tripRef.current = null
            setState((prev) => ({ ...prev, screen: 'timeout', phase: 'timed_out', error: null, checking: false }))
            return
          }
          // 到点核实请求失败：保留单号与订单视图，落到可重试核实态，绝不误判为超时。
          setState((prev) => ({ ...prev, screen: 'lookup', error, checking: false }))
        }
      })()
      inflightRef.current = run
      try {
        await run
      } finally {
        if (inflightRef.current === run) inflightRef.current = null
      }
    })()
    return undefined
  }, [applyView, current, expiredLocally, state.order])

  useEffect(() => {
    if (view !== 'ok') return undefined
    const timer = window.setTimeout(goNext, PAY_OK_ADVANCE_MS)
    return () => window.clearTimeout(timer)
  }, [view, goNext])

  useBusyLock(view === 'loading' || polling || expiredLocally)

  const onRefresh = useCallback(() => {
    if (!polling) return
    void pollOnce(true)
  }, [pollOnce, polling])

  const onRetry = useCallback(() => {
    if (busy) return
    const gen = ++genRef.current
    setBusy(true)
    void (async () => {
      try {
        const old = tripRef.current
        if (view === 'lookup' || view === 'close_failed') {
          // 本机记着的单核实或关单失败：带 refresh=1 再核实一次，覆盖晚到已付结果，不另建新单。
          const stored = old ?? readServiceTrip(serviceKey, { owner: serviceTripOwnerFor(endUserId) })
          if (!stored) {
            await enter(gen)
            return
          }
          try {
            const now = Date.now()
            lastRefreshRef.current = now
            const refreshed = await getServiceOrder(stored.orderId, stored.kioskSessionId, { refresh: true })
            if (!current(gen)) return
            tripRef.current = stored
            applyView(refreshed, true)
          } catch (error) {
            if (!current(gen)) return
            if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') {
              forgetServiceTrip(serviceKey, stored.orderId)
              tripRef.current = null
              setState((prev) => ({ ...prev, screen: 'timeout', phase: 'timed_out', error: null, checking: false }))
            } else {
              tripRef.current = stored
              setState((prev) => ({ ...prev, screen: 'lookup', error, checking: false }))
            }
          }
          return
        }
        if (old) {
          const retired = await retireServiceTripOrder(old, orderRef.current?.status ?? null)
          if (!current(gen)) return
          if (!retired.ok) {
            // 关单失败：绝不静默删掉旧单号再建新单，留在屏上提示原单号已保留。
            tripRef.current = old
            setState((prev) => ({ ...prev, screen: 'close_failed', error: retired.error, checking: false }))
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
  }, [applyView, busy, create, current, endUserId, enter, serviceKey, view])

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
            setState((prev) => ({ ...prev, screen: 'close_failed', error: retired.error, checking: false }))
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

  return { ...state, view, remainMs, busy, onRefresh, onRetry, onLeave, onStart: goNext }
}
