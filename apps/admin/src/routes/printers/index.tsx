import { useState } from 'react'
import { mergeById, useRefreshable } from '@ai-job-print/refresh'
import { Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { PrinterIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import { Pagination } from '../components/DataTable'
import { FilterChip } from '../components/FilterChip'
import { API_MODE } from '../../services/api/client'
import { getPrinters, type AdminPrinterRecord } from '../../services/api/devices'

const PAGE_SIZE = 10
const PRINTERS_REFRESH_KEY = 'admin:printers'

const STATUS_MAP: Record<AdminPrinterRecord['status'], { badge: 'success' | 'error'; label: string }> = {
  online:  { badge: 'success', label: '在线' },
  offline: { badge: 'error',   label: '离线' },
  error:   { badge: 'error',   label: '故障' },
}

const PAPER_MAP: Record<string, { text: string; color: string }> = {
  normal:  { text: '正常', color: 'text-success-fg' },
  low:     { text: '偏少', color: 'text-warning-fg' },
  empty:   { text: '已空', color: 'text-error-fg' },
  jam:     { text: '卡纸', color: 'text-error-fg' },
  unknown: { text: '未上报', color: 'text-neutral-500' },
}

const FILTERS = ['全部', '在线', '离线', '故障'] as const
const FILTER_STATUS: Record<string, AdminPrinterRecord['status'] | null> = {
  全部: null,
  在线: 'online',
  离线: 'offline',
  故障: 'error',
}

function relativeTime(iso: string | null): string {
  if (!iso) return '从未'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diffMin = Math.floor((Date.now() - t) / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const hours = Math.floor(diffMin / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function matchesSearch(p: AdminPrinterRecord, search: string): boolean {
  const s = search.trim().toLowerCase()
  if (!s) return true
  return (
    p.name.toLowerCase().includes(s) ||
    p.terminalCode.toLowerCase().includes(s) ||
    (p.model ?? '').toLowerCase().includes(s) ||
    (p.serialNumber ?? '').toLowerCase().includes(s)
  )
}

export default function PrintersPage() {
  const [filter, setFilter] = useState<string>('全部')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const {
    data: printerData,
    status,
    error,
    refresh,
  } = useRefreshable(
    PRINTERS_REFRESH_KEY,
    getPrinters,
    {
      intervalMs: 30_000,
      merge: (current, incoming) => {
        const printers = mergeById<AdminPrinterRecord>((item) => item.id)(
          current?.printers,
          incoming.printers,
        )
        if (current && printers === current.printers) return current
        return { printers }
      },
      failPolicy: 'keep-last',
    },
  )

  const printers = printerData?.printers ?? []
  const loading = status === 'loading' && printers.length === 0
  const errorMessage = status === 'error'
    ? (error instanceof Error ? error.message : '打印机数据加载失败')
    : null

  const byStatus = filter === '全部'
    ? printers
    : printers.filter((p) => p.status === FILTER_STATUS[filter])
  const filtered = byStatus.filter((p) => matchesSearch(p, search))
  const total = filtered.length
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const counts = {
    全部: printers.length,
    在线: printers.filter((p) => p.status === 'online').length,
    离线: printers.filter((p) => p.status === 'offline').length,
    故障: printers.filter((p) => p.status === 'error').length,
  }

  const handleFilterChange = (f: string) => { setFilter(f); setPage(1) }
  const handleSearch = (v: string) => { setSearch(v); setPage(1) }

  return (
    <>
      {/* 工具条：搜索 + 状态 chips + 刷新 */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="flex h-[34px] min-w-[240px] items-center gap-2 rounded-[9px] border border-neutral-900/10 bg-surface px-3">
          <SearchIcon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索名称、终端、SN…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-500"
          />
        </div>
        {FILTERS.map((f) => (
          <FilterChip
            key={f}
            active={filter === f}
            label={f}
            count={counts[f]}
            onClick={() => handleFilterChange(f)}
          />
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12.5px] text-neutral-500">状态来自 Terminal Agent 心跳上报</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
            刷新
          </button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {['设备名称', '型号', 'SN', '绑定终端', '状态', '当前任务', '碳粉余量', '纸张状态', '故障信息', '最近同步'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" /></td>
                    ))}
                  </tr>
                ))
              ) : errorMessage ? (
                <tr>
                  <td colSpan={10}>
                    <div className="flex flex-col items-center gap-3 py-12">
                      <p className="text-sm text-neutral-500">{errorMessage}</p>
                      <button onClick={() => void refresh()} className="rounded-[9px] bg-primary-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-primary-700">重试</button>
                    </div>
                  </td>
                </tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title="暂无打印机"
                      description={search ? `未找到包含"${search}"的打印机` : '当前筛选条件下没有打印机'}
                    />
                  </td>
                </tr>
              ) : (
                paged.map((p) => {
                  const s = STATUS_MAP[p.status]
                  const paper = PAPER_MAP[p.paperStatus ?? 'unknown'] ?? PAPER_MAP.unknown
                  return (
                    <tr key={p.id} className="transition-colors hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-neutral-900">
                        <div className="flex items-center gap-2">
                          <PrinterIcon className="h-4 w-4 text-neutral-500" aria-hidden="true" />
                          {p.name}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{p.model ?? '未上报'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">{p.serialNumber ?? '未上报'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-700">{p.terminalCode}</td>
                      <td className="px-4 py-3"><StatusBadge dot status={s.badge} label={s.label} /></td>
                      <td className="px-4 py-3 text-xs text-neutral-700">
                        {p.currentTask ?? <span className="text-neutral-400">空闲</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {p.tonerLevel === null ? (
                          <span className="text-xs text-neutral-500">未上报</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-1.5 w-[52px] overflow-hidden rounded-full bg-neutral-100">
                              <span
                                className={
                                  'block h-full rounded-full ' +
                                  (p.tonerLevel < 20 ? 'bg-gradient-to-r from-[#c9764a] to-[#9e5330]' : 'bg-primary-600')
                                }
                                style={{ width: `${Math.max(0, Math.min(100, p.tonerLevel))}%` }}
                              />
                            </span>
                            <span className="text-xs tabular-nums text-neutral-500">{p.tonerLevel}%</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${paper.color}`}>{paper.text}</span>
                        {p.paperTrayLevel !== null && (
                          <span className="ml-1 text-xs tabular-nums text-neutral-500">({p.paperTrayLevel}张)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {p.fault
                          ? <span className="font-semibold text-error-fg">{p.fault}</span>
                          : <span className="text-neutral-400">—</span>
                        }
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-neutral-500">{relativeTime(p.lastSyncAt)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onPageSizeChange={() => { setPage(1) }}
        />
      </Card>

      <p className="mt-3 text-xs text-neutral-400">
        后端当前仅接收 Agent 心跳中的 printerStatus；型号、SN、耗材和纸盒余量未上报时显示为未上报
        {API_MODE !== 'http' && '（当前为 mock 演示数据）'}
      </p>
    </>
  )
}
