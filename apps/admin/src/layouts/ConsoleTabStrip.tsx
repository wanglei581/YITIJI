import { NavLink } from 'react-router-dom'
import type { ConsoleTabGroup } from './adminNav'

/** 同组页面的地址标签。样式对齐设备管理页的下划线标签，窄屏横向滑动，不换行。 */
export function ConsoleTabStrip({ group }: { group: ConsoleTabGroup }) {
  return (
    <nav aria-label={group.label} className="mb-4 w-full min-w-0 max-w-full overflow-x-auto">
      <div className="flex w-max min-w-full flex-nowrap gap-1 border-b-[1.6px] border-neutral-900/[0.06]">
        {group.tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end
            className={({ isActive }) =>
              [
                'relative flex min-h-11 shrink-0 items-center px-4 pb-3 pt-2.5 text-sm font-bold transition-colors',
                isActive ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                {tab.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 -bottom-[1.6px] h-[3px] rounded-sm bg-primary-600"
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
