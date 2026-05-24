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
        default: 'bg-gray-100 text-gray-600',
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
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(badgeVariants({ status }), className)}
    >
      {label}
    </span>
  )
}

export { badgeVariants }
