import { createContext, useContext, type ReactNode } from 'react'
import { INITIAL_KIOSK_LICENSE_GATE, useKioskLicenseGate, type KioskLicenseGate } from '../services/kioskLicenseGate'

const KioskLicenseContext = createContext<KioskLicenseGate>(INITIAL_KIOSK_LICENSE_GATE)

export function KioskLicenseProvider({ children }: { children: ReactNode }) {
  // 清场入口没有可订阅的结束事件；先按约定传 false。
  const gate = useKioskLicenseGate(false)
  return <KioskLicenseContext.Provider value={gate}>{children}</KioskLicenseContext.Provider>
}

// 此文件按调用方约定同时导出 Provider 和 hook。
// eslint-disable-next-line react-refresh/only-export-components
export function useKioskLicense(): KioskLicenseGate {
  return useContext(KioskLicenseContext)
}
