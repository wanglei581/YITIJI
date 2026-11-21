// ============================================================
// 扫描这一趟的按次付款状态钩子、请求头读取与屏上扫描付成后自动续接（P2e-4）。
//
// 只调用 P2e-1 导出的 serviceOrders / serviceTrip / terminalConfig 函数，不另起存储键。
// ============================================================
import { useEffect, useState } from 'react'
import { subscribeKioskSensitiveSessionClear } from '../../auth/kioskSensitiveSession'
import { useAuth } from '../../auth/useAuth'
import { API_MODE } from '../../services/api/client'
import {
  getServiceOrder,
  serviceOrderHeaders,
  type ServiceOrderView,
} from '../../services/api/serviceOrders'
import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
} from '../../services/api/terminalConfig'
import { errorCodeOf } from '../../services/api/userErrorMessage'
import {
  forgetServiceTrip,
  onServiceTripsCleared,
  readServiceTrip,
  serviceTripOwnerFor,
  type ServiceTrip,
} from '../../services/serviceTrip'
import {
  readScanEffectiveCents,
  scanOrderIsEndedForNewTrip,
  scanOrderNeedsSettlePoll,
  scanTripAllowsStartWithoutPay,
} from './scanPayModel'
import { scanLifecycleGeneration } from './scanWorkbenchSession'

const SETTLE_POLL_MS = 5_000
const SETTLE_POLL_MAX = 24

/**
 * 屏上扫描点过「付 X.XX 元开始扫描」去付款屏、付成回到放纸设置页后的一次性续接记号。
 * 只活在内存里，清场 / 换人 / 回到怎么扫 / 扫描代次推进都会立刻清掉；
 * 正常进入放纸设置页时恒为 null，绝不会在未点击开始时自动建会话。
 */
let deviceAutoStartGeneration: number | null = null

export function armScanDeviceAutoStartAfterPay(): void {
  deviceAutoStartGeneration = scanLifecycleGeneration()
}

export function clearScanDeviceAutoStartAfterPay(): void {
  deviceAutoStartGeneration = null
}

export function isScanDeviceAutoStartArmed(): boolean {
  return deviceAutoStartGeneration !== null && deviceAutoStartGeneration === scanLifecycleGeneration()
}

export function consumeScanDeviceAutoStartAfterPay(): boolean {
  const armed = isScanDeviceAutoStartArmed()
  deviceAutoStartGeneration = null
  return armed
}

/** 面板路径上已被 POST /scan/sessions 以 402 明确拒过的“看似已付”旧单号，防止付款屏 ok ↔ 设置页 402 死循环。 */
const panelRejectedOrderIds = new Set<string>()

export function markScanPanelOrderRejected(orderId: string | null | undefined): void {
  if (orderId) panelRejectedOrderIds.add(orderId)
}

export function wasScanPanelOrderRejected(orderId: string | null | undefined): boolean {
  return Boolean(orderId && panelRejectedOrderIds.has(orderId))
}

function resetScanPayMemory(): void {
  clearScanDeviceAutoStartAfterPay()
  panelRejectedOrderIds.clear()
}

subscribeKioskSensitiveSessionClear(resetScanPayMemory)
onServiceTripsCleared(resetScanPayMemory)

function safeForgetScanTripById(orderId?: string): void {
  if (typeof forgetServiceTrip === 'function') forgetServiceTrip('scan', orderId)
}

/** 读取当前这一趟扫描服务单要带的两个头；无单时返回 undefined（免费机或未付）。 */
export function readScanServiceHeaders(endUserId: string | null | undefined): Record<string, string> | undefined {
  const trip = readServiceTrip('scan', { owner: serviceTripOwnerFor(endUserId) })
  if (!trip) return undefined
  return serviceOrderHeaders(trip)
}

/** 忘掉当前扫描服务单（完成页离场、旧单终结或服务端明确不可复用时调用）。 */
export function forgetScanServiceTrip(endUserId: string | null | undefined): void {
  const trip = readServiceTrip('scan', { owner: serviceTripOwnerFor(endUserId) })
  if (trip) safeForgetScanTripById(trip.orderId)
}

