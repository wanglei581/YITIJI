import { formatDateTime, formatRelativeTime } from '@ai-job-print/shared'
import { useState } from 'react'
import { mergeById, useRefreshable } from '@ai-job-print/refresh'
import { Card, ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { PrinterIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import { FilterChip } from '../components/FilterChip'
import { API_MODE } from '../../services/api/client'
import { getPrinters, type AdminPrinterRecord } from '../../services/api/devices'
import { printerStatusView } from '../terminals/terminalStatusViews'

const PRINTERS_REFRESH_KEY = 'admin:printers'
const STATUS_MAP: Record<AdminPrinterRecord['status'], { badge: 'success' | 'error'; label: string }> = {
  online: { badge: 'success', label: '在线' },
  offline: { badge: 'error', label: '离线' },
  error: { badge: 'error', label: '故障' },
}
const PAPER_MAP: Record<string, { badge: 'success' | 'warning' | 'error' | 'default'; label: string }> = {
  normal: { badge: 'success', label: '正常' },
  low: { badge: 'warning', label: '偏少' },
  empty: { badge: 'error', label: '已空' },
  jam: { badge: 'error', label: '卡纸' },
  unknown: { badge: 'default', label: '未上报' },
}
const FILTERS = ['全部', '在线', '离线', '故障'] as const
const FILTER_STATUS: Record<string, AdminPrinterRecord['status'] | null> = { 全部: null, 在线: 'online', 离线: 'offline', 故障: 'error' }

function relativeTime(iso: string | null): string {
  return iso ? formatRelativeTime(iso) : '从未'
}

function formatPaperTrayLevel(level: number | null) {
  if (level === null || !Number.isFinite(level)) return null
  return <span className="ml-1 text-xs tabular-nums text-neutral-500">({Math.round(level)}%)</span>
}

function FaultCell({ printer }: { printer: AdminPrinterRecord }) {
  const view = printerStatusView(printer.printerStatus)
  if (printer.printerStatus === 'queue_cleanup_failed' || printer.printerStatus === 'queue_pause_failed') return <span className="font-semibold text-error-fg">{view.label}</span>
  if (printer.fault) return <span className={`font-semibold ${printer.status === 'online' ? 'text-warning-fg' : 'text-error-fg'}`}>{printer.fault}</span>
  return view.badge === 'success' ? <span className="text-neutral-500">无</span> : <span className="text-neutral-500">{view.label}</span>
}

function matchesSearch(printer: AdminPrinterRecord, search: string): boolean {
  const value = search.trim().toLowerCase()
  if (!value) return true
  return [printer.name, printer.terminalCode, printer.model ?? '', printer.serialNumber ?? ''].some((item) => item.toLowerCase().includes(value))
}

export default function PrintersPage() {
  const [filter, setFilter] = useState<string>('全部')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const { data, status, error, refresh } = useRefreshable(PRINTERS_REFRESH_KEY, getPrinters, {
    intervalMs: 30_000,
    merge: (current, incoming) => {
      const printers = mergeById<AdminPrinterRecord>((item) => item.id)(current?.printers, incoming.printers)
      return current && printers === current.printers ? current : { printers }
    },
    failPolicy: 'keep-last',
  })
  const printers = data?.printers ?? []
  const loading = status === 'loading' && printers.length === 0
  const errorMessage = status === 'error' ? (error instanceof Error ? error.message : '打印机数据加载失败') : null
  const filtered = printers.filter((printer) => (FILTER_STATUS[filter] ? printer.status === FILTER_STATUS[filter] : true) && matchesSearch(printer, search))
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)
  const counts = { 全部: printers.length, 在线: printers.filter((p) => p.status === 'online').length, 离线: printers.filter((p) => p.status === 'offline').length, 故障: printers.filter((p) => p.status === 'error').length }

  const columns: ConsoleColumn<AdminPrinterRecord>[] = [
    { id: 'name', header: '设备名称', truncate: true, title: (p) => p.name, cell: (p) => <div className="flex items-center gap-2 font-semibold text-neutral-900"><PrinterIcon className="h-4 w-4 text-neutral-500" aria-hidden="true" />{p.name}</div> },
    { id: 'model', header: '型号', truncate: true, cell: (p) => p.model ?? '未上报' },
    { id: 'sn', header: 'SN', truncate: true, cell: (p) => <span className="font-mono text-xs">{p.serialNumber ?? '未上报'}</span> },
    { id: 'terminal', header: '绑定终端', truncate: true, cell: (p) => <span className="font-mono text-xs">{p.terminalCode}</span> },
    { id: 'status', header: '状态', cell: (p) => <StatusBadge dot status={STATUS_MAP[p.status].badge} label={STATUS_MAP[p.status].label} /> },
    { id: 'task', header: '当前任务', truncate: true, title: (p) => p.currentTask ?? '空闲', cell: (p) => p.currentTask ?? <span className="text-neutral-400">空闲</span> },
    { id: 'toner', header: '碳粉余量', cell: (p) => p.tonerLevel === null ? <span className="text-xs text-neutral-500">未上报</span> : <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-[52px] overflow-hidden rounded-full bg-neutral-100"><span className={'block h-full rounded-full ' + (p.tonerLevel < 20 ? 'bg-gradient-to-r from-[#c9764a] to-[#9e5330]' : 'bg-primary-600')} style={{ width: `${Math.max(0, Math.min(100, p.tonerLevel))}%` }} /></span><span className="text-xs tabular-nums text-neutral-500">{p.tonerLevel}%</span></span> },
    { id: 'paper', header: '纸张状态', cell: (p) => { const paper = PAPER_MAP[p.paperStatus ?? 'unknown'] ?? PAPER_MAP.unknown; return <span className="inline-flex items-center"><StatusBadge dot status={paper.badge} label={paper.label} />{formatPaperTrayLevel(p.paperTrayLevel)}</span> } },
    { id: 'fault', header: '故障信息', truncate: true, cell: (p) => <FaultCell printer={p} /> },
    { id: 'sync', header: '最近同步', truncate: true, title: (p) => p.lastSyncAt ? formatDateTime(p.lastSyncAt) : undefined, cell: (p) => <span title={p.lastSyncAt ? formatDateTime(p.lastSyncAt) : undefined} className="text-xs tabular-nums text-neutral-500">{relativeTime(p.lastSyncAt)}</span> },
  ]

  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="flex h-[34px] min-w-[240px] items-center gap-2 rounded-[9px] border border-neutral-900/10 bg-surface px-3"><SearchIcon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="搜索名称、终端、SN…" className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-500" /></div>
        {FILTERS.map((item) => <FilterChip key={item} active={filter === item} label={item} count={counts[item]} onClick={() => { setFilter(item); setPage(1) }} />)}
        <div className="ml-auto flex items-center gap-2"><span className="text-[12.5px] text-neutral-500">状态来自终端程序定时上报</span><button type="button" onClick={() => void refresh()} className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"><RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />刷新</button></div>
      </div>
      <Card className="overflow-hidden p-0"><ConsoleTable items={paged} columns={columns} loading={loading} error={errorMessage ? { title: '打印机数据加载失败', message: errorMessage, onRetry: () => void refresh() } : null} empty={{ title: '暂无打印机', description: search ? `未找到包含"${search}"的打印机` : '当前筛选条件下没有打印机' }} page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} /></Card>
      <p className="mt-3 text-xs text-neutral-400">设备状态由终端程序定时上报；型号、SN、耗材和纸盒余量未上报时显示为未上报{API_MODE !== 'http' && '（当前为 mock 演示数据）'}</p>
    </>
  )
}
