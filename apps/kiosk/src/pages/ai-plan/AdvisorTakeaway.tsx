// 稿 52：空态的「三种作业」，以及各态的「带走这一页」。纸样只是样子，不表示已经出纸。

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AdvisorArtifactPayload, ArtifactViewState } from './advisorArtifactModel'

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const KINDS = [
  {
    key: 'qa',
    title: '聊完保存要点',
    chip: '带走：本次要点单',
    text: '边问边聊，聊完点「保存本次要点」（要先登录）。对话本身不保存，小青把要点和待办整理成一页。',
    icon: (
      <Glyph>
        <path d="M12 17v5" />
        <path d="M9 10.8V4h6v6.8l3 3.2H6z" />
      </Glyph>
    ),
  },
  {
    key: 'slot',
    title: '她问，你答，拼成一段话',
    chip: '带走：成稿和它依据的原话',
    text: '小青按顺序问几个问题，你照实回答，最后拼成一段可以直接念的话；没答的地方留空，不替你编。',
    icon: (
      <Glyph>
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h7" />
        <path d="M17 15l2 2 3-4" />
      </Glyph>
    ),
  },
  {
    key: 'cmp',
    title: '逐条比：有没有写到',
    chip: '带走：逐条比对单',
    text: '把你自己写下的要求和你的材料逐条对照，只比有没有写到，不评价写得好不好。',
    icon: (
      <Glyph>
        <path d="M9 11l3 3 8-8" />
        <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
      </Glyph>
    ),
  },
] as const

export function AdvisorKinds() {
  return (
    <section className="aa-sec aa-kinds" data-testid="advisor-artifact-kinds">
      <div className="aa-sec-h">
        <span className="aa-sec-n">01</span>
        <span className="aa-sec-t">小青能帮你做的三种作业</span>
        <span className="aa-sec-hint">做完都会回到这一页</span>
      </div>
      {KINDS.map((kind) => (
        <div className="aa-kind" key={kind.key}>
          <span className="aa-kind-ic" data-k={kind.key}>{kind.icon}</span>
          <span className="aa-kind-tx">
            <span className="aa-kind-h"><b>{kind.title}</b><em>{kind.chip}</em></span>
            <span className="aa-kind-d">{kind.text}</span>
          </span>
        </div>
      ))}
    </section>
  )
}

type PaperKind = 'qa' | 'slot' | 'compare'

function paperKind(state: ArtifactViewState, payload: AdvisorArtifactPayload | null): PaperKind {
  if (payload?.kind === 'slot_draft' || state === 'slot-draft' || state === 'slot-draft-blanks') return 'slot'
  if (payload?.kind === 'compare_report' || state === 'compare-report' || state === 'compare-all-covered') return 'compare'
  return 'qa'
}

function Bar({ className }: { className?: string }) {
  return <span className={className ? `pp-l ${className}` : 'pp-l'} />
}

function PaperQa() {
  return (
    <span className="pp-body">
      <span className="pp-r" data-e="E1"><span className="pp-e" /><Bar /><Bar className="w6" /></span>
      <span className="pp-r" data-e="E2"><span className="pp-e" /><Bar /><Bar className="w8" /></span>
      <span className="pp-r" data-e="E3"><span className="pp-e" /><Bar /><Bar className="w7" /></span>
      <span className="pp-r" data-e="E1"><span className="pp-e" /><Bar className="w9" /></span>
    </span>
  )
}

function PaperSlot() {
  return (
    <span className="pp-body">
      <Bar /><Bar className="w9" /><Bar /><Bar className="w8" /><Bar className="w6" />
      <span className="pp-m pp-sub" />
      <span className="pp-r" data-e="E1"><span className="pp-e sm" /><Bar className="w8" /></span>
      <span className="pp-r" data-e="E1"><span className="pp-e sm" /><Bar className="w7" /></span>
      <span className="pp-r" data-e="E1"><span className="pp-e sm" /><Bar className="w9" /></span>
    </span>
  )
}

function PaperCompare() {
  return (
    <span className="pp-body">
      <span className="pp-r" data-v="ok"><span className="pp-e sm" /><Bar className="w8" /></span>
      <span className="pp-r" data-v="ok"><span className="pp-e sm" /><Bar className="w7" /></span>
      <span className="pp-r" data-v="miss"><span className="pp-e sm" /><Bar className="w9" /></span>
      <span className="pp-r" data-v="miss"><span className="pp-e sm" /><Bar className="w6" /></span>
      <span className="pp-r" data-v="na"><span className="pp-e sm" /><Bar className="w7" /></span>
    </span>
  )
}

const HAS_LINE: Record<PaperKind, string> = {
  qa: '打印稿上有：这里的每一条要点，每条后面附出处和 E1 / E2 / E3。E3 是 AI 的判断，说不说由你定。',
  slot: '打印稿上有：这段话、留空的地方，以及它依据的每一句原话。',
  compare: '打印稿上有：每条要求写没写到，写到的附你材料里的原文。',
}

function isContentTake(state: ArtifactViewState): boolean {
  return state === 'qa-pins' || state === 'slot-draft' || state === 'slot-draft-blanks'
    || state === 'compare-report' || state === 'compare-all-covered' || state === 'print-unavailable'
}

export function AdvisorTake({
  state,
  payload,
}: {
  state: ArtifactViewState
  payload: AdvisorArtifactPayload | null
}) {
  const kind = paperKind(state, payload)
  const contentTake = isContentTake(state)
  const showSteps = contentTake && state !== 'print-unavailable'
  return (
    <section className="aa-sec aa-take" data-testid="advisor-artifact-take">
      <div className="aa-paper" aria-hidden="true">
        <span className="pp-t" />
        <span className="pp-m" />
        {kind === 'slot' ? <PaperSlot /> : kind === 'compare' ? <PaperCompare /> : <PaperQa />}
        <span className="pp-f" />
      </div>
      <div className="aa-take-tx">
        <div className="aa-sec-h">
          <span className="aa-sec-n">02</span>
          <span className="aa-sec-t">{contentTake ? '带走这一页' : '做完以后怎么带走'}</span>
          <span className="aa-sec-hint">A4 打印稿</span>
        </div>
        {showSteps ? (
          <ol className="aa-steps">
            <li><b>1</b><span>点下面「打印带走」，生成一份 PDF 打印稿，直接进打印：先看预览和价格，确认了再出纸。</span></li>
            <li>
              <b>2</b>
              <span>登录的话，打印稿也会存进<Link className="aa-doc-link" to="/me/documents">我的文档</Link>，之后还能再打。</span>
            </li>
          </ol>
        ) : null}
        {!contentTake ? (
          <ol className="aa-steps">
            <li><b>1</b><span>作业做完会回到这一页，能看也能打印。</span></li>
            <li><b>2</b><span>点「打印带走」，生成一份 PDF 打印稿，直接进打印，看过预览和价格再出纸。</span></li>
            <li><b>3</b><span>登录的话，打印稿也会存进「我的文档」。</span></li>
          </ol>
        ) : null}
        {contentTake ? <p className="aa-has">{HAS_LINE[kind]}</p> : null}
        {state === 'print-unavailable' ? (
          <div className="aa-warn" data-testid="advisor-artifact-print-unavailable">
            <b>这台机器的打印暂时读不到</b>
            <p>正文照常可看，打印按钮先不放出来。等打印恢复后回到这里再打。</p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
