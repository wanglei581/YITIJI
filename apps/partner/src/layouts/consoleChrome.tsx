import { createContext, useContext, type ReactNode } from 'react'
import type { ConsoleTab } from './partnerNav'

export interface ConsoleChromeValue {
  groupLabel: string | null
  tabs: readonly ConsoleTab[] | null
}

const ConsoleChromeContext = createContext<ConsoleChromeValue>({ groupLabel: null, tabs: null })

export function ConsoleChromeProvider({ value, children }: { value: ConsoleChromeValue; children: ReactNode }) {
  return <ConsoleChromeContext.Provider value={value}>{children}</ConsoleChromeContext.Provider>
}

export function useConsoleChrome(): ConsoleChromeValue {
  return useContext(ConsoleChromeContext)
}
