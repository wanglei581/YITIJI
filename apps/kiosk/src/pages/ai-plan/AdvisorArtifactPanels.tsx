import type { ReactNode } from 'react'
import { AdvisorKinds, AdvisorTake } from './AdvisorTakeaway'
import {
  LEGEND,
  VERDICT_LABEL,
  type AdvisorArtifactPayload,
  type ArtifactViewState,
  type CompareReportPayload,
  type QaPinsPayload,
  type SlotDraftPayload,
} from './advisorArtifactModel'

function Mark({ children }: { children: ReactNode }) {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export function AdvisorHero({
  heroBefore,
  heroEm,
  heroAfter,
  sub,
}: {
  heroBefore: string
  heroEm: string
  heroAfter: string
  sub: string
}) {
  return (
    <section className="aa-hero">
      <span className="aa-avatar" aria-hidden="true">青</span>
      <span>
        <span className="aa-hero-kicker">小青的作业</span>
        <p className="aa-hero-q">
          {heroBefore}
          <em>{heroEm}</em>
          {heroAfter}
        </p>
        <p className="aa-hero-sub">{sub}</p>
      </span>
    </section>
  )
}

export function EvidenceLegend() {
  return (
    <section className="aa-legend" data-testid="advisor-artifact-legend" aria-label="证据分级图例">
      {LEGEND.map((item) => (
        <span className="aa-lg" data-e={item.level} key={item.level}>
          <b>{item.level}</b>
          {item.text}
        </span>
      ))}
    </section>
  )
}

function SectionHead({
  n,
  title,
  hint,
  stale,
  reread,
}: {
  n: string
  title: string
  hint?: string
  stale?: boolean
  reread?: ReactNode
}) {
  return (
    <div className="aa-sec-h">
      <span className="aa-sec-n">{n}</span>
      <span className="aa-sec-t">{title}</span>
      <span className="aa-sec-side">
        {stale ? <span className="aa-stale">刚才没读到最新的，先显示带过来的内容</span> : null}
        {hint ? <span className="aa-sec-hint">{hint}</span> : null}
        {stale ? reread : null}
      </span>
    </div>
  )
}

export function QaPinsPanel({
  payload,
  stale,
  reread,
}: {
  payload: QaPinsPayload
  stale?: boolean
  reread?: ReactNode
}) {
  return (
    <section className="aa-sec" data-testid="advisor-artifact-qa">
      <SectionHead n="01" title="你钉住的条目" hint={`共 ${payload.pins.length} 条 · 对话未保存`} stale={stale} reread={reread} />
      <div className="aa-scroll">
        {payload.pins.map((pin, index) => (
          <div className="aa-pin" data-e={pin.evidenceLevel} key={`${pin.evidenceLevel}-${index}`}>
            <span className="aa-pin-e">{pin.evidenceLevel}</span>
            <span>
              <p className="aa-pin-c">{pin.content}</p>
              {pin.sourceNote ? <p className="aa-pin-s">{pin.sourceNote}</p> : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function SlotDraftPanel({
  payload,
  stale,
  reread,
}: {
  payload: SlotDraftPayload
  stale?: boolean
  reread?: ReactNode
}) {
  return (
    <section className="aa-sec" data-testid="advisor-artifact-slot">
      <SectionHead n="01" title="拼出来的这段话" hint="全部来自你自己说过的话" stale={stale} reread={reread} />
      <div className="aa-scroll">
        <p className="aa-draft">{payload.draft}</p>
        {payload.blanks.length > 0 ? (
          <div className="aa-blanks">
            <p className="aa-blanks-t">还有 {payload.blanks.length} 处你没答，我留了空</p>
            <p className="aa-blanks-l">{payload.blanks.map((item) => `· ${item}`).join('\n')}</p>
          </div>
        ) : null}
        <div className="aa-based">
          <p className="aa-based-t">这段话依据的原话（打印时一并带出）</p>
          {payload.basedOn.map((item) => (
            <div className="aa-based-i" key={item.slotKey}>
              <span className="aa-based-k">{item.prompt}</span>
              <span className="aa-based-v">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function ComparePanel({
  payload,
  stale,
  reread,
}: {
  payload: CompareReportPayload
  stale?: boolean
  reread?: ReactNode
}) {
  const missing = payload.items.filter((item) => item.verdict === 'missing').length
  const hint = missing > 0
    ? `${payload.items.length} 条要求 · ${missing} 条没写到`
    : `${payload.items.length} 条要求 · 都写到了`
  return (
    <section className="aa-sec" data-testid="advisor-artifact-compare">
      <SectionHead n="01" title="逐条比对" hint={hint} stale={stale} reread={reread} />
      <div className="aa-scroll">
        {payload.items.map((item, index) => (
          <div className="aa-cmp" data-v={item.verdict} key={`${item.verdict}-${index}`}>
            <span className="aa-cmp-v">{VERDICT_LABEL[item.verdict]}</span>
            <span>
              <p className="aa-cmp-r">{item.requirement}</p>
              {item.verdict === 'covered' ? (
                <blockquote className="aa-quote" data-testid="advisor-artifact-quote">
                  「{item.evidence}」
                </blockquote>
              ) : (
                <p className="aa-cmp-e">{item.evidence}</p>
              )}
            </span>
          </div>
        ))}
        {payload.extras.length > 0 ? (
          <div className="aa-extras">
            <p className="aa-extras-t">你材料里有、你写下的要求里没写的</p>
            <p className="aa-extras-l">
              {payload.extras.map((item) => `· ${item.point}${item.note ? `（${item.note}）` : ''}`).join('\n')}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function StateIcon({ state }: { state: ArtifactViewState }) {
  if (state === 'expired') {
    return (
      <Mark>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </Mark>
    )
  }
  if (state === 'error') {
    return (
      <Mark>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </Mark>
    )
  }
  return (
    <Mark>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Mark>
  )
}

export function ArtifactStatePanel({
  state,
  reread,
}: {
  state: ArtifactViewState
  reread?: ReactNode
}) {
  if (state === 'loading') {
    return (
      <section className="aa-sec aa-state" data-tone="info" data-testid="advisor-artifact-loading">
        <span className="aa-state-ic"><StateIcon state={state} /></span>
        <span className="aa-state-tx">
          <p className="aa-state-t">正在读取这一趟的产物</p>
          <p className="aa-state-d">读到之前不会拿旧的或编的顶上。</p>
        </span>
      </section>
    )
  }
  if (state === 'error') {
    return (
      <section className="aa-sec aa-state" data-tone="error" data-testid="advisor-artifact-error">
        <span className="aa-state-ic"><StateIcon state={state} /></span>
        <span className="aa-state-tx">
          <p className="aa-state-t">产物这次没读到</p>
          <p className="aa-state-d">网络不稳，或这次没有把这一份带回来。可以再试一次，或回去问小青重做。</p>
          {reread}
        </span>
      </section>
    )
  }
  if (state === 'expired') {
    return (
      <section className="aa-sec aa-state" data-tone="warn" data-testid="advisor-artifact-expired">
        <span className="aa-state-ic"><StateIcon state={state} /></span>
        <span className="aa-state-tx">
          <p className="aa-state-t">产物已过留存期</p>
          <p className="aa-state-d">公共终端不长期保存个人材料。过期后这份作业的正文不再展示，也不能再从这里打印（已经生成的打印稿按文件的保存期限处理）；需要的话回去重做一次，很快。</p>
        </span>
      </section>
    )
  }
  return (
    <section className="aa-sec aa-state" data-tone="info" data-testid="advisor-artifact-empty">
      <span className="aa-state-ic"><StateIcon state={state} /></span>
      <span className="aa-state-tx">
        <p className="aa-state-t">这一页只显示刚做出来的产物</p>
        <p className="aa-state-d">小青的问答、填槽、比对做完之后，结果会回到这一页，能看也能打印。现在没有可显示的产物 —— 不会拿旧的或编的顶上。</p>
      </span>
    </section>
  )
}

function contentPanel(state: ArtifactViewState, payload: AdvisorArtifactPayload | null): 'qa' | 'slot' | 'compare' | null {
  if (payload?.kind === 'qa_pins' && (state === 'qa-pins' || state === 'print-unavailable')) return 'qa'
  if (payload?.kind === 'slot_draft' && (state === 'slot-draft' || state === 'slot-draft-blanks' || state === 'print-unavailable')) return 'slot'
  if (payload?.kind === 'compare_report' && (state === 'compare-report' || state === 'compare-all-covered' || state === 'print-unavailable')) return 'compare'
  return null
}

function showsGuide(state: ArtifactViewState): boolean {
  return state === 'no-artifact' || state === 'expired' || state === 'loading' || state === 'error'
}

export function ArtifactBody({
  state,
  payload,
  stale,
  reread,
}: {
  state: ArtifactViewState
  payload: AdvisorArtifactPayload | null
  stale?: boolean
  reread?: ReactNode
}) {
  const panel = contentPanel(state, payload)
  const headerReread = stale ? reread : null
  return (
    <>
      {panel === 'qa' && payload?.kind === 'qa_pins' ? <QaPinsPanel payload={payload} stale={stale} reread={headerReread} /> : null}
      {panel === 'slot' && payload?.kind === 'slot_draft' ? <SlotDraftPanel payload={payload} stale={stale} reread={headerReread} /> : null}
      {panel === 'compare' && payload?.kind === 'compare_report' ? <ComparePanel payload={payload} stale={stale} reread={headerReread} /> : null}
      {panel === null ? <ArtifactStatePanel state={state} reread={state === 'error' ? reread : null} /> : null}
      {showsGuide(state) ? <AdvisorKinds /> : null}
      <AdvisorTake state={state} payload={payload} />
    </>
  )
}
