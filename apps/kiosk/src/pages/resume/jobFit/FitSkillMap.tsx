import type { JobFitDecisionSupport, JobFitResponse } from '@ai-job-print/shared'
import '../touch/resume-fit.css'

interface FitSkillMapProps {
  matchPoints: NonNullable<JobFitResponse['matchPoints']>
  gapPoints: NonNullable<JobFitResponse['gapPoints']>
  keywordCoverage?: JobFitDecisionSupport['keywordCoverage']
}

/**
 * 结果明细 —— 稿 jobfit-result：每条一行，「已经写到 · 岗位要求」带简历原文依据，「还没体现 · 岗位要求」写缺什么。
 *
 * 2026-09-26（next-tasks 3.14）起简历对照不分档，这些行就是结果本身；两组的读屏名与服务端打印报告一致
 * （「简历里已经写到的要求 / 简历里还没体现的要求」）。只写缺什么，怎么补留在行动清单页。
 * 每条优势都必须带简历原文依据，没有依据就不该有那一条；服务端这次没给出时写「本次未提供」，
 * 不拿骨架假内容占位。
 */
export function FitSkillMap({ matchPoints, gapPoints, keywordCoverage }: FitSkillMapProps) {
  const hasKeywords = Boolean(keywordCoverage && (keywordCoverage.matched.length > 0 || keywordCoverage.missing.length > 0))

  return (
    <div className="rtp-fit">
      <section className="rtp-fit-group" aria-label="简历里已经写到的要求">
        {matchPoints.length > 0 ? (
          matchPoints.map((point, index) => (
            <div key={`${point.point.slice(0, 24)}-${index}`} className="rtp-fit-row" data-tone="ok">
              <b><i>已经写到</i> · {point.requirement || point.point}</b>
              {point.requirement ? <span>{point.point}</span> : null}
              <small>依据：{'"'}{point.evidence}{'"'}</small>
            </div>
          ))
        ) : (
          // 结果已完成，空数组代表这次没给出，不是还在等待返回。
          <div className="rtp-fit-row" data-tone="none"><b>可以直接讲的优势</b><span>这次返回里没有可直接引用的匹配点。</span><small>本次未提供</small></div>
        )}
      </section>
      <section className="rtp-fit-group" aria-label="简历里还没体现的要求">
        {gapPoints.length > 0 ? (
          gapPoints.map((point, index) => (
            <div key={`${point.gap.slice(0, 24)}-${index}`} className="rtp-fit-row" data-tone="warn">
              <b><i>还没体现</i> · {point.requirement || point.gap}</b>
              {point.requirement ? <span>{point.gap}</span> : null}
            </div>
          ))
        ) : (
          <div className="rtp-fit-row" data-tone="none"><b>还没体现的要求</b><span>这次返回里没有列出差距。</span><small>本次未提供</small></div>
        )}
      </section>

      {hasKeywords && keywordCoverage && (
        <div className="rtp-fit-kw">
          <span>关键词覆盖</span>
          {keywordCoverage.matched.map((kw) => (
            <span key={`m-${kw}`} className="rtp-fit-chip" data-tone="ok">已具备 · {kw}</span>
          ))}
          {keywordCoverage.missing.map((kw) => (
            <span key={`g-${kw}`} className="rtp-fit-chip" data-tone="warn">待补足 · {kw}</span>
          ))}
        </div>
      )}
    </div>
  )
}
