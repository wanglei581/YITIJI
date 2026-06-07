import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useIdleTimer } from '../hooks/useIdleTimer'
import { useKioskBusy } from '../contexts/KioskBusyContext'
import { clearPrintMaterialSession } from '../pages/print/printMaterialSession'
import { clearAiResumeSession } from '../pages/resume/aiResumeSession'
import { useAuth } from './useAuth'

/**
 * Kiosk 空闲自动登出守卫（Phase C-1）。
 *
 * 公共一体机安全约束（CLAUDE.md §11 §17）：
 * - 会员登录态只存内存（见 AuthContext），用户离开后必须主动清理，
 *   避免下一位用户继承上一位的会话与敏感记录。
 * - 登录后无操作超过阈值 → 调 logout() 清空内存会话（token / user）。
 * - 忙碌态（打印中 / 扫描中 / AI 处理中 / 上传中）绝不触发登出：
 *   优先沿用真实忙碌信号 KioskBusyContext（各流程 useBusyLock 注册的引用计数锁），
 *   同时沿用 AuthContext.busy 预留位，任一为真都暂停计时。
 * - 进入待机宣传屏（/screensaver）由 ScreensaverPage 挂载时登出兜底；
 *   屏保为顶级路由，KioskShell 已卸载，本计时器自然停止，二者互不冲突。
 * - 屏保关闭/未配置时，idle 登出不会经过 useScreensaverController 的
 *   clearPrintMaterialSession()。因此本守卫在 idle 触发时同步清理打印材料 session，
 *   并 replace 回首页，避免下一位用户仍停留在材料检查/打印流程页或继承
 *   sessionStorage 中的材料上下文。
 *
 * 不读写任何浏览器存储（material session 用 sessionStorage 由 clear 函数负责清空）；
 * 登出仅清内存态。
 *
 * 阈值默认 180s，可经 VITE_KIOSK_LOGOUT_IDLE_SEC 覆盖（与屏保默认空闲一致，
 * 屏保未配置时本计时器仍独立保障会员会话不会长期驻留）。
 */
const DEFAULT_LOGOUT_IDLE_SEC = 180

function resolveLogoutIdleMs(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_LOGOUT_IDLE_SEC)
  const sec = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOGOUT_IDLE_SEC
  return sec * 1000
}

export function useIdleLogout(): void {
  const { isLoggedIn, busy: authBusy, logout } = useAuth()
  const kioskBusy = useKioskBusy()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const busy = kioskBusy || authBusy
  const onScreensaverRoute = pathname === '/screensaver'

  const handleIdle = useCallback(() => {
    // 仅在非忙碌（enabled 已保证）的 idle 触发：先清敏感材料 / AI 简历 session，再清内存会话，
    // 最后 replace 回首页，确保下一位用户从干净首页开始（避免继承匿名 accessToken）。
    clearPrintMaterialSession()
    clearAiResumeSession()
    logout()
    if (pathname !== '/') navigate('/', { replace: true })
  }, [logout, navigate, pathname])

  useIdleTimer({
    timeoutMs: resolveLogoutIdleMs(),
    enabled: isLoggedIn && !busy && !onScreensaverRoute,
    onIdle: handleIdle,
  })
}
