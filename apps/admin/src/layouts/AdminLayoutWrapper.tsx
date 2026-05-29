import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AdminLayout, type NavItem } from '@ai-job-print/ui'
import { useState } from 'react'
import {
  AlertTriangleIcon,
  BotIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  ConciergeBellIcon,
  FileTextIcon,
  FolderIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
} from 'lucide-react'

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',    label: '工作台',      icon: LayoutDashboardIcon },
  { key: 'devices',      label: '设备管理',     icon: MonitorIcon,         group: '设备运维' },
  { key: 'alerts',       label: '告警中心',     icon: AlertTriangleIcon,   badge: 3 },
  { key: 'orders',       label: '订单管理',     icon: FileTextIcon,        group: '业务管理' },
  { key: 'files',        label: '文件管理',     icon: FolderIcon },
  { key: 'ai-services',  label: 'AI服务管理',   icon: BotIcon },
  { key: 'job-sources',  label: '岗位信息源',   icon: BriefcaseIcon,       group: '数据内容' },
  { key: 'fair-sources', label: '招聘会信息源', icon: CalendarIcon },
  { key: 'fairs',        label: '招聘会管理',   icon: ConciergeBellIcon },
  { key: 'partners',     label: '合作机构管理', icon: Building2Icon,       group: '机构用户' },
  { key: 'users',        label: '用户管理',     icon: UsersIcon },
  { key: 'permissions',  label: '权限管理',     icon: ShieldIcon,          group: '系统管理' },
  { key: 'audit',        label: '日志审计',     icon: ScrollTextIcon },
]

// 历史路径(/terminals 等)在 routes 层重定向到 /devices?tab=…,
// 这里把它们一并映射到 devices 菜单 key,保证侧栏高亮一致。
const PATH_TO_KEY: Record<string, string> = {
  '/':             'dashboard',
  '/devices':      'devices',
  '/terminals':    'devices',
  '/printers':     'devices',
  '/peripherals':  'devices',
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

// 反向映射:菜单 key → 落地路径。
// 多对一时(/devices /terminals /printers /peripherals → 'devices')
// 必须显式选 canonical 路径,否则 Object.fromEntries 取最后一个会把
// "设备管理" 菜单跳到 /peripherals(空 Tab)。
const KEY_TO_PATH: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [path, key] of Object.entries(PATH_TO_KEY)) {
    // 首次写入即胜出 → /devices 是第一个,所以 devices key 落到 /devices
    if (!(key in out)) out[key] = path
  }
  return out
})()

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
