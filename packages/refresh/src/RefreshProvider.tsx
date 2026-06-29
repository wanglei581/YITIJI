import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { RefreshStore } from './store'

interface RefreshContextValue {
  store: RefreshStore
}

const RefreshContext = createContext<RefreshContextValue | null>(null)

export interface RefreshProviderProps {
  children: ReactNode
  paused?: boolean
  idleMs?: number
}

export function RefreshProvider({ children, paused = false, idleMs = 15_000 }: RefreshProviderProps) {
  const value = useMemo<RefreshContextValue>(() => ({ store: new RefreshStore() }), [])

  useEffect(() => {
    value.store.setPaused(paused)
    value.store.setIdleMs(idleMs)
  }, [idleMs, paused, value.store])

  useEffect(() => {
    const resume = () => {
      const hidden = document.visibilityState === 'hidden'
      value.store.setPaused(hidden || paused)
      if (!hidden && !paused) value.store.refreshOnFocus()
    }
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    resume()
    return () => {
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [paused, value.store])

  useEffect(() => {
    const markActivity = () => value.store.markUserActivity()
    const windowEvents = ['click', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const
    const documentEvents = ['input', 'focusin'] as const
    windowEvents.forEach((event) => window.addEventListener(event, markActivity, { passive: true }))
    documentEvents.forEach((event) => document.addEventListener(event, markActivity, { passive: true }))
    return () => {
      windowEvents.forEach((event) => window.removeEventListener(event, markActivity))
      documentEvents.forEach((event) => document.removeEventListener(event, markActivity))
    }
  }, [value.store])

  useEffect(() => {
    const timer = window.setInterval(() => value.store.tick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [value.store])

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
}

export function useRefreshContext(): RefreshContextValue {
  const context = useContext(RefreshContext)
  if (!context) throw new Error('useRefreshContext must be used within RefreshProvider')
  return context
}
