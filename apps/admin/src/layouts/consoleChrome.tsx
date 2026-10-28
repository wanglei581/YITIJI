import { createContext, useContext, type ReactNode } from 'react'
import type { ConsoleTabGroup } from './adminNav'

const ConsoleChromeContext = createContext<ConsoleTabGroup | undefined>(undefined)

/** 布局把当前地址所在的标签组交给页面，由页面在页头之后画标签条。 */
export function ConsoleChromeProvider({
  group,
  children,
}: {
  group: ConsoleTabGroup | undefined
  children: ReactNode
}) {
  return <ConsoleChromeContext.Provider value={group}>{children}</ConsoleChromeContext.Provider>
}

export function useConsoleTabGroup(): ConsoleTabGroup | undefined {
  return useContext(ConsoleChromeContext)
}
