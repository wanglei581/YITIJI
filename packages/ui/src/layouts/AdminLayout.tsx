import { ChevronLeftIcon, ChevronRightIcon, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  /** Optional numeric/string badge shown on the nav item. */
  badge?: string | number
  /** Nested items — rendered as an indented sub-list when parent is active. */
  children?: Omit<NavItem, 'children'>[]
}

export interface AdminLayoutProps {
  children: ReactNode
  navItems?: NavItem[]
  /** Key of the currently active nav item. */
  activeKey?: string
  /** Called when user clicks a nav item. Wire up to your router in Phase 5. */
  onNavChange?: (key: string) => void
  /** App / brand name shown at the top of the sidebar. */
  appName?: string
  /** Logo element — rendered above appName. */
  appLogo?: ReactNode
  /** Whether the sidebar is collapsed to icon-only mode. */
  collapsed?: boolean
  onCollapseChange?: (collapsed: boolean) => void
  /** Slot for top-right actions (search, notifications, account). */
  headerActions?: ReactNode
  className?: string
}

export function AdminLayout({
  children,
  navItems = [],
  activeKey,
  onNavChange,
  appName = '管理后台',
  appLogo,
  collapsed = false,
  onCollapseChange,
  headerActions,
  className,
}: AdminLayoutProps) {
  return (
    <div className={cn('flex h-screen overflow-hidden bg-canvas', className)}>

      {/* ── Sidebar (dark, Gray 900) ────────────────────── */}
      <aside
        className={cn(
          'flex shrink-0 flex-col bg-gray-900 transition-all duration-200',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        {/* Brand */}
        <div className="flex h-14 items-center gap-3 border-b border-gray-800 px-4">
          {appLogo && <div className="shrink-0">{appLogo}</div>}
          {!collapsed && (
            <span className="truncate text-sm font-semibold text-white">{appName}</span>
          )}
        </div>

        {/* Nav items */}
        <nav aria-label="侧边导航" className="flex-1 overflow-y-auto py-3">
          <ul role="list" className="space-y-0.5 px-2">
            {navItems.map((item) => {
              const active = activeKey === item.key
              const Icon = item.icon
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onNavChange?.(item.key)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                      collapsed && 'justify-center px-2',
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed && item.badge != null && (
                      <span className="rounded-full bg-gray-700 px-1.5 py-0.5 text-xs font-medium text-gray-300">
                        {item.badge}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Collapse toggle */}
        {onCollapseChange && (
          <div className="border-t border-gray-800 p-2">
            <button
              type="button"
              aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
              onClick={() => onCollapseChange(!collapsed)}
              className="flex w-full items-center justify-center rounded-md p-2 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
            >
              {collapsed
                ? <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                : <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
              }
            </button>
          </div>
        )}
      </aside>

      {/* ── Main area ──────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Top header — h-14 (56px) per spec */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-surface px-6">
          <div />
          {headerActions && (
            <div className="flex items-center gap-3">{headerActions}</div>
          )}
        </header>

        {/* Page content — scrollable */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
