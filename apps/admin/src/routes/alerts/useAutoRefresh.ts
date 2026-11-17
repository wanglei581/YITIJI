import { useCallback, useEffect, useRef } from 'react'

export const ALERT_AUTO_REFRESH_MS = 60_000

export type AutoRefreshKind = 'user' | 'auto'

/**
 * 前台每 intervalMs 调一次 reload('auto')。
 * 上一次还没回来就跳过这一轮；页面切到后台暂停；回到前台时若距上次成功已超过间隔，立刻再刷。
 * resetKey 变化（换视图、换筛选）后重新计时。卸载时停止。
 */
export function useAutoRefresh(options: {
  intervalMs: number
  resetKey: string
  reload: (kind: AutoRefreshKind) => Promise<boolean>
}): (kind: AutoRefreshKind) => Promise<void> {
  const { intervalMs, resetKey, reload } = options
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const pendingRef = useRef(0)
  const lastSuccessAtRef = useRef<number | null>(null)
  const runRef = useRef<(kind: AutoRefreshKind) => Promise<void>>(async () => {})

  runRef.current = async (kind: AutoRefreshKind) => {
    if (kind === 'auto' && (pendingRef.current > 0 || document.visibilityState === 'hidden')) return
    pendingRef.current += 1
    try {
      const ok = await reloadRef.current(kind)
      if (ok) lastSuccessAtRef.current = Date.now()
    } finally {
      pendingRef.current -= 1
    }
  }

  useEffect(() => {
    let alive = true
    let timer = window.setInterval(() => {
      void runRef.current('auto')
    }, intervalMs)

    const onVisibility = () => {
      if (!alive || document.visibilityState !== 'visible') return
      const last = lastSuccessAtRef.current
      if (last === null || Date.now() - last < intervalMs) return
      window.clearInterval(timer)
      void runRef.current('auto').finally(() => {
        if (!alive) return
        timer = window.setInterval(() => {
          void runRef.current('auto')
        }, intervalMs)
      })
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, resetKey])

  return useCallback((kind: AutoRefreshKind) => runRef.current(kind), [])
}
