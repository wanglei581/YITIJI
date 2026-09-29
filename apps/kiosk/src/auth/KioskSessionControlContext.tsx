import { createContext, useContext, type ReactNode } from 'react'
import type { KioskEndUseOptions, KioskEndUseReason } from './kioskEndUse'

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
  /**
   * 所有离场出口的唯一入口（结束使用、换号、闲置到点、完成页到点、交接）。
   * 页面不许自己 logout / 清本机数据，一律调它；步骤与顺序见 kioskEndUse.ts。
   */
  endKioskUse: (reason: KioskEndUseReason, options?: KioskEndUseOptions) => void
  clearToScreensaver: () => void
}

function failClosed(): void {
  window.location.replace('/')
}

const failClosedValue: KioskSessionControlValue = {
  warning: null,
  continueSession: failClosed,
  hardClear: failClosed,
  endKioskUse: failClosed,
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
