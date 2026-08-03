import type { LucideIcon } from 'lucide-react'
import {
  CircleAlert,
  CircleCheck,
  Inbox,
  LoaderCircle,
  ShieldAlert,
  WifiOff,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type KioskStateTone =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'success'
  | 'permission'

export interface KioskStatePanelProps {
  tone: KioskStateTone
  title: string
  description?: string
  icon?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  compact?: boolean
  className?: string
}

const STATE_LIVE_REGIONS: Record<KioskStateTone, { role: 'status' | 'alert'; ariaLive: 'polite' | 'assertive' }> = {
  loading: { role: 'status', ariaLive: 'polite' },
  success: { role: 'status', ariaLive: 'polite' },
  empty: { role: 'status', ariaLive: 'polite' },
  error: { role: 'alert', ariaLive: 'assertive' },
  offline: { role: 'alert', ariaLive: 'assertive' },
  permission: { role: 'alert', ariaLive: 'assertive' },
}

const STATE_ICONS: Record<KioskStateTone, LucideIcon> = {
  loading: LoaderCircle,
  success: CircleCheck,
  empty: Inbox,
  error: CircleAlert,
  offline: WifiOff,
  permission: ShieldAlert,
}

export function KioskStatePanel({
  tone,
  title,
  description,
  icon,
  meta,
  actions,
  compact = false,
  className,
}: KioskStatePanelProps) {
  const liveRegion = STATE_LIVE_REGIONS[tone]
  const DefaultIcon = STATE_ICONS[tone]
  const defaultIcon = <DefaultIcon aria-hidden="true" />
  const resolvedIcon = icon ?? defaultIcon

  return (
    <section
      className={cn('ui-kiosk-state-panel', className)}
      data-tone={tone}
      data-compact={compact ? 'true' : undefined}
      role={liveRegion.role}
      aria-live={liveRegion.ariaLive}
      aria-busy={tone === 'loading'}
    >
      <div className="ui-kiosk-state-icon">{resolvedIcon}</div>
      <div className="ui-kiosk-state-copy">
        <h2 className="ui-kiosk-state-title">{title}</h2>
        {description && (
          <p className="ui-kiosk-state-description">{description}</p>
        )}
      </div>
      {meta && <div className="ui-kiosk-state-meta">{meta}</div>}
      {actions && <div className="ui-kiosk-state-actions">{actions}</div>}
    </section>
  )
}
