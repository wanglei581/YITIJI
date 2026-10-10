import { PARTNER_TYPE_LABELS, type PartnerType } from '@ai-job-print/shared'
import { STATUS_FILTERS } from './orgPresentation'

export function PartnerFilters({ statusFilter, setStatusFilter, typeFilter, setTypeFilter, statusCounts, search, setSearch, onResetPage }: {
  statusFilter: typeof STATUS_FILTERS[number]; setStatusFilter: (value: typeof STATUS_FILTERS[number]) => void
  typeFilter: PartnerType | null; setTypeFilter: (value: PartnerType | null) => void
  statusCounts: Record<typeof STATUS_FILTERS[number], number>; search: string; setSearch: (value: string) => void; onResetPage: () => void
}) {
  const TYPE_FILTERS: Array<{ label: string; value: PartnerType | null }> = [
    { label: '全部类型', value: null },
    ...Object.entries(PARTNER_TYPE_LABELS).map(([value, label]) => ({ label, value: value as PartnerType })),
  ]

  return (
          <div className="mb-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-neutral-400">合作状态</span>
              <div className="flex gap-2">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => { setStatusFilter(f); onResetPage() }}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                      statusFilter === f ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
                    }`}
                  >
                    {f}
                    <span className="ml-1 text-xs opacity-70">{statusCounts[f]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-neutral-400">机构类型</span>
              <div className="flex flex-wrap gap-2">
                {TYPE_FILTERS.map((f) => (
                  <button
                    key={f.label}
                    onClick={() => { setTypeFilter(f.value); onResetPage() }}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                      typeFilter === f.value ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative mt-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索机构名称、联系人..."
                className="h-8 w-64 rounded-lg border border-neutral-200 bg-surface pl-8 pr-3 text-xs text-neutral-700 placeholder-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
              />
              <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
            </div>
          </div>

  )
}
