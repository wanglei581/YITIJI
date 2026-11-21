// ============================================================
// 简历这一趟的按次付款读数与单据状态：复用 P2e-1 导出的地基函数，不另起一套。
//
// 读本机终端配置 pricing.effective 判断「简历优化价」与「这台机器是否收费」，
// 读本机记下的这一趟订单号并按需查单：诊断页看是否已付、优化/对照页带两个头并判免费再试、
// 没诊断出来页看这一趟有没有已付可退的单。价读不到、总开关关、机构付、公共点位一律按不收费。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TERMINAL_CHARGE_SERVICE_KEYS } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { API_MODE } from '../../services/api/client'
import { subscribeTerminalIdentity } from '../../services/api/screensaver'
import {
  canRetryServiceOrderFree,
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
} from '../../services/api/terminalConfig'
import { errorCodeOf } from '../../services/api/userErrorMessage'
import {
  forgetServiceTrip,
  readServiceTrip,
  serviceTripOwnerFor,
  type ServiceTrip,
} from '../../services/serviceTrip'
import { formatYuan, PAY_BACK } from '../pay/payServiceModel'

/** 稿 pay-1113.js:29 通用免费再试句。 */
export const RESUME_RETRY_COPY = `这一次没做成。可以免费再试一次；不试了或再不成，钱${PAY_BACK}。`

/** 稿 pay-1113.js:305, 421, 436：收费机器上导出不另收钱。 */
export const RESUME_EXPORT_NO_EXTRA_COPY = '导出不另收钱'

/** 稿 pay-1113.js:309：诊断页主按钮文案（金额由接口给，不硬编码）。 */
export function diagnosisPayButtonLabel(cents: number): string {
  return `付 ${formatYuan(cents)}并开始`
}

/** 稿 pay-1113.js:310：诊断页「带走这份报告」卡里的价格说明。 */
export function diagnosisPriceNote(cents: number): string {
  return `这一次 ${formatYuan(cents)}。诊断免费，付好了才开始改。没做成可免费再试一次，再不成钱自动退回。`
}

export interface ResumeChargePricing {
  /** 本机 AI 简历优化生效价（分）。0 表示不收费（免费、公共点位、总开关关、机构付或读不到价）。 */
  resumePriceCents: number
  /** 本机个人收费开启且任一服务生效价 > 0。 */
  machineCharged: boolean
}

const ZERO_PRICING: ResumeChargePricing = { resumePriceCents: 0, machineCharged: false }

function positiveInt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0
}

/** 从本机终端配置里读出简历优化生效价与整机是否收费。缺字段、公共点位、总开关关、机构付一律按不收费。 */
export function readResumeChargePricing(config: unknown): ResumeChargePricing {
  if (!config || typeof config !== 'object') return ZERO_PRICING
  const pricing = (config as { pricing?: unknown }).pricing
  if (!pricing || typeof pricing !== 'object') return ZERO_PRICING
  const record = pricing as {
    isPublicSite?: unknown
    personalChargeEnabled?: unknown
    userChargeMode?: unknown
    effective?: unknown
  }
  if (record.isPublicSite === true || record.personalChargeEnabled !== true || record.userChargeMode !== 'user_pays') {
    return ZERO_PRICING
  }
  const effective = record.effective
  if (!effective || typeof effective !== 'object') return ZERO_PRICING
  const table = effective as Record<string, unknown>
  const resumePriceCents = positiveInt(table.resume_optimize)
  const machineCharged = TERMINAL_CHARGE_SERVICE_KEYS.some((key) => positiveInt(table[key]) > 0)
  return { resumePriceCents, machineCharged }
}

/** 402 或服务端 SERVICE_* 错误：需要回到付款屏重新核对/建单，不得落进「优化结果读取失败」。 */
export function isServicePaymentRedirectError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error && (error as { status?: unknown }).status === 402) {
    return true
  }
  const code = errorCodeOf(error)
  return Boolean(code && code.startsWith('SERVICE_'))
}

/**
 * 这些服务单错误说明本机记下的单号已经不可再用（不存在、已给别的任务用掉或被占用），
 * 回付款屏前要先从本机忘掉，避免付款屏看到旧的已消费单又立刻把人送回优化页。
 */
export function shouldForgetTripOnPaymentError(code: string | null): boolean {
  return code === 'SERVICE_ORDER_NOT_FOUND'
    || code === 'SERVICE_ORDER_IN_USE'
    || code === 'SERVICE_ORDER_REF_OCCUPIED'
}

function initialPricing(terminalId: string | null): ResumeChargePricing {
  if (API_MODE !== 'http' || !terminalId) return ZERO_PRICING
  return readResumeChargePricing(peekCachedKioskTerminalConfig(terminalId))
}

export interface ResumeTripChargeState extends ResumeChargePricing {
  trip: ServiceTrip | null
  headers: Record<string, string> | undefined
  order: ServiceOrderView | null
  phase: ServiceOrderPhase | null
  /** 正在向服务端核对本机记下的这一趟单据状态。 */
  checkingOrder: boolean
  /** 这一趟订单号已是 paid 或可免费再试：诊断页照原样直接去优化，不再出付款按钮。 */
  alreadyPaidForOptimize: boolean
  /** 第一次没做成且在 10 分钟免费再试窗口内。 */
  canFreeRetry: boolean
  /** 这一趟存在已付未结案且后端会原路退回（或正在退）的单，用于没诊断出来页的退款说明。 */
  refundablePaid: boolean
  /** 重新查一次当前记下的这一趟单（优化/对照失败后用来判定是否可免费再试）。 */
  refreshOrder: () => Promise<ServiceOrderView | null>
}

