import { KioskLayout, type KioskTab } from '@ai-job-print/ui'
import { useLayoutEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { KioskTopbarStatus } from '../components/kiosk-shell/KioskAppTopbar'
import { KioskStageFit } from '../components/kiosk-shell/KioskStageFit'
import { getTerminalCode } from '../services/api/terminalConfig'
import { KioskIconSprite } from '../components/kiosk-icon'
import { FavoritesProvider } from '../favorites/FavoritesProvider'
import { useKioskStageFit } from '../hooks/useKioskStageFit'
import { useTerminalDeviceStatus } from '../hooks/useTerminalDeviceStatus'
import '../styles/v6-runtime-shell.css'

function getActiveTab(pathname: string): KioskTab {
  if (pathname.startsWith('/assistant')) return 'assistant'
  if (pathname.startsWith('/profile') || pathname === '/me' || pathname.startsWith('/me/'))
    return 'profile'
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

const ACTIONBAR_ROUTES = new Set([
  '/print/upload',
  '/print/material-check',
  '/print/preview',
  '/print/confirm',
  '/print/cashier',
  '/print/progress',
  '/scan/start',
  '/scan/settings',
  '/scan/progress',
  '/scan/result',
  '/print-scan/convert',
  '/print-scan/sign',
  '/resume/source',
  '/resume/generate',
  '/resume/generate/preview',
  '/resume/report',
])

function routeUsesPageActionbar(pathname: string): boolean {
  return ACTIONBAR_ROUTES.has(pathname) || pathname.startsWith('/print-scan/feature/')
}

interface V6ShellRoute {
  /**
   * 顶栏主标题。
   * null   → 该页自带页内 KioskPageHeader（返回键 + 域名 h1），顶栏只显示「职易达」全局品牌，
   *          避免同一屏 76px 内出现两个同名标题。
   * string → 该页没有页内页头（/print-scan、/profile），域名必须由顶栏承载，
   *          否则用户不知道自己在哪一屏。
   */
  domainTitle: string | null
  /** 副标题是否附终端编号。首页是品牌页不挂设备号；其余页保留，运维要能一眼读出机器。 */
  withTerminalCode: boolean
  /** 顶栏品牌是否兼作「返回首页」。只给没有页内返回键的页，避免和页内返回重复。 */
  brandReturnsHome: boolean
}

/**
 * V6 暖纸壳白名单 —— 「哪些路由已经迁到 V6 壳」的唯一真值。
 *
 * 要把一条路由改成 V6，只改这张表；不要在别处另写 pathname === '/xxx' 的判断。
 * 表外路由继续用旧的深藏青顶栏，互不污染。
 */
const V6_SHELL_ROUTES = new Map<string, V6ShellRoute>([
  ['/', { domainTitle: null, withTerminalCode: false, brandReturnsHome: false }],
  ['/print-scan', { domainTitle: '打印扫描服务', withTerminalCode: true, brandReturnsHome: true }],
  ['/resume-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
  ['/jobs-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
  ['/fairs-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
  ['/interview-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
  ['/policy-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
  ['/profile', { domainTitle: '我的', withTerminalCode: true, brandReturnsHome: false }],
  // 页内自带 KioskPageHeader「到机码核销」，顶栏不再重复域名。
  ['/print/pickup-claim', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
])

function v6ShellSubtitle(entry: V6ShellRoute, terminalCode: string): string {
  // 域名已经在顶栏主标题上时，副标题回落到品牌名，避免「职易达 / 职易达 · 机号」自我重复。
  const base = entry.domainTitle === null ? 'AI 求职操作系统' : '职易达'
  return entry.withTerminalCode ? `${base} · ${terminalCode}` : base
}

/**
 * KioskRoot 只负责带 header/footer/nav 的视觉布局。
 * 会话安全根、忙碌态与 idle/屏保控制器统一挂在 KioskRuntimeRoot。
 *
 * 视觉统一（2026-07-25）：全部布局内路由统一 service-desk + fusion-youth 呈现，
 * 不再按路由白名单切换 legacy 主题；首页也不再自绘顶栏/底栏。
 * 设备状态统一消费 useTerminalDeviceStatus（P0-2 去伪）。
 */
export function KioskRoot() {
  return (
    <>
      {/* 墨青纸感图标 sprite（iconfont Symbol）：挂在布局根，
          虚拟键盘 / 页内通话面板等在任意路由都能引用 #i-* symbol */}
      <KioskIconSprite />
      <KioskShell />
    </>
  )
}

function KioskShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { viewportW, viewportH } = useKioskStageFit()
  // 共享顶栏始终轮询；首页不再自绘顶栏，故不再按 pathname 停用。
  const deviceStatus = useTerminalDeviceStatus(true)
  const { loading, printerLabel, printerReady, kind } = deviceStatus

  const activeTab = getActiveTab(pathname)
  const statusLabel = loading ? '设备检查中' : printerLabel
  const statusTone = statusToneFor(kind, printerReady, loading)
  const terminalCode = getTerminalCode() || '设备未绑定'

  useLayoutEffect(() => {
    const content = document.querySelector<HTMLElement>('.ui-kiosk-content')
    if (!content) return

    const resetRouteScroll = () => {
      content.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }

    resetRouteScroll()
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      resetRouteScroll()
      secondFrame = window.requestAnimationFrame(resetRouteScroll)
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [pathname])

  // 校园招聘专区（/campus）做成沉浸式页：隐藏全局头部 + 「首页/AI顾问/我的」底部导航，
  // 由页面自带顶栏 + 返回箭头承载导航。
  const isCampusZone = pathname === '/campus'
  const v6Shell = V6_SHELL_ROUTES.get(pathname) ?? null
  const isV6Route = v6Shell !== null
  const v6DomainTitle = v6Shell?.domainTitle ?? null
  const usesPageActionbar = routeUsesPageActionbar(pathname)
  const isCompactViewport = viewportW <= 760 || (viewportW <= 960 && viewportW > viewportH)
  const isResponsiveHome = pathname === '/' && isCompactViewport
  const usesFluidViewport = isCompactViewport || (viewportW > 960 && viewportW > viewportH)

  const shell = (
    <KioskLayout
      activeTab={activeTab}
      onTabChange={(tab) => navigate(tabToPath(tab))}
      visualTheme="service-desk"
      density="touch"
      presentation="fusion-youth"
      viewport={isCompactViewport ? 'mobile' : 'kiosk'}
      hideHeader={isCampusZone}
      hideBottomNav={isCampusZone || usesPageActionbar}
      brandMark={isV6Route ? '职' : undefined}
      brandTitle={v6DomainTitle ?? (isV6Route ? '职易达' : `就业服务大厅 · ${terminalCode}`)}
      brandSubtitle={
        v6Shell ? v6ShellSubtitle(v6Shell, terminalCode) : 'AI求职打印服务终端'
      }
      onBrandClick={v6Shell?.brandReturnsHome ? () => navigate('/') : undefined}
      brandActionLabel={v6Shell?.brandReturnsHome ? '返回首页' : undefined}
      headerRight={<KioskTopbarStatus tone={statusTone} label={statusLabel} />}
      className={`${isResponsiveHome ? 'kiosk-home-mobile' : 'h-full'}${isV6Route ? ' v6-runtime-shell' : ''}`}
    >
      {/* FavoritesProvider 在 AuthProvider 内（KioskRoot 处于 RouterProvider 树），
          为岗位列表/详情提供登录态门控的收藏状态；匿名沿用本机 localStorage。 */}
      <FavoritesProvider>
        <Outlet context={deviceStatus} />
      </FavoritesProvider>
    </KioskLayout>
  )

  // 手机首页关闭舞台缩放，但保留相同的 host/scaler/stage DOM，避免旋转时替换布局根。
  return <KioskStageFit enabled={!usesFluidViewport}>{shell}</KioskStageFit>
}
