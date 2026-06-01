import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AdminLayout, type NavItem } from '@ai-job-print/ui'
import { useEffect, useState } from 'react'
import {
  AlertTriangleIcon,
  BotIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  ConciergeBellIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
} from 'lucide-react'
import { getUser, logout, verifyToken, type AuthedUser } from '../services/auth'

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',    label: '工作台',      icon: LayoutDashboardIcon },
  { key: 'devices',      label: '设备管理',     icon: MonitorIcon,         group: '设备运维' },
  { key: 'alerts',       label: '告警中心',     icon: AlertTriangleIcon,   badge: 3 },
  { key: 'orders',       label: '订单管理',     icon: FileTextIcon,        group: '业务管理' },
  { key: 'files',        label: '文件管理',     icon: FolderIcon },
  { key: 'ai-services',  label: 'AI服务管理',   icon: BotIcon },
  { key: 'job-sources',     label: '岗位信息源',   icon: BriefcaseIcon,         group: '数据内容' },
  { key: 'fair-sources',   label: '招聘会信息源', icon: CalendarIcon },
  { key: 'fairs',          label: '招聘会管理',   icon: ConciergeBellIcon },
  { key: 'import-batches', label: 'Excel 导入记录', icon: FileSpreadsheetIcon },
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
  '/job-sources':     'job-sources',
  '/fair-sources':    'fair-sources',
  '/fairs':           'fairs',
  '/import-batches':  'import-batches',
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

const ROLE_LABEL: Record<AuthedUser['role'], string> = {
  admin:   '超级管理员',
  partner: '合作机构',
  kiosk:   '终端用户',
}

export function AdminLayoutWrapper() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState<AuthedUser | null>(() => getUser())
  const [authChecked, setAuthChecked] = useState(false)
  const activeKey = PATH_TO_KEY[location.pathname] ?? 'dashboard'

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
    })
    return () => { cancelled = true }
  }, [navigate])

  // 等 /auth/me 回应再渲染,防 401 时先闪一帧后台 UI
  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-sm text-gray-400">
        正在验证身份…
      </div>
    )
  }

  return (
    <AdminLayout
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavChange={(key) => navigate(KEY_TO_PATH[key] ?? '/')}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      appName="管理后台"
      userName={user?.name ?? '当前用户'}
      userRole={user ? ROLE_LABEL[user.role] : ''}
      notificationCount={3}
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
    </AdminLayout>
  )
}
