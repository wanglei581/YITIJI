// 机构端「终端数据」— /terminals
//
// 数据来源：getPartnerTerminalOperations() → GET /partner/terminal-operations?period=...
// 机构取自登录账号；本页不发送任何机构或终端标识。http 模式只读真实接口，不出演示数据；
// mock 模式的示例在页面上明确标注「演示数据」。
//
// 本页只展示服务端算好的口径（见 services/api/src/orgs/partner-terminal-ops.ts）：
//   - 服务人次、AI 可用率当前算不出来，照实写「暂不能统计」并说明原因，不拿别的数冒充；
//   - 1–4 的计数服务端已置空，页面写「少于 5」，不自行估算；
//   - 导出 CSV 只把已过服务端白名单的这份数据原样写出，不另查任何明细。

import { formatDateTime } from '@ai-job-print/shared'
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, ConsoleTable, EmptyState, ErrorState, LoadingState, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { DownloadIcon, MonitorIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import { FRONTEND_HINT, Page, withFrontendHint } from '../Page'
import {
  getPartnerTerminalOperations,
  type PartnerTerminalOpsView,
  type TerminalOpsPeriod,
  type TerminalOpsRow,
} from '../../services/api/terminalOps'
import { getOrgProfile } from '../../services/api/orgSelf'
import { downloadCsv, safeFileName } from '../../lib/csv'
import { TerminalOpsCards } from './TerminalOpsCards'
import { TerminalOpsDrawer } from './TerminalOpsDrawer'
import {
  METRIC_NOTES,
  RUN_STATE_VIEW,
  buildTerminalOpsCsv,
  countText,
  FAULTS_NOT_REPORTED,
  visitText,
  minutesText,
  rateText,
  relativeTime,
  runState,
  shanghaiDateTime,
  terminalName,
  terminalOpsCsvName,
  windowText,
} from './terminalOpsFormat'

const PERIODS: { value: TerminalOpsPeriod; label: string }[] = [
  { value: 'week', label: '近 7 天' },
  { value: 'month', label: '近 30 天' },
  { value: 'quarter', label: '近 90 天' },
]

const FILTERS = ['全部', '在线', '有未恢复故障'] as const
type Filter = (typeof FILTERS)[number]

function matchesFilter(row: TerminalOpsRow, filter: Filter): boolean {
  if (filter === '在线') return row.online
  if (filter === '有未恢复故障') return row.faults.unrecovered
  return true
}

function matchesSearch(row: TerminalOpsRow, search: string): boolean {
  const s = search.trim().toLowerCase()
  if (!s) return true
  return [row.terminalCode, row.displayName ?? '', row.locationLabel ?? ''].some((v) => v.toLowerCase().includes(s))
}

function PeriodSelector({ value, onChange }: { value: TerminalOpsPeriod; onChange: (p: TerminalOpsPeriod) => void }) {
  return (
    <div role="group" aria-label="统计周期" className="flex rounded-lg border border-neutral-200 bg-surface text-sm">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          aria-pressed={value === p.value}
          onClick={() => onChange(p.value)}
          className={`min-h-[36px] px-4 font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
            value === p.value ? 'bg-primary-600 text-white' : 'text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

export default function TerminalsPage() {
  const [period, setPeriod] = useState<TerminalOpsPeriod>('week')
  const [data, setData] = useState<PartnerTerminalOpsView | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [filter, setFilter] = useState<Filter>('全部')
  const [search, setSearch] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getPartnerTerminalOperations(period)
      .then((next) => {
        if (cancelled) return
        setData(next)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : '终端数据加载失败')
        setState('error')
      })
    return () => { cancelled = true }
  }, [period, reloadKey])

  const rows = useMemo(
    () => (data?.terminals ?? []).filter((row) => matchesFilter(row, filter) && matchesSearch(row, search)),
    [data, filter, search],
  )
  // 抽屉按终端编号取当前这份数据，切周期或刷新后跟着更新。
  const selected = data?.terminals.find((row) => row.terminalCode === selectedCode) ?? null
  const counts: Record<Filter, number> = {
    全部: data?.terminals.length ?? 0,
    在线: data?.terminals.filter((row) => row.online).length ?? 0,
    有未恢复故障: data?.terminals.filter((row) => row.faults.unrecovered).length ?? 0,
  }

  async function exportCsv() {
    if (!data) return
    setExporting(true)
    try {
      const orgName = await getOrgProfile().then((profile) => profile.name).catch(() => '本机构')
      downloadCsv(safeFileName(terminalOpsCsvName(orgName, data)), buildTerminalOpsCsv(data))
    } finally {
      setExporting(false)
    }
  }

  const ready = state === 'ready' && data
  const hasTerminals = Boolean(ready && data.terminals.length > 0)
  const columns: ConsoleColumn<TerminalOpsRow>[] = [
    { id: 'terminal', header: '终端', truncate: true, title: (row) => `${terminalName(row)} · ${row.terminalCode}`, cell: (row) => <button type="button" onClick={() => setSelectedCode(row.terminalCode)} className="block max-w-full text-left"><p className="truncate font-semibold text-neutral-900">{terminalName(row)}</p><p className="mt-0.5 truncate text-xs text-neutral-500"><span className="font-mono">{row.terminalCode}</span>{row.locationLabel ? ` · ${row.locationLabel}` : ''}</p></button> },
    { id: 'status', header: '当前状态', cell: (row) => { const run = RUN_STATE_VIEW[runState(row)]; return <div><StatusBadge dot status={run.status} label={run.label} /><p className="mt-1 text-[11px] text-neutral-500" title={row.lastHeartbeatAt ? formatDateTime(row.lastHeartbeatAt) : undefined}>{relativeTime(row.lastHeartbeatAt)}</p></div> } },
    { id: 'visits', header: '服务人次', align: 'right', cell: (row) => visitText(data!, row.visitCount) },
    { id: 'service', header: '打印扫描次数', align: 'right', cell: (row) => countText(row.serviceCount) },
    { id: 'rate', header: '出纸成功率', align: 'right', cell: (row) => <div><p className="font-semibold tabular-nums text-neutral-900">{rateText(row.output)}</p><p className="text-[11px] text-neutral-500">{countText(row.output.printed)} / {countText(row.output.settled)}</p></div> },
    { id: 'unconfirmed', header: '未确认出纸', align: 'right', cell: (row) => countText(row.output.unconfirmed) },
    { id: 'offline', header: '离线', align: 'right', cell: (row) => row.faults.reportedInWindow ? `${row.faults.offlineCount} 次 · ${minutesText(row.faults.offlineMinutes)}` : <span className="text-xs text-neutral-500" title={FAULTS_NOT_REPORTED}>无法统计</span> },
    { id: 'printerFault', header: '打印机故障', align: 'right', cell: (row) => row.faults.reportedInWindow ? `${row.faults.printerFaultCount} 次 · ${minutesText(row.faults.printerFaultMinutes)}` : <span className="text-xs text-neutral-500" title={FAULTS_NOT_REPORTED}>无法统计</span> },
    { id: 'unrecovered', header: '未恢复', align: 'right', cell: (row) => row.faults.reportedInWindow ? (row.faults.unrecovered ? <span className="font-semibold text-error-fg">未恢复</span> : <span className="text-neutral-500">无</span>) : <span className="text-xs text-neutral-500" title={FAULTS_NOT_REPORTED}>无法统计</span> },
  ]

  return (
    <Page
      title="终端数据"
      subtitle={withFrontendHint('本机构终端的打印扫描服务、出纸与故障恢复', FRONTEND_HINT.terminals)}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector value={period} onChange={setPeriod} />
          <Button size="sm" variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />刷新
          </Button>
          <Button size="sm" onClick={() => void exportCsv()} disabled={!hasTerminals || exporting}>
            <DownloadIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{exporting ? '正在导出' : '导出 CSV'}
          </Button>
        </div>
      )}
    >
      {state === 'loading' && !data ? (
        <LoadingState className="py-20" />
      ) : state === 'error' ? (
        <ErrorState className="py-20" title="终端数据加载失败" message={errorMessage} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !ready ? null : !hasTerminals ? (
        <EmptyState
          icon={MonitorIcon}
          title="本机构还没有绑定终端"
          description="终端由平台绑定后这里会显示运营数据。如需绑定，请联系平台运维。"
          className="py-20"
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
            {data.dataMode === 'demo' && <StatusBadge status="warning" label="演示数据" />}
            <span>统计窗口：{windowText(data)}（北京时间）</span>
            <span>生成于 {shanghaiDateTime(data.generatedAt)}</span>
            <span>{METRIC_NOTES.sample}</span>
          </div>

          <TerminalOpsCards data={data} />

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-neutral-900/[0.06] px-4 py-3">
              <div className="flex h-[36px] min-w-[240px] items-center gap-2 rounded-[9px] border border-neutral-900/10 bg-surface px-3">
                <SearchIcon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索终端名称、编号、位置"
                  aria-label="搜索终端"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-500"
                />
              </div>
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`min-h-[36px] rounded-full border px-3 text-xs font-bold transition-colors ${
                    filter === f ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-neutral-200 bg-surface text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {f} <span className="tabular-nums">{counts[f]}</span>
                </button>
              ))}
              <span className="ml-auto text-xs text-neutral-500">点一行查看这台终端的明细</span>
            </div>
            <ConsoleTable items={rows} columns={columns} empty={{ title: '没有符合条件的终端', description: '换个筛选或关键词试试' }} page={1} pageSize={rows.length || 1} total={rows.length} onPageChange={() => undefined} scrollX={false} />
          </Card>

          <p className="text-xs leading-relaxed text-neutral-500">
            本页只统计本机构名下终端的设备运行与打印扫描服务，不含任何用户个人信息，也不含文件与订单明细。
            终端的绑定、维修与换机由平台处理。
          </p>
        </div>
      )}

      <TerminalOpsDrawer
        row={selected}
        windowLabel={data ? windowText(data) : ''}
        visitRecordingStarted={data?.visitCount.recordingStarted ?? false}
        onClose={() => setSelectedCode(null)}
      />
    </Page>
  )
}
