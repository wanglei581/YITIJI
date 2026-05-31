import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * 8 卡数据面板。
 *
 * Admin/Partner 工作台顶部"核心数据概览"区。
 * 秒哒 admin/01:今日使用人数 1284(↑12%)等 8 卡;
 * 秒哒 partner/04D:岗位发布量 / 外部跳转数 等 8 卡。
 *
 * 设计:
 *   - 4 列等宽(超大屏可手动外包 grid-cols-X 控制)
 *   - 每卡:左 label,左下 value(大字),右上 delta(可选)
 *   - 不绑定 Card 组件,调用方自己决定外框(避免双层边框)
 *
 * delta:
 *   - 正数 → 绿色 ↑ 12%
 *   - 负数 → 红色 ↓ 5%
 *   - 0    → 灰色 ─
 */
export interface MetricItem {
  /** 例 "今日使用人数" */
  label: string
  /** 主数据(已格式化),例 "1,284" 或 "¥3,450.50" */
  value: string
  /** 同比/环比百分比变化,例 12 / -5 / 0;不传则不展示 delta */
  deltaPercent?: number
  /** delta 的对照说明,例 "vs 昨日"(可选)。 */
  deltaHint?: string
  /** 可选 icon,推荐 lucide-react 24px。 */
  icon?: ReactNode
}

export interface MetricGridProps {
  metrics: MetricItem[]
  /** 默认 4 列,可自定义 className 覆盖 grid-cols-X。 */
  className?: string
}

export function MetricGrid({ metrics, className }: MetricGridProps): ReactNode {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4',
        className,
      )}
    >
      {metrics.map((m, idx) => (
        <MetricCard key={idx} {...m} />
      ))}
    </div>
  )
}

function MetricCard({ label, value, deltaPercent, deltaHint, icon }: MetricItem): ReactNode {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-neutral-500">{label}</span>
        {icon && <span className="text-primary-500" aria-hidden>{icon}</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold text-neutral-900">{value}</div>
        {deltaPercent !== undefined && <DeltaBadge pct={deltaPercent} hint={deltaHint} />}
      </div>
    </div>
  )
}

function DeltaBadge({ pct, hint }: { pct: number; hint?: string }): ReactNode {
  const tone =
    pct > 0 ? 'text-success-fg bg-success-bg/60'
    : pct < 0 ? 'text-error-fg bg-error-bg/60'
    : 'text-neutral-500 bg-neutral-100'
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '─'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tone,
      )}
      title={hint}
    >
      {arrow} {Math.abs(pct)}%
    </span>
  )
}
