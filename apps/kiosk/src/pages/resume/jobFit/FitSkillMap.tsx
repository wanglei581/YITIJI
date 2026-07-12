import type { JobFitDecisionSupport, JobFitResponse } from '@ai-job-print/shared'
import { CheckCircle2Icon, TrendingUpIcon } from 'lucide-react'

interface FitSkillMapProps {
  matchPoints: NonNullable<JobFitResponse['matchPoints']>
  keywordCoverage?: JobFitDecisionSupport['keywordCoverage']
}

/** 展示现有匹配依据与可选关键词覆盖；旧缓存缺字段时完全省略该部分。 */
export function FitSkillMap({ matchPoints, keywordCoverage }: FitSkillMapProps) {
  const hasKeywords = Boolean(keywordCoverage && (keywordCoverage.matched.length > 0 || keywordCoverage.missing.length > 0))
  if (matchPoints.length === 0 && !hasKeywords) return null

  return (
    <section className="job-fit-card job-fit-fit-map rounded-2xl border border-neutral-100 bg-white p-5" aria-label="岗位匹配依据">
      <div className="mb-3 flex items-center gap-2">
        <CheckCircle2Icon className="h-4 w-4 text-success-fg" aria-hidden="true" />
        <h2 className="text-base font-semibold text-neutral-900">匹配依据</h2>
      </div>

      {matchPoints.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {matchPoints.map((point, index) => (
            <div key={`${point.point.slice(0, 24)}-${index}`} className="rounded-xl bg-success-bg/60 px-4 py-3">
              <p className="text-sm font-medium text-neutral-900">{point.point}</p>
              <p className="mt-1 text-xs text-neutral-500">原文依据：“{point.evidence}”</p>
            </div>
          ))}
        </div>
      )}

      {hasKeywords && keywordCoverage && (
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUpIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-neutral-800">关键词覆盖</h3>
          </div>
          {keywordCoverage.matched.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {keywordCoverage.matched.map((keyword) => (
                <span key={`matched-${keyword}`} className="rounded-md bg-success-bg px-2 py-1 text-xs text-success-fg">已具备 · {keyword}</span>
              ))}
            </div>
          )}
          {keywordCoverage.missing.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {keywordCoverage.missing.map((keyword) => (
                <span key={`missing-${keyword}`} className="rounded-md bg-warning-bg px-2 py-1 text-xs text-warning-fg">待补足 · {keyword}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
