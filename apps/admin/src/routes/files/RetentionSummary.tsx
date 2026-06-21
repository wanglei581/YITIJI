import { Card } from '@ai-job-print/ui'
import { ClockIcon, FileClockIcon, ShieldCheckIcon, TimerResetIcon } from 'lucide-react'
import type { AdminFileLifecycleSummary } from '../../services/api'
import { retentionPolicyLabel } from './retentionMeta'

function metric(label: string, value: number, hint: string, icon: React.ComponentType<{ className?: string }>) {
  const Icon = icon
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
          <p className="mt-1 text-xs text-gray-400">{hint}</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
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
            <div className="h-16 animate-pulse rounded bg-gray-100" />
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
        {metric('有效文件', summary.totalActive, '全量未清理文件', ShieldCheckIcon)}
        {metric('长期保存', summary.longTermCount, '用户确认后的长期成果物', FileClockIcon)}
        {metric('7天内到期', summary.expiringWithin7Days, '需关注的短期文件', ClockIcon)}
        {metric('待清理', summary.expiredPendingCleanup, '已过期未物理清理', TimerResetIcon)}
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500">
        <span className="font-medium text-gray-600">策略分布：</span>{policyText || '暂无文件'}
        <span className="ml-3 text-gray-400">统计时间 {new Date(summary.generatedAt).toLocaleString()}</span>
      </div>
    </div>
  )
}
