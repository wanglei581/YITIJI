import { useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { EmptyState } from '@ai-job-print/ui'

export interface PaginationProps {
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  const pages: Array<number | string> = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('ellipsis')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('ellipsis')
    pages.push(totalPages)
  }
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500"> 共 <span className="font-medium text-gray-700">{total}</span> 条</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">每页</span>
          <select value={pageSize} onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1) }} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 focus:border-primary-300 focus:outline-none">
            {[10, 20, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className="flex h-7 min-w-[2rem] items-center justify-center rounded text-xs text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40">‹</button>
          {pages.map((p, i) => p === 'ellipsis' ? <span key={'ellipsis-' + i} className="flex h-7 min-w-[2rem] items-center justify-center text-xs text-gray-300">…</span> : <button key={p} onClick={() => onPageChange(p as number)} className={'flex h-7 min-w-[2rem] items-center justify-center rounded text-xs ' + (p === page ? 'bg-primary-600 text-white font-medium' : 'text-gray-600 hover:bg-gray-100')}>{p}</button>)}
          <button onClick={() => onPageChange(page + 1)} disabled={page === totalPages} className="flex h-7 min-w-[2rem] items-center justify-center rounded text-xs text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40">›</button>
        </div>
      )}
    </div>
  )
}

// SearchBar removed - using native input elements in pages instead

export interface FilterPillsProps { filters: string[]; active: string; counts?: Record<string, number>; onChange: (filter: string) => void }

export function FilterPills({ filters, active, counts, onChange }: FilterPillsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((f) => (
        <button key={f} onClick={() => onChange(f)} className={'rounded-full px-4 py-1.5 text-sm font-medium transition-colors ' + (active === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
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
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  className?: string
}

export function DataTable<T>({ items, empty, renderRow, renderHeader, page, pageSize, total, onPageChange, onPageSizeChange, className }: DataTableProps<T>) {
  if (items.length === 0 && empty) return (
    <div>
      <EmptyState title={empty.title} description={empty.description} action={empty.action} className="border-b border-gray-100" />
      <Pagination total={total} page={page} pageSize={pageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </div>
  )
  return (
    <div className={className}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">{renderHeader()}</thead>
          <tbody className="divide-y divide-gray-100">{items.map((item, index) => renderRow(item, index))}</tbody>
        </table>
      </div>
      <Pagination total={total} page={page} pageSize={pageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </div>
  )
}

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