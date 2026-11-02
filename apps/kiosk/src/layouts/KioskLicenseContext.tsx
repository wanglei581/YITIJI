import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { subscribeKioskSensitiveSessionClear } from '../auth/kioskSensitiveSession'
import { useAuth } from '../auth/useAuth'
import { INITIAL_KIOSK_LICENSE_GATE, loadStoredWindDown, saveStoredWindDown, useKioskLicenseGate, type KioskLicenseGate } from '../services/kioskLicenseGate'
import { isWindDownViewOnly, windDownRoute } from './licenseWindDownRoutes'

type KioskLicenseContextValue = KioskLicenseGate & { windDownService: string | null }
const KioskLicenseContext = createContext<KioskLicenseContextValue>({ ...INITIAL_KIOSK_LICENSE_GATE, windDownService: null })

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
  const windDown = useRef<{ mode: string; service: string | null; stored: ReturnType<typeof loadStoredWindDown> }>({ mode: 'initial', service: null, stored: loadStoredWindDown() })
  if (gate.mode === 'winding-down' && windDown.current.mode !== 'winding-down') {
    windDown.current.service = windDown.current.stored ? windDown.current.stored.service : windDownRoute(pathname)?.service ?? null
  }
  if (gate.mode === 'normal' && windDown.current.mode !== 'initial') windDown.current.service = null
  windDown.current.mode = gate.mode
  useEffect(() => {
    if (gate.mode === 'winding-down') {
      const record = { service: windDown.current.service, endsAt: gate.endsAt }
      saveStoredWindDown(record)
      windDown.current.stored = record
    } else if (gate.mode === 'normal') windDown.current.stored = null
  }, [gate.mode, gate.endsAt])
  return <KioskLicenseContext.Provider value={{ ...gate, windDownService: windDown.current.service }}>{children}</KioskLicenseContext.Provider>
}

// 此文件按调用方约定同时导出 Provider 和 hook。
// eslint-disable-next-line react-refresh/only-export-components
export function useKioskLicense(): KioskLicenseContextValue {
  return useContext(KioskLicenseContext)
}
// eslint-disable-next-line react-refresh/only-export-components
export function useWindDownViewOnly(service: string): boolean {
  const { mode, windDownService } = useKioskLicense()
  return isWindDownViewOnly(mode, windDownService, service)
}
