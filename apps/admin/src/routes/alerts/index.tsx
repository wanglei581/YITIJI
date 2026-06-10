import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { AlertTriangleIcon, MonitorOffIcon, PrinterIcon, RefreshCwIcon } from 'lucide-react'
import { adminOpsService, type AdminAlertItem } from '../../services/api/adminOps'

// ─── Display maps ─────────────────────────────────────────────────────────────

const TYPE_META: Record<AdminAlertItem['type'], { label: string; icon: typeof AlertTriangleIcon; iconColor: string }> = {
  terminal_offline: { label: '终端离线',   icon: MonitorOffIcon,    iconColor: 'text-red-500' },
  printer_issue:    { label: '打印机异常', icon: PrinterIcon,       iconColor: 'text-orange-500' },
  print_failed:     { label: '打印失败',   icon: AlertTriangleIcon, iconColor: 'text-amber-500' },
}

const SEVERITY_MAP: Record<string, { badge: 'error' | 'warning'; label: string }> = {
  error:   { badge: 'error',   label: '严重' },
  warning: { badge: 'warning', label: '警告' },
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
      subtitle={`实时派生告警 — ${alerts.length} 条(严重 ${errorCount})${derivedAt ? ` · 生成于 ${fmt(derivedAt)}` : ''}`}
      actions={
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCwIcon className="h-4 w-4" />
          刷新
        </button>
      }
    >
      {/* 诚实说明:派生告警,无处理流转 */}
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
        告警由实时数据派生:终端离线(心跳超 3 分钟)、打印机异常(最近心跳上报)、近 24 小时打印失败任务。当前未建独立告警模型,故不支持确认/指派/处理记录;条件恢复后告警自动消失。
      </div>

      {/* 类型筛选 */}
      <div className="mb-4 flex gap-2">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setTypeFilter(f.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              typeFilter === f.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
            <span className="ml-1.5 text-xs opacity-70">
              {f.value ? alerts.filter((a) => a.type === f.value).length : alerts.length}
            </span>
          </button>
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
          <div className="flex flex-col gap-3">
            {filtered.map((alert) => {
              const meta = TYPE_META[alert.type]
              const severity = SEVERITY_MAP[alert.severity] ?? SEVERITY_MAP.warning
              const Icon = meta.icon
              return (
                <Card key={alert.id} className="flex items-start gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50">
                    <Icon className={`h-5 w-5 ${meta.iconColor}`} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={severity.badge} label={severity.label} />
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{meta.label}</span>
                      {alert.terminalCode && (
                        <span className="font-mono text-xs text-gray-400">{alert.terminalCode}</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-gray-800">{alert.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{alert.detail}</p>
                  </div>
                  <p className="shrink-0 text-xs text-gray-400">{fmt(alert.occurredAt)}</p>
                </Card>
              )
            })}
          </div>
        )
      )}
    </Page>
  )
}
