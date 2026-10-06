import { useEffect, useRef, useState } from 'react'
import type { ResumeContentBlock, ResumeIssue, ResumeReport, ResumeContentBlockKey, ResumeScoringDimensionKey } from '@ai-job-print/shared'
import { RESUME_CONTENT_BLOCKS } from '@ai-job-print/shared'
import { blockLabel, dimLabel, displayResumeExcerpt, evidenceCountOfBlock, evidenceLineSet, issuesOfBlock, sevOf } from '../../resume-report-model'

function Prov({ kind }: { kind: 'contract' | 'derived' | 'fixture' }) {
  return <span className="rrp-prov" data-p={kind} aria-hidden="true" />
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
            <span className="evtx">{displayResumeExcerpt(ev.quote)}</span>
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

/** 整页滚动时，数底边还在可视区之下的内容块。带走区露出来之后不再附那一句。 */
function useStructureScrollHint(blockCount: number) {
  const zoneRef = useRef<HTMLElement>(null)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    const zone = zoneRef.current
    const root = zone?.closest('.qx-scroll')
    if (!zone || !(root instanceof HTMLElement) || blockCount === 0) return

    const read = () => {
      const rootBottom = root.getBoundingClientRect().bottom
      let hidden = 0
      zone.querySelectorAll<HTMLElement>('.rrp-blk').forEach((block) => {
        if (block.getBoundingClientRect().bottom > rootBottom + 1) hidden += 1
      })
      const takeaway = root.querySelector('[data-testid="resume-report-export-actions"]')
      const takeawayBelow = !takeaway || takeaway.getBoundingClientRect().top >= rootBottom - 1
      const next = hidden === 0
        ? null
        : takeawayBelow
          ? `· 下滑还有 ${hidden} 块，最下面可以带走报告`
          : `· 下滑还有 ${hidden} 块`
      setHint((prev) => (prev === next ? prev : next))
    }

    // 阈值跨过时回调；一次滑过整块时观察器可能不报，滚动事件补上。不是定时轮询。
    const observer = new IntersectionObserver(read, { root, threshold: [0, 0.25, 0.5, 0.75, 1] })
    zone.querySelectorAll('.rrp-blk').forEach((block) => observer.observe(block))
    const takeaway = root.querySelector('[data-testid="resume-report-export-actions"]')
    if (takeaway) observer.observe(takeaway)
    root.addEventListener('scroll', read, { passive: true })
    read()
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', read)
    }
  }, [blockCount])

  return { zoneRef, hint }
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
  const { zoneRef, hint } = useStructureScrollHint(shown.length)
  return (
    <section ref={zoneRef} className="rrp-zone" data-testid="resume-report-zone" data-zone="structure">
      <div className="rrp-zh">
        简历被读成了这 {shown.length} 块
        <span>
          共 {shown.length} 块 · 命中 {issues.length} 条问题 <Prov kind={fixture ? 'fixture' : 'contract'} />
          {hint ? <span className="rrp-more" data-testid="resume-report-scroll-hint">{` ${hint}`}</span> : null}
        </span>
      </div>
      <div className="rrp-scroll" data-testid="resume-report-list">
        {shown.map((block, i) => {
          const hit = issuesOfBlock(issues, block.key)
          const evidenceN = evidenceCountOfBlock(issues, block.key)
          const marks = evidenceLineSet(issues, block.key)
          return (
            <div key={block.key} className="rrp-blk" data-on={activeBlk === block.key ? '1' : '0'} data-block={block.key} data-testid={`resume-report-block-${block.key}`}>
              <span className="bno">{i + 1}</span>
              <span className="btx">
                <span className="bhd">
                  <b>{block.label}</b>
                  <span className="rrp-tag" data-hit={hit.length ? '1' : '0'}>
                    {hit.length ? `命中 ${hit.length} 条问题 · ${evidenceN} 条证据` : '本块没有命中问题'}
                  </span>
                </span>
                <span className="lines">
                  {block.lines.map((line, j) => (
                    <span key={j} data-ev={marks.has(j) ? '1' : '0'}><i>{j + 1}</i> {displayResumeExcerpt(line)}</span>
                  ))}
                </span>
              </span>
            </div>
          )
        })}
      </div>
      <p className="rrp-zfoot">
        {fixture
          ? '这里展示的是演示样本，不是你的简历原文。'
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
        {fixture ? ' 标题、原文、影响与改法是演示样本。' : ' 原文引用、影响与改法来自本次报告。'}
      </p>
    </section>
  )
}
