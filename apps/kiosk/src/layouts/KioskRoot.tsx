import { KioskLayout, StatusBadge, type KioskTab } from '@ai-job-print/ui'
import type { DeviceStatus } from '@ai-job-print/shared'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { KioskIconSprite } from '../components/kiosk-icon'
import { KioskBusyProvider } from '../contexts/KioskBusyContext'
import { FavoritesProvider } from '../favorites/FavoritesProvider'
import { useScreensaverController } from '../hooks/useScreensaverController'
import { useIdleLogout } from '../auth/useIdleLogout'

function getActiveTab(pathname: string): KioskTab {
  if (pathname.startsWith('/assistant')) return 'assistant'
  if (pathname.startsWith('/profile')) return 'profile'
  return 'home'
}

function tabToPath(tab: KioskTab): string {
  if (tab === 'assistant') return '/assistant'
  if (tab === 'profile') return '/profile'
  return '/'
}

/**
 * KioskRoot 外层挂 KioskBusyProvider,内层 KioskShell 才能用忙碌态 + 屏保控制器。
 * /screensaver 是顶级路由(全屏,不在此布局内),退出后回到本布局的首页。
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
  const [deviceStatus] = useState<DeviceStatus>('idle')

  // 全局无操作待机宣传屏:忙碌态自动暂停,空闲达阈值跳 /screensaver。
  // 返回 active(屏保是否已配置且有素材),用于与下面的公共空闲重置按 active 互斥。
  const { active: screensaverActive } = useScreensaverController()
  // 公共终端空闲重置(Phase C-1 → C-2A):覆盖登录 + 匿名;忙碌态暂停;空闲达阈值清打印/AI 简历
  // session(含匿名 accessToken)并回首页。屏保 active 时关闭,由屏保控制器接管 idle(优先 /screensaver)。
  useIdleLogout(screensaverActive)

  const activeTab = getActiveTab(pathname)
  const statusVariant = deviceStatus === 'online' || deviceStatus === 'idle' ? 'success' : 'warning'

  // 校园招聘专区（/campus）做成沉浸式 5-Tab 页：隐藏全局头部 + 「首页/AI助手/我的」底部导航，
  // 由页面自带蓝色 Hero 顶栏 + 返回箭头承载导航。
  const isCampusZone = pathname === '/campus'

  return (
    <KioskLayout
      activeTab={activeTab}
      onTabChange={(tab) => navigate(tabToPath(tab))}
      // 首页自带顶栏（一体机名 + 状态栏 + 实时时间，见 HomePage/§15.2），隐藏全局细头部避免重复；
      // 其余页面继续使用全局头部 + 设备状态徽标。
      hideHeader={pathname === '/' || isCampusZone}
      hideBottomNav={isCampusZone}
      headerRight={<StatusBadge status={statusVariant} label={deviceStatus} />}
    >
      {/* FavoritesProvider 在 AuthProvider 内（KioskRoot 处于 RouterProvider 树），
          为岗位列表/详情提供登录态门控的收藏状态；匿名沿用本机 localStorage。 */}
      <FavoritesProvider>
        <Outlet />
      </FavoritesProvider>
    </KioskLayout>
  )
}
