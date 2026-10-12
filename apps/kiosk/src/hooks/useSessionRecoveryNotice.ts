import { useEffect, useRef, useState } from 'react'
import { clearPrintMaterialSession } from '../pages/print/printMaterialSession'
import {
  subscribeTerminalSession,
  takeTerminalSessionRecoveryClearScope,
} from '../services/terminalAuth'

/**
 * print-only：人还在首页或打印线上，当页说这一句。
 * 字面：合规六建议、前端二七拟、合规九定。屏上只许这句，不另写。
 */
export const SESSION_RECOVERY_NOTICE = '机器刚恢复，刚才选的材料已经清掉，要重新传'

/** with-other：先回首页，首页说这一句。字面来源同上。 */
export const SESSION_RECOVERY_NOTICE_OTHER = '机器刚恢复，这台机器上刚才的内容已经清掉，要重新开始。'

const NOTICE_MS = 120_000

type Notice = { until: number; text: string }

let notice: Notice | null = null
let expiryTimer: number | null = null
let watching = false
let wantsHome = false
let dropEpoch = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function arm(text: string, goHome: boolean): void {
  dropEpoch += 1
  // 存储里的打印交接一并清掉。已经打开的页面靠 dropEpoch 丢掉内存里那一份；
  // 之后新选的文件编号不同，不会被这次清场再吞掉。
  clearPrintMaterialSession()
  wantsHome = goHome
  notice = { until: Date.now() + NOTICE_MS, text }
  if (expiryTimer !== null) window.clearTimeout(expiryTimer)
  expiryTimer = window.setTimeout(() => {
    expiryTimer = null
    if (!notice || notice.until > Date.now()) return
    notice = null
    emit()
  }, NOTICE_MS)
  emit()
}

/** 全应用只在这里读一次清场范围。'none' 不说话，也不拆掉已经亮着的那一句。 */
function consume(): void {
  const scope = takeTerminalSessionRecoveryClearScope()
  if (scope === 'print-only') arm(SESSION_RECOVERY_NOTICE, false)
  else if (scope === 'with-other') arm(SESSION_RECOVERY_NOTICE_OTHER, true)
}

function ensureWatch(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  // 恢复可能发生在订阅之前，先读一次。
  consume()
  subscribeTerminalSession(() => consume())
}

export function dismissSessionRecoveryNotice(): void {
  if (!notice) return
  notice = null
  if (expiryTimer !== null) {
    window.clearTimeout(expiryTimer)
    expiryTimer = null
  }
  emit()
}

/** 首页挂载时确保已经在看。不再自己读第二遍。 */
export function readSessionRecoveryOnHomeMount(): void {
  ensureWatch()
}

export function sessionRecoveryWantsHome(): boolean {
  return wantsHome
}

export function acknowledgeSessionRecoveryHome(): void {
  wantsHome = false
}

export function useSessionRecoveryNotice(): string | null {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    ensureWatch()
    const listener = () => setVersion((value) => value + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  void version
  if (!notice || Date.now() >= notice.until) return null
  return notice.text
}

export function useSessionRecoveryDropEpoch(): number {
  const [epoch, setEpoch] = useState(dropEpoch)
  useEffect(() => {
    ensureWatch()
    const listener = () => setEpoch(dropEpoch)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return epoch
}

/**
 * 清场发生在这一页已经挂上之后：内存里的交接作废，120 秒提示收起后也不复水。
 * 清场之后才挂上的页面不在这里吞——存储已清，读到的就是新的一份或空的。
 */
export function useRecoveryDroppedHandoff<T>(handoff: T | null): T | null {
  const epoch = useSessionRecoveryDropEpoch()
  const mountedAt = useRef(epoch)
  const [hidden, setHidden] = useState(false)
  if (!hidden && epoch !== mountedAt.current) setHidden(true)
  return hidden ? null : handoff
}
