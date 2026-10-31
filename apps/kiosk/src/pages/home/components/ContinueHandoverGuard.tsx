import { useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import { needsHandoverConfirm } from '../../../auth/kioskPresence'
import { useAuth } from '../../../auth/useAuth'
import { continueHeldFor, holdContinueFor, isContinueHeld, subscribeContinueHold, tokenFingerprint } from '../continueHandover'

/** 与 kioskPresence 的触碰监听同一组事件：记的是「有人碰过屏幕」，不记坐标、不记按了什么。 */
const TOUCH_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const
/** 空档到点的检查间隔：到点后最迟 0.25 秒收起。 */
const CHECK_EVERY_MS = 250

/**
 * 首页「继续办理」的交接保护。
 *
 * 首页是公共屏：上一位走开、没退出，下一位可能接着站到屏前。「继续办理」会把进行中的打印文件名直接写在
 * 首页上（还要拿登录人的令牌去读 /me），所以它必须守「我的」同一道闸：进来之前这台机器空了超过 30 秒
 * （kioskPresence.needsHandoverConfirm），就先不画、也不读，等本人在「我的」的「还是你吗？」里确认。
 *
 *   · 挂载那一刻就判：要确认的话，面板根本不挂载，一条 /me 请求都不发；
 *   · 挂着的时候盯两件事：空档到点（每 0.25 秒看一眼），和之后的每一下触碰（下一位碰屏）——一判成要确认就收起，
 *     已经画出来的文件名立刻没有，面板的状态与读取一并卸掉；
 *   · 判成要确认之后是粘性的（见 continueHandover）：下一位碰几下、等多久、去别的页再回首页，都还是收着。
 *
 * 收起时这一块什么都不画（稿里首页没有这个状态，也不写「已保存」之类没有核实的话），
 * 外层容器为空时本来就不占位。没登录时没有令牌，什么都不用收，面板自己不画。
 */
export function ContinueHandoverGuard({ children }: { children: ReactNode }) {
  const { isLoggedIn, getToken } = useAuth()
  const token = isLoggedIn ? getToken() : null
  const fingerprint = token ? tokenFingerprint(token) : null
  const heldFor = useSyncExternalStore(subscribeContinueHold, continueHeldFor)
  // 渲染期就判：要收起的话，这一次提交里面板根本不会挂载。
  const held = isContinueHeld(heldFor, fingerprint, fingerprint !== null && needsHandoverConfirm())

  // 刚判成要确认的，在同一次提交里记成粘性。
  useLayoutEffect(() => {
    if (held && fingerprint !== null && heldFor !== fingerprint) holdContinueFor(fingerprint)
  }, [held, fingerprint, heldFor])

  // 没收起时盯着：下一位碰屏，或者空档到点。
  useEffect(() => {
    if (fingerprint === null || held) return
    // 触碰监听挂在 window 的捕获阶段、晚于 kioskPresence 自己的那一个，跑到这里时这一下已经记过了。
    const check = (): void => {
      if (needsHandoverConfirm()) holdContinueFor(fingerprint)
    }
    for (const event of TOUCH_EVENTS) window.addEventListener(event, check, { capture: true, passive: true })
    const timer = window.setInterval(check, CHECK_EVERY_MS)
    return () => {
      for (const event of TOUCH_EVENTS) window.removeEventListener(event, check, { capture: true })
      window.clearInterval(timer)
    }
  }, [fingerprint, held])

  return held ? null : <>{children}</>
}
