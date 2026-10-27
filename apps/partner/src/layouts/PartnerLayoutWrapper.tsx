import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { ContentTrustBanner } from '../components/ContentTrustBanner'
import { PartnerLayout } from '@ai-job-print/ui'
import { useEffect, useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { getUser, logout, verifyToken, type AuthedUser } from '../services/auth'
import { PartnerCapabilitiesProvider } from '../services/CapabilitiesProvider'
import { usePartnerCapabilities } from '../services/capabilities'
import { ConsoleTabStrip } from './ConsoleTabStrip'
import {
  KEY_TO_PATH,
  NAV_ITEMS,
  PATH_TO_KEY,
  consoleTabsFor,
  projectNavItems,
} from './partnerNav'

const ROLE_LABEL: Record<AuthedUser['role'], string> = {
  admin:   '管理员',
  partner: '机构管理员',
  kiosk:   '终端用户',
}

function narrowSidebar(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 767px)').matches
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
  // 390 一类窄屏默认收起侧栏，避免 240px 侧栏把内容区挤出横向滚动。
  const [collapsed, setCollapsed] = useState(narrowSidebar)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const onChange = () => setCollapsed(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  const { capabilities } = usePartnerCapabilities()
  const activeKey = PATH_TO_KEY[location.pathname] ?? (location.pathname.startsWith('/screen/') ? 'screen' : 'dashboard')
  const navItems = projectNavItems(capabilities)
  const tabs = consoleTabsFor(activeKey, capabilities)
  const tabLabel = NAV_ITEMS.find((item) => item.key === activeKey)?.label

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
      {/* 上架受「内容可信」闸门约束：政策由机构自己发布，岗位 / 招聘会仍由管理员上架，
          两条路都要求机构先通过核验。未核验时机构会看到「审核通过了但终端上没有」而
          得不到原因 —— 这条横幅补的就是原因与该找谁。挂布局层，避免逐页塞会漂移。 */}
      <ContentTrustBanner />
      {tabs && tabLabel && <ConsoleTabStrip label={tabLabel} tabs={tabs} />}
      <Outlet />
    </PartnerLayout>
  )
}
