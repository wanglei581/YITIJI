import type { ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { buildPageList } from './consolePageList'

/** 总条数加千分位（2,057）。只放这一个小函数，免得 ui 包为此依赖 shared。 */
function totalText(total: number): string {
  return String(Math.max(0, Math.trunc(total))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100] as const

/**
 * 两后台共用的分页条。页码从 1 起。
 * 摘要固定「共 N 条 · 第 x/y 页」。每页条数只在传入 onPageSizeChange 时出现，
 * 避免没接查询参数的列表冒出改了也不生效的下拉框。
 */
export interface ConsolePagerProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: readonly number[]
  /** 调用方已经算好总页数时用它（空列表按至少 1 页显示）。 */
  totalPages?: number
  className?: string
}

export function ConsolePager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  totalPages: totalPagesProp,
  className,
}: ConsolePagerProps): ReactNode {
  const computed = pageSize > 0 ? Math.ceil(total / pageSize) : 1
  const totalPages = Math.max(1, totalPagesProp ?? computed)
  const current = Math.min(Math.max(page, 1), totalPages)
  const pages = buildPageList(current, totalPages)

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-neutral-100 px-4 py-3', className)}>
      <div className="flex items-center gap-3">
        <span className="text-sm text-neutral-500">
          共 <span className="font-medium text-neutral-700">{totalText(total)}</span> 条
          <span className="text-neutral-400"> · </span>
          第 <span className="font-medium text-neutral-700">{current}</span>
          /{totalPages} 页
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-neutral-400">每页</span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value))
                onPageChange(1)
              }}
              className="rounded-md border border-neutral-200 bg-surface px-2 py-1 text-xs text-neutral-600 focus:border-primary-300 focus:outline-none"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(current - 1)}
            disabled={current === 1}
            aria-label="上一页"
            className="flex h-7 min-w-8 items-center justify-center rounded-md text-xs text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          </button>
          {pages.map((item, index) => (
            item === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="flex h-7 min-w-8 items-center justify-center text-xs text-neutral-300">…</span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                className={
                  'flex h-7 min-w-8 items-center justify-center rounded-md text-xs ' +
                  (item === current ? 'bg-primary-600 font-medium text-white' : 'text-neutral-600 hover:bg-neutral-100')
                }
              >
                {item}
              </button>
            )
          ))}
          <button
            type="button"
            onClick={() => onPageChange(current + 1)}
            disabled={current === totalPages}
            aria-label="下一页"
            className="flex h-7 min-w-8 items-center justify-center rounded-md text-xs text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
