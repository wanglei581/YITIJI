import { formatDateTime, formatRelativeTime } from '@ai-job-print/shared'
import { useMemo, useState } from 'react'
import { mergeById, useRefreshable } from '@ai-job-print/refresh'
import { Card, ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { RefreshCwIcon } from 'lucide-react'
import { FilterChip } from '../components/FilterChip'
import { API_MODE } from '../../services/api/client'
import { getTerminals, type AdminTerminalRecord } from '../../services/api/devices'
import { PrinterLinkBadge, WiredLinkBadge } from '../terminals/TerminalNetworkDiagnostics'
import { fmtDisk, printerStatusView, scanInputView } from '../terminals/terminalStatusViews'
import { PeripheralDrawer } from './PeripheralDrawer'
import { UNREPORTED_PERIPHERALS, hasAnyIssue, hasNetworkIssue, hasPrinterIssue, hasScanIssue, isOfflineTerminal } from './peripheralViews'

const PERIPHERALS_REFRESH_KEY = 'admin:peripherals'
const UNBOUND = '__unbound__'

function relativeTime(iso: string | null): string {
  return iso ? formatRelativeTime(iso) : '从未上报'
}

function SummaryTile({ label, count, tone }: { label: string; count: number; tone: 'error' | 'warning' | 'neutral' }) {
  const color = count === 0 ? 'text-neutral-400' : tone === 'error' ? 'text-error-fg' : tone === 'warning' ? 'text-warning-fg' : 'text-neutral-900'
  return <Card className="px-4 py-3"><p className="text-[11.5px] font-bold text-neutral-500">{label}</p><p className={`mt-1 text-[1.4rem] font-bold leading-none tabular-nums ${color}`}>{count}<span className="ml-1 text-xs font-medium text-neutral-500">台</span></p></Card>
}

function OfflineCell() { return <span className="text-xs text-neutral-400">终端离线</span> }

export default function PeripheralsPage() {
  const [orgFilter, setOrgFilter] = useState('')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [onlyOffline, setOnlyOffline] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data, status, refresh } = useRefreshable(PERIPHERALS_REFRESH_KEY, getTerminals, {
    intervalMs: 30_000,
    merge: (current, incoming) => {
      const terminals = mergeById<AdminTerminalRecord>((item) => item.id)(current?.terminals, incoming.terminals)
      return current && terminals === current.terminals ? current : { terminals }
    },
    failPolicy: 'keep-last',
  })
  const terminals = useMemo(() => data?.terminals ?? [], [data])
  const selected = terminals.find((terminal) => terminal.id === selectedId) ?? null
  const orgOptions = useMemo(() => {
    const names = new Map<string, string>()
    for (const terminal of terminals) if (terminal.orgId && terminal.orgName) names.set(terminal.orgId, terminal.orgName)
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
  }, [terminals])
  const rows = terminals.filter((terminal) => {
    if (orgFilter === UNBOUND && terminal.orgId) return false
    if (orgFilter && orgFilter !== UNBOUND && terminal.orgId !== orgFilter) return false
    if (onlyIssues && !hasAnyIssue(terminal)) return false
    if (onlyOffline && !isOfflineTerminal(terminal)) return false
    return true
  })
  const summary = { printer: terminals.filter(hasPrinterIssue).length, scan: terminals.filter(hasScanIssue).length, network: terminals.filter(hasNetworkIssue).length, offline: terminals.filter(isOfflineTerminal).length }
  const loading = status === 'loading' && terminals.length === 0
  const failed = status === 'error' && terminals.length === 0
  const staleAfterError = status === 'error' && terminals.length > 0
  const openDetail = (terminal: AdminTerminalRecord) => setSelectedId(terminal.id)

  const columns: ConsoleColumn<AdminTerminalRecord>[] = [
    { id: 'terminal', header: '终端', truncate: true, title: (t) => `${t.displayName || t.terminalCode} · ${t.terminalCode}`, cell: (t) => <button type="button" onClick={() => openDetail(t)} className="block max-w-full text-left"><p className="truncate font-semibold text-neutral-900">{t.displayName || t.terminalCode}</p><p className="font-mono text-[11px] text-neutral-500">{t.terminalCode}</p><p className="truncate text-[11px] text-neutral-500">{t.orgName ?? '未绑定机构'}</p></button> },
    { id: 'printer', header: '打印机', cell: (t) => t.online ? <div className="space-y-1"><StatusBadge dot status={printerStatusView(t.printerStatus ?? null).badge} label={printerStatusView(t.printerStatus ?? null).label} /><PrinterLinkBadge online={t.online} printerNetworkStatus={t.printerNetworkStatus} /></div> : <OfflineCell /> },
    { id: 'scan', header: '面板扫描到本机目录', cell: (t) => { const view = scanInputView(t); return t.online ? <div className="space-y-1"><StatusBadge dot status={view.badge} label={view.label} />{view.detail && <span className="block text-xs text-warning-fg">{view.detail}</span>}{view.restart && <span className="block text-xs text-warning-fg">需重启终端程序恢复</span>}</div> : <OfflineCell /> } },
    { id: 'network', header: '有线网络', cell: (t) => t.online ? <WiredLinkBadge online={t.online} wiredNetworkStatus={t.wiredNetworkStatus} /> : <OfflineCell /> },
    { id: 'local', header: '本地任务库与磁盘', cell: (t) => t.online ? <div className="space-y-1">{t.localTaskDatabaseAvailable === false ? <StatusBadge dot status="error" label="任务库不可用" /> : t.localTaskDatabaseAvailable === true ? <StatusBadge dot status="success" label="任务库正常" /> : <StatusBadge dot status="default" label="任务库未上报" />}<span className="block text-xs text-neutral-500">磁盘可用 {fmtDisk(t.diskFreeGb)}</span></div> : <OfflineCell /> },
    { id: 'program', header: '终端程序版本与最近心跳', truncate: true, title: (t) => t.lastHeartbeatAt ? formatDateTime(t.lastHeartbeatAt) : undefined, cell: (t) => <div><p className="font-mono text-xs text-neutral-700">{t.agentVersion ?? '版本未上报'}</p><p title={t.lastHeartbeatAt ? formatDateTime(t.lastHeartbeatAt) : undefined} className={t.online ? 'text-neutral-500' : 'font-semibold text-error-fg'}>{t.online ? relativeTime(t.lastHeartbeatAt) : `离线 · ${relativeTime(t.lastHeartbeatAt)}`}</p></div> },
    ...UNREPORTED_PERIPHERALS.map((name) => ({ id: name, header: <>{name}<sup className="ml-0.5 text-neutral-400">※</sup></>, cell: () => <span className="text-xs text-neutral-400">不上报</span> })),
  ]

  return (
    <>
      {staleAfterError && <div role="alert" className="mb-3.5 flex flex-wrap items-center gap-3 rounded-[10px] border border-warning-fg/30 bg-warning-bg px-4 py-2.5 text-[13px] text-warning-fg"><span className="flex-1">刷新失败，以下为上次成功获取的数据，不代表设备现状。</span><button type="button" onClick={() => void refresh()} className="min-h-[36px] rounded-[8px] border border-warning-fg/40 px-3 font-medium hover:bg-warning-fg/10">重新获取</button></div>}
      <div className="mb-3.5 grid grid-cols-2 gap-3 md:grid-cols-4"><SummaryTile label="打印机异常" count={summary.printer} tone="error" /><SummaryTile label="扫描目录异常" count={summary.scan} tone="error" /><SummaryTile label="网络异常" count={summary.network} tone="warning" /><SummaryTile label="终端离线" count={summary.offline} tone="error" /></div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5"><select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} aria-label="按机构筛选" className="h-[34px] min-w-[180px] rounded-[9px] border border-neutral-900/10 bg-surface px-3 text-[13px] text-neutral-700"><option value="">全部机构</option>{orgOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}<option value={UNBOUND}>未绑定机构</option></select><FilterChip active={onlyIssues} label="只看异常" count={terminals.filter(hasAnyIssue).length} onClick={() => setOnlyIssues((value) => !value)} /><FilterChip active={onlyOffline} label="只看离线" count={summary.offline} onClick={() => setOnlyOffline((value) => !value)} /><div className="ml-auto flex items-center gap-2"><span className="text-[12.5px] text-neutral-500">状态由终端程序定时更新</span><button type="button" onClick={() => void refresh()} className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"><RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />刷新</button></div></div>
      <Card className="overflow-hidden p-0"><ConsoleTable items={rows} columns={columns} loading={loading} error={failed ? { title: '外设状态加载失败', message: '请稍后重试', onRetry: () => void refresh() } : null} empty={{ title: terminals.length === 0 ? '还没有终端' : '没有符合条件的终端', description: terminals.length === 0 ? '终端安装并上报心跳后，这里按外设显示状态。' : '换个机构或取消筛选试试' }} page={1} pageSize={rows.length || 1} total={rows.length} onPageChange={() => undefined} /></Card>
      <p className="mt-3 text-xs text-neutral-500">※ {UNREPORTED_PERIPHERALS.join('、')}由一体机本地使用，当前不会向云端上报状态，后台看不到好坏，只能按外设现场验收清单到现场检查。</p>
      <p className="mt-1 text-xs text-neutral-500">终端离线时各项都显示「终端离线」，不把离线前最后一次上报当成现状；点终端名称可看最后一次上报、原因与处置建议。「面板扫描到本机目录」锁死后要重启终端程序恢复：后台不提供远程解除锁死的单独开关，可在终端详情「远程操作」里远程重启终端程序。{API_MODE !== 'http' && '（当前为 mock 演示数据）'}</p>
      <PeripheralDrawer terminal={selected} onClose={() => setSelectedId(null)} />
    </>
  )
}
