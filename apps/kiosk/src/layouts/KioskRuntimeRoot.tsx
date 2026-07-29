import { Outlet } from 'react-router-dom'
import { KioskPrivacyGuard } from '../auth/KioskPrivacyGuard'
import { KioskBusyProvider } from '../contexts/KioskBusyContext'

/**
 * Kiosk 终端业务路由的非视觉运行时根。
 *
 * 仅手机扫码登录与上传辅助页豁免；法律页仍在安全根内，避免成为暂停硬隐私截止的逃逸路径。
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
