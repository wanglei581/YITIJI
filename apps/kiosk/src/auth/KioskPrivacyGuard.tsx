import type { KioskScreensaverPlaylist } from '@ai-job-print/shared'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useScreensaverController,
  type ScreensaverWarningRequest,
} from '../hooks/useScreensaverController'
import { isKioskClearNoOp } from './kioskClearScope'
import { clearKioskSensitiveSession } from './kioskSensitiveSession'
import {
  KioskSessionControlProvider,
  type KioskSessionClearDestination,
  type KioskSessionControlValue,
  type KioskWarningDescriptor,
  type KioskWarningExitTo,
} from './KioskSessionControlContext'
import { useKioskBusy } from '../contexts/KioskBusyContext'
import { useAuth } from './useAuth'
import { useIdleLogout, type KioskIdleWarningRequest } from './useIdleLogout'

const DEFAULT_PRIVACY_IDLE_SEC = 300
/** 忙碌锁顺延硬截止的上限（秒）。支付轮询成功 / 语音音频活动会重置活动时刻。 */
const DEFAULT_PRIVACY_BUSY_DEFER_SEC = 15 * 60
export const KIOSK_SESSION_ACTIVITY_EVENT = 'ai-job-print:kiosk-session-activity'
const PRIVACY_BOUNDARY_STORAGE_KEY = 'ai-job-print:kiosk-privacy-boundary:v1'
const PRIVACY_BOUNDARY_LOCAL_KEY = 'ai-job-print:kiosk-privacy-boundary-fallback:v1'
const PRIVACY_BOUNDARY_COOKIE_KEY = 'ai_job_print_kiosk_privacy_boundary_v1'
const PRIVACY_BOUNDARY_STATE_KEY = '__kioskPrivacyBoundary'
const PRIVACY_BOUNDARY_CREATED_AT_STATE_KEY = '__kioskPrivacyBoundaryCreatedAt'
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown',
  'touchstart',
  'keydown',
  'mousemove',
  'wheel',
]

interface PrivacyBoundary {
  token: string
  minHistoryIndex: number
  createdAt: number
}

interface PendingWarning {
  sourceHistoryIndex: number | null
  sourcePath: string
  exitTo: KioskWarningExitTo
  deadlineAt: number
  playlist: KioskScreensaverPlaylist | null
}

interface KioskHistoryState {
  usr?: unknown
  key?: string
  idx?: number
  [PRIVACY_BOUNDARY_STATE_KEY]?: string
  [PRIVACY_BOUNDARY_CREATED_AT_STATE_KEY]?: number
}

function resolvePrivacyIdleMs(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_PRIVACY_IDLE_SEC)
  const sec = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PRIVACY_IDLE_SEC
  return sec * 1000
}

function resolvePrivacyBusyDeferMs(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_PRIVACY_BUSY_DEFER_SEC)
  if (Number.isFinite(raw) && raw >= 0) return raw * 1000
  return DEFAULT_PRIVACY_BUSY_DEFER_SEC * 1000
}

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function payStatusLooksPaid(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const record = body as { payStatus?: unknown; data?: { payStatus?: unknown } }
  return record.payStatus === 'paid' || record.data?.payStatus === 'paid'
}

function readHistoryState(): KioskHistoryState {
  return (window.history.state ?? {}) as KioskHistoryState
}

function readSafeHistoryIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function readPrivacyBoundary(): PrivacyBoundary | null {
  const state = readHistoryState()
  const parsedCandidates: PrivacyBoundary[] = []
  if (typeof state[PRIVACY_BOUNDARY_STATE_KEY] === 'string' && typeof state.idx === 'number') {
    parsedCandidates.push({
      token: state[PRIVACY_BOUNDARY_STATE_KEY],
      minHistoryIndex: state.idx,
      createdAt:
        typeof state[PRIVACY_BOUNDARY_CREATED_AT_STATE_KEY] === 'number'
          ? state[PRIVACY_BOUNDARY_CREATED_AT_STATE_KEY]
          : 0,
    })
  }
  if (state.usr && typeof state.usr === 'object' && 'privacyBoundary' in state.usr) {
    const nested = (state.usr as { privacyBoundary?: Partial<PrivacyBoundary> }).privacyBoundary
    if (
      typeof nested?.token === 'string' &&
      typeof nested.minHistoryIndex === 'number' &&
      typeof nested.createdAt === 'number'
    ) {
      parsedCandidates.push({
        token: nested.token,
        minHistoryIndex: nested.minHistoryIndex,
        createdAt: nested.createdAt,
      })
    }
  }

  const candidates: (string | null)[] = []
  try {
    candidates.push(window.sessionStorage.getItem(PRIVACY_BOUNDARY_STORAGE_KEY))
  } catch {
    candidates.push(null)
  }
  try {
    candidates.push(window.localStorage.getItem(PRIVACY_BOUNDARY_LOCAL_KEY))
  } catch {
    candidates.push(null)
  }
  try {
    const cookiePrefix = `${PRIVACY_BOUNDARY_COOKIE_KEY}=`
    const cookieValue = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookiePrefix))
    candidates.push(cookieValue ? decodeURIComponent(cookieValue.slice(cookiePrefix.length)) : null)
  } catch {
    candidates.push(null)
  }

  for (const raw of candidates) {
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as Partial<PrivacyBoundary>
      if (typeof parsed.token === 'string' && typeof parsed.minHistoryIndex === 'number') {
        parsedCandidates.push({
          token: parsed.token,
          minHistoryIndex: parsed.minHistoryIndex,
          createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
        })
      }
    } catch {
      // 尝试下一种同源持久化载体。
    }
  }
  return parsedCandidates.sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
}

