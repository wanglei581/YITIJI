// ============================================================
// 一体机自助开发票扫码屏状态机（/me/orders/invoice）。
//
// 隐私与限流红线：
// - controlToken 只保存在组件内存 ref（controlTokenRef），绝不写入任何 storage 或 URL。
// - 轮询间隔 3 秒（20 次/分，远低于 60 次/分限流），页面不可见时暂停，429 按 Retry-After 退避。
// - 收到「已提交」/「已过期」、本地超过 expiresAt、离开页面、退出登录或换人时立停轮询并清空内存凭证。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createKioskInvoiceSession,
  InvoiceSessionHttpError,
  pollKioskInvoiceSession,
  type InvoiceOrderKind,
} from '../../../../services/api/invoiceSessions'
import { getCachedKioskTerminalConfig, getTerminalId } from '../../../../services/api/terminalConfig'
import { isTerminalConfigCharged } from './orderInvoiceCopy'

export type InvoiceScreenPhase =
  | 'loading'
  | 'waiting'
  | 'submitted'
  | 'expired'
  | 'free'
  | 'blocked'
  | 'no_target'
  | 'login'
  | 'error'

export interface OrderInvoiceTarget {
  orderKind: InvoiceOrderKind
  orderId: string
}

export interface OrderInvoiceSessionState {
  phase: InvoiceScreenPhase
  codeUrl: string | null
  expiresAt: string | null
  reason: string
  rateLimited: boolean
  busy: boolean
  regenerate: () => void
}

const POLL_BASE_MS = 3_000
const POLL_MIN_429_MS = 10_000
const POLL_MAX_BACKOFF_MS = 60_000

function safeChineseReason(raw: string | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!/[\u4e00-\u9fff]/.test(trimmed)) return ''
  if (/[A-Za-z_]{8,}/.test(trimmed)) return ''
  return trimmed
}

export function parseInvoiceTarget(search: string): OrderInvoiceTarget | null {
  const params = new URLSearchParams(search)
  const kind = params.get('kind')?.trim()
  const id = params.get('id')?.trim()
  if ((kind !== 'service' && kind !== 'print') || !id || id.length > 80) return null
  return { orderKind: kind, orderId: id }
}

