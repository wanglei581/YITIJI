import type { ResumeIssue, ResumeReport, ResumeScoringDimensionKey } from '@ai-job-print/shared'
import { DIM_ABOUT, TIER_RULE, dimLabel, sevOf, tierOf } from '../../resume-report-model'
import { IssueCard } from './ResumeReportIssues'

export function ScoresZone({
  sections,
  issues,
  activeDim,
  onDim,
}: {
  sections: ResumeReport['sections']
  issues: ResumeIssue[]
  activeDim: ResumeScoringDimensionKey | null
  onDim: (dim: ResumeScoringDimensionKey) => void
}) {
  const selected = sections.find((s) => s.key === activeDim)
  const mine = activeDim ? issues.filter((issue) => issue.dim === activeDim) : []
  return (
    <section className="rrp-zone" data-testid="resume-report-zone" data-zone="scores">
      <div className="rrp-zh">
        六个维度各自的分数
        <span>点任意一项看它在看什么</span>
      </div>
      <div data-testid="resume-report-dimensions" role="group" aria-label="六个诊断维度" style={{ display: 'grid', gap: 8 }}>
        {sections.map((section) => {
          const t = tierOf(section.score, section.maxScore)
          const pct = section.maxScore > 0 ? Math.round((section.score / section.maxScore) * 100) : 0
          const on = activeDim === section.key
          return (
            <button
              key={section.key}
              type="button"
              className="rrp-dim"
              data-dim={section.key}
              data-tone={t.tone}
              aria-pressed={on}
              data-testid={`resume-report-dim-${section.key}`}
              onClick={() => onDim(section.key as ResumeScoringDimensionKey)}
            >
              <span className="nm">{section.label}</span>
              <span className="rrp-track">
                <span
                  className="rrp-fill"
                  role="progressbar"
                  aria-label={`${section.label}得分`}
                  aria-valuenow={section.score}
                  aria-valuemin={0}
                  aria-valuemax={section.maxScore}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="tier">{t.word}</span>
              <span className="sc">{section.score}<u>/{section.maxScore}</u></span>
            </button>
          )
        })}
      </div>
      <div className="rrp-dd" data-testid="resume-report-dim-detail" data-dim-selected={activeDim ?? 'none'}>
        {selected ? (
          <>
            <b>{selected.label}</b>
            <p style={{ margin: '4px 0 0', fontSize: 18, color: 'var(--qx-ink-2)' }}>
              {DIM_ABOUT[selected.key as ResumeScoringDimensionKey] ?? ''}
              {mine.length
                ? ` 本维在「问题证据」里对应 ${mine.length} 条（${sevOf(sections, selected.key).word}）。`
                : ' 本维在「问题证据」里没有对应条目。'}
            </p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 18, color: 'var(--qx-ink-2)' }}>点上面任意一项，看它在看什么。六项各自打分、互不换算，只描述这份简历的表达。</p>
        )}
      </div>
      {activeDim && mine.length > 0 ? (
        <div className="rrp-scroll" data-testid="resume-report-dim-issues" style={{ marginTop: 10 }}>
          {mine.map((issue, i) => (
            <IssueCard key={issue.id} issue={issue} index={i} sections={sections} onDim={onDim} />
          ))}
        </div>
      ) : null}
      <p className="rrp-zfoot" data-testid="resume-report-tier-note">
        {TIER_RULE} 六项各自成立，本页不求和、不换算比例、不排名。
      </p>
    </section>
  )
}

export function DimensionTalk({ sections }: { sections: ResumeReport['sections'] }) {
  if (sections.length === 0) return null
  return (
    <section className="rrp-dimtalk" aria-label="每维一句人话">
      <div className="rrp-zh" style={{ marginBottom: 4 }}>每维一句人话<span>分数的人话读法，不是录用预测</span></div>
      <ul>
        {sections.map((section) => {
          const t = tierOf(section.score, section.maxScore)
          const about = DIM_ABOUT[section.key as ResumeScoringDimensionKey]
          return (
            <li key={section.key}>
              <b>{dimLabel(section.key)}：{t.word}。</b>
              {about ? ` ${about}` : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
