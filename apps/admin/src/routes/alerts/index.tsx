import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatCount, formatDateTime } from '@ai-job-print/shared'
import { ConsoleTable, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FilterChip } from '../components/FilterChip'
import { AlertTriangleIcon, BotIcon, FileWarningIcon, MessageSquareWarningIcon, MonitorOffIcon, PrinterIcon, RefreshCwIcon } from 'lucide-react'
import {
  adminOpsService,
  type AdminAlertItem,
  type AdminAlertsResult,
  type AlertAction,
  type AlertListView,
} from '../../services/api/adminOps'
import { AI_CONTENT_COMPLAINT_SLA_WORKDAYS } from '../member-feedback/feedbackSla'
import { alertDetailText } from './alertDetailText'
import { userMessageOf } from '../../services/api/userErrorMessage'

const TYPE_META: Record<
  AdminAlertItem['type'],
  { label: string; icon: typeof AlertTriangleIcon; guidance?: string; link?: { label: string; to: string } }
> = {
  terminal_offline: { label: '终端离线',   icon: MonitorOffIcon },
  printer_issue:    { label: '打印机异常', icon: PrinterIcon },
  print_failed:     { label: '打印失败',   icon: AlertTriangleIcon },
  // 只说明现状与处置边界：本页动作只记录处理，不退款、不恢复文件，也不改订单状态。
  paid_pending_file_unavailable: {
    label: '已支付文件不可用',
    icon: FileWarningIcon,
    guidance: '订单已支付，但打印文件当前不可用（原因见上一行），任务无法正常出纸，需人工核对订单后处置。确认 / 静默 / 关闭只记录处理，不会退款，也不会恢复文件。',
  },
  // C3：只给条数与最早提交时间，不带投诉正文与手机号；处理在「意见反馈」页。
  feedback_pending: {
    label: 'AI 内容投诉待处理',
    icon: MessageSquareWarningIcon,
    guidance: `有 AI 内容投诉等待处理（条数与最早提交时间见上一行），须在 ${AI_CONTENT_COMPLAINT_SLA_WORKDAYS} 个工作日内答复。点「去处理」直接打开已按「AI 内容投诉」筛好的意见反馈，答复后这条告警自动消失；有新投诉进来会再次提醒。确认 / 静默只记录处理。`,
    link: { label: '去处理', to: '/member-feedback?category=ai_content' },
  },
  // 免费打印防刷：某台终端当天免费出纸面数达到上限的告警阈值（默认 80%），用满升为严重。
  print_terminal_quota_high: {
    label: '免费打印量接近上限',
    icon: PrinterIcon,
    guidance: '这台终端今天的免费打印面数已接近或达到每日上限（数字见上一行），达到上限后本机当天不再接受免费单，明天 0 点恢复。每日上限的全站默认值和单台设置由管理员配置。确认 / 静默只记录处理。',
  },
  ai_provider_unavailable: {
    label: 'AI 账户不可用',
    icon: BotIcon,
    guidance: '最近 15 分钟内，模型账户出现余额或密钥一类的失败，而且之后没有成功。用户只能改用手动方式。出现成功后这条告警自动消失。',
  },
  ai_consecutive_failures: {
    label: 'AI 连续失败',
    icon: BotIcon,
    guidance: '最近 10 分钟内，模型请求末尾连续失败达到 5 次。这段时间里一次都没成功时标为严重，否则是警告。与账户不可用同时出现时，只保留账户不可用。',
  },
  ai_budget_exhausted: {
    label: 'AI 费用上限已用完',
    icon: BotIcon,
    guidance: '全站今天的 AI 费用已经到上限，AI 功能暂停到明天 0 点。单台终端或单个会员自己的上限不会出现在这里。',
  },
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
  { label: '已支付文件不可用', value: 'paid_pending_file_unavailable' },
  { label: 'AI 内容投诉', value: 'feedback_pending' },
  { label: '免费打印量', value: 'print_terminal_quota_high' },
  { label: 'AI 账户不可用', value: 'ai_provider_unavailable' },
  { label: 'AI 连续失败', value: 'ai_consecutive_failures' },
  { label: 'AI 费用上限已用完', value: 'ai_budget_exhausted' },
] as const

const VIEW_TABS: Array<{ label: string; value: AlertListView }> = [
  { label: '待处理', value: 'open' },
  { label: '已确认（仍在发生）', value: 'acknowledged' },
  { label: '已静默/关闭（仍在发生）', value: 'suppressed' },
]

