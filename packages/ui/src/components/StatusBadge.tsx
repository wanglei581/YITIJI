import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      status: {
        success: 'bg-success-bg text-success-fg',
        warning: 'bg-warning-bg text-warning-fg',
        error:   'bg-error-bg text-error-fg',
        info:    'bg-info-bg text-info-fg',
        default: 'bg-neutral-100 text-neutral-600',
      },
    },
    defaultVariants: {
      status: 'default',
    },
  },
)

export interface StatusBadgeProps extends VariantProps<typeof badgeVariants> {
  label: string
  className?: string
  /** 在文字前渲染 6px 当前色圆点（墨青纸感后台规范）。默认关闭，不影响既有页面。 */
  dot?: boolean
}

export function StatusBadge({ status, label, className, dot = false }: StatusBadgeProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(badgeVariants({ status }), dot && 'gap-1.5', className)}
    >
      {dot && (
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      )}
      {label}
    </span>
  )
}

export { badgeVariants }
