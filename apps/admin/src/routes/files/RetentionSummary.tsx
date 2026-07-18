import { Card } from '@ai-job-print/ui'
import { ClockIcon, FileClockIcon, ShieldCheckIcon, TimerResetIcon } from 'lucide-react'
import type { AdminFileLifecycleSummary } from '../../services/api'
import { retentionPolicyLabel } from './retentionMeta'

function metric(
  label: string,
  value: number,
  hint: string,
  icon: React.ComponentType<{ className?: string }>,
  iconClass = 'bg-neutral-100 text-neutral-500',
) {
  const Icon = icon
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-neutral-500">{label}</p>
          <p className="mt-1 text-[1.6rem] font-bold tabular-nums leading-none text-neutral-900">{value}</p>
          <p className="mt-1.5 text-xs text-neutral-400">{hint}</p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${iconClass}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </Card>
  )
}

export function RetentionSummary({ summary }: { summary: AdminFileLifecycleSummary | null }) {
  if (!summary) {
    return (
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <div className="h-16 animate-pulse rounded bg-neutral-100" />
          </Card>
        ))}
      </div>
    )
  }
  const policyText = summary.byRetentionPolicy
    .map((item) => `${retentionPolicyLabel(item.key)} ${item.count}`)
    .join(' / ')

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        {metric('有效文件', summary.totalActive, '全量未清理文件', ShieldCheckIcon, 'bg-success-bg text-success-fg')}
        {metric('长期保存', summary.longTermCount, '用户确认后的长期成果物', FileClockIcon, 'bg-info-bg text-info-fg')}
        {metric('7天内到期', summary.expiringWithin7Days, '需关注的短期文件', ClockIcon, 'bg-warning-bg text-warning-fg')}
        {metric('待清理', summary.expiredPendingCleanup, '已过期未物理清理', TimerResetIcon, 'bg-error-bg text-error-fg')}
      </div>
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
        <span className="font-medium text-neutral-600">策略分布：</span>{policyText || '暂无文件'}
        <span className="ml-3 text-neutral-400">统计时间 {new Date(summary.generatedAt).toLocaleString()}</span>
      </div>
    </div>
  )
}
