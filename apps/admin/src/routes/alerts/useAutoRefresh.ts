import { useCallback, useEffect, useRef } from 'react'

export const ALERT_AUTO_REFRESH_MS = 60_000

export type AutoRefreshKind = 'user' | 'auto'

/** 组件已经卸载时为 true。在途请求回来后也要再看一眼，避免 setState。 */
export type AutoRefreshContext = {
  readonly disposed: () => boolean
}

/**
 * 前台每 intervalMs 调一次 reload('auto')。
 * 上一次还没回来就跳过这一轮，跳过时不另排计时器。
 * 页面切到后台暂停；回到前台时若距上次成功已超过间隔，立刻再刷，并从此重新计时。
 * resetKey 变化（换视图、换筛选）后重新计时。
 * 任何时刻最多一个计时器。卸载后不再请求、不再安排计时器。
 */
export function useAutoRefresh(options: {
  intervalMs: number
  resetKey: string
  reload: (kind: AutoRefreshKind, ctx: AutoRefreshContext) => Promise<boolean>
}): (kind: AutoRefreshKind) => Promise<void> {
  const { intervalMs, resetKey, reload } = options
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const pendingRef = useRef(0)
  const lastSuccessAtRef = useRef<number | null>(null)
  const runRef = useRef<(kind: AutoRefreshKind) => Promise<void>>(async () => {})
  const generationRef = useRef(0)
  const unmountedRef = useRef(false)
  const disposed = useCallback(() => unmountedRef.current, [])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  useEffect(() => {
    const generation = ++generationRef.current
    const effectStale = () => unmountedRef.current || generationRef.current !== generation
    let timer: number | null = null

    const clearTimer = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }

    const armTimer = () => {
      if (effectStale()) return
      clearTimer()
      timer = window.setInterval(() => {
        void runRef.current('auto')
      }, intervalMs)
    }

    runRef.current = async (kind: AutoRefreshKind) => {
      if (unmountedRef.current) return
      if (kind === 'auto' && (pendingRef.current > 0 || document.visibilityState === 'hidden')) return
      pendingRef.current += 1
      try {
        const ok = await reloadRef.current(kind, { disposed })
        if (unmountedRef.current) return
        if (ok) lastSuccessAtRef.current = Date.now()
      } finally {
        pendingRef.current -= 1
      }
    }

    armTimer()

    const onVisibility = () => {
      if (effectStale() || document.visibilityState !== 'visible') return
      const last = lastSuccessAtRef.current
      if (last === null || Date.now() - last < intervalMs) return
      // 上一次还没回来：保持现有那一个计时器，不另排重建。
      if (pendingRef.current > 0) return
      clearTimer()
      void runRef.current('auto').finally(() => {
        if (effectStale()) return
        armTimer()
      })
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      generationRef.current += 1
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [disposed, intervalMs, resetKey])

  return useCallback((kind: AutoRefreshKind) => runRef.current(kind), [])
}
