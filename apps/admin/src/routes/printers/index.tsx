import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { PrinterIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import { Pagination } from '../components/DataTable'
import { API_MODE } from '../../services/api/client'
import { getPrinters, type AdminPrinterRecord } from '../../services/api/devices'

const PAGE_SIZE = 10

const STATUS_MAP: Record<AdminPrinterRecord['status'], { badge: 'success' | 'error'; label: string }> = {
  online:  { badge: 'success', label: '在线' },
  offline: { badge: 'error',   label: '离线' },
  error:   { badge: 'error',   label: '故障' },
}

const PAPER_MAP: Record<string, { text: string; color: string }> = {
  normal:  { text: '正常', color: 'text-green-600' },
  low:     { text: '偏少', color: 'text-orange-500' },
  empty:   { text: '已空', color: 'text-red-500' },
  jam:     { text: '卡纸', color: 'text-red-500' },
  unknown: { text: '未上报', color: 'text-gray-400' },
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
  const [printers, setPrinters] = useState<AdminPrinterRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('全部')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    getPrinters()
      .then((res) => setPrinters(res.printers))
      .catch((e) => setError((e as Error)?.message ?? '打印机数据加载失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

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
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">打印机状态来自 Windows Terminal Agent 心跳上报</p>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" />
          刷新
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索名称、终端、SN…"
            className="h-9 rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20"
          />
        </div>
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === f ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {f}
              <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50">
              <tr>
                {['设备名称', '型号', 'SN', '绑定终端', '状态', '当前任务', '碳粉余量', '纸张状态', '故障信息', '最近同步'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={10}>
                    <div className="flex flex-col items-center gap-3 py-12">
                      <p className="text-sm text-neutral-400">{error}</p>
                      <button onClick={load} className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs text-white hover:bg-primary-700">重试</button>
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
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800">
                        <div className="flex items-center gap-2">
                          <PrinterIcon className="h-4 w-4 text-gray-400" />
                          {p.name}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{p.model ?? '未上报'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{p.serialNumber ?? '未上报'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{p.terminalCode}</td>
                      <td className="px-4 py-3"><StatusBadge status={s.badge} label={s.label} /></td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {p.currentTask ?? <span className="text-gray-300">空闲</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {p.tonerLevel === null ? '未上报' : `${p.tonerLevel}%`}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${paper.color}`}>{paper.text}</span>
                        {p.paperTrayLevel !== null && (
                          <span className="ml-1 text-xs text-gray-400">({p.paperTrayLevel}张)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {p.fault
                          ? <span className="text-red-500">{p.fault}</span>
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{relativeTime(p.lastSyncAt)}</td>
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
