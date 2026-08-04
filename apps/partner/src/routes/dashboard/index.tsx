import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DatabaseIcon,
  RefreshCwIcon,
  ScrollTextIcon,
} from 'lucide-react'
import { getPartnerDashboard, type PartnerDashboardData } from '../../services/api/orgSelf'

// ─── 工作台（审计修复：全部指标来自 GET /partner/dashboard 真实计数）──────────
// 原硬编码 METRICS/RECENT_SYNCS/pendingCount 已删除；无埋点支撑的「展示/跳转/打印次数」
// 指标卡一并移除（没有的数据不展示假数字）。

const RESULT_CONFIG: Record<string, { label: string; badge: 'success' | 'error' | 'warning' }> = {
  success: { label: '成功', badge: 'success' },
  failed: { label: '失败', badge: 'error' },
  partial: { label: '部分失败', badge: 'warning' },
}

const DATA_TYPE_LABEL: Record<string, string> = { job: '岗位', fair: '招聘会', policy: '政策' }

function PendingReviewCallout({ count, onView }: { count: number; onView: () => void }) {
  if (count === 0) return null
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-warning/30 bg-warning-bg px-5 py-4">
      <div className="flex items-center gap-3">
        <AlertCircleIcon className="h-5 w-5 shrink-0 text-warning-fg" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-warning-fg">有 {count} 条数据待管理员审核</p>
          <p className="mt-0.5 text-xs text-warning-fg">
            数据提交后需经管理员审核，通过后才会在终端展示
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 whitespace-nowrap border-warning/40 text-warning-fg hover:bg-warning-bg"
        onClick={onView}
      >
        去查看
        <ArrowRightIcon className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}

function MetricsGrid({ data, onGo }: { data: PartnerDashboardData; onGo: (path: string) => void }) {
  const metrics = [
    {
      label: '已上传岗位', value: data.jobs.total,
      note: `已发布 ${data.jobs.published} · 待审核 ${data.jobs.pending}`,
      icon: BriefcaseIcon, iconClass: 'bg-info-bg text-info-fg', path: '/jobs',
    },
    {
      label: '已上传招聘会', value: data.fairs.total,
      note: `已发布 ${data.fairs.published} · 待审核 ${data.fairs.pending}`,
      icon: CalendarIcon, iconClass: 'bg-purple-50 text-purple-600', path: '/fairs',
    },
    {
      label: '政策公告', value: data.policies.total,
      note: `已发布 ${data.policies.published} · 待审核 ${data.policies.pending}`,
      icon: ScrollTextIcon, iconClass: 'bg-success-bg text-success-fg', path: '/policy',
    },
    {
      label: '已发布数据', value: data.jobs.published + data.fairs.published + data.policies.published,
      note: `岗位 ${data.jobs.published} + 招聘会 ${data.fairs.published} + 政策 ${data.policies.published}`,
      icon: CheckCircleIcon, iconClass: 'bg-success-bg text-success-fg', path: '/jobs',
    },
    {
      label: '待审核数据', value: data.pendingTotal,
      note: data.pendingTotal > 0 ? '等待管理员审核' : '当前无待审核',
      icon: ClockIcon, iconClass: 'bg-warning-bg text-warning-fg', path: '/jobs',
    },
    {
      label: '数据源', value: data.sources.total,
      note: `启用中 ${data.sources.enabled} 个`,
      icon: DatabaseIcon, iconClass: 'bg-cyan-50 text-cyan-600', path: '/sources',
    },
  ]
  return (
    <section aria-label="数据概览">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
        <h2 className="text-[13px] font-bold text-neutral-700">数据概览</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {metrics.map((m) => {
          const Icon = m.icon
          return (
            <Card
              key={m.label}
              className="cursor-pointer p-4 transition-shadow hover:shadow-md"
              onClick={() => onGo(m.path)}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-medium text-neutral-500">{m.label}</p>
                  <p className="mt-1.5 text-[1.5rem] font-bold tabular-nums leading-none text-neutral-900">{m.value}</p>
                  <p className="mt-1.5 text-[10.5px] text-neutral-400">{m.note}</p>
                </div>
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${m.iconClass}`}>
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

function SyncLogSection({ data, onGoLogs }: { data: PartnerDashboardData; onGoLogs: () => void }) {
  return (
    <section aria-label="最近同步记录">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
          <h2 className="text-[13px] font-bold text-neutral-700">最近同步记录</h2>
        </div>
        <button
          type="button"
          onClick={onGoLogs}
          className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          查看全部
          <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        {data.recentSyncs.length === 0 ? (
          <EmptyState
            icon={RefreshCwIcon}
            title="暂无同步记录"
            description="通过 API / Webhook / Excel 导入数据后，这里会显示最近的同步结果"
            className="py-10"
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['数据源', '类型', '新增/更新/失败', '结果', '同步时间'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-5 py-3 text-left text-xs font-medium text-neutral-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {data.recentSyncs.map((s) => {
                const cfg = RESULT_CONFIG[s.status] ?? { label: s.status, badge: 'warning' as const }
                return (
                  <tr key={s.id} className="transition-colors hover:bg-neutral-50">
                    <td className="px-5 py-3.5 font-medium text-neutral-800">{s.source}</td>
                    <td className="px-5 py-3.5">
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                        {DATA_TYPE_LABEL[s.dataType] ?? s.dataType}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-neutral-700">
                      {s.addedCount} / {s.updatedCount} / <span className={s.errorCount > 0 ? 'text-error-fg' : ''}>{s.errorCount}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge dot status={cfg.badge} label={cfg.label} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-xs tabular-nums text-neutral-400">{s.syncTime}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<PartnerDashboardData | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getPartnerDashboard()
      .then((d) => {
        if (cancelled) return
        setData(d)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <Page title="工作台" subtitle="本机构数据概览（实时统计）">
      {state === 'loading' ? (
        <LoadingState className="py-20" />
      ) : state === 'error' || !data ? (
        <ErrorState className="py-20" onRetry={() => setReloadKey((k) => k + 1)} />
      ) : (
        <div className="flex flex-col gap-6">
          <PendingReviewCallout count={data.pendingTotal} onView={() => navigate('/jobs')} />
          <MetricsGrid data={data} onGo={(p) => navigate(p)} />
          <SyncLogSection data={data} onGoLogs={() => navigate('/sync-logs')} />
        </div>
      )}
    </Page>
  )
}
