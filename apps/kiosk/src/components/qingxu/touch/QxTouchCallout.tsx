import type { ReactNode } from 'react'
import { QxTouchIcon, type QxTouchIconName } from './QxTouchIcon'

export type QxTouchCalloutKind = 'remind' | 'howto' | 'fine'

export function QxTouchCallout({
  kind,
  children,
  icon,
}: {
  kind: QxTouchCalloutKind
  children: ReactNode
  icon?: QxTouchIconName
}) {
  if (kind === 'fine') return <p className="qxt-fine">{children}</p>
  const name = icon ?? (kind === 'remind' ? 'call' : 'file')
  return (
    <div className={kind === 'remind' ? 'qxt-remind' : 'qxt-howto'}>
      <QxTouchIcon name={name} size={34} strokeWidth={2} />
      <span>{children}</span>
    </div>
  )
}
