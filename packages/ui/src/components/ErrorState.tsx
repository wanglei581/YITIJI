import { AlertCircleIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { Button } from './Button'

export interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({
  title = '出现了一些问题',
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-error-bg">
        <AlertCircleIcon className="h-7 w-7 text-error" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-medium text-neutral-900">{title}</p>
        {message && <p className="text-sm text-neutral-500">{message}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          重试
        </Button>
      )}
    </div>
  )
}
