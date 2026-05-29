import {
  BellIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  /** Numeric/string badge shown on the nav item. */
  badge?: string | number
  /** Section header shown above this item when sidebar is expanded. */
  group?: string
  /** Nested items — rendered as an indented sub-list when parent is active. */
  children?: Omit<NavItem, 'children'>[]
}

export interface AdminLayoutProps {
  children: ReactNode
  navItems?: NavItem[]
  /** Key of the currently active nav item. */
  activeKey?: string
  /** Called when user clicks a nav item. */
  onNavChange?: (key: string) => void
  /** App / brand name shown at the top of the sidebar. */
  appName?: string
  /** Logo element — rendered in the brand area instead of the default "AI" mark. */
  appLogo?: ReactNode
  /** Whether the sidebar is collapsed to icon-only mode. */
  collapsed?: boolean
  onCollapseChange?: (collapsed: boolean) => void
  /**
   * Custom slot for top-right header content.
   * When provided, replaces the default search/bell/user controls entirely.
   */
  headerActions?: ReactNode
  /** Display name for the logged-in user. */
  userName?: string
  /** Role label shown under the user name. */
  userRole?: string
  /** Notification count shown on the bell badge. */
  notificationCount?: number
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
  userName,
  userRole,
  notificationCount = 0,
  className,
}: AdminLayoutProps) {
  return (
    <div className={cn('flex h-screen overflow-hidden bg-canvas', className)}>

      {/* ── Sidebar ────────────────────────────────────────── */}
      <aside
        className={cn(
          'flex shrink-0 flex-col bg-gray-900 transition-all duration-200',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center gap-3 border-b border-gray-800',
            collapsed ? 'justify-center px-3' : 'px-4',
          )}
        >
          {appLogo
            ? <div className="shrink-0">{appLogo}</div>
            : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-600">
                <span className="text-[11px] font-bold leading-none text-white">AI</span>
              </div>
            )
          }
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{appName}</p>
              <p className="truncate text-[10px] text-gray-500">AI求职打印服务终端</p>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav aria-label="侧边导航" className="flex-1 overflow-y-auto py-2">
          <ul role="list" className="space-y-0.5 px-2">
            {navItems.map((item, index) => {
              const active = activeKey === item.key
              const Icon = item.icon
              const prevItem = navItems[index - 1]
              const showGroup = !collapsed && item.group && item.group !== prevItem?.group

              return (
                <li key={item.key}>
                  {/* Group label */}
                  {showGroup && (
                    <div className={cn('px-3 pb-1', index === 0 ? 'pt-1' : 'pt-4')}>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                        {item.group}
                      </span>
                    </div>
                  )}

                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onNavChange?.(item.key)}
                    className={cn(
                      'relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200',
                      collapsed && 'justify-center px-2',
                    )}
                  >
                    {/* Left accent bar for active state */}
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-primary-400"
                      />
                    )}

                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />

                    {!collapsed && (
                      <span className="flex-1 truncate">{item.label}</span>
                    )}

                    {!collapsed && item.badge != null && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-px text-[10px] font-semibold leading-tight',
                          typeof item.badge === 'number' && item.badge > 0
                            ? 'bg-red-500 text-white'
                            : 'bg-gray-700 text-gray-300',
                        )}
                      >
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

      {/* ── Main area ──────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Top header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-surface px-6">
          {/* Left placeholder (can be used for breadcrumbs) */}
          <div />

          {/* Right: custom slot or default search/bell/user */}
          <div className="flex items-center gap-1">
            {headerActions ?? (
              <>
                {/* Search */}
                <button
                  type="button"
                  aria-label="搜索"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  <SearchIcon className="h-4 w-4" aria-hidden="true" />
                </button>

                {/* Notification bell */}
                <button
                  type="button"
                  aria-label={`通知${notificationCount > 0 ? `（${notificationCount}条）` : ''}`}
                  className="relative flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  <BellIcon className="h-4 w-4" aria-hidden="true" />
                  {notificationCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1 top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold leading-none text-white"
                    >
                      {notificationCount > 9 ? '9+' : notificationCount}
                    </span>
                  )}
                </button>

                {/* Divider + user info */}
                {(userName ?? userRole) && (
                  <>
                    <div className="mx-1.5 h-5 w-px bg-gray-200" aria-hidden="true" />
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-gray-100"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-600">
                        <span className="text-[11px] font-semibold text-white">
                          {(userName ?? '管')[0]}
                        </span>
                      </div>
                      <div className="text-left">
                        {userName && (
                          <p className="text-xs font-medium leading-none text-gray-800">
                            {userName}
                          </p>
                        )}
                        {userRole && (
                          <p className="mt-0.5 text-[10px] leading-none text-gray-400">
                            {userRole}
                          </p>
                        )}
                      </div>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </header>

        {/* Page content — scrollable */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