const MAX_TIMER_MS = 2_147_483_647

export function useResumeTripCharge(options?: { inspectOrder?: boolean }): ResumeTripChargeState {
  const inspectOrder = options?.inspectOrder ?? false
  const { user } = useAuth()
  const endUserId = user?.id ?? null
  const owner = useMemo(() => serviceTripOwnerFor(endUserId), [endUserId])
  const [terminalId, setTerminalId] = useState<string | null>(() => getTerminalId())
  const [pricing, setPricing] = useState<ResumeChargePricing>(() => initialPricing(getTerminalId()))
  const [trip, setTrip] = useState<ServiceTrip | null>(() => readServiceTrip('resume_optimize', { owner }))
  const [order, setOrder] = useState<ServiceOrderView | null>(null)
  const [, setNowMs] = useState<number>(() => Date.now())
  const [checkingOrder, setCheckingOrder] = useState<boolean>(
    () => inspectOrder && API_MODE === 'http' && Boolean(getTerminalId()) && Boolean(readServiceTrip('resume_optimize', { owner })),
  )
  const nowMs = Date.now()
  const renderedNowRef = useRef<number>(nowMs)
  renderedNowRef.current = nowMs

  useEffect(() => subscribeTerminalIdentity(() => {
    const next = getTerminalId()
    setTerminalId(next)
    setPricing(initialPricing(next))
  }), [])

  useEffect(() => {
    if (API_MODE !== 'http' || !terminalId) {
      setPricing(ZERO_PRICING)
      return
    }
    let cancelled = false
    void getCachedKioskTerminalConfig(terminalId)
      .then((config) => {
        if (!cancelled) setPricing(readResumeChargePricing(config))
      })
      .catch(() => {
        if (!cancelled) setPricing(ZERO_PRICING)
      })
    return () => { cancelled = true }
  }, [terminalId])

  const refreshOrder = useCallback(async (): Promise<ServiceOrderView | null> => {
    const current = readServiceTrip('resume_optimize', { owner })
    setTrip(current)
    if (API_MODE !== 'http' || !terminalId || !current) {
      setOrder(null)
      setCheckingOrder(false)
      return null
    }
    setCheckingOrder(true)
    try {
      const view = await getServiceOrder(current.orderId, current.kioskSessionId)
      setOrder(view)
      return view
    } catch (error) {
      if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') {
        forgetServiceTrip('resume_optimize', current.orderId)
        setTrip(null)
      }
      setOrder(null)
      return null
    } finally {
      setCheckingOrder(false)
    }
  }, [owner, terminalId])

  useEffect(() => {
    const current = readServiceTrip('resume_optimize', { owner })
    setTrip(current)
    if (!inspectOrder || API_MODE !== 'http' || !terminalId || !current) {
      setOrder(null)
      setCheckingOrder(false)
      return
    }
    let cancelled = false
    setCheckingOrder(true)
    void getServiceOrder(current.orderId, current.kioskSessionId)
      .then((view) => {
        if (cancelled) return
        setOrder(view)
      })
      .catch((error) => {
        if (cancelled) return
        if (errorCodeOf(error) === 'SERVICE_ORDER_NOT_FOUND') {
          forgetServiceTrip('resume_optimize', current.orderId)
          setTrip(null)
        }
        setOrder(null)
      })
      .finally(() => {
        if (!cancelled) setCheckingOrder(false)
      })
    return () => { cancelled = true }
  }, [inspectOrder, owner, terminalId])

  useEffect(() => {
    if (!order || order.status !== 'paid' || order.attemptsUsed < 1 || !order.retryUntil) return
    const retryAt = Date.parse(order.retryUntil)
    if (!Number.isFinite(retryAt)) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      const remaining = retryAt - Date.now()
      if (remaining <= 0) {
        if (renderedNowRef.current < retryAt) setNowMs(Date.now())
        return
      }
      const delay = Math.min(remaining, MAX_TIMER_MS)
      timer = setTimeout(() => {
        timer = null
        if (Date.now() < retryAt) {
          schedule()
          return
        }
        setNowMs(Date.now())
      }, delay)
    }
    schedule()
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [order])

  const headers = useMemo(() => (trip ? serviceOrderHeaders(trip) : undefined), [trip])
  const phase = order ? serviceOrderPhase(order, nowMs) : null
  const alreadyPaidForOptimize = phase === 'paid' || phase === 'retry_free'
  const canFreeRetry = order !== null && canRetryServiceOrderFree(order, nowMs)
  const refundablePaid = phase === 'paid' || phase === 'retry_free' || phase === 'retry_expired' || phase === 'refunding'

  return {
    ...pricing,
    trip,
    headers,
    order,
    phase,
    checkingOrder,
    alreadyPaidForOptimize,
    canFreeRetry,
    refundablePaid,
    refreshOrder,
  }
}
