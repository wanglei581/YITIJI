import type { ReactNode } from 'react'
import { useKioskLicense } from './KioskLicenseContext'
import './license-gate.css'

export function LicenseLock({ children }: { children: ReactNode }) {
  const { mode } = useKioskLicense()
  if (mode !== 'winding-down') return children
  return <div data-license-locked="" {...{ inert: '' }} aria-disabled="true" style={{ display: 'contents' }}>{children}</div>
}
