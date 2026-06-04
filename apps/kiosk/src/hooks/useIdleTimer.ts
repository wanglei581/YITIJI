import { useEffect, useRef } from 'react'

/**
 * 无操作计时器。enabled 期间监听用户输入,超过 timeoutMs 无操作触发 onIdle。
 *
 * 触控优先(CLAUDE.md §17):监听 pointerdown/touchstart/keydown/mousemove/wheel,
 * 任意输入都重置计时。passive 监听不阻塞滚动/触控。
 *
 * enabled=false(忙碌态 / 已在屏保 / 未配置)时完全不计时,也不残留监听。
 */
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown',
  'touchstart',
  'keydown',
  'mousemove',
  'wheel',
]

export function useIdleTimer(opts: { timeoutMs: number; enabled: boolean; onIdle: () => void }): void {
  const { timeoutMs, enabled, onIdle } = opts
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!enabled || timeoutMs <= 0) return

    let timer: number | undefined
    const reset = (): void => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => onIdleRef.current(), timeoutMs)
    }

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()

    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [enabled, timeoutMs])
}
