import type { JobFitResponse } from '@ai-job-print/shared'
import { TrendingUpIcon } from 'lucide-react'

interface GapActionCardsProps {
  gapPoints: NonNullable<JobFitResponse['gapPoints']>
}

/** 差距与准备建议 — 对齐原型屏55 a-wheat card */
export function GapActionCards({ gapPoints }: GapActionCardsProps) {
  if (gapPoints.length === 0) return null
  return (
    <section className="job-fit-card job-fit-gap-actions jf-section jf-section--wheat" aria-label="差距与准备建议">
      <div className="jf-card-head">
        <span className="jf-card-icon" aria-hidden="true"><TrendingUpIcon /></span>
        <div>
          <h2>差距与准备建议</h2>
        </div>
      </div>
      <div className="jf-ev-stack">
        {gapPoints.map((point, index) => (
          <div key={`${point.gap.slice(0, 24)}-${index}`} className="jf-ev-item jf-ev-item--gap">
            <p>{point.gap}</p>
            <span>{point.suggestion}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
