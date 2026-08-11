import { createContext, useContext, type ReactNode } from 'react'

export type KioskWarningExitTo = 'home' | 'screensaver'

export interface KioskWarningDescriptor {
  sourcePath: string
  exitTo: KioskWarningExitTo
  deadlineAt: number
  canContinue: boolean
}

export type KioskSessionClearDestination =
  | { path: '/' | '/profile'; state?: never }
  | { path: '/login'; state: { from: '/profile'; hint?: string } }

export interface KioskSessionControlValue {
  warning: KioskWarningDescriptor | null
  continueSession: () => void
  hardClear: () => void
  clearSessionTo: (destination: KioskSessionClearDestination) => void
  clearToScreensaver: () => void
}

function failClosed(): void {
  window.location.replace('/')
}

const failClosedValue: KioskSessionControlValue = {
  warning: null,
  continueSession: failClosed,
  hardClear: failClosed,
  clearSessionTo: failClosed,
  clearToScreensaver: failClosed,
}

export const KioskSessionControlContext = createContext<KioskSessionControlValue>(failClosedValue)

export function KioskSessionControlProvider({
  children,
  value,
}: {
  children: ReactNode
  value: KioskSessionControlValue
}) {
  return (
    <KioskSessionControlContext.Provider value={value}>
      {children}
    </KioskSessionControlContext.Provider>
  )
}

export function useKioskSessionControl(): KioskSessionControlValue {
  return useContext(KioskSessionControlContext)
}
