import type { ResumeContentBlock, ResumeIssue, ResumePriority, ResumeReport } from '@ai-job-print/shared'
import {
  blockLabel,
  derivedPriorities,
  DIM_ABOUT,
  dimLabel,
  displayResumeExcerpt,
  evidenceCountOfBlock,
  evidenceLineSet,
  issuesOfBlock,
  tierOf,
} from '../../resume-report-model'
import { ResumeReportStates } from './ResumeReportStates'

/** 一条问题卡：编号 + 问题 + 在哪一块 · 哪个维度 + 依据 / 影响 / 可以怎么改。 */
function IssueCard({ issue, index, blocks }: { issue: ResumeIssue; index: number; blocks: ResumeContentBlock[] }) {
  const quote = issue.evidence[0]?.quote
  const blockKey = issue.evidence[0]?.blockKey
  const where = blockKey ? blocks.find((block) => block.key === blockKey)?.label ?? blockLabel(blockKey) : null
  return (
    <article className="qxt-issue" data-testid="resume-report-issue">
      <b>{index} {issue.title}</b>
      <small>{where ? `${where} · ` : ''}{dimLabel(issue.dim)}</small>
      {quote ? <p><u>依据</u>「{displayResumeExcerpt(quote)}」</p> : null}
      <p><u>影响</u>{issue.impact}</p>
      <p><u>可以怎么改</u>{issue.fixIt}</p>
    </article>
  )
}

/** 报告里没有问题条目时，用「先改这几处」的优先项顶上（报告自带或按低分维度列出）。 */
function PriorityCard({ item, index }: { item: ResumePriority; index: number }) {
  return (
    <article className="qxt-issue" data-testid="resume-report-priority">
      <b>{index} {item.focus}</b>
      {item.reason ? <p>{item.reason}</p> : null}
    </article>
  )
}

/**
 * 诊断报告正文（稿 diagnosis）：左边六个维度，右边先改这几处（最多 3 条），
 * 下面是全部问题、报告结论、内容结构（收起），带走与去向由页面另放。
 * 数字、依据、影响、可以怎么改都从本次报告读；没有的栏不画，不拿通用建议顶替。
 */
export function ResumeReportBody({
  report,
  issues,
}: {
  report: ResumeReport
  issues: ResumeIssue[]
}) {
  const blocks = report.contentBlocks ?? []
  const priorities = (report.priorities?.length ? report.priorities : derivedPriorities(report.sections)).slice(0, 3)
  const top = issues.slice(0, 3)
  const rest = issues.slice(3)
  const riskNotes = report.riskNotes ?? []
  const hasConclusions = report.suggestions.length > 0 || riskNotes.length > 0 || (report.priorities?.length ?? 0) > 0
  // 右栏摆不满三张卡时，用报告里本来就有的「报告结论」补进右栏并默认展开，不让问题卡被拉长去凑左栏的高度（走查 I-19）。
  // 三张摆满时仍是稿里的样子：结论收在下面。
  const shownCards = top.length > 0 ? top.length : priorities.length
  const conclusionsInColumn = hasConclusions && shownCards < 3
  const conclusions = hasConclusions ? (
    <details className="qxt-all" open={conclusionsInColumn || undefined} data-testid="resume-report-conclusions">
      <summary>报告结论（建议 {report.suggestions.length} · 风险提醒 {riskNotes.length}）</summary>
      {report.suggestions.length > 0 ? (
        <>
          <p><u>可执行建议</u></p>
          <ol className="qxt-list">{report.suggestions.map((tip) => <li key={tip}>{tip}</li>)}</ol>
        </>
      ) : null}
      {riskNotes.length > 0 ? (
        <>
          <p><u>表达风险提醒</u></p>
          <ol className="qxt-list">{riskNotes.map((note) => <li key={note}>{note}</li>)}</ol>
        </>
      ) : null}
      <p>建议只针对简历表达，不涉及录用、面试或投递结果，也不会发给任何企业。</p>
    </details>
  ) : null

  return (
    <>
      <div className="qxt-rep">
        {report.sections.length > 0 ? (
          <section className="qxt-dims" aria-label="六个维度" data-testid="resume-report-dims">
            <div className="qxt-h">六个维度<small>这不是录取分 · 不求和</small></div>
            {report.sections.map((section) => {
              const tier = tierOf(section.score, section.maxScore)
              const ratio = section.maxScore > 0 ? section.score / section.maxScore : 0
              const about = section.key in DIM_ABOUT ? DIM_ABOUT[section.key as keyof typeof DIM_ABOUT] : ''
              return (
                <div key={section.key} className="qxt-dim" data-tone={tier.tone} data-testid={`resume-report-dim-${section.key}`}>
                  <span><b>{section.label || dimLabel(section.key)}</b><small>{about}</small></span>
                  <em>{section.score} · {tier.word}</em>
                  <i
                    role="progressbar"
                    aria-label={`${section.label || dimLabel(section.key)}得分`}
                    aria-valuemin={0}
                    aria-valuemax={section.maxScore}
                    aria-valuenow={section.score}
                    style={{ ['--p' as string]: String(ratio) }}
                  />
                </div>
              )
            })}
          </section>
        ) : null}
        <section className="qxt-prios" aria-label="先改这几处" data-testid="resume-report-priorities" data-roomy={conclusionsInColumn || undefined}>
          <div className="qxt-h">先改这几处<small>最多 3 条{issues.length === 0 && (report.priorities?.length ?? 0) === 0 ? ' · 按低分维度列出' : ''}</small></div>
          {top.length > 0
            ? top.map((issue, i) => <IssueCard key={issue.id} issue={issue} index={i + 1} blocks={blocks} />)
            : priorities.map((item, i) => <PriorityCard key={`${item.focus}-${i}`} item={item} index={i + 1} />)}
          {top.length === 0 && priorities.length === 0 ? <p className="qxt-none">这份报告没有给出需要先改的条目。</p> : null}
          {conclusionsInColumn ? conclusions : null}
        </section>
      </div>

      {issues.length > 0 ? (
        <details className="qxt-all" open={rest.length > 0} data-testid="resume-report-all-issues">
          <summary>全部问题（{issues.length}）</summary>
          <p>{top.map((issue, i) => `${i + 1} ${issue.title}`).join(' · ')}{rest.length > 0 ? ' · 上面三张' : ''}</p>
          {rest.map((issue, i) => <IssueCard key={issue.id} issue={issue} index={i + 4} blocks={blocks} />)}
        </details>
      ) : null}

      {conclusionsInColumn ? null : conclusions}

      {blocks.length > 0 ? (
        <details className="qxt-all" data-testid="resume-report-structure">
          <summary>简历内容结构（{blocks.length} 块）</summary>
          {blocks.map((block) => {
            const hits = issuesOfBlock(issues, block.key)
            const evidence = evidenceCountOfBlock(issues, block.key)
            const marks = evidenceLineSet(issues, block.key)
            return (
              <section key={block.key} className="qxt-block-row" data-testid={`resume-report-block-${block.key}`}>
                <b>{block.label}<small>{hits.length > 0 ? `命中 ${hits.length} 条问题 · ${evidence} 条证据` : '本块没有命中问题'}</small></b>
                {block.lines.length > 0
                  ? block.lines.map((line, i) => <p key={i} data-ev={marks.has(i) ? '1' : '0'}><i>{i + 1}</i> {displayResumeExcerpt(line)}</p>)
                  : <p>这一块在原文里是空的。</p>}
              </section>
            )
          })}
        </details>
      ) : null}
    </>
  )
}

export function EmptyReportBody() {
  return <ResumeReportStates viewState="report-empty" />
}
