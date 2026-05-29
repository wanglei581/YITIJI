import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  className?: string
  /** 'default' = text-xl（页面主标题）; 'large' = text-2xl（一级大标题，如 Kiosk 首页） */
  size?: 'default' | 'large'
}

export function PageHeader({ title, subtitle, actions, className, size = 'default' }: PageHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between border-b border-neutral-200 pb-4', className)}>
      <div>
        <h1 className={cn(
          'font-semibold text-neutral-900',
          size === 'large' ? 'text-2xl' : 'text-xl',
        )}>
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
