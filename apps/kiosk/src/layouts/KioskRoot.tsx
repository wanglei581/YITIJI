import { KioskLayout, StatusBadge, type KioskTab } from '@ai-job-print/ui'
import type { DeviceStatus } from '@ai-job-print/shared'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { MemberAuthProvider, useMemberIdleLogout } from '../auth/MemberAuthContext'

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

/** 实际外壳：在 MemberAuthProvider 内，可用空闲超时登出。 */
function KioskShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [deviceStatus] = useState<DeviceStatus>('idle')

  // 公共一体机：登录态下 5 分钟无操作自动登出。
  useMemberIdleLogout()

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

export function KioskRoot() {
  return (
    <MemberAuthProvider>
      <KioskShell />
    </MemberAuthProvider>
  )
}
