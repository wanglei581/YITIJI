import type { ResumeContentBlockKey, ResumeIssue, ResumeReport, ResumeScoringDimensionKey } from '@ai-job-print/shared'
import {
  conclusionCount,
  defaultSeg,
  derivedPriorities,
  quantHits,
  type ReportSeg,
} from '../../resume-report-model'
import { IssuesZone, StructureZone } from './ResumeReportIssues'
import { DimensionTalk, ScoresZone } from './ResumeReportScores'

function Prov({ kind }: { kind: 'contract' | 'derived' | 'fixture' }) {
  const label = kind === 'contract' ? '合同' : kind === 'derived' ? '本页算' : '夹具'
  return <span className="rrp-prov" data-p={kind}>{label}</span>
}

export function ResumeReportBody({
  report,
  issues,
  fixture,
  seg,
  dim,
  blk,
  onSeg,
  onDim,
}: {
  report: ResumeReport
  issues: ResumeIssue[]
  fixture: boolean
  seg: ReportSeg | null
  dim: ResumeScoringDimensionKey | null
  blk: ResumeContentBlockKey | null
  onSeg: (seg: ReportSeg) => void
  onDim: (dim: ResumeScoringDimensionKey) => void
}) {
  const blocks = report.contentBlocks ?? []
  const activeSeg = defaultSeg({ ...report, issues, contentBlocks: blocks }, seg)
  const hasStructure = blocks.length > 0
  const hasIssues = issues.length > 0
  const hasScores = report.sections.length > 0
  const conclN = conclusionCount(report)
  const priorities = (report.priorities?.length ? report.priorities : derivedPriorities(report.sections)).slice(0, 3)
  const prioritiesFromReport = (report.priorities?.length ?? 0) > 0
  const evidenceN = issues.reduce((n, issue) => n + issue.evidence.length, 0)

  return (
    <>
      <section className="rrp-score-note" data-testid="resume-report-not-admission">
        这不是录取分
        <span>六项各自打分，本页不求和、不换算百分比，也不代表录用、面试或投递结果。</span>
      </section>

      {priorities.length > 0 ? (
        <section className="rrp-pri" data-testid="resume-report-priorities">
          <div className="rrp-zh">先改这几处<span>{prioritiesFromReport ? '报告自带' : '按低分分项机械列出'} <Prov kind={prioritiesFromReport ? 'contract' : 'derived'} /></span></div>
          <ol>
            {priorities.map((item, i) => (
              <li key={`${item.focus}-${i}`}>
                <span className="no">{i + 1}</span>
                <span><b>{item.focus}</b>{item.reason ? ` ${item.reason}` : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <DimensionTalk sections={report.sections} />

      <section className="rrp-cbar" data-testid="resume-report-counts">
        <div className="rrp-cgrid">
          {[
            ['内容块', blocks.length, fixture ? 'fixture' : 'contract'],
            ['问题', issues.length, fixture ? 'fixture' : 'contract'],
            ['原文证据', evidenceN, fixture ? 'fixture' : 'contract'],
            ['量化命中', quantHits(blocks), 'derived'],
            ['评分维度', report.sections.length, 'contract'],
            ['结论条目', conclN, 'contract'],
          ].map(([label, count, prov]) => (
            <span key={String(label)} className="rrp-cc" data-zero={count ? '0' : '1'} data-prov={String(prov)}>
              <u>{label} <Prov kind={prov as 'contract' | 'derived' | 'fixture'} /></u>
              <b>{count as number}</b>
            </span>
          ))}
        </div>
        <p className="rrp-legend">合同＝服务端报告里就有；本页算＝由报告机械推出；夹具＝合成样本，只在夹具门内出现。</p>
      </section>

      <div className="rrp-segs" role="tablist" aria-label="报告主内容分区" data-testid="resume-report-segs">
        {([
          ['structure', '内容结构', blocks.length, hasStructure],
          ['issues', '问题证据', issues.length, hasIssues],
          ['scores', '六维分数', report.sections.length, hasScores],
          ['conclusions', '报告结论', conclN, conclN > 0],
        ] as const).map(([key, label, count, enabled]) => (
          <button
            key={key}
            type="button"
            className="rrp-seg"
            role="tab"
            aria-selected={activeSeg === key}
            aria-disabled={!enabled}
            data-testid={`resume-report-seg-${key}`}
            onClick={() => { if (enabled) onSeg(key) }}
          >
            {label}<em>{enabled ? count : '无'}</em>
          </button>
        ))}
      </div>

      {activeSeg === 'structure' && hasStructure ? (
        <StructureZone blocks={blocks} issues={issues} activeBlk={blk} fixture={fixture} />
      ) : null}
      {activeSeg === 'issues' && hasIssues ? (
        <IssuesZone issues={issues} sections={report.sections} fixture={fixture} onDim={onDim} />
      ) : null}
      {activeSeg === 'scores' && hasScores ? (
        <ScoresZone sections={report.sections} issues={issues} activeDim={dim} onDim={onDim} />
      ) : null}
      {activeSeg === 'conclusions' && conclN > 0 ? <ConclusionsZone report={report} /> : null}
    </>
  )
}

function ConclusionsZone({ report }: { report: ResumeReport }) {
  const hasP = (report.priorities?.length ?? 0) > 0
  const hasR = (report.riskNotes?.length ?? 0) > 0
  return (
    <section className="rrp-zone" data-testid="resume-report-zone" data-zone="conclusions">
      <div className="rrp-zh">
        报告自己给的三栏结论
        <span>先改 {report.priorities?.length ?? 0} · 建议 {report.suggestions.length} · 风险 {report.riskNotes?.length ?? 0}</span>
      </div>
      <div className="rrp-scroll" data-testid="resume-report-list">
        {hasP ? (
          <>
            <div className="rrp-subh">先改这几处</div>
            {report.priorities!.map((item, i) => (
              <div key={i} className="rrp-it" data-kind="pri"><span className="no">{i + 1}</span><span className="tx"><b>{item.focus}</b><p>{item.reason}</p></span></div>
            ))}
          </>
        ) : null}
        <div className="rrp-subh">可执行建议</div>
        {report.suggestions.map((tip, i) => (
          <div key={i} className="rrp-it" data-kind="sug"><span className="no">{i + 1}</span><span className="tx"><b>{tip}</b></span></div>
        ))}
        {hasR ? (
          <>
            <div className="rrp-subh">表达风险提醒</div>
            {report.riskNotes!.map((note, i) => (
              <div key={i} className="rrp-it" data-kind="risk"><span className="no">{i + 1}</span><span className="tx"><b>{note}</b></span></div>
            ))}
          </>
        ) : null}
      </div>
      <p className="rrp-zfoot">
        {hasP && hasR
          ? '三栏都按报告给出的顺序原样排列。建议只针对简历表达，不涉及录用、面试或投递结果，也不会发给任何企业。'
          : '这是一份早期报告：只有分数和建议，没有「先改这几处」「表达风险」两项字段 —— 这不是读取失败。'}
      </p>
    </section>
  )
}

export function EmptyReportBody() {
  return (
    <>
      <section className="rrp-state">
        <h2>报告回来了，但里面是空的</h2>
        <p>
          服务端确实返回了这份报告，只是六个维度、建议、优先级和风险提醒都是空的。
          常见原因是这次提取到的简历文字太少，不足以给出有依据的结论。
          这不是读取失败，也不是能力未接通。本页不会为了把版面填满而生成任何结论，也不出总分。
        </p>
      </section>
    </>
  )
}
