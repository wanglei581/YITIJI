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
let tapBound = false
let pressedSinceArm = false
let releaseTimer: number | null = null
/** 抬手后等 click 的上限。按在置灰按钮上不发 click，过了这段还没等到也照样收。 */
const RELEASE_GRACE_MS = 600
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * 「下一次触屏」＝句子亮起之后才按下的那一下。
 * 按下（pointerdown）时只记一笔、不收：句子一没整页往上挪，抬手时手指底下已经换了东西，
 * 这一下会点空或点到别的按钮。等这一下点完（click）或滑走（pointercancel）再收——click 走到
 * 捕获阶段时点中的是谁已经定了，按钮照常生效；按在置灰按钮上不发 click，抬手后 RELEASE_GRACE_MS 收。
 * 句子亮起前就按着的那一下不算，免得本人还没看清就收了。
 * 捕获阶段挂上，不 preventDefault、不 stopPropagation。
 */
function onPressStart(): void {
  pressedSinceArm = true
}

function onPressEnd(): void {
  if (pressedSinceArm) dismissSessionRecoveryNotice()
}

function onRelease(): void {
  if (!pressedSinceArm) return
  if (releaseTimer !== null) window.clearTimeout(releaseTimer)
  releaseTimer = window.setTimeout(() => {
    releaseTimer = null
    dismissSessionRecoveryNotice()
  }, RELEASE_GRACE_MS)
}

function bindTapDismiss(): void {
  if (tapBound || typeof document === 'undefined') return
  tapBound = true
  document.addEventListener('pointerdown', onPressStart, true)
  document.addEventListener('pointerup', onRelease, true)
  document.addEventListener('click', onPressEnd, true)
  document.addEventListener('pointercancel', onPressEnd, true)
}

function unbindTapDismiss(): void {
  pressedSinceArm = false
  if (releaseTimer !== null) {
    window.clearTimeout(releaseTimer)
    releaseTimer = null
  }
  if (!tapBound || typeof document === 'undefined') return
  document.removeEventListener('pointerdown', onPressStart, true)
  document.removeEventListener('pointerup', onRelease, true)
  document.removeEventListener('click', onPressEnd, true)
  document.removeEventListener('pointercancel', onPressEnd, true)
  tapBound = false
}

function clearNotice(): void {
  notice = null
  if (expiryTimer !== null) {
    window.clearTimeout(expiryTimer)
    expiryTimer = null
  }
  unbindTapDismiss()
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
    clearNotice()
    emit()
  }, NOTICE_MS)
  // 新的一句：之前按着、还没抬手的那一下不算。
  pressedSinceArm = false
  if (releaseTimer !== null) {
    window.clearTimeout(releaseTimer)
    releaseTimer = null
  }
  bindTapDismiss()
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
  clearNotice()
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
    // 先挂上再读。ensureWatch 里那一次 consume 会当场通知；监听若排在后面，首屏这一句就丢了。
    const listener = () => setVersion((value) => value + 1)
    listeners.add(listener)
    ensureWatch()
    setVersion((value) => value + 1)
    return () => { listeners.delete(listener) }
  }, [])
  void version
  if (!notice || Date.now() >= notice.until) return null
  return notice.text
}

export function useSessionRecoveryDropEpoch(): number {
  const [epoch, setEpoch] = useState(dropEpoch)
  useEffect(() => {
    const listener = () => setEpoch(dropEpoch)
    listeners.add(listener)
    ensureWatch()
    setEpoch(dropEpoch)
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
