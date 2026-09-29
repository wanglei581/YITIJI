import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { ConsolePager } from './ConsolePager'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'

export type ConsoleColumnAlign = 'left' | 'right' | 'center'

export interface ConsoleColumn<T> {
  id: string
  header: ReactNode
  align?: ConsoleColumnAlign
  /** 截断并在悬停 title 显示全文。title 缺省时，单元格是字符串或数字才填 title。 */
  truncate?: boolean
  title?: (item: T) => string | undefined
  /** 右侧固定。底色继承所在行，避免盖住行状态色。 */
  sticky?: boolean
  cell: (item: T, index: number) => ReactNode
  headerClassName?: string
  cellClassName?: string
}

export interface ConsoleTableError {
  title?: string
  message?: string
  onRetry?: () => void
}

export interface ConsoleTableProps<T> {
  items: T[]
  empty?: { title: string; description?: string; action?: ReactNode }
  renderRow?: (item: T, index: number) => ReactNode
  renderHeader?: () => ReactNode
  columns?: ConsoleColumn<T>[]
  /** 为 true 时表体显示加载，不渲染行，也不把空列表当成空态。 */
  loading?: boolean
  /** 有值时表体显示错误和重试，不渲染行。 */
  error?: ConsoleTableError | null
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
 * align、truncate、sticky、loading、error 都是可选项，不传则不生效。
 */
export function ConsoleTable<T>({
  items,
  empty,
  renderRow,
  renderHeader,
  columns,
  loading = false,
  error = null,
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
  const useColumns = columns != null && columns.length > 0
  if (!loading && error == null && items.length === 0 && empty) {
    return (
      <div className={className}>
        <EmptyState title={empty.title} description={empty.description} action={empty.action} className="border-b border-neutral-100" />
        {pager}
      </div>
    )
  }

  const stateColSpan = useColumns ? columns.length : 100
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
                      column.sticky && 'sticky right-0 z-10 bg-surface border-l border-neutral-900/[0.06]',
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
            {loading ? (
              <tr>
                <td colSpan={stateColSpan} className="p-0">
                  <LoadingState />
                </td>
              </tr>
            ) : error != null ? (
              <tr>
                <td colSpan={stateColSpan} className="p-0">
                  <ErrorState title={error.title} message={error.message} onRetry={error.onRetry} />
                </td>
              </tr>
            ) : useColumns
              ? items.map((item, index) => (
                  <tr key={index} className="group bg-surface hover:bg-neutral-50">
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
                            column.sticky && 'sticky right-0 z-10 bg-inherit border-l border-neutral-900/[0.06]',
                            column.cellClassName,
                          )}
                        >
                          <div className={cn(column.truncate && 'max-w-64 truncate')}>{content}</div>
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
