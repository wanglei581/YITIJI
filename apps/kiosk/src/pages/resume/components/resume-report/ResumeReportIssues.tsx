import type { ResumeContentBlock, ResumeIssue, ResumeReport, ResumeContentBlockKey, ResumeScoringDimensionKey } from '@ai-job-print/shared'
import { RESUME_CONTENT_BLOCKS } from '@ai-job-print/shared'
import { blockLabel, dimLabel, evidenceLineSet, issuesOfBlock, sevOf } from '../../resume-report-model'

function Prov({ kind }: { kind: 'contract' | 'derived' | 'fixture' }) {
  const label = kind === 'contract' ? '合同' : kind === 'derived' ? '本页算' : '夹具'
  return <span className="rrp-prov" data-p={kind}>{label}</span>
}

export function IssueCard({
  issue,
  index,
  sections,
  onDim,
}: {
  issue: ResumeIssue
  index: number
  sections: ResumeReport['sections']
  onDim: (dim: ResumeScoringDimensionKey) => void
}) {
  const sev = sevOf(sections, issue.dim)
  return (
    <article className="rrp-iss" data-issue={issue.id} data-dim={issue.dim} data-sev={sev.key} data-testid={`resume-report-issue-${issue.id}`}>
      <div className="rrp-ihd">
        <span className="no">{index + 1}</span>
        <b>{issue.title}</b>
        <span className="rrp-sev" data-s={sev.key}>{sev.word}</span>
        <button type="button" className="rrp-dimlink" onClick={() => onDim(issue.dim)} data-testid={`resume-report-issue-dim-${issue.id}`}>
          {dimLabel(issue.dim)}
        </button>
      </div>
      <div className="rrp-evs" data-testid={`resume-report-evidence-${issue.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
        {issue.evidence.map((ev, i) => (
          <span key={`${ev.blockKey}-${ev.lineIndex}-${i}`} className="rrp-ev">
            <span className="evsrc">{blockLabel(ev.blockKey)} 第 {ev.lineIndex + 1} 行原文</span>
            <span className="evtx">{ev.quote}</span>
          </span>
        ))}
      </div>
      <div className="rrp-why2">
        <span><u>影响</u>{issue.impact}</span>
        <span><u>可以怎么改</u>{issue.fixIt}</span>
      </div>
    </article>
  )
}

export function StructureZone({
  blocks,
  issues,
  activeBlk,
  fixture,
}: {
  blocks: ResumeContentBlock[]
  issues: ResumeIssue[]
  activeBlk: ResumeContentBlockKey | null
  fixture: boolean
}) {
  const shown = RESUME_CONTENT_BLOCKS.map((meta) => blocks.find((b) => b.key === meta.key)).filter((b): b is ResumeContentBlock => Boolean(b))
  return (
    <section className="rrp-zone" data-testid="resume-report-zone" data-zone="structure">
      <div className="rrp-zh">
        简历被读成了这七块
        <span>共 {shown.length} 块 · 命中 {issues.length} 条问题 <Prov kind={fixture ? 'fixture' : 'contract'} /></span>
      </div>
      <div className="rrp-scroll" data-testid="resume-report-list">
        {shown.map((block, i) => {
          const hit = issuesOfBlock(issues, block.key)
          const marks = evidenceLineSet(issues, block.key)
          return (
            <div key={block.key} className="rrp-blk" data-on={activeBlk === block.key ? '1' : '0'} data-block={block.key} data-testid={`resume-report-block-${block.key}`}>
              <span className="bno">{i + 1}</span>
              <span className="btx">
                <span className="bhd" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <b>{block.label}</b>
                  <span className="rrp-tag" data-hit={hit.length ? '1' : '0'}>
                    {hit.length ? `命中 ${hit.length} 条问题` : '本块没有命中问题'}
                  </span>
                </span>
                <span className="lines">
                  {block.lines.map((line, j) => (
                    <span key={j} data-ev={marks.has(j) ? '1' : '0'}><i>{j + 1}</i> {line}</span>
                  ))}
                </span>
              </span>
            </div>
          )
        })}
      </div>
      <p className="rrp-zfoot">
        {fixture
          ? '这一块的内容结构与原文片段是本页合成样本：夹具门打开时用来核对版式，不是你的简历。'
          : '片段逐字摘自送模型的那份简历文本（已遮盖联系方式）。一行都没留下的块不会出现。'}
      </p>
    </section>
  )
}

export function IssuesZone({
  issues,
  sections,
  fixture,
  onDim,
}: {
  issues: ResumeIssue[]
  sections: ResumeReport['sections']
  fixture: boolean
  onDim: (dim: ResumeScoringDimensionKey) => void
}) {
  const cnt = { high: 0, mid: 0, low: 0 }
  for (const issue of issues) cnt[sevOf(sections, issue.dim).key] += 1
  return (
    <section className="rrp-zone" data-testid="resume-report-zone" data-zone="issues" data-sev-high={cnt.high} data-sev-mid={cnt.mid} data-sev-low={cnt.low}>
      <div className="rrp-zh">
        每条问题都指到原文那一句
        <span>高 {cnt.high} · 中 {cnt.mid} · 低 {cnt.low} <Prov kind="derived" /></span>
      </div>
      <div className="rrp-scroll" data-testid="resume-report-list">
        {issues.map((issue, i) => (
          <IssueCard key={issue.id} issue={issue} index={i} sections={sections} onDim={onDim} />
        ))}
      </div>
      <p className="rrp-zfoot">
        维度名来自六个固定评分维度；严重度由该维分数机械分档（不足一半＝高）。
        {fixture ? ' 标题、原文、影响与改法是夹具样本。' : ' 原文引用、影响与改法来自服务端问题清单。'}
      </p>
    </section>
  )
}
