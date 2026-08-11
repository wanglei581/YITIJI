import type { KioskScreensaverPlaylist } from '@ai-job-print/shared'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useScreensaverController,
  type ScreensaverWarningRequest,
} from '../hooks/useScreensaverController'
import { clearKioskSensitiveSession } from './kioskSensitiveSession'
import {
  KioskSessionControlProvider,
  type KioskSessionClearDestination,
  type KioskSessionControlValue,
  type KioskWarningDescriptor,
  type KioskWarningExitTo,
} from './KioskSessionControlContext'
import { useAuth } from './useAuth'
import { useIdleLogout, type KioskIdleWarningRequest } from './useIdleLogout'

const DEFAULT_PRIVACY_IDLE_SEC = 300
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
 * 公共终端会话安全根：统一普通 idle、屏保与不受 busy 抑制的硬隐私截止。
 *
 * privacy boundary 只记录随机代次和 React Router history idx，不含任何用户数据。
 * 边界之前的历史项在渲染 Outlet 前即被遮罩、去除 usr 并重载为首页，防止浏览器后退
 * 恢复匿名 accessToken 或上一位会员页面。
 */
export function KioskPrivacyGuard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [clearing, setClearing] = useState(false)
  const [warning, setWarning] = useState<KioskWarningDescriptor | null>(null)
  const pendingWarningRef = useRef<PendingWarning | null>(null)
  const returningWarningRef = useRef(false)
  const clearingModeRef = useRef<null | 'hard' | 'screensaver'>(null)
  const boundaryRef = useRef<PrivacyBoundary | null>(null)

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
    [hardClear, navigate, pathname]
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
    let lastActivityAt = Date.now()
    let timer: number | undefined

    const checkDeadline = (): void => {
      const remainingMs = timeoutMs - (Date.now() - lastActivityAt)
      if (remainingMs <= 0) {
        hardClear()
        return
      }
      timer = window.setTimeout(checkDeadline, remainingMs)
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
      if (Date.now() - lastActivityAt >= timeoutMs) {
        hardClear()
        return
      }
      if (timer !== undefined) window.clearTimeout(timer)
      checkDeadline()
    }

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, markActivity, { passive: true })
    )
    document.addEventListener('visibilitychange', handleVisibilityChange)
    scheduleFromNow()

    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActivity))
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
