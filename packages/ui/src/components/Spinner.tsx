import { cn } from '../lib/cn'

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-[3px]',
  xl: 'h-12 w-12 border-4',
} as const

export interface SpinnerProps {
  size?: keyof typeof sizeClasses
  className?: string
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="加载中"
      className={cn(
        'animate-spin rounded-full border-neutral-200 border-t-primary-600',
        sizeClasses[size],
        className,
      )}
    />
  )
}