export function useOrderInvoiceSession(
  target: OrderInvoiceTarget | null,
  isLoggedIn: boolean,
  token: string | null,
): OrderInvoiceSessionState {
  const [phase, setPhase] = useState<InvoiceScreenPhase>('loading')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [codeUrl, setCodeUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [rateLimited, setRateLimited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // controlToken 仅存组件内存 ref，绝不写进 localStorage / sessionStorage / URL。
  const controlTokenRef = useRef<string | null>(null)

  const clearMemoryCreds = useCallback(() => {
    controlTokenRef.current = null
    setSessionId(null)
    setCodeUrl(null)
    setExpiresAt(null)
    setRateLimited(false)
  }, [])

  const regenerate = useCallback(() => {
    clearMemoryCreds()
    setReason('')
    setAttempt((value) => value + 1)
  }, [clearMemoryCreds])

  // 退出登录、换人或卸载时立即清空内存态凭证。
  useEffect(() => {
    if (!isLoggedIn || !token) {
      controlTokenRef.current = null
    }
    return () => {
      controlTokenRef.current = null
    }
  }, [isLoggedIn, token])

  // 阶段一：无目标单时判本机是否免费；有目标单时调用建会话接口出码。
  useEffect(() => {
    let alive = true
    controlTokenRef.current = null
    setSessionId(null)
    setCodeUrl(null)
    setExpiresAt(null)
    setRateLimited(false)
    setReason('')

    if (!target) {
      setPhase('loading')
      setBusy(false)
      const terminalId = getTerminalId()
      if (!terminalId) {
        setPhase('free')
        return undefined
      }
      void getCachedKioskTerminalConfig(terminalId)
        .then((config) => {
          if (!alive) return
          if (!isTerminalConfigCharged(config)) {
            setPhase('free')
          } else {
            setPhase(isLoggedIn && token ? 'no_target' : 'login')
          }
        })
        .catch(() => {
          if (!alive) return
          setPhase(isLoggedIn && token ? 'no_target' : 'login')
        })
      return () => {
        alive = false
      }
    }

    if (!isLoggedIn || !token) {
      setBusy(false)
      setPhase('login')
      return undefined
    }

    setBusy(true)
    setPhase('loading')
    void createKioskInvoiceSession(token, {
      orderKind: target.orderKind,
      orderId: target.orderId,
    })
      .then((created) => {
        if (!alive) return
        controlTokenRef.current = created.controlToken
        setSessionId(created.sessionId)
        setCodeUrl(created.codeUrl)
        setExpiresAt(created.expiresAt)
        setPhase('waiting')
      })
      .catch((error: unknown) => {
        if (!alive) return
        controlTokenRef.current = null
        if (error instanceof InvoiceSessionHttpError) {
          if (error.status === 401) {
            setPhase('login')
            return
          }
          if (error.code === 'INVOICE_NOT_ALLOWED') {
            if (error.message.includes('没有实付金额')) {
              setPhase('free')
              return
            }
            setReason(safeChineseReason(error.message) || '这一单开不了发票。')
            setPhase('blocked')
            return
          }
          setReason(safeChineseReason(error.message) || '开票码暂时无法生成，请稍后再试。')
          setPhase('error')
          return
        }
        setReason('开票码暂时无法生成，请稍后再试。')
        setPhase('error')
      })
      .finally(() => {
        if (alive) setBusy(false)
      })

    return () => {
      alive = false
    }
  }, [target?.orderKind, target?.orderId, isLoggedIn, token, attempt])

  // 阶段二：waiting 状态下按 3s 轮询，遵守到期时刻、页面可见性与 429 退避；终态/离页/退出立停。
  useEffect(() => {
    if (phase !== 'waiting' || !isLoggedIn || !token || !sessionId || !expiresAt) return undefined
    const expiresAtMs = Date.parse(expiresAt)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      controlTokenRef.current = null
      setCodeUrl(null)
      setPhase('expired')
      return undefined
    }

    let alive = true
    let inFlight = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let backoffMs = POLL_BASE_MS
    let rateLimitUntil = 0

    const clearPollTimer = () => {
      if (pollTimer !== null) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
    }

    const markExpired = () => {
      clearPollTimer()
      controlTokenRef.current = null
      setCodeUrl(null)
      setRateLimited(false)
      setPhase('expired')
    }

    const expiryTimer = setTimeout(() => {
      if (alive) markExpired()
    }, Math.max(0, expiresAtMs - Date.now()))

    const schedule = (ms: number) => {
      if (!alive) return
      clearPollTimer()
      pollTimer = setTimeout(() => void tick(), ms)
    }

    const tick = async () => {
      if (!alive || inFlight) return
      const ctrl = controlTokenRef.current
      if (!ctrl || Date.now() >= expiresAtMs) {
        markExpired()
        return
      }
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        schedule(POLL_BASE_MS)
        return
      }
      const now = Date.now()
      if (rateLimitUntil > now) {
        schedule(rateLimitUntil - now)
        return
      }
      inFlight = true
      try {
        const res = await pollKioskInvoiceSession(sessionId, ctrl)
        if (!alive) return
        setRateLimited(false)
        backoffMs = POLL_BASE_MS
        rateLimitUntil = 0
        if (res.status === '已提交') {
          clearPollTimer()
          controlTokenRef.current = null
          setCodeUrl(null)
          setPhase('submitted')
          return
        }
        if (res.status === '已过期') {
          markExpired()
          return
        }
        schedule(POLL_BASE_MS)
      } catch (error: unknown) {
        if (!alive) return
        if (error instanceof InvoiceSessionHttpError && error.status === 401) {
          markExpired()
          return
        }
        if (error instanceof InvoiceSessionHttpError && error.status === 429) {
          setRateLimited(true)
          const nextStep = backoffMs < POLL_MIN_429_MS ? POLL_MIN_429_MS : Math.min(POLL_MAX_BACKOFF_MS, backoffMs * 2)
          const waitMs = Math.min(POLL_MAX_BACKOFF_MS, Math.max(error.retryAfterMs ?? 0, nextStep))
          backoffMs = waitMs
          rateLimitUntil = Date.now() + waitMs
          schedule(waitMs)
          return
        }
        backoffMs = Math.min(30_000, Math.max(6_000, backoffMs * 2))
        schedule(backoffMs)
      } finally {
        inFlight = false
      }
    }

    const onVisibility = () => {
      if (!alive || typeof document === 'undefined' || document.visibilityState !== 'visible') return
      if (Date.now() >= expiresAtMs) {
        markExpired()
        return
      }
      if (!inFlight && Date.now() >= rateLimitUntil) {
        clearPollTimer()
        void tick()
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    schedule(POLL_BASE_MS)

    return () => {
      alive = false
      clearPollTimer()
      clearTimeout(expiryTimer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [phase, isLoggedIn, token, sessionId, expiresAt])

  return { phase, codeUrl, expiresAt, reason, rateLimited, busy, regenerate }
}
