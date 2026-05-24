import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { PartnerLayout, type NavItem } from '@ai-job-print/ui'
import { useState } from 'react'
import {
  BarChart2Icon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  DatabaseIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  RefreshCwIcon,
  UserCogIcon,
} from 'lucide-react'

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',  label: '工作台',        icon: LayoutDashboardIcon },
  { key: 'profile',    label: '机构资料',       icon: Building2Icon },
  { key: 'jobs',       label: '岗位信息管理',   icon: BriefcaseIcon },
  { key: 'fairs',      label: '招聘会信息管理', icon: CalendarIcon },
  { key: 'policy',     label: '政策公告管理',   icon: FileTextIcon },
  { key: 'terminals',  label: '终端数据',       icon: MonitorIcon },
  { key: 'stats',      label: '数据统计',       icon: BarChart2Icon },
  { key: 'sources',    label: '数据源管理',     icon: DatabaseIcon },
  { key: 'sync-logs',  label: '同步日志',       icon: RefreshCwIcon },
  { key: 'account',    label: '账号权限',       icon: UserCogIcon },
]

const PATH_TO_KEY: Record<string, string> = {
  '/':           'dashboard',
  '/profile':    'profile',
  '/jobs':       'jobs',
  '/fairs':      'fairs',
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

export function PartnerLayoutWrapper() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const activeKey = PATH_TO_KEY[location.pathname] ?? 'dashboard'

  return (
    <PartnerLayout
      orgName="合作机构"
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavChange={(key) => navigate(KEY_TO_PATH[key] ?? '/')}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
    >
      <Outlet />
    </PartnerLayout>
  )
}
