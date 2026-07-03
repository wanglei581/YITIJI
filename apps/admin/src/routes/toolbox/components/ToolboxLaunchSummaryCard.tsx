import { Card } from '@ai-job-print/ui'
import type { ToolboxLaunchSummary } from '@ai-job-print/shared'
import { formatCount } from '../constants'

export function ToolboxLaunchSummaryCard({ summary }: { summary: ToolboxLaunchSummary | null }) {
  const metrics = [
    { label: '7天总事件', value: summary?.totalCount ?? 0 },
    { label: '外部确认打开', value: summary?.externalConfirmedCount ?? 0 },
    { label: '二维码展示数', value: summary?.qrShownCount ?? 0 },
    { label: '外部取消数', value: summary?.externalCancelledCount ?? 0 },
  ]

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-neutral-900">百宝箱使用概览</h2>
          <p className="mt-1 text-xs text-neutral-500">最近 7 天匿名终端事件统计；二维码展示数不等同于真实扫码完成。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          {summary ? `${summary.days} 天窗口` : '加载中'}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
            <p className="text-xs font-medium text-neutral-500">{metric.label}</p>
            <p className="mt-1 text-2xl font-bold text-neutral-900">{formatCount(metric.value)}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-neutral-100 bg-surface px-4 py-3">
        <p className="text-xs font-semibold text-neutral-500">Top 功能项</p>
        {summary?.topItems.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.topItems.map((item) => (
              <span key={item.itemKey} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {item.itemTitle || item.itemKey} · {formatCount(item.count)}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-neutral-400">暂无使用事件</p>
        )}
      </div>
    </Card>
  )
}
