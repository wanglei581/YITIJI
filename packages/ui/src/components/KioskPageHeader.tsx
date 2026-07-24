import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface KioskPageHeaderProps {
  title: string
  description?: string
  onBack?: () => void
  backLabel?: string
  leading?: ReactNode
  aside?: ReactNode
  headingId?: string
  className?: string
}

export function KioskPageHeader({
  title,
  description,
  onBack,
  backLabel = '返回',
  leading,
  aside,
  headingId,
  className,
}: KioskPageHeaderProps) {
  return (
    <header className={cn('ui-kiosk-page-header', className)}>
      <div className="ui-kiosk-page-header-main">
        {onBack && (
          <button
            type="button"
            className="ui-kiosk-back-button"
            onClick={onBack}
            aria-label={backLabel}
          >
            <ArrowLeft aria-hidden="true" />
            <span className="ui-kiosk-back-label">{backLabel}</span>
          </button>
        )}
        {leading && <div className="ui-kiosk-page-header-leading">{leading}</div>}
        <div className="ui-kiosk-page-header-titles">
          <h1 id={headingId} className="ui-kiosk-page-header-title">
            {title}
          </h1>
          {description && (
            <p className="ui-kiosk-page-header-description">{description}</p>
          )}
        </div>
      </div>
      {aside && <div className="ui-kiosk-page-header-aside">{aside}</div>}
    </header>
  )
}
