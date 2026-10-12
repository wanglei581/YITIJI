import { useEffect, useState } from 'react'
import {
  subscribeTerminalSession,
  terminalSessionRecoveryDeferred,
  terminalSessionState,
  type TerminalSessionState,
} from '../services/terminalAuth'

/** 本机会话的原始状态。确认页按钮仍读这个：checking 时不可点。 */
export function useTerminalSessionState(): TerminalSessionState {
  const [session, setSession] = useState<TerminalSessionState>(() => terminalSessionState())
  useEffect(() => subscribeTerminalSession(setSession), [])
  return session
}

// 三处页面共用「上一次定下来的状态」：只有 ready / failed 改写，checking 保持上一次；还没定过按没失败。
// 记在模块里、由订阅改写：哪个页面都没挂着时状态变了也照样记下，回到首页不会拿到过期的那一次。
let settledPrintSession: 'ready' | 'failed' | null = null
let settledDeferred = false
let watchingSettled = false
const deferredListeners = new Set<() => void>()

function settle(next: TerminalSessionState): void {
  if (next === 'ready' || next === 'failed') settledPrintSession = next
}

function settleDeferred(next: TerminalSessionState): void {
  // checking 保持上一次：压着没恢复时续期会先变成 checking，不能把第 5 句闪掉。
  if (next === 'checking') return
  const prev = settledDeferred
  settledDeferred = next === 'failed' && terminalSessionRecoveryDeferred()
  if (settledDeferred === prev) return
  for (const listener of deferredListeners) listener()
}

function ensureSettledWatch(): void {
  if (watchingSettled) return
  watchingSettled = true
  const current = terminalSessionState()
  settle(current)
  settleDeferred(current)
  subscribeTerminalSession((next) => {
    settle(next)
    settleDeferred(next)
  })
}

export function usePrintSessionBlocked(): boolean {
  ensureSettledWatch()
  // 订阅本身也会让组件在状态变化时重渲染，读到的是订阅里已经记好的值。
  useTerminalSessionState()
  return settledPrintSession === 'failed'
}

/** 压着没恢复。状态字符串没变（仍是 failed）时，setRecoveryView 也会通知，这里靠自己的订阅重绘。 */
export function usePrintSessionDeferred(): boolean {
  ensureSettledWatch()
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((value) => value + 1)
    deferredListeners.add(listener)
    return () => { deferredListeners.delete(listener) }
  }, [])
  useTerminalSessionState()
  return settledDeferred
}
