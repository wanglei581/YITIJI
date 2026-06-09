// ============================================================
// FairCalendarPopover — 招聘会日历（筛选栏小图标 → 展开月历）
//
// 设计要点（用户需求）：
//   - 日历不占大版面，做成筛选栏里的小图标按钮，点击展开。
//   - 有招聘会的日期下方加彩色小圆点（按城市着色），标记当天有活动。
//   - 点某天 → 列表过滤到该天；再点同一天或「清除」→ 取消过滤。
//   - 点外部 backdrop → 折叠。
//   - 纯手写月历网格，不引入任何日历依赖。
// ============================================================

import { useMemo, useState } from 'react'
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
// 城市着色调色板（固定类名，保证 Tailwind 不被 purge）
const DOT_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-orange-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function cityColor(city: string) {
  let sum = 0
  for (let i = 0; i < city.length; i++) sum += city.charCodeAt(i)
  return DOT_COLORS[sum % DOT_COLORS.length]
}

export interface FairCalendarItem {
  startTime: string
  city?: string
}

export function FairCalendarPopover({
  fairs,
  selectedDate,
  onSelectDate,
}: {
  fairs: FairCalendarItem[]
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const today = useMemo(() => new Date(), [])
  const initial = selectedDate ? new Date(selectedDate) : today
  const [view, setView] = useState({ y: initial.getFullYear(), m: initial.getMonth() })

  // 每天的标记：城市集合 + 招聘会场数
  const marks = useMemo(() => {
    const map = new Map<string, { cities: string[]; count: number }>()
    for (const f of fairs) {
      const d = new Date(f.startTime)
      if (Number.isNaN(d.getTime())) continue
      const key = dateKey(d)
      const entry = map.get(key) ?? { cities: [], count: 0 }
      entry.count += 1
      if (f.city && !entry.cities.includes(f.city)) entry.cities.push(f.city)
      map.set(key, entry)
    }
    return map
  }, [fairs])

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1)
    const startWeekday = first.getDay()
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
    const arr: (string | null)[] = []
    for (let i = 0; i < startWeekday; i++) arr.push(null)
    for (let d = 1; d <= daysInMonth; d++) arr.push(`${view.y}-${pad(view.m + 1)}-${pad(d)}`)
    return arr
  }, [view])

  const monthFairCount = useMemo(() => {
    let c = 0
    for (const [key, entry] of marks) {
      const [y, m] = key.split('-').map(Number)
      if (y === view.y && m === view.m + 1) c += entry.count
    }
    return c
  }, [marks, view])

  const todayKey = dateKey(today)

  const prevMonth = () =>
    setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))
  const nextMonth = () =>
    setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))
  const goToday = () => setView({ y: today.getFullYear(), m: today.getMonth() })

  const pick = (key: string) => {
    onSelectDate(selectedDate === key ? null : key)
    setOpen(false)
  }

  const selectedLabel = selectedDate
    ? `${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8, 10))}日`
    : null

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="按日期筛选招聘会"
        className={[
          'flex min-h-[48px] items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
          selectedDate
            ? 'bg-primary-600 text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
        ].join(' ')}
      >
        <CalendarDaysIcon className="h-4 w-4" />
        {selectedLabel ? (
          <>
            <span>{selectedLabel}</span>
            <XIcon
              className="h-4 w-4 opacity-80"
              onClick={(e) => {
                e.stopPropagation()
                onSelectDate(null)
              }}
            />
          </>
        ) : (
          <span>日历</span>
        )}
      </button>

      {open && (
        <>
          {/* 外部点击折叠 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
            {/* 月份导航 */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={prevMonth}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                aria-label="上个月"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold text-gray-900">
                {view.y}年{view.m + 1}月
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                >
                  今天
                </button>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                  aria-label="下个月"
                >
                  <ChevronRightIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* 星期表头 */}
            <div className="mt-3 grid grid-cols-7 text-center text-xs text-gray-400">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={i === 0 || i === 6 ? 'text-rose-400' : ''}>
                  {w}
                </div>
              ))}
            </div>

            {/* 日期网格 */}
            <div className="mt-1 grid grid-cols-7 gap-y-1">
              {cells.map((key, idx) => {
                if (!key) return <div key={`e-${idx}`} className="h-11" />
                const day = Number(key.slice(8, 10))
                const mark = marks.get(key)
                const isSelected = selectedDate === key
                const isToday = key === todayKey
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pick(key)}
                    className="flex h-11 flex-col items-center justify-center gap-0.5"
                  >
                    <span
                      className={[
                        'flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors',
                        isSelected
                          ? 'bg-primary-600 font-semibold text-white'
                          : isToday
                            ? 'font-semibold text-primary-600 ring-1 ring-primary-200'
                            : mark
                              ? 'font-medium text-gray-900 hover:bg-gray-100'
                              : 'text-gray-400 hover:bg-gray-50',
                      ].join(' ')}
                    >
                      {day}
                    </span>
                    <span className="flex h-1.5 items-center gap-0.5">
                      {mark
                        ? (mark.cities.length > 0
                            ? mark.cities.slice(0, 3)
                            : ['__']
                          ).map((city, i) => (
                            <span
                              key={i}
                              className={`h-1.5 w-1.5 rounded-full ${
                                isSelected
                                  ? 'bg-white'
                                  : city === '__'
                                    ? 'bg-rose-500'
                                    : cityColor(city)
                              }`}
                            />
                          ))
                        : null}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-500">
              <span>
                本月 <span className="font-semibold text-gray-900">{monthFairCount}</span> 场招聘会
              </span>
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectDate(null)
                    setOpen(false)
                  }}
                  className="font-medium text-primary-600 hover:underline"
                >
                  清除日期筛选
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