function createBoundaryToken(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function writePrivacyBoundary(): PrivacyBoundary {
  const state = readHistoryState()
  const boundary = {
    token: createBoundaryToken(),
    // 新增一条干净 history entry，并由 pushState 截断旧 forward 栈。
    minHistoryIndex: (typeof state.idx === 'number' ? state.idx : 0) + 1,
    createdAt: Date.now(),
  }
  const serialized = JSON.stringify(boundary)
  try {
    window.sessionStorage.setItem(PRIVACY_BOUNDARY_STORAGE_KEY, serialized)
  } catch {
    // 本地清场不能依赖 sessionStorage 可写。
  }
  try {
    window.localStorage.setItem(PRIVACY_BOUNDARY_LOCAL_KEY, serialized)
  } catch {
    // 继续使用同源 SameSite 会话 Cookie 和已净化 history.state。
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  try {
    document.cookie = `${PRIVACY_BOUNDARY_COOKIE_KEY}=${encodeURIComponent(serialized)}; Path=/; SameSite=Strict${secure}`
  } catch {
    // 三种持久化都失败时仍继续同步清理；当前 landing state 仍携带无 PII 边界。
  }
  return boundary
}

function pushSanitizedDestination(
  boundary: PrivacyBoundary,
  destination: KioskSessionClearDestination,
): void {
  const state = readHistoryState()
  const sanitizedState = {
    ...state,
    usr: destination.state ?? null,
    key: `privacy-${boundary.token}`,
    idx: boundary.minHistoryIndex,
    [PRIVACY_BOUNDARY_STATE_KEY]: boundary.token,
    [PRIVACY_BOUNDARY_CREATED_AT_STATE_KEY]: boundary.createdAt,
  }
  try {
    window.history.pushState(sanitizedState, '', destination.path)
    window.location.reload()
  } catch {
    // pushState 极端失败时仍遮罩并硬到受限目的地；持久 boundary 会拦截旧历史。
    window.history.replaceState(sanitizedState, '', destination.path)
    window.location.replace(destination.path)
  }
}

function PrivacyClearingOverlay() {
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[2147483647] bg-slate-950"
      data-kiosk-privacy-clearing="true"
      role="status"
      aria-live="assertive"
    >
      <span className="sr-only">正在清除本次使用记录</span>
    </div>
  )
}

/**
 * 公共终端会话安全根：统一普通 idle、屏保与硬隐私截止。
 * 硬截止在忙碌锁（语音 live/connecting、支付 pending、AI 生成中）期间暂停，顺延上限 15 分钟。
 *
 * privacy boundary 只记录随机代次和 React Router history idx，不含任何用户数据。
 * 边界之前的历史项在渲染 Outlet 前即被遮罩、去除 usr 并重载为首页，防止浏览器后退
 * 恢复匿名 accessToken 或上一位会员页面。
 */
export function KioskPrivacyGuard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { logout, isLoggedIn, guestMode } = useAuth()
  const kioskBusy = useKioskBusy()
  const busyRef = useRef(false)
  busyRef.current = kioskBusy
  const [clearing, setClearing] = useState(false)
  const [warning, setWarning] = useState<KioskWarningDescriptor | null>(null)
  const pendingWarningRef = useRef<PendingWarning | null>(null)
  const returningWarningRef = useRef(false)
  const clearingModeRef = useRef<null | 'hard' | 'screensaver'>(null)
  const boundaryRef = useRef<PrivacyBoundary | null>(null)
  // 硬隐私截止的 effect 不随路由 / 登录态重建（重建会顺带重置计时，等于被无限续期）。
  // 用 ref 让它在「到点那一刻」读到当前值，而不是 effect 建立时的旧快照。
  const clearNoOpProbeRef = useRef<() => boolean>(() => false)
  clearNoOpProbeRef.current = () => isKioskClearNoOp({ pathname, isLoggedIn, guestMode })

  if (boundaryRef.current === null) boundaryRef.current = readPrivacyBoundary()
  const boundary = boundaryRef.current
  const historyState = readHistoryState()
  const historyIndex = readSafeHistoryIndex(historyState.idx)
  const nestedBoundary =
    historyState.usr &&
    typeof historyState.usr === 'object' &&
    'privacyBoundary' in historyState.usr
      ? (historyState.usr as { privacyBoundary?: Partial<PrivacyBoundary> }).privacyBoundary
      : null
  const isSanitizedBoundaryEntry =
    boundary !== null &&
    (historyState[PRIVACY_BOUNDARY_STATE_KEY] === boundary.token ||
      nestedBoundary?.token === boundary.token)
  const isStaleHistoryEntry =
    boundary !== null &&
    !isSanitizedBoundaryEntry &&
    (historyIndex === null || historyIndex <= boundary.minHistoryIndex)

  const claimClearing = useCallback((mode: 'hard' | 'screensaver'): boolean => {
    if (clearingModeRef.current !== null) return false
    clearingModeRef.current = mode
    return true
  }, [])

  const establishPrivacyBoundary = useCallback(() => {
    const nextBoundary = writePrivacyBoundary()
    boundaryRef.current = nextBoundary
    return nextBoundary
  }, [])

  const clearSessionTo = useCallback((destination: KioskSessionClearDestination) => {
    if (!claimClearing('hard')) return
    returningWarningRef.current = false

    // 先 fail-closed 阻断交互；本地敏感状态同步清除，不等待网络。
    setClearing(true)
    clearKioskSensitiveSession()
    logout()
    const nextBoundary = establishPrivacyBoundary()
    pendingWarningRef.current = null
    setWarning(null)

    // 留一帧让遮罩提交到 DOM，再新增干净 entry、截断 forward 并硬刷新 React 树。
    window.requestAnimationFrame(() => pushSanitizedDestination(nextBoundary, destination))
  }, [claimClearing, establishPrivacyBoundary, logout])

  const hardClear = useCallback(() => {
    clearSessionTo({ path: '/' })
  }, [clearSessionTo])

  const clearToScreensaver = useCallback((): void => {
    if (returningWarningRef.current) {
      hardClear()
      return
    }
    const pendingWarning = pendingWarningRef.current
    const playlist = pendingWarning?.exitTo === 'screensaver' ? pendingWarning.playlist : null
    if (!playlist?.enabled || playlist.items.length === 0) {
      hardClear()
      return
    }
    if (!claimClearing('screensaver')) return
    returningWarningRef.current = false

    setClearing(true)
    clearKioskSensitiveSession()
    logout()
    const nextBoundary = establishPrivacyBoundary()
    pendingWarningRef.current = null
    setWarning(null)
    navigate('/screensaver', {
      state: {
        playlist,
        privacyBoundary: nextBoundary,
      },
    })
  }, [claimClearing, establishPrivacyBoundary, hardClear, logout, navigate])

  const startWarning = useCallback(
    (
      request: KioskIdleWarningRequest,
      exitTo: KioskWarningExitTo,
      playlist: KioskScreensaverPlaylist | null
    ): void => {
      if (
        pendingWarningRef.current !== null ||
        returningWarningRef.current ||
        clearingModeRef.current !== null
      ) {
        return
      }
      // 干净待机态：清场什么都清不掉。不要把空操作包装成「还在使用吗？」问用户。
      // 屏保已配置时仍要进待机宣传屏——那是产品行为，不是隐私清场，直接进即可。
      if (isKioskClearNoOp({ pathname, isLoggedIn, guestMode })) {
        if (exitTo === 'screensaver') {
          // 复用既有清场收尾，不另起一条进屏保的路径：clearToScreensaver 从
          // pendingWarningRef 取 playlist，所以这里先按「已确认要进屏保」登记，
          // 再交给它统一执行 clearKioskSensitiveSession / logout /
          // establishPrivacyBoundary / navigate('/screensaver')。
          pendingWarningRef.current = {
            sourceHistoryIndex: null,
            sourcePath: pathname,
            exitTo,
            deadlineAt: request.deadlineAt,
            playlist,
          }
          clearToScreensaver()
        }
        return
      }
      if (Date.now() >= request.deadlineAt) {
        hardClear()
        return
      }

      const state = readHistoryState()
      const safeSourceHistoryIndex = readSafeHistoryIndex(state.idx)
      const sourceHistoryIndex =
        safeSourceHistoryIndex !== null && safeSourceHistoryIndex < Number.MAX_SAFE_INTEGER
          ? safeSourceHistoryIndex
          : null
      const pendingWarning: PendingWarning = {
        sourceHistoryIndex,
        sourcePath: pathname,
        exitTo,
        deadlineAt: request.deadlineAt,
        playlist,
      }
      pendingWarningRef.current = pendingWarning
      setWarning({
        sourcePath: pendingWarning.sourcePath,
        exitTo: pendingWarning.exitTo,
        deadlineAt: pendingWarning.deadlineAt,
        canContinue: sourceHistoryIndex !== null,
      })
      navigate('/session-timeout')
    },
    [clearToScreensaver, guestMode, hardClear, isLoggedIn, navigate, pathname]
  )

  const handleOrdinaryWarning = useCallback(
    (request: KioskIdleWarningRequest): void => {
      startWarning(request, 'home', null)
    },
    [startWarning]
  )

  const handleScreensaverWarning = useCallback(
    (request: ScreensaverWarningRequest): void => {
      startWarning(request, 'screensaver', request.playlist)
    },
    [startWarning]
  )

  const continueSession = useCallback((): void => {
    if (returningWarningRef.current) return
    const pendingWarning = pendingWarningRef.current
    const currentState = readHistoryState()
    const currentHistoryIndex = readSafeHistoryIndex(currentState.idx)
    if (
      pendingWarning === null ||
      Date.now() >= pendingWarning.deadlineAt ||
      pendingWarning.sourceHistoryIndex === null ||
      currentHistoryIndex === null ||
      currentHistoryIndex !== pendingWarning.sourceHistoryIndex + 1
    ) {
      hardClear()
      return
    }

    returningWarningRef.current = true
    void Promise.resolve(navigate(-1)).catch(() => {
      returningWarningRef.current = false
      hardClear()
    })
  }, [hardClear, navigate])

  const { active: screensaverActive } = useScreensaverController(handleScreensaverWarning)
  useIdleLogout(screensaverActive, handleOrdinaryWarning)

  useEffect(() => {
    if (!isStaleHistoryEntry) return
    hardClear()
  }, [hardClear, isStaleHistoryEntry])

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent): void => {
      // 公共终端不恢复 BFCache 中冻结的上一份 React/auth/route 内存态。
      if (event.persisted) hardClear()
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [hardClear])

  const onScreensaverRoute = pathname === '/screensaver'
  const onSessionTimeoutRoute = pathname === '/session-timeout'
  // 首帧 fail-closed：路由进入 /session-timeout 但 pendingWarning 缺失(直接访问、刷新、
  // history index 不匹配、刷新后丢失 ref)时,渲染阶段直接认定本次为清场中,只挂遮罩;
  // 后续 effect 负责真正执行 hardClear 并推回首页,避免出现"先看到会话页,再被替换"
  // 的中间帧。会话页的标题、按钮、当前登录 / 掩码手机号都是 PII,绝不允许这种闪现。
  const isOrphanSessionTimeoutRoute =
    onSessionTimeoutRoute && pendingWarningRef.current === null

  useEffect(() => {
    if (!onSessionTimeoutRoute || pendingWarningRef.current !== null) return
    hardClear()
  }, [hardClear, onSessionTimeoutRoute])

  useEffect(() => {
    if (!returningWarningRef.current || onSessionTimeoutRoute) return

    const pendingWarning = pendingWarningRef.current
    const currentHistoryIndex = readSafeHistoryIndex(readHistoryState().idx)
    returningWarningRef.current = false
    if (
      pendingWarning !== null &&
      pendingWarning.sourceHistoryIndex !== null &&
      currentHistoryIndex === pendingWarning.sourceHistoryIndex
    ) {
      pendingWarningRef.current = null
      setWarning(null)
      return
    }

    hardClear()
  }, [hardClear, onSessionTimeoutRoute, pathname])

  useEffect(() => {
    if (warning === null) return
    const expireWarning = (): void => {
      if (warning.exitTo === 'screensaver') {
        clearToScreensaver()
        return
      }
      hardClear()
    }
    const remainingMs = warning.deadlineAt - Date.now()
    if (remainingMs <= 0) {
      expireWarning()
      return
    }
    const timer = window.setTimeout(expireWarning, remainingMs)
    return () => window.clearTimeout(timer)
  }, [clearToScreensaver, hardClear, warning])

  useEffect(() => {
    if (!onScreensaverRoute || clearingModeRef.current !== 'screensaver') return
    const state = readHistoryState()
    const routeBoundary =
      state.usr && typeof state.usr === 'object' && 'privacyBoundary' in state.usr
        ? (state.usr as { privacyBoundary?: Partial<PrivacyBoundary> }).privacyBoundary
        : null
    const expectedBoundary = boundaryRef.current

    if (expectedBoundary !== null && routeBoundary?.token === expectedBoundary.token) {
      clearingModeRef.current = null
      setClearing(false)
      return
    }

    clearingModeRef.current = null
    setClearing(false)
    hardClear()
  }, [hardClear, onScreensaverRoute])

  useEffect(() => {
    if (onScreensaverRoute || isStaleHistoryEntry) return

    const timeoutMs = resolvePrivacyIdleMs()
    const busyDeferMs = resolvePrivacyBusyDeferMs()
    let lastActivityAt = Date.now()
    let timer: number | undefined
    const originalFetch = window.fetch.bind(window)

    const checkDeadline = (): void => {
      const now = Date.now()
      const idleDeadline = lastActivityAt + timeoutMs
      const busyCapDeadline = idleDeadline + busyDeferMs
      if (now < idleDeadline) {
        timer = window.setTimeout(checkDeadline, idleDeadline - now)
        return
      }
      // 到点这一刻重新读实时状态，而不是沿用 effect 建立时的快照：
      // 只要期间出现了登录 / guestMode / 任一敏感残留，这里都会判定「不是空操作」
      // 并照常硬清场。这是最后一道兜底，不能被上游的省略计时静默绕过。
      if (clearNoOpProbeRef.current()) {
        lastActivityAt = now
        timer = window.setTimeout(checkDeadline, timeoutMs)
        return
      }
      if (busyRef.current && now < busyCapDeadline) {
        timer = window.setTimeout(checkDeadline, Math.min(1000, busyCapDeadline - now))
        return
      }
      hardClear()
    }

    const scheduleFromNow = (): void => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(checkDeadline, timeoutMs)
    }

    const markActivity = (): void => {
      lastActivityAt = Date.now()
      scheduleFromNow()
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return
      if (timer !== undefined) window.clearTimeout(timer)
      checkDeadline()
    }

    const inspectPaymentActivity = async (res: Response, input: RequestInfo | URL): Promise<void> => {
      if (!res.ok) return
      if (!/\/orders\/[^/?#]+\/pay-status(?:\?|$)/.test(requestUrlOf(input))) return
      const body: unknown = await res.clone().json()
      if (payStatusLooksPaid(body)) markActivity()
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await originalFetch(input, init)
      void inspectPaymentActivity(res, input).catch(() => undefined)
      return res
    }

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, markActivity, { passive: true })
    )
    window.addEventListener(KIOSK_SESSION_ACTIVITY_EVENT, markActivity)
    document.addEventListener('playing', markActivity, { capture: true, passive: true })
    document.addEventListener('visibilitychange', handleVisibilityChange)
    scheduleFromNow()

    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      window.fetch = originalFetch
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActivity))
      window.removeEventListener(KIOSK_SESSION_ACTIVITY_EVENT, markActivity)
      document.removeEventListener('playing', markActivity, { capture: true })
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [hardClear, isStaleHistoryEntry, onScreensaverRoute])

  const sessionControlValue = useMemo<KioskSessionControlValue>(
    () => ({
      warning,
      continueSession,
      hardClear,
      clearSessionTo,
      clearToScreensaver,
    }),
    [clearSessionTo, clearToScreensaver, continueSession, hardClear, warning]
  )

  return (
    <KioskSessionControlProvider value={sessionControlValue}>
      {clearing || isStaleHistoryEntry || isOrphanSessionTimeoutRoute ? (
        <PrivacyClearingOverlay />
      ) : (
        children
      )}
    </KioskSessionControlProvider>
  )
}
