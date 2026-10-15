// ============================================================
// FairCalendarPopover — 招聘会日历（筛选栏小图标 → 展开月历）
//
// 设计要点（用户需求）：
//   - 日历不占大版面，做成筛选栏里的小图标按钮，点击展开。
//   - 有招聘会的日期下方加小圆点，标记当天有活动。
//   - 点某天 → 列表过滤到该天；再点同一天或「清除」→ 取消过滤。
//   - 点外部 backdrop → 折叠。
//   - 纯手写月历网格，不引入任何日历依赖。
//
// 2026-09-20 随 /job-fairs 迁入青序流光：配色改用 qx 令牌，日期格提到 48px 触控下限。
// 按城市着色的六色点原本靠 tailwind 固定类名，青序里没有对应语义色——
// 「今天有几场」才是用户要的信息，城市颜色没有可解释的图例，故收敛成单色点 + 场数。
//
// 时区：日期键一律走 Asia/Shanghai（fairDateKey / shanghaiTodayKey），
// 与 JobFairsPage 的筛选判据同源。原来用 `new Date(startTime).getFullYear()` 等
// **浏览器本地时区**取键，一体机现场看不出问题，但同一页在手机 / 桌面浏览器也开放：
// 时区一偏，点了带小圆点的那天会筛出 0 场——标记说有、筛选说没有，两个判据打架。
// ============================================================

import { useMemo, useState } from 'react'
import { shanghaiTodayKey } from '@ai-job-print/shared'
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { fairDateKey } from '../fairFormat'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function pad(n: number) {
  return String(n).padStart(2, '0')
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
  // 「今天」与初始月份都按上海墙钟算，和下面的 marks / 筛选判据同一口径。
  const todayKey = useMemo(() => shanghaiTodayKey(), [])
  const todayParts = useMemo(() => {
    const [y, m] = todayKey.split('-').map(Number)
    return { y, m: m - 1 }
  }, [todayKey])
  const [view, setView] = useState(() => {
    const source = selectedDate ?? todayKey
    const [y, m] = source.split('-').map(Number)
    return Number.isFinite(y) && Number.isFinite(m) ? { y, m: m - 1 } : todayParts
  })

  // 每天的标记：场数（真实条数，不估算）。键用 fairDateKey（Asia/Shanghai），
  // 与 JobFairsPage 里 `fairDateKey(f.startTime) !== selectedDate` 的筛选判据逐字同源。
  const marks = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of fairs) {
      const key = fairDateKey(f.startTime)
      // 解析不出来的时间戳 fairDateKey 会原样回传；那种串不是日期键，不该进日历。
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
      map.set(key, (map.get(key) ?? 0) + 1)
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
    for (const [key, count] of marks) {
      const [y, m] = key.split('-').map(Number)
      if (y === view.y && m === view.m + 1) c += count
    }
    return c
  }, [marks, view])

  const prevMonth = () =>
    setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))
  const nextMonth = () =>
    setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))
  const goToday = () => setView(todayParts)

  const pick = (key: string) => {
    onSelectDate(selectedDate === key ? null : key)
    setOpen(false)
  }

  const selectedLabel = selectedDate
    ? `${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8, 10))}日`
    : null

  return (
    <div className="qxfw-picker">
      {/* 与 RegionPicker 同一处修正：清除键此前是触发按钮**内部**的 role="button" span，
          嵌套可交互元素在 HTML 里非法、读屏只念得出外层一个控件。改成兄弟按钮。 */}
      <span className="qxfw-chipgrp">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="按日期筛选招聘会"
          aria-pressed={Boolean(selectedDate)}
          className={`dw-chip${selectedDate ? ' on' : ''}`}
        >
          <CalendarDaysIcon size={20} aria-hidden />
          <span>{selectedLabel ?? '举办日期'}</span>
        </button>
        {selectedDate ? (
          <button
            type="button"
            className="qxfw-chip-clear"
            aria-label="清除日期筛选"
            onClick={() => onSelectDate(null)}
          >
            <XIcon size={20} aria-hidden />
          </button>
        ) : null}
      </span>

      {open && (
        <>
          <div className="qxfw-cal-backdrop" onClick={() => setOpen(false)} />
          <div className="qxfw-cal">
            <div className="qxfw-cal-nav">
              <button type="button" onClick={prevMonth} aria-label="上个月">
                <ChevronLeftIcon size={22} aria-hidden />
              </button>
              <b>{view.y}年{view.m + 1}月</b>
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={goToday}>今天</button>
                <button type="button" onClick={nextMonth} aria-label="下个月">
                  <ChevronRightIcon size={22} aria-hidden />
                </button>
              </span>
            </div>

            <div className="qxfw-cal-week">
              {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
            </div>

            <div className="qxfw-cal-grid">
              {cells.map((key, idx) => {
                if (!key) return <div key={`e-${idx}`} className="qxfw-cal-pad" />
                const day = Number(key.slice(8, 10))
                const count = marks.get(key) ?? 0
                return (
                  <button
                    key={key}
                    type="button"
                    className="qxfw-cal-day"
                    data-has={count > 0 ? 'true' : undefined}
                    data-today={key === todayKey ? 'true' : undefined}
                    aria-pressed={selectedDate === key}
                    aria-label={count > 0 ? `${view.m + 1}月${day}日 · ${count} 场` : `${view.m + 1}月${day}日`}
                    onClick={() => pick(key)}
                  >
                    {day}
                    {count > 0 ? <span className="qxfw-cal-dot" aria-hidden /> : null}
                  </button>
                )
              })}
            </div>

            <div className="qxfw-cal-foot">
              <span>本月 {monthFairCount} 场招聘会（按已加载集合统计）</span>
              {selectedDate && (
                <button type="button" onClick={() => { onSelectDate(null); setOpen(false) }}>
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
