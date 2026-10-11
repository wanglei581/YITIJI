import { useEffect, useState } from 'react'
import {
  subscribeTerminalSession,
  terminalSessionState,
  type TerminalSessionState,
} from '../services/terminalAuth'

/** 本机会话。checking 与 ready 时页面保持原样，只有 failed 才改打印这条线。 */
export function useTerminalSessionState(): TerminalSessionState {
  const [session, setSession] = useState<TerminalSessionState>(() => terminalSessionState())
  useEffect(() => subscribeTerminalSession(setSession), [])
  return session
}
