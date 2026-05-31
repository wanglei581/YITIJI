import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * 水平步骤指示器。
 *
 * 用于 W2 K2 AI 简历四步流(上传 → 解析 → 优化 → 打印)、
 * Partner 数据源接入向导、Kiosk 打印流程等。
 *
 * 状态:
 *   - completed:已完成,蓝底白勾
 *   - active:   进行中,蓝边白底蓝字
 *   - pending:  未开始,灰边灰字
 *
 * 不内嵌路由,只做"看板",当前步进控制由调用方传入 currentIndex。
 */
export interface StepperStep {
  /** 短标题,例 "上传简历" */
  title: string
  /** 可选副标题,例 "PDF / Word / 图片" */
  description?: string
}

export interface StepperProps {
  steps: StepperStep[]
  /** 0 起始;< 0 全 pending;>= length 全 completed。 */
  currentIndex: number
  className?: string
}

export function Stepper({ steps, currentIndex, className }: StepperProps): ReactNode {
  return (
    <ol
      className={cn('flex w-full items-start gap-2', className)}
      aria-label="进度步骤"
    >
      {steps.map((step, idx) => {
        const status =
          idx < currentIndex ? 'completed' : idx === currentIndex ? 'active' : 'pending'
        const isLast = idx === steps.length - 1
        return (
          <li key={idx} className="flex flex-1 items-start gap-3 last:flex-none">
            {/* 圆点 + 序号 */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
                  status === 'completed' && 'border-primary-600 bg-primary-600 text-white',
                  status === 'active'    && 'border-primary-600 bg-white       text-primary-600',
                  status === 'pending'   && 'border-neutral-300 bg-white       text-neutral-400',
                )}
                aria-current={status === 'active' ? 'step' : undefined}
              >
                {status === 'completed' ? <Check className="h-4 w-4" aria-hidden /> : idx + 1}
              </span>
            </div>
            {/* 标题 */}
            <div className="min-w-0 flex-1 pt-1">
              <div
                className={cn(
                  'text-sm font-medium',
                  status === 'completed' && 'text-neutral-700',
                  status === 'active'    && 'text-primary-700',
                  status === 'pending'   && 'text-neutral-400',
                )}
              >
                {step.title}
              </div>
              {step.description && (
                <div className="mt-0.5 text-xs text-neutral-500">{step.description}</div>
              )}
            </div>
            {/* 连接线 */}
            {!isLast && (
              <div
                className={cn(
                  'mt-4 hidden h-px flex-1 sm:block',
                  status === 'completed' ? 'bg-primary-600' : 'bg-neutral-200',
                )}
                aria-hidden
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
