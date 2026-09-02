import { useCallback, useEffect, useState } from 'react'
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FilterChip } from '../components/FilterChip'
import { AlertTriangleIcon, MonitorOffIcon, PrinterIcon, RefreshCwIcon } from 'lucide-react'
import {
  adminOpsService,
  type AdminAlertItem,
  type AlertListView,
} from '../../services/api/adminOps'
import { ApiHttpError } from '../../services/api/client'

const TYPE_META: Record<AdminAlertItem['type'], { label: string; icon: typeof AlertTriangleIcon }> = {
  terminal_offline: { label: '终端离线',   icon: MonitorOffIcon },
  printer_issue:    { label: '打印机异常', icon: PrinterIcon },
  print_failed:     { label: '打印失败',   icon: AlertTriangleIcon },
}

const SEVERITY_MAP: Record<string, { badge: 'error' | 'warning'; label: string }> = {
  error:   { badge: 'error',   label: '严重' },
  warning: { badge: 'warning', label: '警告' },
}

const SEVERITY_STYLE: Record<string, { bar: string; iconBox: string }> = {
  error:   { bar: 'bg-error',   iconBox: 'bg-error-bg text-error-fg' },
  warning: { bar: 'bg-warning', iconBox: 'bg-warning-bg text-warning-fg' },
}

const TYPE_FILTERS = [
  { label: '全部', value: '' },
  { label: '终端离线', value: 'terminal_offline' },
  { label: '打印机异常', value: 'printer_issue' },
  { label: '打印失败', value: 'print_failed' },
] as const

const VIEW_TABS: Array<{ label: string; value: AlertListView }> = [
  { label: '待处理', value: 'open' },
  { label: '已确认（仍在发生）', value: 'acknowledged' },
  { label: '已静默/关闭（仍在发生）', value: 'suppressed' },
]

