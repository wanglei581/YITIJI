import type { ReactNode } from 'react'

export type QxTouchChipTone = 'teal' | 'slate' | 'clay' | 'cin' | 'ghost'

export function QxTouchChip({
  children,
  tone = 'teal',
  ai = false,
}: {
  children: ReactNode
  tone?: QxTouchChipTone
  ai?: boolean
}) {
  return <span className={`qxt-chip qxt-chip-${tone}${ai ? ' qxt-chip-ai' : ''}`}>{children}</span>
}
