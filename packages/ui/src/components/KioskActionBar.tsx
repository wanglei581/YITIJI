import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface KioskActionBarProps {
  children: ReactNode
  leading?: ReactNode
  className?: string
}

export function KioskActionBar({
  children,
  leading,
  className,
}: KioskActionBarProps) {
  return (
    <footer className={cn('ui-kiosk-action-bar', className)}>
      {leading && <div className="ui-kiosk-action-leading">{leading}</div>}
      <div className="ui-kiosk-action-items">{children}</div>
    </footer>
  )
}
