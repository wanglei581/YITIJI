import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { subscribeKioskSensitiveSessionClear } from '../auth/kioskSensitiveSession'
import { useAuth } from '../auth/useAuth'
import { INITIAL_KIOSK_LICENSE_GATE, useKioskLicenseGate, type KioskLicenseGate } from '../services/kioskLicenseGate'

const KioskLicenseContext = createContext<KioskLicenseGate>(INITIAL_KIOSK_LICENSE_GATE)

export function KioskLicenseProvider({ children }: { children: ReactNode }) {
  const [useEnded, setUseEnded] = useState(false)
  const { user, guestMode } = useAuth()
  const { pathname } = useLocation()
  const prior = useRef({ user, guestMode, pathname })
  useEffect(() => subscribeKioskSensitiveSessionClear(() => setUseEnded(true)), [])
  useEffect(() => {
    const previous = prior.current
    if ((user && user !== previous.user) || (guestMode && !previous.guestMode) ||
        (pathname !== previous.pathname && !['/', '/screensaver', '/login'].includes(pathname))) setUseEnded(false)
    prior.current = { user, guestMode, pathname }
  }, [user, guestMode, pathname])
  const gate = useKioskLicenseGate(useEnded)
  return <KioskLicenseContext.Provider value={gate}>{children}</KioskLicenseContext.Provider>
}

// 此文件按调用方约定同时导出 Provider 和 hook。
// eslint-disable-next-line react-refresh/only-export-components
export function useKioskLicense(): KioskLicenseGate {
  return useContext(KioskLicenseContext)
}
