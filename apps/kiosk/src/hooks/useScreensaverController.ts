import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { KioskScreensaverPlaylist } from '@ai-job-print/shared'
import { useKioskBusy } from '../contexts/KioskBusyContext'
import { useIdleTimer } from './useIdleTimer'
import { getScreensaverPlaylist, getTerminalId } from '../services/api/screensaver'
import { prefetchAsset, pruneCache } from '../services/screensaverCache'

/**
 * 屏保控制器(挂在 KioskRoot,全局生效)。
 *
 * 职责:
 *   1. 周期拉取本终端屏保配置(enabled / idleTimeoutSec / items),并预缓存素材
 *   2. 无操作达阈值 → 跳 /screensaver(全屏路由),携带 playlist 避免二次拉取
 *   3. 忙碌态(打印/扫描/AI/上传)或已在屏保页时,暂停 idle 计时(评审 bug #1)
 */
const REFRESH_MS = 5 * 60 * 1000
const DEFAULT_TIMEOUT_SEC = 180

export function useScreensaverController(): void {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const busy = useKioskBusy()
  const [playlist, setPlaylist] = useState<KioskScreensaverPlaylist | null>(null)
  const playlistRef = useRef<KioskScreensaverPlaylist | null>(null)
  playlistRef.current = playlist

  const terminalId = getTerminalId()

  useEffect(() => {
    if (!terminalId) return
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const p = await getScreensaverPlaylist(terminalId)
        if (cancelled) return
        setPlaylist(p)
        if (p.enabled && p.items.length > 0) {
          // 预缓存素材 + 清理失效缓存,保证断网兜底且不无限膨胀
          p.items.forEach((it) => void prefetchAsset(it))
          void pruneCache(p.items.map((it) => it.sha256))
        }
      } catch {
        // 拉取失败:保持上一次有效配置;首次失败则 null(不进屏保)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [terminalId])

  const active = !!playlist?.enabled && (playlist?.items.length ?? 0) > 0
  const onScreensaverRoute = pathname === '/screensaver'
  const timeoutMs = (playlist?.idleTimeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000

  const handleIdle = useCallback(() => {
    const p = playlistRef.current
    if (!p?.enabled || p.items.length === 0) return
    navigate('/screensaver', { state: { playlist: p } })
  }, [navigate])

  useIdleTimer({
    timeoutMs,
    enabled: active && !busy && !onScreensaverRoute,
    onIdle: handleIdle,
  })
}
