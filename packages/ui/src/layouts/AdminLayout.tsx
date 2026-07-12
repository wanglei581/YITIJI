import {
  BellIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import {
  getVisualThemeAttributes,
  type UiDensity,
  type VisualTheme,
} from '../theme/visualTheme'

export interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  /** Optional href fallback for browser-native navigation semantics. */
  href?: string
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
  visualTheme?: VisualTheme
  density?: UiDensity
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
  visualTheme = 'legacy',
  density = 'compact',
  className,
}: AdminLayoutProps) {
  return (
    <div
      {...getVisualThemeAttributes(visualTheme, density)}
      className={cn('ui-admin-shell flex h-screen overflow-hidden bg-canvas', className)}
    >

      {/* ── Sidebar ────────────────────────────────────────── */}
      <aside
        className={cn(
          'ui-admin-sidebar flex shrink-0 flex-col bg-neutral-900 transition-all duration-200',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'flex h-[70px] shrink-0 items-center gap-3',
            collapsed ? 'justify-center px-3' : 'px-5',
          )}
        >
          {appLogo
            ? <div className="shrink-0">{appLogo}</div>
            : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#fdfbf4] to-[#dff2ea]">
                <span className="text-[13px] font-extrabold leading-none text-primary-700">AI</span>
              </div>
            )
          }
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[15px] font-extrabold text-white">{appName}</p>
              <p className="mt-0.5 truncate text-[11px] text-[#9dc4b6]">AI求职打印服务终端</p>
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
                    <div className={cn('px-3 pb-1.5', index === 0 ? 'pt-1' : 'pt-4')}>
                      <span className="text-[11px] font-bold tracking-[0.08em] text-[#8fb5a7]">
                        {item.group}
                      </span>
                    </div>
                  )}

                  <a
                    href={item.href ?? '#'}
                    aria-current={active ? 'page' : undefined}
                    onClick={(e) => {
                      if (onNavChange) {
                        e.preventDefault()
                        onNavChange(item.key)
                      }
                    }}
                    className={cn(
                      'relative flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13.5px] font-semibold transition-colors',
                      active
                        ? 'bg-primary-600 text-white'
                        : 'text-[#c6ddd3] hover:bg-white/[0.07] hover:text-white',
                      collapsed && 'justify-center px-2',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-85" aria-hidden="true" />

                    {!collapsed && (
                      <span className="flex-1 truncate">{item.label}</span>
                    )}

                    {!collapsed && item.badge != null && (
                      <span
                        className={cn(
                          'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-extrabold leading-none',
                          typeof item.badge === 'number' && item.badge > 0
                            ? 'bg-error text-white'
                            : 'bg-white/10 text-[#c6ddd3]',
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* User block（原型 side-user：头像 + 姓名 + 角色） */}
        {(userName ?? userRole) && (
          <div
            className={cn(
              'flex shrink-0 items-center gap-2.5 border-t border-white/10',
              collapsed ? 'justify-center px-3 py-3' : 'px-5 py-3.5',
            )}
          >
            <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-primary-600">
              <span className="text-sm font-extrabold text-white">
                {(userName ?? '管')[0]}
              </span>
            </div>
            {!collapsed && (
              <div className="min-w-0">
                {userName && (
                  <p className="truncate text-[13px] font-semibold text-white">{userName}</p>
                )}
                {userRole && (
                  <p className="mt-0.5 truncate text-[11px] text-white/60">{userRole}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Collapse toggle */}
        {onCollapseChange && (
          <div className="border-t border-white/10 p-2">
            <button
              type="button"
              aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
              onClick={() => onCollapseChange(!collapsed)}
              className="flex w-full items-center justify-center rounded-[9px] p-2 text-[#8fb5a7] hover:bg-white/[0.07] hover:text-white"
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
        <header className="ui-admin-topbar flex h-[60px] shrink-0 items-center justify-between border-b border-neutral-900/[0.06] bg-surface px-7">
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
                  className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                >
                  <SearchIcon className="h-4 w-4" aria-hidden="true" />
                </button>

                {/* Notification bell */}
                <button
                  type="button"
                  aria-label={`通知${notificationCount > 0 ? `（${notificationCount}条）` : ''}`}
                  className="relative flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                >
                  <BellIcon className="h-4 w-4" aria-hidden="true" />
                  {notificationCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1 top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-error px-0.5 text-[9px] font-bold leading-none text-white"
                    >
                      {notificationCount > 9 ? '9+' : notificationCount}
                    </span>
                  )}
                </button>

                {/* Divider + user info */}
                {(userName ?? userRole) && (
                  <>
                    <div className="mx-1.5 h-5 w-px bg-neutral-200" aria-hidden="true" />
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-neutral-100"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-600">
                        <span className="text-[11px] font-semibold text-white">
                          {(userName ?? '管')[0]}
                        </span>
                      </div>
                      <div className="text-left">
                        {userName && (
                          <p className="text-xs font-medium leading-none text-neutral-800">
                            {userName}
                          </p>
                        )}
                        {userRole && (
                          <p className="mt-0.5 text-[10px] leading-none text-neutral-400">
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
        <main className="ui-admin-content flex-1 overflow-y-auto px-7 pb-8 pt-6">
          {children}
        </main>
      </div>
    </div>
  )
}
