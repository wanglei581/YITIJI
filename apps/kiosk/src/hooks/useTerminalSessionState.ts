import { useEffect, useState } from 'react'
import {
  subscribeTerminalSession,
  terminalSessionState,
  type TerminalSessionState,
} from '../services/terminalAuth'

/** 本机会话的原始状态。确认页按钮仍读这个：checking 时不可点。 */
export function useTerminalSessionState(): TerminalSessionState {
  const [session, setSession] = useState<TerminalSessionState>(() => terminalSessionState())
  useEffect(() => subscribeTerminalSession(setSession), [])
  return session
}

// 三处页面共用。只有 ready / failed 改写；checking 保持上一次。还没定过时按没失败。
let settledPrintSession: 'ready' | 'failed' | null = null

export function usePrintSessionBlocked(): boolean {
  const session = useTerminalSessionState()
  if (session === 'ready' || session === 'failed') settledPrintSession = session
  return settledPrintSession === 'failed'
}
