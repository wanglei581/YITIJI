import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

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
          共 <span className="font-medium text-neutral-700">{total}</span> 条
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
              className="rounded border border-neutral-200 bg-surface px-2 py-1 text-xs text-neutral-600 focus:border-primary-300 focus:outline-none"
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
            className="flex h-7 min-w-[2rem] items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹
          </button>
          {pages.map((item, index) => (
            item === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="flex h-7 min-w-[2rem] items-center justify-center text-xs text-neutral-300">…</span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                className={
                  'flex h-7 min-w-[2rem] items-center justify-center rounded text-xs ' +
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
            className="flex h-7 min-w-[2rem] items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}

function buildPageList(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }
  const pages: Array<number | 'ellipsis'> = [1]
  if (current > 3) pages.push('ellipsis')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('ellipsis')
  pages.push(total)
  return pages
}
