import { Outlet } from 'react-router-dom'
import { KioskPrivacyGuard } from '../auth/KioskPrivacyGuard'
import { KioskBusyProvider } from '../contexts/KioskBusyContext'

/**
 * Kiosk 终端业务路由的非视觉运行时根。
 *
 * 手机辅助页与共享法律页不挂在这里，避免套用 27 寸公共终端的 idle 策略。
 */
export function KioskRuntimeRoot() {
  return (
    <KioskBusyProvider>
      <KioskPrivacyGuard>
        <Outlet />
      </KioskPrivacyGuard>
    </KioskBusyProvider>
  )
}