/** 进付款屏前兜底清掉已终结旧单（pending 待付单仍留给付款屏继续展示/关单）。 */
export function forgetEndedScanTrip(
  trip: ServiceTrip | null | undefined,
  order: ServiceOrderView | null | undefined,
): void {
  if (!trip || !order) return
  if (order.id !== trip.orderId) return
  if (scanOrderIsEndedForNewTrip(order, Date.now())) safeForgetScanTripById(trip.orderId)
}

export interface ScanPayGateState {
  loading: boolean
  /** 本机扫描生效价（分）。0 / null 表示不收费或读不到价。 */
  chargeCents: number | null
  trip: ServiceTrip | null
  order: ServiceOrderView | null
  /** 收费且这一趟尚未取得可用已付/免费再试单：需要把建会话按钮换成「付 X.XX 元开始扫描」。 */
  needsPayment: boolean
  /** 已有可用的已付或可免费再试单（或本机免费），可直接发起建会话。 */
  readyToCreate: boolean
}

function syncInitialConfig(enabled: boolean): { loaded: boolean; cents: number | null } {
  if (!enabled) return { loaded: false, cents: null }
  if (API_MODE !== 'http') return { loaded: true, cents: null }
  const terminalId = getTerminalId()
  if (!terminalId) return { loaded: true, cents: null }
  const cached = peekCachedKioskTerminalConfig(terminalId)
  if (!cached) return { loaded: false, cents: null }
  return { loaded: true, cents: readScanEffectiveCents(cached) }
}

/**
 * 怎么扫 / 放纸设置 / 面板建会话前置核验共用：读本机扫描价目 + 本趟已记服务单状态。
 * 价 0 / 读不到价 / 公共点位 / 演示模式：needsPayment 为 false，界面与建会话照原样。
 * 查单发现已结案或已终结旧单时当场忘掉，避免污染新一趟或被付款屏复用。
 */
export function useScanPayState(options?: { enabled?: boolean }): ScanPayGateState {
  const enabled = options?.enabled !== false
  const { user } = useAuth()
  const endUserId = user?.id ?? null
  const initialConfig = syncInitialConfig(enabled)
  const [chargeCents, setChargeCents] = useState<number | null>(initialConfig.cents)
  const [configLoaded, setConfigLoaded] = useState<boolean>(initialConfig.loaded)
  const [trip, setTrip] = useState<ServiceTrip | null>(() => (
    enabled && API_MODE === 'http' && getTerminalId()
      ? readServiceTrip('scan', { owner: serviceTripOwnerFor(endUserId) })
      : null
  ))
  const [order, setOrder] = useState<ServiceOrderView | null>(null)
  const [orderLoaded, setOrderLoaded] = useState<boolean>(() => enabled && trip === null)
  const [orderLookupFailed, setOrderLookupFailed] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setConfigLoaded(false)
      setOrderLoaded(false)
      return undefined
    }
    const terminalId = getTerminalId()
    if (API_MODE !== 'http' || !terminalId) {
      setChargeCents(null)
      setConfigLoaded(true)
      setTrip(null)
      setOrder(null)
      setOrderLoaded(true)
      setOrderLookupFailed(false)
      return undefined
    }
    let stale = false
    const currentTrip = readServiceTrip('scan', { owner: serviceTripOwnerFor(endUserId) })
    setTrip(currentTrip)
    setOrderLookupFailed(false)

    const cached = peekCachedKioskTerminalConfig(terminalId)
    if (cached) {
      setChargeCents(readScanEffectiveCents(cached))
      setConfigLoaded(true)
    } else {
      setConfigLoaded(false)
      void getCachedKioskTerminalConfig(terminalId)
        .then((config) => {
          if (stale) return
          setChargeCents(readScanEffectiveCents(config))
          setConfigLoaded(true)
        })
        .catch(() => {
          if (stale) return
          setChargeCents(null)
          setConfigLoaded(true)
        })
    }

    if (!currentTrip) {
      setOrder(null)
      setOrderLoaded(true)
    } else {
      setOrderLoaded(false)
      void getServiceOrder(currentTrip.orderId, currentTrip.kioskSessionId)
        .then((view) => {
          if (stale) return
          if (scanOrderIsEndedForNewTrip(view, Date.now())) {
            safeForgetScanTripById(currentTrip.orderId)
            setTrip(null)
            setOrder(null)
          } else {
            setOrder(view)
          }
          setOrderLoaded(true)
        })
        .catch((error) => {
          if (stale) return
          if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') {
            safeForgetScanTripById(currentTrip.orderId)
            setTrip(null)
            setOrder(null)
          } else {
            setOrderLookupFailed(true)
          }
          setOrderLoaded(true)
        })
    }

    return () => { stale = true }
  }, [enabled, endUserId])

  const loading = !enabled || !configLoaded || !orderLoaded
  const charged = typeof chargeCents === 'number' && chargeCents > 0
  const hasUsableOrder = order !== null && scanTripAllowsStartWithoutPay(order, Date.now())
  // 有本地单号却查单网络失败时，不误出第二次付款按钮；点开始由服务端按原单号判定。
  const needsPayment = charged && !loading && !hasUsableOrder && !(trip !== null && orderLookupFailed)
  const readyToCreate = !loading && (!charged || hasUsableOrder)
  return { loading, chargeCents, trip, order, needsPayment, readyToCreate }
}

