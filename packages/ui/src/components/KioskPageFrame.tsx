import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface KioskPageFrameProps {
  children: ReactNode
  header?: ReactNode
  footer?: ReactNode
  className?: string
}

export function KioskPageFrame({
  children,
  header,
  footer,
  className,
}: KioskPageFrameProps) {
  return (
    <section
      data-kiosk-component="page-frame"
      className={cn('ui-kiosk-page-frame', className)}
    >
      {header}
      {children}
      {footer}
    </section>
  )
}
