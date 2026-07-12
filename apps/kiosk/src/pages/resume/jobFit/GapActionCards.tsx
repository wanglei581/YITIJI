import type { JobFitResponse } from '@ai-job-print/shared'
import { TrendingUpIcon } from 'lucide-react'

interface GapActionCardsProps {
  gapPoints: NonNullable<JobFitResponse['gapPoints']>
}

/** 只显示服务端已给出的差距与准备建议，不扩写学习路径或承诺。 */
export function GapActionCards({ gapPoints }: GapActionCardsProps) {
  if (gapPoints.length === 0) return null
  return (
    <section className="job-fit-card job-fit-gap-actions rounded-2xl border border-neutral-100 bg-white p-5" aria-label="差距与准备建议">
      <div className="mb-3 flex items-center gap-2">
        <TrendingUpIcon className="h-4 w-4 text-warning-fg" aria-hidden="true" />
        <h2 className="text-base font-semibold text-neutral-900">差距与准备建议</h2>
      </div>
      <div className="flex flex-col gap-2.5">
        {gapPoints.map((point, index) => (
          <div key={`${point.gap.slice(0, 24)}-${index}`} className="rounded-xl bg-warning-bg/60 px-4 py-3">
            <p className="text-sm font-medium text-neutral-900">{point.gap}</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">{point.suggestion}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
