import type { JobFitDecisionSupport, JobFitResponse } from '@ai-job-print/shared'
import { Ghosts, Sec } from './jobFitQxKit'

interface FitSkillMapProps {
  matchPoints: NonNullable<JobFitResponse['matchPoints']>
  keywordCoverage?: JobFitDecisionSupport['keywordCoverage']
}

/**
 * 结果明细 —— 稿 46 结果屏的 evi 两栏。
 *
 * 服务端没有逐条返回时画的是虚线槽位「等待服务端逐条返回」，不是骨架假内容：
 * 每条优势都必须带简历原文依据，没有依据就不该有那一条。
 */
export function FitSkillMap({ matchPoints, keywordCoverage }: FitSkillMapProps) {
  const hasKeywords = Boolean(keywordCoverage && (keywordCoverage.matched.length > 0 || keywordCoverage.missing.length > 0))

  return (
    <Sec title="结果明细" hint="服务端逐条返回后填入" grow>
      {matchPoints.length > 0 ? (
        <div className="jfq-ev-stack">
          {matchPoints.map((point, index) => (
            <div key={`${point.point.slice(0, 24)}-${index}`} className="jfq-ev-item">
              <p>{point.point}</p>
              <span>原文依据：{'"'}{point.evidence}{'"'}</span>
            </div>
          ))}
        </div>
      ) : (
        <Ghosts items={[{
          title: '可以直接讲的优势',
          // 结果已完成，空数组代表这次没给出，不是还在等待返回。
          desc: '这次返回里没有可直接引用的匹配点。',
          tag: '本次未提供',
        }]} />
      )}

      {hasKeywords && keywordCoverage && (
        <div className="jfq-kw-row">
          <span className="jfq-kw-label">关键词覆盖</span>
          {keywordCoverage.matched.map((kw) => (
            <span key={`m-${kw}`} className="jfq-kw" data-tone="ok">已具备 · {kw}</span>
          ))}
          {keywordCoverage.missing.map((kw) => (
            <span key={`g-${kw}`} className="jfq-kw" data-tone="warn">待补足 · {kw}</span>
          ))}
        </div>
      )}
    </Sec>
  )
}