function fmt(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

function handlingLabel(alert: AdminAlertItem): { badge: 'info' | 'warning' | 'default'; label: string } {
  if (alert.handlingState === 'acknowledged') return { badge: 'info', label: '已确认 · 问题仍在发生' }
  if (alert.handlingState === 'silenced') return { badge: 'warning', label: '已静默 · 问题仍在发生' }
  if (alert.handlingState === 'closed') return { badge: 'default', label: '已关闭 · 问题仍在发生' }
  return { badge: 'warning', label: '未处理 · 问题仍在发生' }
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AdminAlertItem[]>([])
  const [derivedAt, setDerivedAt] = useState<string | null>(null)
  const [firingCount, setFiringCount] = useState(0)
  const [openCount, setOpenCount] = useState(0)
  const [acknowledgedCount, setAcknowledgedCount] = useState(0)
  const [suppressedCount, setSuppressedCount] = useState(0)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [typeFilter, setTypeFilter] = useState('')
  const [view, setView] = useState<AlertListView>('open')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async (nextView: AlertListView = view) => {
    setState('loading')
    setActionError(null)
    try {
      const res = await adminOpsService.listAlerts(nextView)
      setAlerts(res.data)
      setDerivedAt(res.derivedAt)
      setFiringCount(res.firingCount)
      setOpenCount(res.openCount)
      setAcknowledgedCount(res.acknowledgedCount)
      setSuppressedCount(res.suppressedCount)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [view])

  useEffect(() => { void load(view) }, [load, view])

  const filtered = typeFilter ? alerts.filter((a) => a.type === typeFilter) : alerts
  const errorCount = alerts.filter((a) => a.severity === 'error').length

  async function dispose(
    alert: AdminAlertItem,
    action: 'acknowledge' | 'silence' | 'close',
    duration?: '1h' | '4h' | '24h',
  ) {
    setBusyKey(`${alert.subjectKey}:${action}${duration ?? ''}`)
    setActionError(null)
    try {
      await adminOpsService.disposeAlert({
        subjectKey: alert.subjectKey,
        episodeToken: alert.episodeToken,
        action,
        duration,
      })
      await load(view)
    } catch (err) {
      setActionError(err instanceof ApiHttpError ? err.message : '处理失败，请刷新后重试')
    } finally {
      setBusyKey(null)
    }
  }

  const emptyTitle = firingCount === 0
    ? '当前无告警'
    : filtered.length === 0 && typeFilter
      ? '该分类当前无告警'
      : '这一栏没有告警'
  const emptyDescription = firingCount === 0
    ? '所有终端在线、打印机正常、近 24 小时无未处理失败任务'
    : filtered.length === 0 && typeFilter
      ? `「${TYPE_META[typeFilter as AdminAlertItem['type']]?.label ?? typeFilter}」在当前栏无告警；仍有 ${firingCount} 条问题未恢复`
      : `待处理 ${openCount} · 已确认仍在发生 ${acknowledgedCount} · 已静默/关闭仍在发生 ${suppressedCount}。确认不会把设备显示成正常。`

  return (
    <Page
      title="告警中心"
      subtitle={`实时派生 · 待处理 ${openCount} / 仍在发生 ${firingCount}${derivedAt ? ` · 生成于 ${fmt(derivedAt)}` : ''}${errorCount ? ` · 本栏严重 ${errorCount}` : ''}`}
      actions={
        <button
          type="button"
          onClick={() => void load(view)}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </button>
      }
    >
      <div className="mb-4 rounded-[9px] border border-info/20 bg-info-bg px-4 py-2.5 text-[13px] text-info-fg">
        告警由实时状态派生：终端离线（心跳超 3 分钟）、打印机异常、近 24 小时打印失败。确认 / 静默 / 关闭只记录处理，设备仍异常时不会显示成已恢复。已退款失败单按订单退款状态退出告警，不伪造出纸结果。
      </div>

      <div className="mb-3 flex flex-wrap gap-2.5">
        {VIEW_TABS.map((tab) => (
          <FilterChip
            key={tab.value}
            active={view === tab.value}
            label={tab.label}
            count={tab.value === 'open' ? openCount : tab.value === 'acknowledged' ? acknowledgedCount : suppressedCount}
            onClick={() => setView(tab.value)}
          />
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2.5">
        {TYPE_FILTERS.map((f) => (
          <FilterChip
            key={f.label}
            active={typeFilter === f.value}
            label={f.label}
            count={f.value ? alerts.filter((a) => a.type === f.value).length : alerts.length}
            onClick={() => setTypeFilter(f.value)}
          />
        ))}
      </div>

      {actionError && (
        <p className="mb-3 text-[13px] text-error-fg">{actionError}</p>
      )}

      {state === 'loading' && <LoadingState className="py-24" />}
      {state === 'error' && <ErrorState className="py-24" onRetry={() => void load(view)} />}

      {state === 'ready' && (
        filtered.length === 0 ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            icon={AlertTriangleIcon}
            className="py-20"
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtered.map((alert) => {
              const meta = TYPE_META[alert.type]
              const severity = SEVERITY_MAP[alert.severity] ?? SEVERITY_MAP.warning
              const style = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.warning
              const handling = handlingLabel(alert)
              const Icon = meta.icon
              const busy = busyKey?.startsWith(`${alert.subjectKey}:`) ?? false
              return (
                <div
                  key={alert.id}
                  className="relative flex flex-col gap-3 overflow-hidden rounded-lg border border-neutral-900/[0.06] bg-surface py-4 pl-[18px] pr-[18px] shadow-sm sm:flex-row sm:items-center"
                >
                  <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${style.bar}`} />
                  <span className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] ${style.iconBox}`}>
                    <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-neutral-900">{alert.title}</p>
                      <StatusBadge dot status={severity.badge} label={severity.label} />
                      <span className="rounded-md bg-neutral-50 px-1.5 py-0.5 text-xs text-neutral-500">{meta.label}</span>
                      <StatusBadge status={handling.badge} label={handling.label} />
                    </div>
                    <p className="mt-1 truncate text-[12.5px] text-neutral-500">
                      {alert.terminalCode ? `${alert.terminalCode} · ` : ''}
                      {alert.detail}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                    <p className="text-xs tabular-nums text-neutral-500">{fmt(alert.occurredAt)}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {alert.handlingState === 'open' && (
                        <ActionButton disabled={busy} onClick={() => void dispose(alert, 'acknowledge')}>确认</ActionButton>
                      )}
                      {alert.handlingState !== 'closed' && (
                        <>
                          <ActionButton disabled={busy} onClick={() => void dispose(alert, 'silence', '1h')}>静默 1 小时</ActionButton>
                          <ActionButton disabled={busy} onClick={() => void dispose(alert, 'silence', '4h')}>静默 4 小时</ActionButton>
                          <ActionButton disabled={busy} onClick={() => void dispose(alert, 'silence', '24h')}>静默 24 小时</ActionButton>
                        </>
                      )}
                      {alert.handlingState !== 'closed' && (
                        <ActionButton disabled={busy} onClick={() => void dispose(alert, 'close')}>关闭</ActionButton>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </Page>
  )
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 min-w-[48px] items-center justify-center rounded-[9px] border border-neutral-200 bg-surface px-3 text-[12px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
    >
      {children}
    </button>
  )
}
