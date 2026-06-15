import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { PartnerLayout, type NavItem } from '@ai-job-print/ui'
import { useEffect, useState } from 'react'
import {
  BarChart2Icon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  DatabaseIcon,
  FileTextIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorIcon,
  RefreshCwIcon,
  UserCogIcon,
} from 'lucide-react'
import { getUser, logout, verifyToken, type AuthedUser } from '../services/auth'

const PATH_TO_KEY: Record<string, string> = {
  '/':           'dashboard',
  '/profile':    'profile',
  '/jobs':       'jobs',
  '/companies':  'companies',
  '/fairs':      'fairs',
  '/smart-campus': 'smart-campus',
  '/policy':     'policy',
  '/terminals':  'terminals',
  '/stats':      'stats',
  '/sources':    'sources',
  '/sync-logs':  'sync-logs',
  '/account':    'account',
}

const KEY_TO_PATH: Record<string, string> = Object.fromEntries(
  Object.entries(PATH_TO_KEY).map(([path, key]) => [key, path])
)

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',  label: '工作台',        icon: LayoutDashboardIcon, href: KEY_TO_PATH.dashboard },
  { key: 'profile',    label: '机构资料',       icon: Building2Icon,   group: '机构信息', href: KEY_TO_PATH.profile },
  { key: 'jobs',       label: '岗位信息管理',   icon: BriefcaseIcon,   group: '数据管理', href: KEY_TO_PATH.jobs },
  { key: 'companies',  label: '企业资料管理',   icon: Building2Icon, href: KEY_TO_PATH.companies },
  { key: 'fairs',      label: '招聘会信息管理', icon: CalendarIcon, href: KEY_TO_PATH.fairs },
  { key: 'smart-campus', label: '智慧校园',       icon: GraduationCapIcon, group: '校园服务', href: KEY_TO_PATH['smart-campus'] },
  { key: 'policy',     label: '政策公告管理',   icon: FileTextIcon, href: KEY_TO_PATH.policy },
  { key: 'sources',    label: '数据源管理',     icon: DatabaseIcon, href: KEY_TO_PATH.sources },
  { key: 'sync-logs',  label: '同步日志',       icon: RefreshCwIcon, href: KEY_TO_PATH['sync-logs'] },
  { key: 'terminals',  label: '终端数据',       icon: MonitorIcon,     group: '数据与账号', href: KEY_TO_PATH.terminals },
  { key: 'stats',      label: '数据统计',       icon: BarChart2Icon, href: KEY_TO_PATH.stats },
  { key: 'account',    label: '账号权限',       icon: UserCogIcon, href: KEY_TO_PATH.account },
]

const ROLE_LABEL: Record<AuthedUser['role'], string> = {
  admin:   '管理员',
  partner: '机构管理员',
  kiosk:   '终端用户',
}

export function PartnerLayoutWrapper() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState<AuthedUser | null>(() => getUser())
  const [authChecked, setAuthChecked] = useState(false)
  const activeKey = PATH_TO_KEY[location.pathname] ?? 'dashboard'

  useEffect(() => {
    let cancelled = false
    verifyToken().then((u) => {
      if (cancelled) return
      if (!u) {
        navigate('/login', { replace: true })
        return
      }
      if (u.role !== 'partner') {
        // 角色不符强制下线
        navigate('/login', { replace: true })
        return
      }
      setUser(u)
      setAuthChecked(true)
    })
    return () => { cancelled = true }
  }, [navigate])

  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-sm text-gray-400">
        正在验证身份…
      </div>
    )
  }

  const orgName = user?.name ?? '合作机构后台'

  return (
    <PartnerLayout
      orgName={orgName}
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavChange={(key) => navigate(KEY_TO_PATH[key] ?? '/')}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      userName={user?.name ?? '当前用户'}
      userRole={user ? ROLE_LABEL[user.role] : ''}
      // 通知角标:暂无机构通知数据源,不展示假数字(审计修复)
      headerActions={
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium text-gray-800">{user?.name ?? '当前用户'}</p>
            <p className="text-xs text-gray-500">{user ? ROLE_LABEL[user.role] : ''}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200"
            aria-label="退出登录"
          >
            <LogOutIcon className="h-4 w-4" aria-hidden="true" />
            退出
          </button>
        </div>
      }
    >
      <Outlet />
    </PartnerLayout>
  )
}
