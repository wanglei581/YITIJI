import { useNavigate } from 'react-router-dom'
import { formatCount, formatDateTime } from '@ai-job-print/shared'
import { Card, ConsoleTable, EmptyState, StatusBadge } from '@ai-job-print/ui'
import {
  ArrowRightIcon,
  BriefcaseIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DatabaseIcon,
  RefreshCwIcon,
  type LucideIcon,
} from 'lucide-react'
import type { PartnerDashboardData } from '../../services/api/orgSelf'
import type { PartnerStatsResponse } from '../../services/api/stats'
import { useRecruitmentHosting } from '../../services/capabilities'

/**
 * 招聘内容概况只在能力接口明确返回打开时渲染。
 * 关闭、还在读、读失败都不渲染，避免把「没读到」显示成没有岗位。
 * 数字与同步记录沿用托管打开时工作台原来的文案和去向。
 */
const MISS = '这类这次没读到'

const RESULT_LABEL: Record<string, { label: string; badge: 'success' | 'error' | 'warning' }> = {
  success: { label: '成功', badge: 'success' },
  failed: { label: '失败', badge: 'error' },
  partial: { label: '部分失败', badge: 'warning' },
}

const DATA_TYPE_LABEL: Record<string, string> = { job: '岗位', fair: '招聘会', policy: '政策' }

type Snapshot = PartnerStatsResponse['snapshot']
type ReadStatus = 'loading' | 'error' | 'ready'

function reviewPath(snapshot: Snapshot): string {
  if (snapshot.pendingReviewJobs > 0) return '/jobs'
  if (snapshot.pendingReviewFairs > 0) return '/fairs'
  if (snapshot.pendingReviewPolicies > 0) return '/policy'
  return '/companies'
}

