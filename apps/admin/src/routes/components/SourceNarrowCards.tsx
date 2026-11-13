import { useEffect, useState, type ReactNode } from 'react'

/** 与 Tailwind `md`（768px）对齐：更窄才挂载卡片，避免桌面页里留下隐藏副本。 */
function useNarrowCards() {
  const query = '(max-width: 767px)'
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const sync = () => setNarrow(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  return narrow
}

const chipIdle =
  'inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-neutral-200 bg-surface px-3 text-xs font-semibold text-neutral-700 hover:border-neutral-300'
const chipOn =
  'inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-primary-200 bg-primary-50 px-3 text-xs font-semibold text-primary-800'

/** 搜索在前，来源状态芯片单行横滑，选中态浅于紧急下架。 */
export function SourceStatusFilters({
  options,
  value,
  onChange,
  search,
  onSearch,
  searchPlaceholder,
}: {
  options: readonly string[]
  value: string
  onChange: (next: string) => void
  search: string
  onSearch: (next: string) => void
  searchPlaceholder: string
}) {
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
      <div className="relative min-w-0 shrink-0 lg:w-64">
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-surface px-3 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
        />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-neutral-500">来源状态</span>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={value === option ? chipOn : chipIdle}
              aria-pressed={value === option}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 390 宽下一行一张卡。768 及以上不挂载，1440 仍只用原表格。 */
export function SourceNarrowCards<T extends { id: string }>({
  items,
  emptyTitle,
  titleOf,
  statusOf,
  onView,
  onTakedown,
  viewLabel = '查看',
}: {
  items: T[]
  emptyTitle: string
  titleOf: (item: T) => string
  statusOf: (item: T) => ReactNode
  onView: (item: T) => void
  onTakedown: (item: T) => void
  viewLabel?: string
}) {
  const narrow = useNarrowCards()
  if (!narrow) return null
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-500">{emptyTitle}</p>
  }
  return (
    <ul className="mb-4 space-y-3">
      {items.map((item) => (
        <li key={item.id} className="rounded-lg border border-neutral-200 bg-surface p-3">
          <p className="text-sm font-semibold text-neutral-900">{titleOf(item)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">{statusOf(item)}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onView(item)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-200 bg-surface px-3 text-sm font-semibold text-neutral-800"
            >
              {viewLabel}
            </button>
            <button
              type="button"
              onClick={() => onTakedown(item)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-error/40 bg-transparent px-3 text-sm font-semibold text-error-fg"
            >
              紧急下架
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