function fmt(iso: string): string {
  return formatDateTime(iso)
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
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [viewTotal, setViewTotal] = useState<number | null>(null)
  const [listedCount, setListedCount] = useState(0)
  const [truncation, setTruncation] = useState<AdminAlertsResult['truncation']>(null)
  const [openCount, setOpenCount] = useState(0)
  const [acknowledgedCount, setAcknowledgedCount] = useState(0)
  const [suppressedCount, setSuppressedCount] = useState(0)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [typeFilter, setTypeFilter] = useState('')
  const [view, setView] = useState<AlertListView>('open')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [confirmCloseKey, setConfirmCloseKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async (nextView: AlertListView = view) => {
    setState('loading')
    setActionError(null)
    setConfirmCloseKey(null)
    try {
      const res = await adminOpsService.listAlerts(nextView)
      setAlerts(res.data)
      setDerivedAt(res.derivedAt)
      setFiringCount(res.firingCount)
      setTotal(res.total)
      setTruncated(res.truncated)
      setViewTotal(res.viewTotal ?? null)
      setListedCount(res.listedCount)
      setTruncation(res.truncation)
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
    action: AlertAction,
    duration?: '1h' | '4h' | '24h',
  ) {
    setBusyKey(`${alert.subjectKey}:${action}${duration ?? ''}`)
    setActionError(null)
    setConfirmCloseKey(null)
    try {
      await adminOpsService.disposeAlert({
        subjectKey: alert.subjectKey,
        episodeToken: alert.episodeToken,
        action,
        duration,
      })
      await load(view)
    } catch (err) {
      setActionError(userMessageOf(err, '处理失败，请刷新后重试'))
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
    ? '所有终端在线、打印机正常、近 24 小时无未处理失败任务、无文件不可用的已支付待打印任务，AI 账户、连续失败和当天全站费用上限也都没有告警'
    : filtered.length === 0 && typeFilter
      ? `「${TYPE_META[typeFilter as AdminAlertItem['type']]?.label ?? typeFilter}」在当前栏无告警；仍有 ${formatCount(firingCount)} 条问题未恢复`
      : `待处理 ${formatCount(openCount)} · 已确认仍在发生 ${formatCount(acknowledgedCount)} · 已静默/关闭仍在发生 ${formatCount(suppressedCount)}。确认不会把设备显示成正常。`

  return (
    <Page
      title="告警中心"
      subtitle={`实时派生 · 待处理 ${formatCount(openCount)} / 仍在发生 ${formatCount(firingCount)}${truncated ? (viewTotal !== null ? ` · 仅展示前 ${formatCount(listedCount)} 条，本视图共 ${formatCount(viewTotal)} 条` : ` · 仅展示前 ${formatCount(listedCount)} 条，全部在发 ${formatCount(total)} 条（派生层上限已触及，本视图精确条数未知）`) : ''}${derivedAt ? ` · 生成于 ${fmt(derivedAt)}` : ''}${errorCount ? ` · 本栏严重 ${formatCount(errorCount)}` : ''}`}
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
        告警由实时状态派生：终端离线（心跳超 5 分钟）、打印机异常、近 24 小时打印失败、已支付但打印文件不可用的待打印任务（需人工处置）、AI 账户不可用、AI 连续失败、当天全站 AI 费用用完。确认 / 静默 / 关闭只记录处理，问题仍在时不会显示成已恢复；关闭后可以「重新打开」退回待处理。已退款的订单按订单退款状态退出告警，本页不发起退款，不伪造出纸结果。
      </div>

      {truncation && (
        <div className="mb-4 rounded-[9px] border border-warning/30 bg-warning-bg px-4 py-2.5 text-[13px] text-warning-fg">
          当前仍在发生 <span className="font-bold tabular-nums">{formatCount(firingCount)}</span> 条，本页最多列出最近{' '}
          <span className="tabular-nums">{formatCount(truncation.cap)}</span> 条，另有{' '}
          <span className="font-bold tabular-nums">{formatCount(truncation.omitted)}</span> 条打印失败告警未在本页列出。
          下方各栏计数只统计已列出的部分，未列出的告警同样仍在发生。
        </div>
      )}

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
          <ConsoleTable items={filtered}
            page={1} pageSize={Math.max(filtered.length, 1)} total={filtered.length} onPageChange={() => {}}
            renderHeader={() => <tr>{['告警与处置说明', '时间与操作'].map((header, i) => <th key={header} className={`whitespace-nowrap px-4 py-3 text-left text-xs text-neutral-500 ${i === 1 ? 'sticky right-0 z-10 border-l border-neutral-100 bg-surface' : ''}`}>{header}</th>)}</tr>}
            renderRow={(alert) => {
              const meta = TYPE_META[alert.type]
              const severity = SEVERITY_MAP[alert.severity] ?? SEVERITY_MAP.warning
              const style = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.warning
              const handling = handlingLabel(alert)
              const Icon = meta.icon
              const busy = busyKey?.startsWith(`${alert.subjectKey}:`) ?? false
              const detailLine = alertDetailText(alert.terminalCode, alert.detail)
              return (
                <tr key={alert.id} className="group bg-surface hover:bg-neutral-50">
                  <td className="relative min-w-[400px] max-w-[620px] px-4 py-4">
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${style.bar}`} />
                    <div className="flex items-start gap-3">
                      <span className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] ${style.iconBox}`}>
                        <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="line-clamp-2 break-words text-sm font-bold text-neutral-900" title={alert.title}>{alert.title}</p>
                          <StatusBadge dot status={severity.badge} label={severity.label} />
                          <span className="rounded-md bg-neutral-50 px-1.5 py-0.5 text-xs text-neutral-500">{meta.label}</span>
                          <StatusBadge status={handling.badge} label={handling.label} />
                        </div>
                        <p className="mt-1 truncate text-[12.5px] text-neutral-500" title={detailLine}>
                          {detailLine}
                        </p>
                        {meta.guidance && (
                          <p className="mt-1 text-[12px] text-neutral-600">{meta.guidance}</p>
                        )}
                        {meta.link && (
                          <Link
                            to={meta.link.to}
                            className="mt-1.5 inline-flex h-9 min-w-[48px] items-center rounded-[9px] border border-primary-300 bg-primary-50 px-3 text-[12px] font-bold text-primary-700 hover:bg-primary-100"
                          >
                            {meta.link.label} →
                          </Link>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="sticky right-0 z-10 min-w-[300px] max-w-[360px] border-l border-neutral-100 bg-inherit px-4 py-4">
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-xs tabular-nums text-neutral-500">{fmt(alert.occurredAt)}</p>
                      {confirmCloseKey === alert.subjectKey ? (
                        // 关闭会把仍在发生的告警移出默认视图，所以要二次确认；
                        // 即使误点，也还有下面的「重新打开」可以退回待处理。
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[12px] text-neutral-600">关闭后不再出现在待处理，问题仍在发生：</span>
                          <ActionButton
                            disabled={busy}
                            tone="danger"
                            onClick={() => void dispose(alert, 'close')}
                          >
                            确认关闭
                          </ActionButton>
                          <ActionButton disabled={busy} onClick={() => setConfirmCloseKey(null)}>取消</ActionButton>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {alert.handlingState === 'open' && (
                            <ActionButton disabled={busy} onClick={() => void dispose(alert, 'acknowledge')}>确认</ActionButton>
                          )}
                          {alert.handlingState !== 'closed' && (
                            <>
                              <ActionButton disabled={busy} onClick={() => void dispose(alert, 'silence', '1h')}>静默 1 小时</ActionButton>
                              <ActionButton disabled={busy} onClick={() => void dispose(alert, 'silence', '4h')}>静默 4 小时</ActionButton>
                              <ActionButton disabled={busy} onClick={() => void dispose(alert, 'silence', '24h')}>静默 24 小时</ActionButton>
                              <ActionButton disabled={busy} onClick={() => setConfirmCloseKey(alert.subjectKey)}>关闭</ActionButton>
                            </>
                          )}
                          {alert.handlingState !== 'open' && (
                            <ActionButton disabled={busy} onClick={() => void dispose(alert, 'reopen')}>重新打开</ActionButton>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )
            }}
          />
        )
      )}
    </Page>
  )
}

function ActionButton({
  children,
  disabled,
  onClick,
  tone = 'default',
}: {
  children: string
  disabled: boolean
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  const toneClass = tone === 'danger'
    ? 'border-error/40 bg-error-bg text-error-fg hover:bg-error-bg/80'
    : 'border-neutral-200 bg-surface text-neutral-700 hover:bg-neutral-50'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 min-w-[48px] items-center justify-center rounded-[9px] border px-3 text-[12px] font-bold transition-colors disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  )
}
