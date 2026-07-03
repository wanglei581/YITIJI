import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ResumeLayoutSettings } from '@ai-job-print/shared'

export const DEFAULT_RESUME_LAYOUT: Required<ResumeLayoutSettings> = {
  fontScale: 'standard',
  lineSpacing: 'standard',
  margin: 'normal',
  columns: 1,
  accent: 'blue',
}

const accentColor: Record<Required<ResumeLayoutSettings>['accent'], string> = {
  blue: '#2563eb',
  green: '#047857',
  slate: '#475569',
}

export function useResumeLayout() {
  const [layout, setLayout] = useState<Required<ResumeLayoutSettings>>(DEFAULT_RESUME_LAYOUT)

  const previewStyle = useMemo<CSSProperties>(() => ({
    '--resume-accent': accentColor[layout.accent],
    '--resume-font-scale': layout.fontScale === 'compact' ? 0.92 : layout.fontScale === 'large' ? 1.08 : 1,
    '--resume-line-height': layout.lineSpacing === 'compact' ? 1.45 : layout.lineSpacing === 'relaxed' ? 1.78 : 1.62,
    '--resume-padding': layout.margin === 'narrow' ? '18px' : layout.margin === 'wide' ? '30px' : '24px',
  }) as CSSProperties, [layout])

  const previewClassName = layout.columns === 2
    ? 'md:[column-count:2] md:[column-gap:28px]'
    : ''

  const resetLayout = () => setLayout(DEFAULT_RESUME_LAYOUT)

  return { layout, setLayout, resetLayout, previewClassName, previewStyle }
}
