import { KioskLayout, StatusBadge, type KioskTab } from '@ai-job-print/ui'
import type { DeviceStatus } from '@ai-job-print/shared'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { KioskBusyProvider } from '../contexts/KioskBusyContext'
import { useScreensaverController } from '../hooks/useScreensaverController'
import { useIdleLogout } from '../auth/useIdleLogout'

function getActiveTab(pathname: string): KioskTab {
  if (pathname.startsWith('/assistant')) return 'assistant'
  if (pathname.startsWith('/profile')) return 'profile'
  return 'home'
}

function tabToPath(tab: KioskTab): string {
  if (tab === 'assistant') return '/assistant'
  if (tab === 'profile') return '/profile'
  return '/'
}

/**
 * KioskRoot 外层挂 KioskBusyProvider,内层 KioskShell 才能用忙碌态 + 屏保控制器。
 * /screensaver 是顶级路由(全屏,不在此布局内),退出后回到本布局的首页。
 */
export function KioskRoot() {
  return (
    <KioskBusyProvider>
      <KioskShell />
    </KioskBusyProvider>
  )
}

function KioskShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [deviceStatus] = useState<DeviceStatus>('idle')

  // 全局无操作待机宣传屏:忙碌态自动暂停,空闲达阈值跳 /screensaver。
  useScreensaverController()
  // 会员登录态空闲自动登出:忙碌态自动暂停,空闲达阈值清内存会话(Phase C-1)。
  useIdleLogout()

  const activeTab = getActiveTab(pathname)
  const statusVariant = deviceStatus === 'online' || deviceStatus === 'idle' ? 'success' : 'warning'

  return (
    <KioskLayout
      activeTab={activeTab}
      onTabChange={(tab) => navigate(tabToPath(tab))}
      headerRight={<StatusBadge status={statusVariant} label={deviceStatus} />}
    >
      <Outlet />
    </KioskLayout>
  )
}
