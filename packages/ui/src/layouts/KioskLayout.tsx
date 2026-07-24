import { BotIcon, HomeIcon, UserIcon } from 'lucide-react'
import type { ReactNode } from 'react'
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
  { key: 'assistant', label: 'AI助手', icon: BotIcon },
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
      className={cn('ui-kiosk-shell flex h-screen flex-col overflow-hidden bg-canvas', className)}
    >

      {/* ── Top status bar (optional) ───────────────────── */}
      {!hideHeader && (
        <header className="ui-kiosk-header flex h-10 shrink-0 items-center justify-between border-b border-neutral-200 bg-surface px-4">
          <span className="text-xs font-medium text-neutral-500">AI求职打印服务终端</span>
          {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
        </header>
      )}

      {/* ── Main content — scrollable ────────────────────── */}
      <main className="ui-kiosk-content flex-1 overflow-y-auto">
        {children}
      </main>

      {/* ── Bottom navigation ────────────────────────────── */}
      {!hideBottomNav && (
      <nav
        aria-label="主导航"
        className="ui-kiosk-nav flex h-20 shrink-0 items-center gap-2 border-t border-neutral-200 bg-surface px-4 py-1.5"
      >
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              onClick={() => onTabChange?.(key)}
              className={cn(
                /* touch target: nav 高度扣除 padding 后 ≥ 56px × 1/3 宽 */
                'flex h-full flex-1 flex-col items-center justify-center gap-1 rounded-[18px] transition-colors',
                active
                  ? 'bg-primary-100 font-bold text-primary-700'
                  : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 active:text-neutral-700',
              )}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              <span className="text-xs font-semibold">{label}</span>
            </button>
          )
        })}
      </nav>
      )}
    </div>
  )
}
