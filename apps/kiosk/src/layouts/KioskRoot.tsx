import { KioskLayout, StatusBadge, type KioskTab } from '@ai-job-print/ui'
import type { DeviceStatus } from '@ai-job-print/shared'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

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

export function KioskRoot() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [deviceStatus] = useState<DeviceStatus>('idle')

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
