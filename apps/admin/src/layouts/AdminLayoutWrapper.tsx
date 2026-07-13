import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AdminLayout, type NavItem } from '@ai-job-print/ui'
import { useEffect, useState } from 'react'
import {
  AlertTriangleIcon,
  BellIcon,
  BotIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  ConciergeBellIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderIcon,
  GiftIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  MonitorIcon,
  MonitorPlayIcon,
  PackageIcon,
  PrinterIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ShieldIcon,
  SparklesIcon,
  UserCogIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react'
import { getUser, logout, verifyToken, type AuthedUser } from '../services/auth'
import { adminOpsService } from '../services/api/adminOps'

// 历史路径(/terminals 等)在 routes 层重定向到 /devices?tab=…,
// 这里把它们一并映射到 devices 菜单 key,保证侧栏高亮一致。
const PATH_TO_KEY: Record<string, string> = {
  '/':             'dashboard',
  '/devices':      'devices',
  '/terminals':    'devices',
  '/printers':     'devices',
  '/peripherals':  'devices',
  '/screensaver':  'screensaver',
  '/toolbox':      'toolbox',
  '/smart-campus': 'smart-campus',
  '/orders':       'orders',
  '/print-scan':   'print-scan',
  '/billing':      'billing',
  '/files':        'files',
  '/job-materials': 'job-materials',
  '/ai-services':  'ai-services',
  '/ai-config':    'ai-config',
  '/job-sources':     'job-sources',
  '/fair-sources':    'fair-sources',
  '/policy-sources':  'policy-sources',
  '/fairs':           'fairs',
  '/companies':       'companies',
  '/import-batches':  'import-batches',
  '/sync-sources':    'sync-sources',
  '/partners':     'partners',
  '/users':        'users',
  '/benefit-activities': 'benefit-activities',
  '/member-benefits': 'member-benefits',
  '/member-feedback': 'member-feedback',
  '/member-notifications': 'member-notifications',
  '/alerts':       'alerts',
  '/permissions':  'permissions',
  '/audit':        'audit',
  '/account-settings': 'account-settings',
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

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',    label: '工作台',      icon: LayoutDashboardIcon, href: KEY_TO_PATH.dashboard },
  { key: 'devices',      label: '设备管理',     icon: MonitorIcon,         group: '设备运维', href: KEY_TO_PATH.devices },
  { key: 'screensaver',  label: '宣传屏',       icon: MonitorPlayIcon, href: KEY_TO_PATH.screensaver },
  { key: 'toolbox',      label: '百宝箱',       icon: PackageIcon, href: KEY_TO_PATH.toolbox },
  { key: 'smart-campus', label: '智慧校园',     icon: GraduationCapIcon, href: KEY_TO_PATH['smart-campus'] },
  // badge 不再硬编码:告警数为实时派生,进入页面即见真实数量
  { key: 'alerts',       label: '告警中心',     icon: AlertTriangleIcon, href: KEY_TO_PATH.alerts },
  { key: 'orders',       label: '订单管理',     icon: FileTextIcon,        group: '业务管理', href: KEY_TO_PATH.orders },
  { key: 'print-scan',   label: '打印扫描运维', icon: PrinterIcon, href: KEY_TO_PATH['print-scan'] },
  { key: 'billing',      label: '计费与对账',   icon: WalletIcon, href: KEY_TO_PATH.billing },
  { key: 'files',        label: '文件管理',     icon: FolderIcon, href: KEY_TO_PATH.files },
  { key: 'job-materials', label: '求职材料库',   icon: FileTextIcon, href: KEY_TO_PATH['job-materials'] },
  { key: 'ai-services',  label: 'AI服务管理',   icon: BotIcon, href: KEY_TO_PATH['ai-services'] },
  { key: 'ai-config',    label: 'AI大模型',     icon: SparklesIcon, href: KEY_TO_PATH['ai-config'] },
  { key: 'job-sources',     label: '岗位信息源',   icon: BriefcaseIcon,         group: '数据内容', href: KEY_TO_PATH['job-sources'] },
  { key: 'fair-sources',   label: '招聘会信息源', icon: CalendarIcon, href: KEY_TO_PATH['fair-sources'] },
  { key: 'policy-sources', label: '政策信息源',   icon: ScrollTextIcon, href: KEY_TO_PATH['policy-sources'] },
  { key: 'fairs',          label: '招聘会管理',   icon: ConciergeBellIcon, href: KEY_TO_PATH.fairs },
  { key: 'companies',      label: '企业展示管理', icon: Building2Icon, href: KEY_TO_PATH.companies },
  { key: 'import-batches', label: 'Excel 导入记录', icon: FileSpreadsheetIcon, href: KEY_TO_PATH['import-batches'] },
  { key: 'sync-sources',   label: 'API 同步数据源', icon: RefreshCwIcon, href: KEY_TO_PATH['sync-sources'] },
  { key: 'partners',     label: '合作机构管理', icon: Building2Icon,       group: '机构用户', href: KEY_TO_PATH.partners },
  { key: 'users',        label: '用户管理',     icon: UsersIcon, href: KEY_TO_PATH.users },
  { key: 'benefit-activities', label: '权益活动', icon: GiftIcon, href: KEY_TO_PATH['benefit-activities'] },
  { key: 'member-benefits', label: '会员权益', icon: GiftIcon, href: KEY_TO_PATH['member-benefits'] },
  { key: 'member-feedback', label: '意见反馈', icon: MessageSquareIcon, href: KEY_TO_PATH['member-feedback'] },
  { key: 'member-notifications', label: '消息通知', icon: MegaphoneIcon, href: KEY_TO_PATH['member-notifications'] },
  { key: 'permissions',  label: '权限管理',     icon: ShieldIcon,          group: '系统管理', href: KEY_TO_PATH.permissions },
  { key: 'audit',        label: '日志审计',     icon: ScrollTextIcon, href: KEY_TO_PATH.audit },
]

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
  // 通知角标 = 实时派生告警数(审计修复:原硬编码 3);加载失败显示 0,不显示假数字
  const [alertCount, setAlertCount] = useState(0)
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
      <div className="flex h-screen items-center justify-center bg-canvas text-sm text-neutral-400">
        正在验证身份…
      </div>
    )
  }

  return (
    <AdminLayout
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      visualTheme={location.pathname === '/' ? 'service-desk' : 'legacy'}
      density="compact"
      onNavChange={(key) => navigate(KEY_TO_PATH[key] ?? '/')}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      appName="管理后台"
      userName={user?.name ?? '当前用户'}
      userRole={user ? ROLE_LABEL[user.role] : ''}
      headerActions={
        <div className="flex items-center gap-3">
          {/* 真实告警数(实时派生);点击进入告警中心。原 notificationCount prop 在自定义 headerActions 下不渲染,已移除死代码 */}
          <a
            href="/alerts"
            onClick={(e) => {
              e.preventDefault()
              navigate('/alerts')
            }}
            aria-label={`告警${alertCount > 0 ? `(${alertCount}条)` : ''}`}
            className="relative flex h-9 w-9 items-center justify-center rounded-[9px] text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
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
            className="flex h-9 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-sm font-semibold text-neutral-600 transition-colors hover:bg-neutral-50 active:bg-neutral-100"
          >
            <UserCogIcon className="h-4 w-4" aria-hidden="true" />
            账号设置
          </a>
          <button
            type="button"
            onClick={logout}
            className="flex h-9 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-sm font-semibold text-neutral-600 transition-colors hover:bg-neutral-50 active:bg-neutral-100"
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
