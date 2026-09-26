import type { JobFitDecisionSupport, JobFitResponse } from '@ai-job-print/shared'
import { AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react'
import { Sec } from './jobFitQxKit'

interface FitSkillMapProps {
  matchPoints: NonNullable<JobFitResponse['matchPoints']>
  gapPoints: NonNullable<JobFitResponse['gapPoints']>
  keywordCoverage?: JobFitDecisionSupport['keywordCoverage']
}

/**
 * 结果明细 —— 稿 46 结果屏的 evi 两栏：左栏写到的要求，右栏还没体现的要求。
 *
 * 2026-09-26（next-tasks 3.14）起简历对照不分档，这两栏就是结果本身；栏名与服务端打印报告
 * 一致（「简历里已经写到的要求 / 简历里还没体现的要求」）。右栏只写缺什么，怎么补留在行动清单页。
 * 每条优势都必须带简历原文依据，没有依据就不该有那一条；服务端这次没给出时写「本次未提供」，
 * 不拿骨架假内容占位。
 */
export function FitSkillMap({ matchPoints, gapPoints, keywordCoverage }: FitSkillMapProps) {
  const hasKeywords = Boolean(keywordCoverage && (keywordCoverage.matched.length > 0 || keywordCoverage.missing.length > 0))

  return (
    <Sec title="结果明细" hint="服务端逐条返回后填入" grow>
      <div className="jfq-evi">
        <section className="jfq-evi-col" aria-label="简历里已经写到的要求">
          <div className="jfq-evi-h">
            <span className="jfq-evi-ic" aria-hidden="true"><CheckCircle2Icon size={22} /></span>
            <b>简历里已经写到的要求</b>
          </div>
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
            // 结果已完成，空数组代表这次没给出，不是还在等待返回。
            <div className="jfq-ghost"><b>可以直接讲的优势</b><p>这次返回里没有可直接引用的匹配点。</p><span>本次未提供</span></div>
          )}
        </section>
        <section className="jfq-evi-col" data-tone="warn" aria-label="简历里还没体现的要求">
          <div className="jfq-evi-h">
            <span className="jfq-evi-ic" aria-hidden="true"><AlertTriangleIcon size={22} /></span>
            <b>简历里还没体现的要求</b>
          </div>
          {gapPoints.length > 0 ? (
            <div className="jfq-ev-stack">
              {gapPoints.map((point, index) => (
                <div key={`${point.gap.slice(0, 24)}-${index}`} className="jfq-ev-item" data-tone="warn">
                  <p>{point.gap}</p>
                  {point.requirement ? <span>对应要求：{point.requirement}</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="jfq-ghost"><b>还没体现的要求</b><p>这次返回里没有列出差距。</p><span>本次未提供</span></div>
          )}
        </section>
      </div>

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
