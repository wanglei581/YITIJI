import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * 漏斗转化卡片。
 *
 * Partner 数据统计页主图(秒哒 partner/15)。
 * 例:总曝光 12450 → 详情浏览 8230 (66%) → 外部跳转 3210 (25%)。
 *
 * 不用 recharts 的 Funnel(样式定制困难),直接用横向 bar + 百分比文字。
 *
 * 每一级:左标题 / 中数据 / 右占比;条宽 = (当前值 / 第一级值) × 100%。
 */
export interface FunnelStep {
  label: string
  value: number
  /** 可选,自定义副文字(例 "占比 25%")。默认按 value/firstValue 自动算。 */
  hint?: string
}

export interface FunnelCardProps {
  steps: FunnelStep[]
  /** 数字千分位格式化,默认 zh-CN。 */
  locale?: string
  className?: string
}

export function FunnelCard({ steps, locale = 'zh-CN', className }: FunnelCardProps): ReactNode {
  if (steps.length === 0) {
    return <div className={cn('text-sm text-neutral-400', className)}>暂无漏斗数据</div>
  }
  const firstValue = steps[0]!.value || 1
  return (
    <ol className={cn('space-y-3', className)}>
      {steps.map((step, idx) => {
        const pct = Math.round((step.value / firstValue) * 100)
        const widthPct = Math.max(8, pct) // 极小值保留 8% 视觉条
        return (
          <li key={idx} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-neutral-700">{step.label}</span>
              <span className="text-neutral-500">
                <span className="font-semibold text-neutral-900">
                  {step.value.toLocaleString(locale)}
                </span>
                {' · '}
                {step.hint ?? `${pct}%`}
              </span>
            </div>
            <div className="relative h-6 overflow-hidden rounded-md bg-neutral-100">
              <div
                className="h-full bg-primary-500"
                style={{ width: `${widthPct}%` }}
                aria-hidden
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