/**
 * 结果页读当前这一趟的扫描服务单。无单（不收费 / 没付过）时不发请求，页面保持一字不改。
 * 失败结果页传入 pollWhileSettling=true，服务端清扫从 consumed/refunding 落定时自动刷新文案。
 */
export function useScanTripOrder(options?: { pollWhileSettling?: boolean }): {
  trip: ServiceTrip | null
  order: ServiceOrderView | null
  loading: boolean
} {
  const { user } = useAuth()
  const endUserId = user?.id ?? null
  const pollWhileSettling = options?.pollWhileSettling === true
  const [trip, setTrip] = useState<ServiceTrip | null>(() => (
    API_MODE === 'http' && getTerminalId()
      ? readServiceTrip('scan', { owner: serviceTripOwnerFor(endUserId) })
      : null
  ))
  const [order, setOrder] = useState<ServiceOrderView | null>(null)
  const [loading, setLoading] = useState<boolean>(() => trip !== null)

  useEffect(() => {
    const terminalId = getTerminalId()
    if (API_MODE !== 'http' || !terminalId) {
      setTrip(null)
      setOrder(null)
      setLoading(false)
      return undefined
    }
    const currentTrip = readServiceTrip('scan', { owner: serviceTripOwnerFor(endUserId) })
    setTrip(currentTrip)
    if (!currentTrip) {
      setOrder(null)
      setLoading(false)
      return undefined
    }
    let stale = false
    let timer = 0
    let polls = 0
    setLoading(true)

    const fetchOnce = async (): Promise<void> => {
      try {
        const view = await getServiceOrder(currentTrip.orderId, currentTrip.kioskSessionId)
        if (stale) return
        setOrder(view)
        setLoading(false)
        if (pollWhileSettling && scanOrderNeedsSettlePoll(view) && polls < SETTLE_POLL_MAX) {
          polls += 1
          timer = window.setTimeout(() => void fetchOnce(), SETTLE_POLL_MS)
        }
      } catch (error) {
        if (stale) return
        if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') {
          forgetServiceTrip('scan', currentTrip.orderId)
          setTrip(null)
          setOrder(null)
        }
        setLoading(false)
      }
    }
    void fetchOnce()
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [endUserId, pollWhileSettling])

  return { trip, order, loading }
}

/**
 * 屏上扫描从付款屏付成回来后自动续接建会话：
 * 只有在用户于放纸设置页亲手点过「付 X.XX 元开始扫描」并完成付款（或机器变为免费）时才触发一次，
 * 正常进入放纸设置页绝不触发。
 */
export function useScanDevicePayResume(input: {
  enabled: boolean
  pay: ScanPayGateState
  onResume: () => void
}): void {
  const { enabled, pay, onResume } = input
  useEffect(() => {
    if (!isScanDeviceAutoStartArmed()) return
    if (pay.loading) return
    if (pay.needsPayment) {
      clearScanDeviceAutoStartAfterPay()
      return
    }
    if (!enabled || !pay.readyToCreate) return
    if (consumeScanDeviceAutoStartAfterPay()) onResume()
  }, [enabled, onResume, pay.loading, pay.needsPayment, pay.readyToCreate])
}
