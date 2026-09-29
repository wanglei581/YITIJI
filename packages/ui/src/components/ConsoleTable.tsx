import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { ConsolePager } from './ConsolePager'
import { EmptyState } from './EmptyState'

export type ConsoleColumnAlign = 'left' | 'right' | 'center'

export interface ConsoleColumn<T> {
  id: string
  header: ReactNode
  align?: ConsoleColumnAlign
  /** 截断并在悬停 title 显示全文。title 缺省时，单元格是字符串或数字才填 title。 */
  truncate?: boolean
  title?: (item: T) => string | undefined
  /** 右侧固定。底色与行一致，悬停跟 group-hover。 */
  sticky?: boolean
  cell: (item: T, index: number) => ReactNode
  headerClassName?: string
  cellClassName?: string
}

export interface ConsoleTableProps<T> {
  items: T[]
  empty?: { title: string; description?: string; action?: ReactNode }
  renderRow?: (item: T, index: number) => ReactNode
  renderHeader?: () => ReactNode
  columns?: ConsoleColumn<T>[]
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  className?: string
  /** 默认 true：表在自己的容器里横向滚动，页面本身不滚。 */
  scrollX?: boolean
}

function alignClass(align: ConsoleColumnAlign | undefined): string {
  if (align === 'right') return 'text-right tabular-nums'
  if (align === 'center') return 'text-center'
  return 'text-left'
}

function cellText(node: ReactNode): string | undefined {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return undefined
}

/**
 * 两后台共用的表格外壳。不传 columns 时仍走 renderHeader / renderRow，外观与原先管理员 DataTable 一致。
 * align、truncate、sticky 都是可选项，不传则不生效。
 */
export function ConsoleTable<T>({
  items,
  empty,
  renderRow,
  renderHeader,
  columns,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className,
  scrollX = true,
}: ConsoleTableProps<T>): ReactNode {
  const pager = (
    <ConsolePager
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
    />
  )
  if (items.length === 0 && empty) {
    return (
      <div className={className}>
        <EmptyState title={empty.title} description={empty.description} action={empty.action} className="border-b border-neutral-100" />
        {pager}
      </div>
    )
  }

  const useColumns = columns != null && columns.length > 0
  return (
    <div className={className}>
      <div className={scrollX ? 'overflow-x-auto' : undefined}>
        <table className="w-full text-sm">
          <thead>
            {useColumns ? (
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    className={cn(
                      'whitespace-nowrap px-4 py-3 text-xs font-medium text-neutral-500',
                      alignClass(column.align),
                      column.sticky && 'sticky right-0 bg-surface',
                      column.headerClassName,
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            ) : renderHeader?.()}
          </thead>
          <tbody className="divide-y divide-neutral-900/[0.06]">
            {useColumns
              ? items.map((item, index) => (
                  <tr key={index} className="group">
                    {columns.map((column) => {
                      const content = column.cell(item, index)
                      const title = column.truncate
                        ? (column.title?.(item) ?? cellText(content))
                        : undefined
                      return (
                        <td
                          key={column.id}
                          title={title}
                          className={cn(
                            'px-4 py-3',
                            alignClass(column.align),
                            column.truncate && 'max-w-[16rem] truncate',
                            column.sticky && 'sticky right-0 bg-surface group-hover:bg-neutral-50',
                            column.cellClassName,
                          )}
                        >
                          {content}
                        </td>
                      )
                    })}
                  </tr>
                ))
              : items.map((item, index) => renderRow?.(item, index))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  )
}
