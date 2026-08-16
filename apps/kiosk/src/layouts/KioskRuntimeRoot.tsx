import { Outlet } from 'react-router-dom'
import { KioskPrivacyGuard } from '../auth/KioskPrivacyGuard'
import { KioskBusyProvider } from '../contexts/KioskBusyContext'
import { KioskHidScanGuard } from '../components/hid-guard/KioskHidScanGuard'

/**
 * Kiosk 终端业务路由的非视觉运行时根。
 *
 * 仅手机扫码登录与上传辅助页豁免；法律页仍在安全根内，避免成为暂停硬隐私截止的逃逸路径。
 *
 * KioskHidScanGuard 挂在这里而不是 KioskRoot：误扫防护是运行时安全能力，
 * 必须覆盖沉浸式页（/campus 等隐藏了视觉外壳的路由）。
 */
export function KioskRuntimeRoot() {
  return (
    <KioskBusyProvider>
      <KioskPrivacyGuard>
        <KioskHidScanGuard />
        <Outlet />
      </KioskPrivacyGuard>
    </KioskBusyProvider>
  )
}
