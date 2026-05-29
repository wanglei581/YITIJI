import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AdminLayout, type NavItem } from '@ai-job-print/ui'
import { useState } from 'react'
import {
  AlertTriangleIcon,
  BotIcon,
  BriefcaseIcon,
  Building2Icon,
  CableIcon,
  CalendarIcon,
  ConciergeBellIcon,
  FileTextIcon,
  FolderIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  PrinterIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
} from 'lucide-react'

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',    label: '工作台',      icon: LayoutDashboardIcon },
  { key: 'terminals',    label: '终端管理',     icon: MonitorIcon,         group: '设备管理' },
  { key: 'printers',     label: '打印机管理',   icon: PrinterIcon },
  { key: 'peripherals',  label: '外设管理',     icon: CableIcon },
  { key: 'orders',       label: '订单管理',     icon: FileTextIcon,        group: '业务管理' },
  { key: 'files',        label: '文件管理',     icon: FolderIcon },
  { key: 'ai-services',  label: 'AI服务管理',   icon: BotIcon },
  { key: 'job-sources',  label: '岗位信息源',   icon: BriefcaseIcon,       group: '数据内容' },
  { key: 'fair-sources', label: '招聘会信息源', icon: CalendarIcon },
  { key: 'fairs',        label: '招聘会管理',   icon: ConciergeBellIcon },
  { key: 'partners',     label: '合作机构管理', icon: Building2Icon,       group: '机构用户' },
  { key: 'users',        label: '用户管理',     icon: UsersIcon },
  { key: 'alerts',       label: '告警中心',     icon: AlertTriangleIcon,   group: '系统管理', badge: 3 },
  { key: 'permissions',  label: '权限管理',     icon: ShieldIcon },
  { key: 'audit',        label: '日志审计',     icon: ScrollTextIcon },
]

const PATH_TO_KEY: Record<string, string> = {
  '/':             'dashboard',
  '/terminals':    'terminals',
  '/printers':     'printers',
  '/peripherals':  'peripherals',
  '/orders':       'orders',
  '/files':        'files',
  '/ai-services':  'ai-services',
  '/job-sources':  'job-sources',
  '/fair-sources': 'fair-sources',
  '/fairs':        'fairs',
  '/partners':     'partners',
  '/users':        'users',
  '/alerts':       'alerts',
  '/permissions':  'permissions',
  '/audit':        'audit',
}

const KEY_TO_PATH: Record<string, string> = Object.fromEntries(
  Object.entries(PATH_TO_KEY).map(([path, key]) => [key, path])
)

export function AdminLayoutWrapper() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const activeKey = PATH_TO_KEY[location.pathname] ?? 'dashboard'

  return (
    <AdminLayout
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavChange={(key) => navigate(KEY_TO_PATH[key] ?? '/')}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      appName="管理后台"
      userName="系统管理员"
      userRole="超级管理员"
      notificationCount={3}
    >
      <Outlet />
    </AdminLayout>
  )
}
