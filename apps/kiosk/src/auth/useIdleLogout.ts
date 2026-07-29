import { useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useIdleTimer } from '../hooks/useIdleTimer'
import { useKioskBusy } from '../contexts/KioskBusyContext'
import { useAuth } from './useAuth'

export interface KioskIdleWarningRequest {
  deadlineAt: number
  warningMs: number
}

/**
 * Kiosk 公共终端空闲重置守卫（Phase C-1 → C-2A 扩展）。
 *
 * 覆盖范围（关键修复）：**登录会员 + 匿名用户都生效**。
 * - C-1 初版 enabled 含 `isLoggedIn`，只对登录态计时；当屏保未配置 / 未启用时，
 *   匿名用户离开后 `aiResumeSession`（sessionStorage 内 taskId + 一次性 accessToken）
 *   既不会被本守卫清理，也不会被屏保接管 → 下一位用户刷新即可读回上一位匿名 AI 结果。
 * - 本守卫去掉登录门槛：匿名同样在空闲达阈值前发出预警，交由隐私守卫统一处理。
 *
 * 与待机宣传屏的关系（screensaverActive，避免双触发）：
 * - 屏保已配置且有素材（screensaverActive=true）→ 本守卫**关闭**，由
 *   useScreensaverController 接管 idle，优先进入 /screensaver（其挂载与退出均清会话），
 *   不破坏现有屏保行为。
 * - 屏保未配置 / 未启用（screensaverActive=false）→ 本守卫接管 idle，做公共终端重置。
 * 二者按 screensaverActive 互斥，任一 idle 周期内只有一个计时器会触发，不会竞态。
 *
 * 忙碌态豁免（CLAUDE.md §11 §17）：打印 / 扫描 / AI / 上传中（KioskBusyContext 引用计数锁）
 * 或 AuthContext.busy 预留位任一为真 → 立即暂停计时，绝不打断业务流程。
 *
 * idle 只上报绝对预警截止；后续动作由 KioskPrivacyGuard 统一处理。
 *
 * 用户数据只清内存态 + sessionStorage；持久化 privacy boundary 仅含随机代次和 history idx，
 * 不包含 token、手机号、材料或其他用户数据。
 *
 * 阈值默认 180s，可经 VITE_KIOSK_LOGOUT_IDLE_SEC 覆盖。
 */
const DEFAULT_LOGOUT_IDLE_SEC = 180
const MAX_BROWSER_TIMER_MS = 2_147_483_647

function resolveLogoutIdleMs(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_LOGOUT_IDLE_SEC)
  const sec = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOGOUT_IDLE_SEC
  return sec * 1000
}

export function resolveWarningWindow(totalMs: number): { triggerMs: number; warningMs: number } {
  const safeTotalMs =
    Number.isFinite(totalMs) && totalMs > 0 && totalMs <= MAX_BROWSER_TIMER_MS ? totalMs : 1
  const raw = Number(import.meta.env.VITE_KIOSK_SESSION_WARNING_SEC)
  const configuredMs = (Number.isFinite(raw) && raw > 0 ? raw : 30) * 1000
  const desiredWarningMs = Math.min(configuredMs, safeTotalMs)
  const triggerMs = Math.max(1, safeTotalMs - desiredWarningMs)
  return { triggerMs, warningMs: Math.max(0, safeTotalMs - triggerMs) }
}

export function useIdleLogout(
  screensaverActive: boolean,
  onWarning: (request: KioskIdleWarningRequest) => void
): void {
  const { busy: authBusy } = useAuth()
  const kioskBusy = useKioskBusy()
  const { pathname } = useLocation()

  const busy = kioskBusy || authBusy
  const onScreensaverRoute = pathname === '/screensaver'
  const onSessionTimeoutRoute = pathname === '/session-timeout'
  const { triggerMs, warningMs } = resolveWarningWindow(resolveLogoutIdleMs())
  const handleIdle = useCallback(
    (scheduledAt: number) => {
      onWarning({ deadlineAt: scheduledAt + warningMs, warningMs })
    },
    [onWarning, warningMs]
  )

  useIdleTimer({
    timeoutMs: triggerMs,
    // 覆盖登录 + 匿名；屏保接管（screensaverActive）时关闭，避免与 useScreensaverController 双触发。
    enabled: !busy && !onScreensaverRoute && !onSessionTimeoutRoute && !screensaverActive,
    onIdle: handleIdle,
  })
}
