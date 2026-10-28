import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AdminLayout } from '@ai-job-print/ui'
import { useEffect, useState } from 'react'
import { BellIcon, LogOutIcon, UserCogIcon } from 'lucide-react'
import { getUser, logout, verifyToken, type AuthedUser } from '../services/auth'
import { adminOpsService } from '../services/api/adminOps'
import { ConsoleChromeProvider } from './consoleChrome'
import { KEY_TO_PATH, NAV_ITEMS, PATH_TO_KEY, tabGroupForPath } from './adminNav'

const ROLE_LABEL: Record<AuthedUser['role'], string> = {
  admin:   '超级管理员',
  partner: '合作机构',
  kiosk:   '终端用户',
}

function narrowSidebar(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 767px)').matches
}

export function AdminLayoutWrapper() {
  const navigate = useNavigate()
  const location = useLocation()
  // 390 一类窄屏默认收起侧栏，避免 240px 侧栏把内容区挤到无法换行。
  const [collapsed, setCollapsed] = useState(narrowSidebar)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const onChange = () => setCollapsed(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  const [user, setUser] = useState<AuthedUser | null>(() => getUser())
  const [authChecked, setAuthChecked] = useState(false)
  // 通知角标 = 未处理的派生告警数（默认 view=open）；加载失败显示 0,不显示假数字
  const [alertCount, setAlertCount] = useState(0)
  // 数据大屏的页签是 /screen/:tab 子路径，侧栏仍高亮「数据大屏」
  const activeKey = PATH_TO_KEY[location.pathname] ?? (location.pathname.startsWith('/screen/') ? 'screen' : 'dashboard')
  const tabGroup = tabGroupForPath(location.pathname)

  // Boot 时调 /auth/me 校验 token;失败 (verifyToken 返回 null) 跳 /login。
  useEffect(() => {
    let cancelled = false
    verifyToken().then((u) => {
      if (cancelled) return
      if (!u) {
        navigate('/login', { replace: true })
        return
      }
      setUser(u)
      setAuthChecked(true)
      adminOpsService
        .listAlerts()
        .then((r) => { if (!cancelled) setAlertCount(r.data.length) })
        .catch(() => undefined)
    })
    return () => { cancelled = true }
  }, [navigate])

  // 等 /auth/me 回应再渲染,防 401 时先闪一帧后台 UI
  if (!authChecked) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas text-sm text-neutral-400">
        正在验证身份…
      </div>
    )
  }

  return (
    <AdminLayout
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      visualTheme="legacy"
      density="compact"
      onNavChange={(key) => navigate(KEY_TO_PATH[key] ?? '/')}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      appName="管理后台"
      userName={user?.name ?? '当前用户'}
      userRole={user ? ROLE_LABEL[user.role] : ''}
      headerActions={
        <div className="flex items-center gap-1.5 sm:gap-3">
          {/* 未处理告警数(实时派生的 open 视图);点击进入告警中心。已确认但仍在发生的不会从告警页消失。 */}
          <a
            href="/alerts"
            onClick={(e) => {
              e.preventDefault()
              navigate('/alerts')
            }}
            aria-label={`告警${alertCount > 0 ? `(${alertCount}条)` : ''}`}
            className="relative flex h-11 w-11 items-center justify-center rounded-[9px] text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
          >
            <BellIcon className="h-4 w-4" aria-hidden="true" />
            {alertCount > 0 && (
              <span className="absolute right-1 top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-error px-0.5 text-[9px] font-bold leading-none text-white">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </a>
          {/* 用户名/角色已移至侧栏底部用户区(AdminLayout side-user),顶栏不再重复展示 */}
          <a
            href="/account-settings"
            onClick={(e) => {
              e.preventDefault()
              navigate('/account-settings')
            }}
            aria-label="账号设置"
            className="flex min-h-11 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-sm font-semibold text-neutral-600 transition-colors hover:bg-neutral-50 active:bg-neutral-100"
          >
            <UserCogIcon className="h-4 w-4" aria-hidden="true" />
            账号设置
          </a>
          <button
            type="button"
            onClick={logout}
            className="flex min-h-11 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-sm font-semibold text-neutral-600 transition-colors hover:bg-neutral-50 active:bg-neutral-100"
            aria-label="退出登录"
          >
            <LogOutIcon className="h-4 w-4" aria-hidden="true" />
            退出
          </button>
        </div>
      }
    >
      <ConsoleChromeProvider group={tabGroup}>
        <Outlet />
      </ConsoleChromeProvider>
    </AdminLayout>
  )
}
