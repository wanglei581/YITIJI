import { useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ConsolePager, ConsoleTable, type ConsoleColumn } from '@ai-job-print/ui'

export interface PaginationProps {
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange }: PaginationProps) {
  return (
    <ConsolePager
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
    />
  )
}

// SearchBar removed - using native input elements in pages instead

export interface FilterPillsProps { filters: string[]; active: string; counts?: Record<string, number>; onChange: (filter: string) => void }

export function FilterPills({ filters, active, counts, onChange }: FilterPillsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((f) => (
        <button key={f} onClick={() => onChange(f)} className={'rounded-full border px-[13px] py-1.5 text-xs font-bold transition-colors ' + (active === f ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40')}>
          {f}{counts && counts[f] !== undefined && <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>}
        </button>
      ))}
    </div>
  )
}

export interface DataTableProps<T> {
  items: T[]
  empty?: { title: string; description?: string; action?: ReactNode }
  renderRow: (item: T, index: number) => ReactNode
  renderHeader: () => ReactNode
  columns?: ConsoleColumn<T>[]
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  className?: string
  scrollX?: boolean
}

export function DataTable<T>({ items, empty, renderRow, renderHeader, columns, page, pageSize, total, onPageChange, onPageSizeChange, className, scrollX }: DataTableProps<T>) {
  return (
    <ConsoleTable
      items={items}
      empty={empty}
      renderRow={renderRow}
      renderHeader={renderHeader}
      columns={columns}
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      className={className}
      scrollX={scrollX}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTableState(defaultPageSize = 20) {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const rawPageSize = parseInt(searchParams.get('pageSize') ?? String(defaultPageSize), 10)
  const pageSize = [10, 20, 50, 100].includes(rawPageSize) ? rawPageSize : defaultPageSize
  const search = searchParams.get('search') ?? ''
  const setPage = (p: number) => { setSearchParams((prev: URLSearchParams) => { const n = new URLSearchParams(prev); n.set('page', String(p)); return n }) }
  const setPageSize = (s: number) => { setSearchParams((prev: URLSearchParams) => { const n = new URLSearchParams(prev); n.set('pageSize', String(s)); n.set('page', '1'); return n }) }
  const setSearch = (v: string) => { setSearchParams((prev: URLSearchParams) => { const n = new URLSearchParams(prev); n.set('search', v); n.set('page', '1'); return n }) }
  return { page, pageSize, search, setPage, setPageSize, setSearch }
}