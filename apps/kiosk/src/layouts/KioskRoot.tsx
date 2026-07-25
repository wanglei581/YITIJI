import { KioskLayout, type KioskTab } from '@ai-job-print/ui'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { KioskTopbarStatus } from '../components/kiosk-shell/KioskAppTopbar'
import { getTerminalId } from '../services/api/terminalConfig'
import { KioskIconSprite } from '../components/kiosk-icon'
import { KioskBusyProvider } from '../contexts/KioskBusyContext'
import { FavoritesProvider } from '../favorites/FavoritesProvider'
import { useScreensaverController } from '../hooks/useScreensaverController'
import { useTerminalDeviceStatus } from '../hooks/useTerminalDeviceStatus'
import { useIdleLogout } from '../auth/useIdleLogout'

function getActiveTab(pathname: string): KioskTab {
  if (pathname.startsWith('/assistant')) return 'assistant'
  if (pathname.startsWith('/profile') || pathname === '/me' || pathname.startsWith('/me/')) return 'profile'
  return 'home'
}

function tabToPath(tab: KioskTab): string {
  if (tab === 'assistant') return '/assistant'
  if (tab === 'profile') return '/profile'
  return '/'
}

function statusToneFor(kind: string, printerReady: boolean, loading: boolean): string {
  if (loading) return 'neutral'
  if (printerReady) return 'positive'
  if (kind === 'unknown' || kind === 'low_paper') return 'warning'
  return 'negative'
}

/**
 * KioskRoot 外层挂 KioskBusyProvider,内层 KioskShell 才能用忙碌态 + 屏保控制器。
 * /screensaver 是顶级路由(全屏,不在此布局内),退出后回到本布局的首页。
 *
 * 视觉统一（2026-07-25）：全部布局内路由统一 service-desk + fusion-youth 呈现，
 * 不再按路由白名单切换 legacy 主题；首页也不再自绘顶栏/底栏。
 * 设备状态统一消费 useTerminalDeviceStatus（P0-2 去伪）。
 */
export function KioskRoot() {
  return (
    <KioskBusyProvider>
      {/* 墨青纸感图标 sprite（iconfont Symbol）：挂在布局根，
          虚拟键盘 / 页内通话面板等在任意路由都能引用 #i-* symbol */}
      <KioskIconSprite />
      <KioskShell />
    </KioskBusyProvider>
  )
}

function KioskShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // 共享顶栏始终轮询；首页不再自绘顶栏，故不再按 pathname 停用。
  const { loading, printerLabel, printerReady, kind } = useTerminalDeviceStatus(true)

  // 全局无操作待机宣传屏:忙碌态自动暂停,空闲达阈值跳 /screensaver。
  // 返回 active(屏保是否已配置且有素材),用于与下面的公共空闲重置按 active 互斥。
  const { active: screensaverActive } = useScreensaverController()
  // 公共终端空闲重置(Phase C-1 → C-2A):覆盖登录 + 匿名;忙碌态暂停;空闲达阈值清打印/AI 简历
  // session(含匿名 accessToken)并回首页。屏保 active 时关闭,由屏保控制器接管 idle(优先 /screensaver)。
  useIdleLogout(screensaverActive)

  const activeTab = getActiveTab(pathname)
  const statusLabel = loading ? '设备检查中' : printerLabel
  const statusTone = statusToneFor(kind, printerReady, loading)
  const terminalId = getTerminalId() || '01号机'

  // 校园招聘专区（/campus）做成沉浸式页：隐藏全局头部 + 「首页/AI助手/我的」底部导航，
  // 由页面自带顶栏 + 返回箭头承载导航。
  const isCampusZone = pathname === '/campus'

  return (
    <KioskLayout
      activeTab={activeTab}
      onTabChange={(tab) => navigate(tabToPath(tab))}
      visualTheme="service-desk"
      density="touch"
      presentation="fusion-youth"
      viewport="kiosk"
      hideHeader={isCampusZone}
      hideBottomNav={isCampusZone}
      brandTitle={`就业服务大厅 · ${terminalId}`}
      brandSubtitle="AI求职打印服务终端"
      headerRight={<KioskTopbarStatus tone={statusTone} label={statusLabel} />}
    >
      {/* FavoritesProvider 在 AuthProvider 内（KioskRoot 处于 RouterProvider 树），
          为岗位列表/详情提供登录态门控的收藏状态；匿名沿用本机 localStorage。 */}
      <FavoritesProvider>
        <Outlet />
      </FavoritesProvider>
    </KioskLayout>
  )
}
