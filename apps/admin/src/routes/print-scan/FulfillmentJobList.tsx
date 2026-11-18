// 复印与材料包的只读列表。不进统一任务聚合，也不提供重试或取消。
// 演示模式两个接口都返回空列表，不造行。

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { RefreshCwIcon } from 'lucide-react'
import { FilterChip } from '../components/FilterChip'
import { getTerminals, type AdminTerminalRecord } from '../../services/api/devices'
import {
  adminPrintScanService,
  type AdminFulfillmentListItem,
  type AdminFulfillmentListPage,
} from '../../services/api/printScan'

const TONE: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  queued: 'warning',
  scanning: 'info',
  printing: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
  expired: 'default',
  unconfirmed: 'warning',
  unclassified: 'default',
}

const COPY_FILTERS = [
  { label: '全部', value: '' },
  { label: '排队', value: 'queued' },
  { label: '扫描中', value: 'scanning' },
  { label: '打印中', value: 'printing' },
  { label: '完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
  { label: '已过期', value: 'expired' },
  { label: '出纸未确认', value: 'unconfirmed' },
]

const PACK_FILTERS = [
  { label: '全部', value: '' },
  { label: '排队', value: 'queued' },
  { label: '打印中', value: 'printing' },
  { label: '完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
  { label: '已过期', value: 'expired' },
]

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return '读取失败，请再试一次'
}

function copiesText(item: AdminFulfillmentListItem): string {
  if (item.copies != null) return String(item.copies)
  if (item.lineCount != null && item.lineCount > 1) return '各行份数不同'
  return '—'
}

function terminalOptionLabel(terminal: AdminTerminalRecord): string {
  const name = terminal.displayName?.trim()
  return name ? `${name}（${terminal.terminalCode}）` : terminal.terminalCode
}

export function FulfillmentJobList({ kind }: { kind: 'copy' | 'material_pack' }) {
  const [terminals, setTerminals] = useState<AdminTerminalRecord[]>([])
  const [terminalHint, setTerminalHint] = useState<string | null>(null)
  const [terminalId, setTerminalId] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [data, setData] = useState<AdminFulfillmentListPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadSeq = useRef(0)
  const filters = kind === 'copy' ? COPY_FILTERS : PACK_FILTERS
  const emptyTitle = kind === 'copy' ? '还没有复印任务' : '还没有材料包订单'
  const emptyDescription = kind === 'copy'
    ? '当前筛选下没有屏上复印记录。'
    : '当前筛选下没有材料包订单。'

  useEffect(() => {
    let cancelled = false
    getTerminals()
      .then((result) => {
        if (!cancelled) setTerminals(result.terminals)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setTerminalHint(`终端列表没有读到：${readError(reason)}。可以先看全部任务，或点刷新再读一次。`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    const query = { terminalId: terminalId || undefined, status: status || undefined, page, pageSize }
    try {
      const result = kind === 'copy'
        ? await adminPrintScanService.listCopyJobs(query)
        : await adminPrintScanService.listMaterialPackOrders(query)
      if (seq !== loadSeq.current) return
      setData(result)
    } catch (reason: unknown) {
      if (seq !== loadSeq.current) return
      setData(null)
      setError(readError(reason))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [kind, terminalId, status, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const columns: ConsoleColumn<AdminFulfillmentListItem>[] = [
    { id: 'terminal', header: '终端', cellClassName: 'whitespace-nowrap', cell: (item) => item.terminalCode ?? '—' },
    { id: 'started', header: '开始时间', cellClassName: 'whitespace-nowrap tabular-nums', cell: (item) => formatDateTime(item.startedAt) },
    { id: 'copies', header: '份数', cellClassName: 'whitespace-nowrap', cell: (item) => copiesText(item) },
    ...(kind === 'material_pack' ? [{
      id: 'lines',
      header: '行数',
      cellClassName: 'whitespace-nowrap tabular-nums',
      cell: (item: AdminFulfillmentListItem) => item.lineCount == null ? '—' : String(item.lineCount),
    }] : []),
    {
      id: 'status',
      header: '状态',
      cellClassName: 'whitespace-nowrap',
      cell: (item) => <StatusBadge status={TONE[item.status] ?? 'default'} label={item.statusLabel} />,
    },
    {
      id: 'reason',
      header: '失败原因',
      truncate: true,
      title: (item) => item.failureReason ?? undefined,
      cell: (item) => item.failureReason ?? '—',
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="终端"
          value={terminalId}
          onChange={(event) => {
            setTerminalId(event.target.value)
            setPage(1)
          }}
          className="h-[30px] rounded-full border border-neutral-900/10 bg-surface px-3 text-[12.5px] font-bold text-neutral-700"
        >
          <option value="">全部终端</option>
          {terminals.map((terminal) => (
            <option key={terminal.id} value={terminal.id}>{terminalOptionLabel(terminal)}</option>
          ))}
        </select>
        {filters.map((filter) => (
          <FilterChip
            key={filter.value || 'all'}
            active={status === filter.value}
            label={filter.label}
            onClick={() => {
              setStatus(filter.value)
              setPage(1)
            }}
          />
        ))}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex h-[30px] items-center gap-1.5 rounded-full border border-neutral-900/10 bg-surface px-[13px] text-[12.5px] font-bold text-neutral-700 hover:border-primary-600/40"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" /> 刷新
        </button>
      </div>
      {terminalHint && (
        <p className="text-[12.5px] leading-relaxed text-neutral-600">{terminalHint}</p>
      )}
      <ConsoleTable
        items={data?.items ?? []}
        columns={columns}
        loading={loading}
        error={error ? { title: '读取失败', message: error, onRetry: () => void load() } : null}
        empty={{ title: emptyTitle, description: emptyDescription }}
        page={page}
        pageSize={pageSize}
        total={data?.pagination.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(next) => {
          setPageSize(next)
          setPage(1)
        }}
        className="overflow-hidden rounded-xl border border-neutral-900/10 bg-surface [&_table]:table-fixed [&_th]:px-2 [&_td]:px-2 [&_td]:text-xs"
      />
    </div>
  )
}
