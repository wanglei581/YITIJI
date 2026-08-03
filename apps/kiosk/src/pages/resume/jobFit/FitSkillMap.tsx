import type { JobFitDecisionSupport, JobFitResponse } from '@ai-job-print/shared'
import { CheckCircle2Icon } from 'lucide-react'

interface FitSkillMapProps {
  matchPoints: NonNullable<JobFitResponse['matchPoints']>
  keywordCoverage?: JobFitDecisionSupport['keywordCoverage']
}

/** 匹配依据 + 关键词覆盖 — 对齐原型屏55 a-teal card */
export function FitSkillMap({ matchPoints, keywordCoverage }: FitSkillMapProps) {
  const hasKeywords = Boolean(keywordCoverage && (keywordCoverage.matched.length > 0 || keywordCoverage.missing.length > 0))
  if (matchPoints.length === 0 && !hasKeywords) return null

  return (
    <section className="job-fit-card job-fit-fit-map jf-section jf-section--teal" aria-label="岗位匹配依据">
      <div className="jf-card-head">
        <span className="jf-card-icon" aria-hidden="true"><CheckCircle2Icon /></span>
        <div>
          <h2>匹配依据</h2>
          <div className="jf-card-sub">每条结论均附简历原文依据</div>
        </div>
      </div>

      {matchPoints.length > 0 && (
        <div className="jf-ev-stack">
          {matchPoints.map((point, index) => (
            <div key={`${point.point.slice(0, 24)}-${index}`} className="jf-ev-item jf-ev-item--match">
              <p>{point.point}</p>
              <span>原文依据：{'"'}{point.evidence}{'"'}</span>
            </div>
          ))}
        </div>
      )}

      {hasKeywords && keywordCoverage && (
        <div className="jf-kw-row">
          <span className="jf-kw-label">关键词覆盖</span>
          {keywordCoverage.matched.map((kw) => (
            <span key={`m-${kw}`} className="jf-chip jf-chip--ok">已具备 · {kw}</span>
          ))}
          {keywordCoverage.missing.map((kw) => (
            <span key={`g-${kw}`} className="jf-chip jf-chip--warn">待补足 · {kw}</span>
          ))}
        </div>
      )}
    </section>
  )
}
