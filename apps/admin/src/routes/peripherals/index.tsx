// 设备管理 · 外设（/devices?tab=peripherals）：按外设看的状态矩阵。
//
// 数据只来自 GET /admin/terminals（Terminal Agent 心跳），30 秒刷新，与终端页同一写法。
// 词表复用终端页（terminalStatusViews.ts / TerminalNetworkDiagnostics.tsx），不另起一套。
// 本页只读：不做外设配置，也不提供任何远程解除扫描锁死的入口。
// U 盘、扫码枪、摄像头、读卡器云端没有遥测，统一写「不上报」，不伪造状态。

import { useMemo, useState } from 'react'
import { mergeById, useRefreshable } from '@ai-job-print/refresh'
import { Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { CableIcon, RefreshCwIcon } from 'lucide-react'
import { FilterChip } from '../components/FilterChip'
import { API_MODE } from '../../services/api/client'
import { getTerminals, type AdminTerminalRecord } from '../../services/api/devices'
import { PrinterLinkBadge, WiredLinkBadge } from '../terminals/TerminalNetworkDiagnostics'
import { fmtDisk, printerStatusView, scanInputView } from '../terminals/terminalStatusViews'
import { PeripheralDrawer } from './PeripheralDrawer'
import {
  UNREPORTED_PERIPHERALS,
  hasAnyIssue,
  hasNetworkIssue,
  hasPrinterIssue,
  hasScanIssue,
  isOfflineTerminal,
} from './peripheralViews'

const PERIPHERALS_REFRESH_KEY = 'admin:peripherals'
const UNBOUND = '__unbound__'
const COLUMNS = ['终端', '打印机', '面板扫描到本机目录', '有线网络', '本地任务库与磁盘', 'Agent 版本与最后心跳', ...UNREPORTED_PERIPHERALS]

function relativeTime(iso: string | null): string {
  if (!iso) return '从未上报'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diffMin = Math.floor((Date.now() - t) / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const hours = Math.floor(diffMin / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function SummaryTile({ label, count, tone }: { label: string; count: number; tone: 'error' | 'warning' | 'neutral' }) {
  const color = count === 0 ? 'text-neutral-400' : tone === 'error' ? 'text-error-fg' : tone === 'warning' ? 'text-warning-fg' : 'text-neutral-900'
  return (
    <Card className="px-4 py-3">
      <p className="text-[11.5px] font-bold text-neutral-500">{label}</p>
      <p className={`mt-1 text-[1.4rem] font-bold leading-none tabular-nums ${color}`}>
        {count}<span className="ml-1 text-xs font-medium text-neutral-500">台</span>
      </p>
    </Card>
  )
}

function OfflineCell() {
  return <span className="text-xs text-neutral-400">终端离线</span>
}

export default function PeripheralsPage() {
  const [orgFilter, setOrgFilter] = useState('')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [onlyOffline, setOnlyOffline] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, status, refresh } = useRefreshable(PERIPHERALS_REFRESH_KEY, getTerminals, {
    intervalMs: 30_000,
    merge: (current, incoming) => {
      const terminals = mergeById<AdminTerminalRecord>((item) => item.id)(current?.terminals, incoming.terminals)
      if (current && terminals === current.terminals) return current
      return { terminals }
    },
    failPolicy: 'keep-last',
  })

  const terminals = useMemo(() => data?.terminals ?? [], [data])
  // 抽屉跟着 30 秒刷新走：按 id 取最新一份，不握住打开那一刻的旧快照。
  const selected = terminals.find((t) => t.id === selectedId) ?? null
  const orgOptions = useMemo(() => {
    const names = new Map<string, string>()
    for (const t of terminals) if (t.orgId && t.orgName) names.set(t.orgId, t.orgName)
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
  }, [terminals])

  const rows = terminals.filter((t) => {
    if (orgFilter === UNBOUND && t.orgId) return false
    if (orgFilter && orgFilter !== UNBOUND && t.orgId !== orgFilter) return false
    if (onlyIssues && !hasAnyIssue(t)) return false
    if (onlyOffline && !isOfflineTerminal(t)) return false
    return true
  })
  const summary = {
    printer: terminals.filter(hasPrinterIssue).length,
    scan: terminals.filter(hasScanIssue).length,
    network: terminals.filter(hasNetworkIssue).length,
    offline: terminals.filter(isOfflineTerminal).length,
  }
  const loading = status === 'loading' && terminals.length === 0
  const failed = status === 'error' && terminals.length === 0
  // keep-last：刷新失败时保留上一份数据，但必须说清楚这不是最新状态。
  const staleAfterError = status === 'error' && terminals.length > 0

  return (
    <>
      {staleAfterError && (
        <div role="alert" className="mb-3.5 flex flex-wrap items-center gap-3 rounded-[10px] border border-warning-fg/30 bg-warning-bg px-4 py-2.5 text-[13px] text-warning-fg">
          <span className="flex-1">刷新失败，以下为上次成功获取的数据，不代表设备现状。</span>
          <button type="button" onClick={() => void refresh()} className="min-h-[36px] rounded-[8px] border border-warning-fg/40 px-3 font-medium hover:bg-warning-fg/10">
            重新获取
          </button>
        </div>
      )}
      <div className="mb-3.5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile label="打印机异常" count={summary.printer} tone="error" />
        <SummaryTile label="扫描目录异常" count={summary.scan} tone="error" />
        <SummaryTile label="网络异常" count={summary.network} tone="warning" />
        <SummaryTile label="终端离线" count={summary.offline} tone="error" />
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          aria-label="按机构筛选"
          className="h-[34px] min-w-[180px] rounded-[9px] border border-neutral-900/10 bg-surface px-3 text-[13px] text-neutral-700 focus:border-primary-600 focus:outline-none"
        >
          <option value="">全部机构</option>
          {orgOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          <option value={UNBOUND}>未绑定机构</option>
        </select>
        <FilterChip active={onlyIssues} label="只看异常" count={terminals.filter(hasAnyIssue).length} onClick={() => setOnlyIssues((v) => !v)} />
        <FilterChip active={onlyOffline} label="只看离线" count={summary.offline} onClick={() => setOnlyOffline((v) => !v)} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12.5px] text-neutral-500">状态来自 Terminal Agent 心跳，每 30 秒刷新</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />刷新
          </button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {COLUMNS.map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-3 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">
                    {h}{(UNREPORTED_PERIPHERALS as readonly string[]).includes(h) && <sup className="ml-0.5 text-neutral-400">※</sup>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {loading ? (
                [0, 1, 2].map((i) => (
                  <tr key={i}>
                    {COLUMNS.map((c) => <td key={c} className="px-3 py-4"><div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" /></td>)}
                  </tr>
                ))
              ) : failed ? (
                <tr>
                  <td colSpan={COLUMNS.length}>
                    <div className="flex flex-col items-center gap-3 py-12">
                      <p className="text-sm text-neutral-500">外设状态加载失败，请稍后重试</p>
                      <button type="button" onClick={() => void refresh()} className="rounded-[9px] bg-primary-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-primary-700">重试</button>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length}>
                    <EmptyState
                      icon={CableIcon}
                      title={terminals.length === 0 ? '还没有终端' : '没有符合条件的终端'}
                      description={terminals.length === 0 ? '终端安装并上报心跳后，这里按外设显示状态。' : '换个机构或取消筛选试试'}
                      className="py-12"
                    />
                  </td>
                </tr>
              ) : rows.map((t) => {
                const printer = printerStatusView(t.printerStatus ?? null)
                const scan = scanInputView(t)
                return (
                  <tr
                    key={t.id}
                    tabIndex={0}
                    onClick={() => setSelectedId(t.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(t.id) } }}
                    className="cursor-pointer align-top transition-colors hover:bg-neutral-50 focus:bg-primary-50/50 focus:outline-none"
                    aria-label={`查看 ${t.terminalCode} 的外设详情`}
                  >
                    <td className="px-3 py-3">
                      <p className="font-semibold text-neutral-900">{t.displayName || t.terminalCode}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-neutral-500">{t.terminalCode}</p>
                      <p className="text-[11px] text-neutral-500">{t.orgName ?? '未绑定机构'}</p>
                    </td>
                    <td className="px-3 py-3">
                      {t.online ? (
                        <div className="flex flex-col gap-1">
                          <StatusBadge dot status={printer.badge} label={printer.label} />
                          <PrinterLinkBadge online={t.online} printerNetworkStatus={t.printerNetworkStatus} />
                        </div>
                      ) : <OfflineCell />}
                    </td>
                    <td className="px-3 py-3">
                      {t.online ? (
                        <div className="flex flex-col gap-1">
                          <StatusBadge dot status={scan.badge} label={scan.label} />
                          {scan.detail && <span className="text-xs text-warning-fg">{scan.detail}</span>}
                          {scan.restart && <span className="text-xs text-warning-fg">需重启 Agent 恢复</span>}
                        </div>
                      ) : <OfflineCell />}
                    </td>
                    <td className="px-3 py-3">
                      {t.online ? <WiredLinkBadge online={t.online} wiredNetworkStatus={t.wiredNetworkStatus} /> : <OfflineCell />}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs">
                      {t.online ? (
                        <div className="flex flex-col gap-1">
                          {t.localTaskDatabaseAvailable === false
                            ? <StatusBadge dot status="error" label="任务库不可用" />
                            : t.localTaskDatabaseAvailable === true
                              ? <StatusBadge dot status="success" label="任务库正常" />
                              : <StatusBadge dot status="default" label="任务库未上报" />}
                          <span className="text-neutral-500">磁盘可用 {fmtDisk(t.diskFreeGb)}</span>
                        </div>
                      ) : <OfflineCell />}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs">
                      <p className="font-mono text-neutral-700">{t.agentVersion ?? '版本未上报'}</p>
                      <p className={t.online ? 'text-neutral-500' : 'font-semibold text-error-fg'}>
                        {t.online ? relativeTime(t.lastHeartbeatAt) : `离线 · ${relativeTime(t.lastHeartbeatAt)}`}
                      </p>
                    </td>
                    {UNREPORTED_PERIPHERALS.map((name) => (
                      <td key={name} className="whitespace-nowrap px-3 py-3 text-xs text-neutral-400">不上报</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-neutral-500">
        ※ {UNREPORTED_PERIPHERALS.join('、')}由一体机本地使用，Terminal Agent 目前不向云端上报它们的状态，后台看不到好坏，只能按外设现场验收清单到现场检查。
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        终端离线时各项都显示「终端离线」，不把离线前最后一次上报当成现状；点一行可看最后一次上报、原因与处置建议。
        「面板扫描到本机目录」锁死只能到现场重启 Agent 恢复，后台不提供远程解除。
        {API_MODE !== 'http' && '（当前为 mock 演示数据）'}
      </p>

      <PeripheralDrawer terminal={selected} onClose={() => setSelectedId(null)} />
    </>
  )
}
