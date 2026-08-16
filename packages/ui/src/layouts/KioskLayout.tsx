import { BotIcon, HomeIcon, UserIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { KioskTopbar } from '../components/KioskTopbar'
import { cn } from '../lib/cn'
import {
  getKioskPresentationAttributes,
  getVisualThemeAttributes,
  type KioskPresentation,
  type KioskViewport,
  type UiDensity,
  type VisualTheme,
} from '../theme/visualTheme'

export type KioskTab = 'home' | 'assistant' | 'profile'

interface TabDef {
  key: KioskTab
  label: string
  icon: typeof HomeIcon
}

const TABS: TabDef[] = [
  { key: 'home',      label: '首页',   icon: HomeIcon },
  { key: 'assistant', label: 'AI顾问', icon: BotIcon },
  { key: 'profile',   label: '我的',   icon: UserIcon },
]

export interface KioskLayoutProps {
  children: ReactNode
  /** Which tab is currently active. Wire up to your router in Phase 3. */
  activeTab?: KioskTab
  /** Called when user taps a tab. Wire up to your router in Phase 3. */
  onTabChange?: (tab: KioskTab) => void
  /** Optional right-side element in the top status bar. */
  headerRight?: ReactNode
  /** 顶栏品牌名（原型 topbar 左侧主标题），如「就业服务大厅」。 */
  brandTitle?: string
  /** 顶栏品牌副标题（原型 topbar 左侧次要说明），如终端编号。 */
  brandSubtitle?: string
  /** V6 品牌标记与域首屏返回动作。 */
  brandMark?: ReactNode
  onBrandClick?: () => void
  brandActionLabel?: string
  /** Hide the top status bar entirely. */
  hideHeader?: boolean
  /** Hide the bottom navigation entirely (e.g. immersive 招聘会 detail pages). */
  hideBottomNav?: boolean
  visualTheme?: VisualTheme
  density?: UiDensity
  presentation?: KioskPresentation
  viewport?: KioskViewport
  className?: string
}

export function KioskLayout({
  children,
  activeTab = 'home',
  onTabChange,
  headerRight,
  brandTitle = '就业服务大厅',
  brandSubtitle = 'AI求职打印服务终端',
  brandMark,
  onBrandClick,
  brandActionLabel,
  hideHeader = false,
  hideBottomNav = false,
  visualTheme = 'legacy',
  density = 'touch',
  presentation = 'legacy',
  viewport = 'kiosk',
  className,
}: KioskLayoutProps) {
  return (
    <div
      {...getVisualThemeAttributes(visualTheme, density)}
      {...getKioskPresentationAttributes(presentation, viewport)}
      className={cn('ui-kiosk-shell flex h-dvh flex-col overflow-hidden bg-canvas', className)}
    >

      {/* ── Top status bar：原型 topbar（76px 墨绿，品牌 + 状态） ── */}
      {!hideHeader && (
        <KioskTopbar
          brandMark={brandMark}
          brandTitle={brandTitle}
          brandSubtitle={brandSubtitle}
          right={headerRight}
          onBrandClick={onBrandClick}
          brandActionLabel={brandActionLabel}
        />
      )}

      {/* ── Main content — scrollable ────────────────────── */}
      <main className="ui-kiosk-content flex-1 overflow-y-auto">
        {children}
      </main>

      {/* ── Bottom navigation：原型 navbar（116px 墨绿 + 青玉指示条） ── */}
      {!hideBottomNav && (
      <nav aria-label="主导航" className="ui-kiosk-nav">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              onClick={() => onTabChange?.(key)}
              className="ui-kiosk-nav__item"
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          )
        })}
      </nav>
      )}
    </div>
  )
}
