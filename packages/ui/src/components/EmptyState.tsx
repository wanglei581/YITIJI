import type { LucideIcon } from 'lucide-react'
import { InboxIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <Icon className="h-7 w-7 text-gray-400" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-medium text-gray-900">{title}</p>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
