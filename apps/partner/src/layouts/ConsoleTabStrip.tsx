import { NavLink } from 'react-router-dom'
import type { ConsoleTab } from './partnerNav'

/** 内容区地址分组标签。下划线样式与管理员设备页一致；不渲染标题。 */
export function ConsoleTabStrip({ label, tabs }: { label: string; tabs: readonly ConsoleTab[] }) {
  if (tabs.length === 0) return null
  return (
    <nav aria-label={label} className="mb-4 max-w-full min-w-0 overflow-x-auto border-b-[1.6px] border-neutral-900/[0.06]">
      <div className="flex w-max min-w-full flex-nowrap gap-1">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end
            className={({ isActive }) => [
              'relative flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-4 pb-3 pt-2.5 text-sm font-bold transition-colors',
              isActive ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700',
            ].join(' ')}
          >
            {({ isActive }) => (
              <>
                {tab.label}
                {isActive && (
                  <span aria-hidden="true" className="absolute inset-x-3 -bottom-[1.6px] h-[3px] rounded-sm bg-primary-600" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
