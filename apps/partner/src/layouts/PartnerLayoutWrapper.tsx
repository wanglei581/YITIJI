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
import { PartnerCapabilitiesProvider } from '../services/CapabilitiesProvider'
import { usePartnerCapabilities } from '../services/capabilities'
import type { PartnerDataSourceCapabilities } from '../services/api'

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

/**
 * 侧栏能力投影：只隐藏「这类机构连打开都会被服务端拒绝」的入口。
 *
 * 判定来源是服务端 `partner-capabilities.ts` 的同一份矩阵（经
 * `GET /partner/data-sources/capabilities` 下发），前端不另写机构类型规则。
 *
 * 只有智慧校园符合「整页不可用」：smart-campus.service.ts 的 assertSchoolOrg
 * 对**读取**也拒（PARTNER_NOT_SCHOOL），非学校机构点进去只会拿到 403。
 *
 * 岗位 / 招聘会 / 政策**不隐藏**，尽管服务端按类型拒绝新增：
 * 这三处的列表、编辑、下架都不校验机构类型（jobs-partner.service.ts 的
 * getPartnerJobs/getPartnerFairs、policies.service.ts 「更新/下架/删除不校验」），
 * 存量数据必须还能被机构自己下架——把整页藏掉反而会把违规内容锁死在已发布状态。
 * 这些页面改为**在真正会 403 的那颗「新增」按钮上禁用并说明原因**，
 * 比藏掉整个入口更准确，也正好消掉「填完整张表才 403」的死路。
 */
function isNavItemVisible(key: string, caps: PartnerDataSourceCapabilities | null): boolean {
  if (!caps) return true // 能力未知一律放行，见 services/capabilities.ts 的 fail-open 说明
  if (key === 'smart-campus') return caps.canManageSmartCampus
  return true
}

/** 过滤后把被丢弃项的分组标题顺延给该组第一个幸存项，避免分组表头凭空消失。 */
function projectNavItems(caps: PartnerDataSourceCapabilities | null): NavItem[] {
  const out: NavItem[] = []
  let pendingGroup: string | undefined
  for (const item of NAV_ITEMS) {
    if (item.group) pendingGroup = item.group
    if (!isNavItemVisible(item.key, caps)) continue
    out.push(pendingGroup ? { ...item, group: pendingGroup } : item)
    pendingGroup = undefined
  }
  return out
}

const ROLE_LABEL: Record<AuthedUser['role'], string> = {
  admin:   '管理员',
  partner: '机构管理员',
  kiosk:   '终端用户',
}

export function PartnerLayoutWrapper() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthedUser | null>(() => getUser())
  const [authChecked, setAuthChecked] = useState(false)

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
      <div className="flex h-dvh items-center justify-center bg-canvas text-sm text-neutral-400">
        正在验证身份…
      </div>
    )
  }

  // 能力接口需要已登录的 JWT，所以放在鉴权通过之后才挂载
  return (
    <PartnerCapabilitiesProvider>
      <PartnerConsoleShell user={user} />
    </PartnerCapabilitiesProvider>
  )
}

function PartnerConsoleShell({ user }: { user: AuthedUser | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const { capabilities } = usePartnerCapabilities()
  const activeKey = PATH_TO_KEY[location.pathname] ?? 'dashboard'
  const navItems = projectNavItems(capabilities)

  const orgName = user?.name ?? '合作机构后台'

  return (
    <PartnerLayout
      orgName={orgName}
      navItems={navItems}
      activeKey={activeKey}
      visualTheme="legacy"
      density="comfortable"
      onNavChange={(key) => navigate(KEY_TO_PATH[key] ?? '/')}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      userName={user?.name ?? '当前用户'}
      userRole={user ? ROLE_LABEL[user.role] : ''}
      // 通知角标:暂无机构通知数据源,不展示假数字(审计修复)
      headerActions={
        <div className="flex items-center gap-3">
          {/* 用户名/角色已移至侧栏底部用户区(PartnerLayout side-user),顶栏不再重复展示 */}
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
    </PartnerLayout>
  )
}
