import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'

// 90s 无操作弹预警；120s（再 +30s）自动 logout
const WARN_AT_MS  = 90_000
const LOGOUT_AT_MS = 120_000

const TRACKED_EVENTS: (keyof DocumentEventMap)[] = [
  'touchstart',
  'touchmove',
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'click',
]

interface IdleLogoutGuardProps {
  /** 预警弹层挂载的容器 className（可选，默认 fixed 覆盖层）。 */
  className?: string
}

export function IdleLogoutGuard({ className }: IdleLogoutGuardProps) {
  const { isLoggedIn, busy, logout } = useAuth()

  const [warning, setWarning]     = useState(false)
  // remaining：预警弹出后倒计时剩余秒数（从 30 递减到 0）
  const [remaining, setRemaining] = useState(30)

  // 保存定时器 ref，方便在多处清除
  const warnTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  // 记录计时器暂停前已过去的毫秒数
  const elapsedRef     = useRef(0)
  const lastTickRef    = useRef<number>(0)
  // 当前是否处于暂停状态（busy=true 时）
  const pausedRef      = useRef(false)

  const clearAllTimers = useCallback(() => {
    if (warnTimerRef.current)   { clearTimeout(warnTimerRef.current);   warnTimerRef.current   = null }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null }
    if (countdownRef.current)   { clearInterval(countdownRef.current);  countdownRef.current   = null }
  }, [])

  const startTimers = useCallback(() => {
    clearAllTimers()
    setWarning(false)
    setRemaining(30)
    elapsedRef.current   = 0
    lastTickRef.current  = Date.now()
    pausedRef.current    = false

    warnTimerRef.current = setTimeout(() => {
      setWarning(true)
      // 开始 30s 倒计时显示
      setRemaining(30)
      countdownRef.current = setInterval(() => {
        setRemaining((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1_000)
    }, WARN_AT_MS)

    logoutTimerRef.current = setTimeout(() => {
      clearAllTimers()
      setWarning(false)
      logout()
    }, LOGOUT_AT_MS)
  }, [clearAllTimers, logout])

  // 用户主动点"继续使用"
  const handleContinue = useCallback(() => {
    startTimers()
  }, [startTimers])

  // 用户主动点"退出"
  const handleLogout = useCallback(() => {
    clearAllTimers()
    setWarning(false)
    logout()
  }, [clearAllTimers, logout])

  // 活动事件 → 重置计时器（预警弹出前才重置；预警弹出后不再因触摸重置）
  const handleActivity = useCallback(() => {
    if (!warning) startTimers()
  }, [warning, startTimers])

  // busy 切换时：暂停 / 恢复计时器
  useEffect(() => {
    if (!isLoggedIn) return

    if (busy) {
      // 暂停：记录已过去时间，清除定时器
      if (!pausedRef.current) {
        pausedRef.current = true
        elapsedRef.current += Date.now() - lastTickRef.current
        clearAllTimers()
        setWarning(false)
        setRemaining(30)
      }
    } else {
      // 恢复：从剩余时间继续计时
      if (pausedRef.current) {
        pausedRef.current = false
        lastTickRef.current = Date.now()
        const remainWarn   = Math.max(0, WARN_AT_MS   - elapsedRef.current)
        const remainLogout = Math.max(0, LOGOUT_AT_MS - elapsedRef.current)

        if (remainLogout <= 0) {
          logout()
          return
        }

        if (remainWarn <= 0) {
          // 已超过预警线，直接弹预警
          const secs = Math.ceil(remainLogout / 1_000)
          setWarning(true)
          setRemaining(secs)
          countdownRef.current = setInterval(() => {
            setRemaining((prev) => {
              if (prev <= 1) {
                if (countdownRef.current) clearInterval(countdownRef.current)
                return 0
              }
              return prev - 1
            })
          }, 1_000)
          logoutTimerRef.current = setTimeout(() => {
            clearAllTimers()
            setWarning(false)
            logout()
          }, remainLogout)
        } else {
          warnTimerRef.current = setTimeout(() => {
            setWarning(true)
            setRemaining(30)
            countdownRef.current = setInterval(() => {
              setRemaining((prev) => {
                if (prev <= 1) {
                  if (countdownRef.current) clearInterval(countdownRef.current)
                  return 0
                }
                return prev - 1
              })
            }, 1_000)
          }, remainWarn)

          logoutTimerRef.current = setTimeout(() => {
            clearAllTimers()
            setWarning(false)
            logout()
          }, remainLogout)
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, isLoggedIn])

  // 登录态变化：登录时启动，登出时停止
  useEffect(() => {
    if (!isLoggedIn) {
      clearAllTimers()
      setWarning(false)
      return
    }
    if (!busy) startTimers()
    return clearAllTimers
  // startTimers / clearAllTimers 是 useCallback，引用稳定
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])

  // 注册全局活动监听
  useEffect(() => {
    if (!isLoggedIn) return
    const opts = { passive: true, capture: true }
    TRACKED_EVENTS.forEach((ev) =>
      document.addEventListener(ev, handleActivity as EventListener, opts),
    )
    return () => {
      TRACKED_EVENTS.forEach((ev) =>
        document.removeEventListener(ev, handleActivity as EventListener, opts),
      )
    }
  }, [isLoggedIn, handleActivity])

  if (!isLoggedIn || !warning) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="即将自动退出"
      className={
        className ??
        'fixed inset-0 z-50 flex items-center justify-center bg-black/50'
      }
    >
      <div className="mx-6 w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <p className="text-center text-lg font-semibold text-gray-900">即将自动退出</p>
        <p className="mt-3 text-center text-sm text-gray-500">
          长时间未操作，将在{' '}
          <span className="font-bold text-red-500">{remaining}</span>{' '}
          秒后自动退出登录
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={handleLogout}
            className="flex-1 rounded-xl border border-gray-200 py-3.5 text-sm font-medium text-gray-600 active:bg-gray-50"
          >
            退出登录
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="flex-1 rounded-xl bg-primary-600 py-3.5 text-sm font-medium text-white active:bg-primary-700"
          >
            继续使用
          </button>
        </div>
      </div>
    </div>
  )
}
