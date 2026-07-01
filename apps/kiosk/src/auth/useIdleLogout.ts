import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useIdleTimer } from '../hooks/useIdleTimer'
import { useKioskBusy } from '../contexts/KioskBusyContext'
import { clearKioskSensitiveSession } from './kioskSensitiveSession'
import { useAuth } from './useAuth'

/**
 * Kiosk 公共终端空闲重置守卫（Phase C-1 → C-2A 扩展）。
 *
 * 覆盖范围（关键修复）：**登录会员 + 匿名用户都生效**。
 * - C-1 初版 enabled 含 `isLoggedIn`，只对登录态计时；当屏保未配置 / 未启用时，
 *   匿名用户离开后 `aiResumeSession`（sessionStorage 内 taskId + 一次性 accessToken）
 *   既不会被本守卫清理，也不会被屏保接管 → 下一位用户刷新即可读回上一位匿名 AI 结果。
 * - 本守卫去掉登录门槛：匿名同样在空闲达阈值时清 session 并回首页，堵住该缺口。
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
 * idle 触发动作：清打印材料 + AI 简历 session（含匿名 accessToken），登出（幂等，匿名为 no-op），
 * 非首页则 replace 回首页，确保下一位用户从干净首页开始。
 *
 * 仅清内存态 + sessionStorage（由 clear 函数负责）；**不读写也不新增 localStorage / cookie / IndexedDB**。
 *
 * 阈值默认 180s，可经 VITE_KIOSK_LOGOUT_IDLE_SEC 覆盖。
 */
const DEFAULT_LOGOUT_IDLE_SEC = 180

function resolveLogoutIdleMs(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_LOGOUT_IDLE_SEC)
  const sec = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOGOUT_IDLE_SEC
  return sec * 1000
}

export function useIdleLogout(screensaverActive: boolean): void {
  const { busy: authBusy, logout } = useAuth()
  const kioskBusy = useKioskBusy()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const busy = kioskBusy || authBusy
  const onScreensaverRoute = pathname === '/screensaver'

  const handleIdle = useCallback(() => {
    // 非忙碌、屏保未接管时的 idle：先清敏感 session（打印材料 + AI 简历，含匿名 accessToken）
    // 和登录前求职材料草稿，再清内存会话（登出幂等，匿名为 no-op），最后 replace 回首页。
    clearKioskSensitiveSession()
    logout()
    if (pathname !== '/') navigate('/', { replace: true })
  }, [logout, navigate, pathname])

  useIdleTimer({
    timeoutMs: resolveLogoutIdleMs(),
    // 覆盖登录 + 匿名；屏保接管（screensaverActive）时关闭，避免与 useScreensaverController 双触发。
    enabled: !busy && !onScreensaverRoute && !screensaverActive,
    onIdle: handleIdle,
  })
}
