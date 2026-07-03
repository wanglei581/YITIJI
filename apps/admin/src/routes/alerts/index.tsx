import { useCallback, useEffect, useState } from 'react'
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FilterChip } from '../components/FilterChip'
import { AlertTriangleIcon, MonitorOffIcon, PrinterIcon, RefreshCwIcon } from 'lucide-react'
import { adminOpsService, type AdminAlertItem } from '../../services/api/adminOps'

// ─── Display maps ─────────────────────────────────────────────────────────────

const TYPE_META: Record<AdminAlertItem['type'], { label: string; icon: typeof AlertTriangleIcon }> = {
  terminal_offline: { label: '终端离线',   icon: MonitorOffIcon },
  printer_issue:    { label: '打印机异常', icon: PrinterIcon },
  print_failed:     { label: '打印失败',   icon: AlertTriangleIcon },
}

const SEVERITY_MAP: Record<string, { badge: 'error' | 'warning'; label: string }> = {
  error:   { badge: 'error',   label: '严重' },
  warning: { badge: 'warning', label: '警告' },
}

/** 原型 alert-card 左色条 + 图标块配色（sev-crit 朱 / sev-warn 陶）。 */
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

function fmt(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AdminAlertItem[]>([])
  const [derivedAt, setDerivedAt] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [typeFilter, setTypeFilter] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await adminOpsService.listAlerts()
      setAlerts(res.data)
      setDerivedAt(res.derivedAt)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = typeFilter ? alerts.filter((a) => a.type === typeFilter) : alerts
  const errorCount = alerts.filter((a) => a.severity === 'error').length

  return (
    <Page
      title="告警中心"
      subtitle={`硬件 / 任务实时派生告警 · ${alerts.length} 条（严重 ${errorCount}）${derivedAt ? ` · 生成于 ${fmt(derivedAt)}` : ''}`}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </button>
      }
    >
      {/* 诚实说明:派生告警,无处理流转 */}
      <div className="mb-4 rounded-[9px] border border-info/20 bg-info-bg px-4 py-2.5 text-[13px] text-info-fg">
        告警由实时数据派生:终端离线(心跳超 3 分钟)、打印机异常(最近心跳上报)、近 24 小时打印失败任务。当前未建独立告警模型,故不支持确认/指派/处理记录;条件恢复后告警自动消失。
      </div>

      {/* 类型筛选 */}
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

      {state === 'loading' && <LoadingState className="py-24" />}
      {state === 'error' && <ErrorState className="py-24" onRetry={() => void load()} />}

      {state === 'ready' && (
        filtered.length === 0 ? (
          <EmptyState
            title="当前无告警"
            description="所有终端在线、打印机正常、近 24 小时无失败任务"
            icon={AlertTriangleIcon}
            className="py-20"
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtered.map((alert) => {
              const meta = TYPE_META[alert.type]
              const severity = SEVERITY_MAP[alert.severity] ?? SEVERITY_MAP.warning
              const style = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.warning
              const Icon = meta.icon
              return (
                <div
                  key={alert.id}
                  className="relative flex items-center gap-3.5 overflow-hidden rounded-lg border border-neutral-900/[0.06] bg-surface py-4 pl-[18px] pr-[18px] shadow-sm"
                >
                  {/* 左侧 severity 色条（原型 alert-card::before） */}
                  <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${style.bar}`} />

                  <span className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] ${style.iconBox}`}>
                    <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-neutral-900">{alert.title}</p>
                      <StatusBadge dot status={severity.badge} label={severity.label} />
                      <span className="rounded-md bg-neutral-50 px-1.5 py-0.5 text-xs text-neutral-500">{meta.label}</span>
                    </div>
                    <p className="mt-1 truncate text-[12.5px] text-neutral-500">
                      {alert.terminalCode ? `${alert.terminalCode} · ` : ''}
                      {alert.detail}
                    </p>
                  </div>

                  <p className="shrink-0 text-xs tabular-nums text-neutral-500">{fmt(alert.occurredAt)}</p>
                </div>
              )
            })}
          </div>
        )
      )}
    </Page>
  )
}
