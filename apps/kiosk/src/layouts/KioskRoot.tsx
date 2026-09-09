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
  '/print/desk',
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
/* 只列**仍在用 V6 壳**的路由。迁到青序流光的路由必须从这里移出去——
 * `isV6Route` 虽然已经用 `!isQxRoute` 挡住了它们，但这张表本身也是运行时真值，
 * fusion-w6-routes.spec.ts:32 会拿它和实际壳归属对账，留着就是自相矛盾。
 * 2026-09-08 移出：'/'（首页迁入青序流光）、'/print-scan'（早已迁入，本次一并清理）。 */
const V6_SHELL_ROUTES = new Map<string, V6ShellRoute>([
  ['/resume-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
  ['/jobs-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
  ['/fairs-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
  ['/interview-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
  ['/policy-service', { domainTitle: null, withTerminalCode: true, brandReturnsHome: false }],
])

/**
 * 青序流光已迁移路由。
 *
 * `Set.has(pathname)` 是精确字符串比对：`/print-scan/feature/id-photo` 对不上
 * 集合里的字面量，带参路由会漏出旧壳、两套色系打架。
 *
 * 所以匹配分两层：
 *   1. 精确集合 —— 无参数路由；
 *   2. 前缀列表 —— 只放「整棵子树都已迁完」的带参段。
 *
 * 前缀绝不能写成 `/print-scan`：同前缀下尚未迁移的 `/print-scan/convert`
 * 仍是别的 lane，误命中会让它掉进空壳。`/print-scan/sign` 已迁入精确集合。
 * hideHeader / hideBottomNav 只接受本文件内对 pathname 的封闭判定
 * （`isQxMigratedPath(pathname)` 是壳层契约允许的具名谓词形态）。
 */
const QX_MIGRATED_ROUTES = new Set<string>([
  '/',
  '/print/pickup-claim',
  '/print/cashier',
  '/print/upload',
  '/print/confirm',
  '/print/desk',
  '/print/material-check',
  '/print/preview',
  '/print/progress',
  '/print/done',
  '/resume/report',
  '/resume/optimize',
  '/resume/optimize/compare',
  '/resume/generate/preview',
  '/print-scan',
  '/print-scan/sign',
  '/print-scan/convert',
  '/offline-agencies',
  '/companies',
  '/jobs/online-platforms',
  '/ai/plan',
  '/scan/start',
  '/scan/settings',
  '/scan/progress',
  '/scan/result',
  '/jobs',
  // 批 3「我的」：逐条精确列出。不用 `/me/` 宽前缀 —— 尚未迁移的
  // `/me/documents` `/me/settings` 等兄弟路由会被误命中掉进空壳。
  '/profile',
  '/me/benefits',
  '/me/feedback',
  '/me/privacy-requests',
  '/me/notifications',
  '/notifications',
  '/me/resumes',
  '/me/favorites',
  '/me/ai-records',
  '/me/activity',
])
const QX_MIGRATED_PREFIXES = [
  '/print-scan/feature/',
  // 42 号稿机构目录的详情段；同前缀下只有 /offline-agencies/:id。
  '/offline-agencies/',
  // 43 号稿企业目录的详情段；同前缀下只有 /companies/:id。
  '/companies/',
// /me/activity/:id 用精确前缀，避免误伤尚未迁移的 /me/* 兄弟路由。
  '/me/activity/',
] as const
/**
 * 带参路由但父段还有未迁兄弟页：不能写宽前缀。
 * - /jobs/:id/offline 不能用 /jobs/（会误伤 /jobs/:id、/jobs/online-platforms）
 * - /job-fairs/:id/companies/:companyId 不能用 /job-fairs/（会误伤列表、详情、地图、资料）
 */
const QX_MIGRATED_EXACT_PATTERNS: readonly RegExp[] = [
  // 26 号稿岗位详情：只放行单段 ID。不能写成 '/jobs/' 前缀——那会连
  // /jobs/:id/offline 一起放行（它有自己的稿和自己的模式，见下一行）。
  /^\/jobs\/[^/]+$/,
  /^\/jobs\/[^/]+\/offline$/,
  /^\/job-fairs\/[^/]+\/companies\/[^/]+$/,
]

function isQxMigratedPath(pathname: string): boolean {
  if (QX_MIGRATED_ROUTES.has(pathname)) return true
  if (QX_MIGRATED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  return QX_MIGRATED_EXACT_PATTERNS.some((pattern) => pattern.test(pathname))
}

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
  // 青序流光已迁移路由退出旧壳：判定见模块级 isQxMigratedPath（精确集合 + 带参前缀）。
  const isQxRoute = isQxMigratedPath(pathname)

  const isCampusZone = pathname === '/campus'
  const v6Shell = V6_SHELL_ROUTES.get(pathname) ?? null
  const isV6Route = v6Shell !== null && !isQxRoute
  const v6DomainTitle = v6Shell?.domainTitle ?? null
  const usesPageActionbar = routeUsesPageActionbar(pathname)
  const isCompactViewport = viewportW <= 760 || (viewportW <= 960 && viewportW > viewportH)
  // 青序首页自带窄屏布局；旧 kiosk-home-mobile 会再次改壳尺寸，造成两套首页壳叠加。
  const isResponsiveHome = pathname === '/' && isCompactViewport && !isQxRoute
  const usesFluidViewport = isCompactViewport || (viewportW > 960 && viewportW > viewportH)

  const shell = (
    <KioskLayout
      activeTab={activeTab}
      onTabChange={(tab) => navigate(tabToPath(tab))}
      visualTheme="service-desk"
      density="touch"
      presentation="fusion-youth"
      viewport={isCompactViewport ? 'mobile' : 'kiosk'}
      hideHeader={isCampusZone || isQxRoute}
      hideBottomNav={isCampusZone || isQxRoute || usesPageActionbar}
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
