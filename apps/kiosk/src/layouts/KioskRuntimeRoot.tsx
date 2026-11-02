import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { refreshKioskProfile, startKioskProfileKeeper } from '../services/api/kioskProfile'
import { AiDeclarationHost } from '../ai/AiDeclarationHost'
import { KioskPrivacyGuard } from '../auth/KioskPrivacyGuard'
import { KioskBusyProvider } from '../contexts/KioskBusyContext'
import { KioskHidScanGuard } from '../components/hid-guard/KioskHidScanGuard'
import { useContentUpdate } from '../hooks/useContentUpdate'
import { startSupportContactKeeper } from '../services/api/supportContact'
import { KioskLicenseProvider, useKioskLicense } from './KioskLicenseContext'
import { KioskPausedScreen } from '../components/KioskPausedScreen'

function ContentUpdateGuard() {
  useContentUpdate()
  return null
}

/**
 * 服务电话与服务时间由管理员后台配置。运行时根负责读：挂载时读一次，之后在缓存过期前续上，
 * 终端号变了按新号重读（见 supportContact.ts）；页面和设备状态只订阅，不各自去读。
 * 挂在隐私清场叠层外面：清场只换掉子树，不应该让读取与续期的计时跟着重来一遍。
 */
function ProfileGuard() {
  const { user, guestMode } = useAuth()
  const { pathname } = useLocation()
  const previousPath = useRef(pathname)
  useEffect(() => startKioskProfileKeeper(), [])
  useEffect(() => { void refreshKioskProfile() }, [user, guestMode])
  useEffect(() => {
    if (previousPath.current === '/screensaver' && pathname !== '/screensaver') void refreshKioskProfile()
    previousPath.current = pathname
  }, [pathname])
  return null
}

function SupportContactGuard() {
  useEffect(() => startSupportContactKeeper(), [])
  return null
}

function LicensedOutlet() {
  const { mode, notice } = useKioskLicense()
  const navigate = useNavigate()
  const previousMode = useRef(mode)
  useEffect(() => {
    if (previousMode.current === 'paused' && mode === 'normal') navigate('/', { replace: true })
    previousMode.current = mode
  }, [mode, navigate])
  return mode === 'paused' ? <KioskPausedScreen notice={notice} /> : <Outlet />
}

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
      <AiDeclarationHost />
      <SupportContactGuard />
      <ProfileGuard />
      <KioskLicenseProvider>
        <KioskPrivacyGuard>
          <ContentUpdateGuard />
          <KioskHidScanGuard />
          <LicensedOutlet />
        </KioskPrivacyGuard>
      </KioskLicenseProvider>
    </KioskBusyProvider>
  )
}