function Miss({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg">
      <span>{MISS}</span>
      <button type="button" onClick={onRetry} className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-warning/40 px-3 text-sm font-semibold">重试</button>
    </div>
  )
}

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  iconClass,
  path,
  onGo,
}: {
  label: string
  value: number
  note: string
  icon: LucideIcon
  iconClass: string
  path: string
  onGo: (path: string) => void
}) {
  return (
    <Card className="min-w-0 cursor-pointer p-4 transition-shadow hover:shadow-md" onClick={() => onGo(path)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-medium text-neutral-500">{label}</p>
          <p className="mt-1.5 text-[1.5rem] font-bold tabular-nums leading-none text-neutral-900">{formatCount(value)}</p>
          <p className="mt-1.5 text-[10.5px] text-neutral-400">{note}</p>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${iconClass}`}>
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </div>
      </div>
    </Card>
  )
}

function PendingMetric({
  snapshot,
  statsStatus,
  onRetry,
  onGo,
}: {
  snapshot: Snapshot | null
  statsStatus: ReadStatus
  onRetry: () => void
  onGo: (path: string) => void
}) {
  if (statsStatus === 'ready' && snapshot) {
    const pending = snapshot.pendingReview
    return (
      <MetricCard
        label="待审核数据"
        value={pending}
        note={pending > 0 ? '含审核中与企业资料，与统计页相同' : '当前无待审核'}
        icon={ClockIcon}
        iconClass="bg-warning-bg text-warning-fg"
        path={reviewPath(snapshot)}
        onGo={onGo}
      />
    )
  }
  return (
    <Card className="min-w-0 space-y-2 p-4">
      <p className="text-[11.5px] font-medium text-neutral-500">待审核数据</p>
      {statsStatus === 'error' || (statsStatus === 'ready' && !snapshot)
        ? <Miss onRetry={onRetry} />
        : <p className="text-sm text-neutral-500">正在读取</p>}
    </Card>
  )
}

function MetricGrid({
  data,
  snapshot,
  statsStatus,
  onRetryStats,
  onGo,
}: {
  data: PartnerDashboardData
  snapshot: Snapshot | null
  statsStatus: ReadStatus
  onRetryStats: () => void
  onGo: (path: string) => void
}) {
  const published = data.jobs.published + data.fairs.published + data.policies.published
  return (
    <div className="grid grid-cols-2 gap-3">
      <MetricCard
        label="已上传岗位"
        value={data.jobs.total}
        note={`已发布 ${formatCount(data.jobs.published)} · 待初审 ${formatCount(data.jobs.pending)}`}
        icon={BriefcaseIcon}
        iconClass="bg-info-bg text-info-fg"
        path="/jobs"
        onGo={onGo}
      />
      <MetricCard
        label="已上传招聘会"
        value={data.fairs.total}
        note={`已发布 ${formatCount(data.fairs.published)} · 待初审 ${formatCount(data.fairs.pending)}`}
        icon={CalendarIcon}
        iconClass="bg-purple-50 text-purple-600"
        path="/fairs"
        onGo={onGo}
      />
      <MetricCard
        label="已发布数据"
        value={published}
        note={`岗位 ${formatCount(data.jobs.published)} + 招聘会 ${formatCount(data.fairs.published)} + 政策 ${formatCount(data.policies.published)}`}
        icon={CheckCircleIcon}
        iconClass="bg-success-bg text-success-fg"
        path="/jobs"
        onGo={onGo}
      />
      <PendingMetric snapshot={snapshot} statsStatus={statsStatus} onRetry={onRetryStats} onGo={onGo} />
      <MetricCard
        label="数据源"
        value={data.sources.total}
        note={`启用中 ${formatCount(data.sources.enabled)} 个`}
        icon={DatabaseIcon}
        iconClass="bg-cyan-50 text-cyan-600"
        path="/sources"
        onGo={onGo}
      />
    </div>
  )
}

function SyncLogSection({ data, onGoLogs }: { data: PartnerDashboardData; onGoLogs: () => void }) {
  return (
    <section aria-label="最近同步记录" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
          <h2 className="text-[13px] font-bold text-neutral-700">最近同步记录</h2>
        </div>
        <button
          type="button"
          onClick={onGoLogs}
          className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          查看全部
          <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      <Card className="min-w-0 overflow-hidden p-0">
        {data.recentSyncs.length === 0 ? (
          <EmptyState
            icon={RefreshCwIcon}
            title="暂无同步记录"
            description="通过 API / Webhook / Excel 导入数据后，这里会显示最近的同步结果"
            className="py-10"
          />
        ) : (
          <ConsoleTable
            items={data.recentSyncs}
            page={1}
            pageSize={Math.max(data.recentSyncs.length, 1)}
            total={data.recentSyncs.length}
            onPageChange={() => {}}
            columns={[
              { id: 'source', header: '数据源', truncate: true, cell: (row) => row.source },
              { id: 'type', header: '类型', cell: (row) => DATA_TYPE_LABEL[row.dataType] ?? row.dataType },
              {
                id: 'counts',
                header: '新增/更新/失败',
                cellClassName: 'whitespace-nowrap tabular-nums',
                cell: (row) => (
                  <>
                    {formatCount(row.addedCount)} / {formatCount(row.updatedCount)} / <span className={row.errorCount > 0 ? 'text-error-fg' : ''}>{formatCount(row.errorCount)}</span>
                  </>
                ),
              },
              {
                id: 'result',
                header: '结果',
                cell: (row) => {
                  const cfg = RESULT_LABEL[row.status] ?? { label: row.status, badge: 'warning' as const }
                  return <StatusBadge dot status={cfg.badge} label={cfg.label} />
                },
              },
              { id: 'time', header: '同步时间', cellClassName: 'whitespace-nowrap tabular-nums', cell: (row) => formatDateTime(row.syncTime) },
            ]}
          />
        )}
      </Card>
    </section>
  )
}

export function RecruitmentOverview({
  dashboard,
  snapshot,
  statsStatus,
  onRetryDashboard,
  onRetryStats,
}: {
  dashboard: { status: ReadStatus; data: PartnerDashboardData | null }
  snapshot: Snapshot | null
  statsStatus: ReadStatus
  onRetryDashboard: () => void
  onRetryStats: () => void
}) {
  const hosting = useRecruitmentHosting()
  const navigate = useNavigate()
  if (hosting !== 'on') return null
  const data = dashboard.status === 'ready' ? dashboard.data : null

  return (
    <section aria-label="招聘内容概况" className="min-w-0 space-y-4">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
        <h2 className="text-[13px] font-bold text-neutral-700">招聘内容概况</h2>
      </div>
      {dashboard.status === 'loading' && <p className="text-sm text-neutral-500">正在读取招聘内容</p>}
      {dashboard.status === 'error' && <Miss onRetry={onRetryDashboard} />}
      {data && (
        <>
          <MetricGrid data={data} snapshot={snapshot} statsStatus={statsStatus} onRetryStats={onRetryStats} onGo={(path) => navigate(path)} />
          <SyncLogSection data={data} onGoLogs={() => navigate('/sync-logs')} />
        </>
      )}
    </section>
  )
}
