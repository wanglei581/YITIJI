import { ClockIcon, MessageSquareIcon, PrinterIcon } from 'lucide-react'
import {
  LEGEND,
  VERDICT_LABEL,
  type AdvisorArtifactPayload,
  type ArtifactViewState,
  type CompareReportPayload,
  type QaPinsPayload,
  type SlotDraftPayload,
} from './advisorArtifactModel'

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
        <span className="aa-hero-kicker">ADVISOR OUTPUT</span>
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

export function QaPinsPanel({ payload }: { payload: QaPinsPayload }) {
  return (
    <section className="aa-sec" data-testid="advisor-artifact-qa">
      <div className="aa-sec-h">
        <span className="aa-sec-n">01</span>
        <span className="aa-sec-t">你钉住的条目</span>
        <span className="aa-sec-hint">共 {payload.pins.length} 条 · 对话未保存</span>
      </div>
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

export function SlotDraftPanel({ payload }: { payload: SlotDraftPayload }) {
  return (
    <section className="aa-sec" data-testid="advisor-artifact-slot">
      <div className="aa-sec-h">
        <span className="aa-sec-n">01</span>
        <span className="aa-sec-t">拼出来的这段话</span>
        <span className="aa-sec-hint">全部来自你自己说过的话</span>
      </div>
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

export function ComparePanel({ payload }: { payload: CompareReportPayload }) {
  const missing = payload.items.filter((item) => item.verdict === 'missing').length
  const hint = missing > 0
    ? `${payload.items.length} 条要求 · ${missing} 条没写到`
    : `${payload.items.length} 条要求 · 都写到了`
  return (
    <section className="aa-sec" data-testid="advisor-artifact-compare">
      <div className="aa-sec-h">
        <span className="aa-sec-n">01</span>
        <span className="aa-sec-t">逐条比对</span>
        <span className="aa-sec-hint">{hint}</span>
      </div>
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
            <p className="aa-extras-t">你材料里有、岗位正文没提的</p>
            <p className="aa-extras-l">
              {payload.extras.map((item) => `· ${item.point}${item.note ? `（${item.note}）` : ''}`).join('\n')}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function ArtifactStatePanel({
  state,
  onRetry,
}: {
  state: ArtifactViewState
  onRetry?: () => void
}) {
  if (state === 'loading') {
    return (
      <section className="aa-sec aa-state" data-tone="info" data-testid="advisor-artifact-loading">
        <span className="aa-state-ic"><MessageSquareIcon size={56} aria-hidden /></span>
        <p className="aa-state-t">正在读取这一趟的产物</p>
        <p className="aa-state-d">读到之前不会拿旧的或编的顶上。</p>
      </section>
    )
  }
  if (state === 'error') {
    return (
      <section className="aa-sec aa-state" data-tone="error" data-testid="advisor-artifact-error">
        <span className="aa-state-ic"><MessageSquareIcon size={56} aria-hidden /></span>
        <p className="aa-state-t">产物这次没读到</p>
        <p className="aa-state-d">网络或服务端没有把这一份带回来。可以再试一次，或回去问小青重做。</p>
        {onRetry ? (
          <button type="button" className="qx-btn" data-variant="teal" onClick={onRetry}>再读一次</button>
        ) : null}
      </section>
    )
  }
  if (state === 'expired') {
    return (
      <section className="aa-sec aa-state" data-tone="warn" data-testid="advisor-artifact-expired">
        <span className="aa-state-ic"><ClockIcon size={56} aria-hidden /></span>
        <p className="aa-state-t">产物已过留存期</p>
        <p className="aa-state-d">公共终端不长期保存个人材料。过期后正文不再展示，也无法再打印；需要的话回去重做一次，很快。</p>
      </section>
    )
  }
  if (state === 'print-unavailable') {
    return (
      <section className="aa-sec aa-state" data-tone="warn" data-testid="advisor-artifact-print-unavailable">
        <span className="aa-state-ic"><PrinterIcon size={56} aria-hidden /></span>
        <p className="aa-state-t">读不到打印能力，先不放打印按钮</p>
        <p className="aa-state-d">这台机器的打印状态暂时确认不了。产物正文还在，可以先看；能力恢复后再打印，或者去问工作人员。</p>
      </section>
    )
  }
  return (
    <section className="aa-sec aa-state" data-tone="info" data-testid="advisor-artifact-empty">
      <span className="aa-state-ic"><MessageSquareIcon size={56} aria-hidden /></span>
      <p className="aa-state-t">这一页只显示刚做出来的产物</p>
      <p className="aa-state-d">小青的问答、填槽、比对做完之后，结果会回到这一页，能看也能打印。现在没有可显示的产物 —— 不会拿旧的或编的顶上。</p>
    </section>
  )
}

export function ArtifactBody({
  state,
  payload,
  onRetry,
}: {
  state: ArtifactViewState
  payload: AdvisorArtifactPayload | null
  onRetry?: () => void
}) {
  if (state === 'qa-pins' && payload?.kind === 'qa_pins') return <QaPinsPanel payload={payload} />
  if ((state === 'slot-draft' || state === 'slot-draft-blanks') && payload?.kind === 'slot_draft') {
    return <SlotDraftPanel payload={payload} />
  }
  if ((state === 'compare-report' || state === 'compare-all-covered') && payload?.kind === 'compare_report') {
    return <ComparePanel payload={payload} />
  }
  return <ArtifactStatePanel state={state} onRetry={onRetry} />
}
