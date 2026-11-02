import { useEffect, useLayoutEffect, useRef } from 'react'
import { useAuth } from '../auth/useAuth'
import { isKioskClearNoOp } from '../auth/kioskClearScope'
import { useKioskSessionControl } from '../auth/KioskSessionControlContext'
import { useKioskBusy } from '../contexts/KioskBusyContext'
import { scanCleanupHolding } from '../pages/scan/scanCleanupGate'
import {
  ContentUpdateController,
  fetchContentRelease,
  readContentRelease,
} from '../services/contentUpdate'

export function useContentUpdate(): void {
  const auth = useAuth()
  const busy = useKioskBusy()
  const { warning } = useKioskSessionControl()
  const state = useRef({ auth, busy, warning })
  useLayoutEffect(() => {
    state.current = { auth, busy, warning }
  }, [auth, busy, warning])

  useEffect(() => {
    if (!import.meta.env.PROD) return
    const indexUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href
    const current = readContentRelease(document, indexUrl)
    if (!current) return
    const controller = new ContentUpdateController({
      currentVersion: current.version,
      readPublished: (verifyAssets, signal) => fetchContentRelease(indexUrl, verifyAssets, signal),
      canReload: () => {
        const latest = state.current
        return (
          latest.auth.ready &&
          !latest.auth.busy &&
          !latest.busy &&
          latest.warning === null &&
          document.visibilityState === 'visible' &&
          navigator.onLine &&
          window.location.pathname === '/' &&
          !window.location.search &&
          !window.location.hash &&
          !scanCleanupHolding() &&
          isKioskClearNoOp({
            pathname: '/',
            isLoggedIn: latest.auth.isLoggedIn,
            guestMode: latest.auth.guestMode,
          }) &&
          !document.querySelector(
            ':modal, [role="dialog"], [aria-modal="true"], input:focus, textarea:focus, [contenteditable="true"]:focus'
          )
        )
      },
      reload: () => window.location.reload(),
    })
    const activity = () => controller.markActivity()
    const resume = () => {
      controller.markActivity()
      if (document.visibilityState === 'visible' && navigator.onLine) void controller.check()
    }
    const events = [
      'pointerdown',
      'touchstart',
      'keydown',
      'mousemove',
      'wheel',
      'scroll',
      'input',
      'focusin',
    ] as const
    events.forEach((event) =>
      window.addEventListener(event, activity, { capture: true, passive: true })
    )
    window.addEventListener('online', resume)
    window.addEventListener('offline', activity)
    document.addEventListener('visibilitychange', resume)
    const timer = window.setInterval(() => {
      void controller.tick()
    }, 1000)
    void controller.tick()
    return () => {
      controller.stop()
      window.clearInterval(timer)
      events.forEach((event) => window.removeEventListener(event, activity, { capture: true }))
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', activity)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])
}
