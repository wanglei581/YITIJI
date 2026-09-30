import type { ReactNode } from 'react'
import { ConsolePager } from './ConsolePager'

/**
 * 标准分页器。页码从 0 起，内部交给 ConsolePager（从 1 起）。
 * 摘要为「共 N 条 · 第 x/y 页」。传入 onPageSizeChange 才显示 10/20/50/100。
 */
export interface PaginationProps {
  /** 当前页（0 起始）。 */
  page: number
  /** 每页条数。 */
  pageSize: number
  /** 总条数。 */
  total: number
  /** 用户点页码或上下页时触发，参数仍是 0 起始。 */
  onChange: (nextPage: number) => void
  onPageSizeChange?: (size: number) => void
  className?: string
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  onPageSizeChange,
  className,
}: PaginationProps): ReactNode {
  return (
    <ConsolePager
      page={page + 1}
      pageSize={pageSize}
      total={total}
      onPageChange={(next) => onChange(next - 1)}
      onPageSizeChange={onPageSizeChange}
      className={className}
    />
  )
}
