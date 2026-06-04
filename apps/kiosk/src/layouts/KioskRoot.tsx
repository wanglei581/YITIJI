import { KioskLayout, StatusBadge, type KioskTab } from '@ai-job-print/ui'
import type { DeviceStatus } from '@ai-job-print/shared'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOutIcon, UserIcon } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { IdleLogoutGuard } from '../auth/IdleLogoutGuard'

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
  const { isLoggedIn, displayName, logout } = useAuth()

  const activeTab = getActiveTab(pathname)
  const statusVariant = deviceStatus === 'online' || deviceStatus === 'idle' ? 'success' : 'warning'

  const authBlock = isLoggedIn ? (
    <>
      <span className="flex items-center gap-1 text-xs text-neutral-600">
        <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {displayName}
      </span>
      <button
        type="button"
        onClick={logout}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 active:bg-neutral-200"
        aria-label="退出登录"
      >
        <LogOutIcon className="h-3.5 w-3.5" aria-hidden="true" />
        退出
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={() => navigate('/login')}
      className="rounded-md px-3 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 active:bg-primary-100"
    >
      登录
    </button>
  )

  return (
    <>
      <KioskLayout
        activeTab={activeTab}
        onTabChange={(tab) => navigate(tabToPath(tab))}
        headerRight={
          <>
            <StatusBadge status={statusVariant} label={deviceStatus} />
            {authBlock}
          </>
        }
      >
        <Outlet />
      </KioskLayout>
      <IdleLogoutGuard />
    </>
  )
}
