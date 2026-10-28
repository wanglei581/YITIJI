import type { ReactNode } from 'react'

export type QxTouchChipTone = 'teal' | 'slate' | 'clay' | 'cin' | 'ghost'

export function QxTouchChip({
  children,
  tone = 'teal',
  ai = false,
  id,
}: {
  children: ReactNode
  tone?: QxTouchChipTone
  ai?: boolean
  id?: string
}) {
  return <span id={id} className={`qxt-chip qxt-chip-${tone}${ai ? ' qxt-chip-ai' : ''}`}>{children}</span>
}
