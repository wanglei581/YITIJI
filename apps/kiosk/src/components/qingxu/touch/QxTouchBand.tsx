import { Fragment, useId, type ReactNode } from 'react'
import { QxTouchClock } from './QxTouchClock'
import { QxTouchIcon } from './QxTouchIcon'
import { useQxTouchBack } from './useQxTouchBack'

export type QxTouchBandKind = 'std' | 'compact'
export type QxTouchSeal = 'idle' | 'listen' | 'think'
export type QxTouchStatus =
  | { text: string; tone?: 'ok' | 'warn' | 'unknown' | 'reading' }
  | false

export type QxTouchRail = { labels: readonly string[]; now: number }

function FlowLines({ id, live }: { id: string; live: boolean }) {
  return (
    <div className="qxt-flow" aria-hidden="true" data-live={live ? 'on' : 'off'}>
      {/* 横坐标收在 0–1200 里：线条两端本就淡出，伸出画框只会让越界门禁变红 */}
      <svg viewBox="0 0 1200 600" preserveAspectRatio="none">
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop offset="0" stopColor="var(--qx-emerald)" stopOpacity="0" />
            <stop offset="0.5" stopColor="var(--qx-emerald)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--qx-emerald)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 468 C 267 300, 514 588, 800 372 S 1114 180, 1200 264" fill="none" stroke={`url(#${id})`} strokeWidth="2.2" />
        <path d="M0 540 C 305 396, 552 636, 838 444 S 1124 276, 1200 348" fill="none" stroke={`url(#${id})`} strokeWidth="1.2" opacity="0.7" />
        <path d="M0 216 C 343 72, 629 300, 876 156 S 1143 12, 1200 84" fill="none" stroke={`url(#${id})`} strokeWidth="1" opacity="0.45" />
      </svg>
    </div>
  )
}

/**
 * 意图带。进度条 rail 与路径胶囊 path 只渲染一种；两者都传时只留 rail。
 * 印章只有 listen / think 才动。不传 status 时写「状态未知」，不假装就绪。
 * 只传 text 不传 tone 时是灰点；只有显式 tone: 'ok' 才亮绿。
 * 返回为真却没传 onBack 时，有站内历史就回退，否则回首页。
 */
export function QxTouchBand({
  kind = 'std',
  eyebrow,
  title,
  sub,
  place,
  seal = 'idle',
  status,
  rail,
  path,
  pathLabel,
  onBack,
  back = true,
  live = false,
}: {
  kind?: QxTouchBandKind
  eyebrow?: string
  title: ReactNode
  sub?: ReactNode
  place?: string
  seal?: QxTouchSeal | null
  status?: QxTouchStatus
  rail?: QxTouchRail
  path?: readonly string[]
  pathLabel?: string
  onBack?: () => void
  back?: boolean
  live?: boolean
}) {
  const rawId = useId().replace(/:/g, '')
  const goBack = useQxTouchBack(onBack)
  const placeLabel = place?.trim() ? place.trim() : ''
  const tone = status === false ? null : (status?.tone ?? 'unknown')
  const statusText = status === false ? '' : (status?.text ?? '状态未知')
  const showRail = Boolean(rail)
  const showPath = !showRail && Boolean(path && path.length > 0)
  const sealClass = seal === 'listen' ? 'qxt-seal qxt-seal-listen' : seal === 'think' ? 'qxt-seal qxt-seal-think' : 'qxt-seal'

  return (
    <header className={`qxt-band qxt-band-${kind}${live ? ' qxt-band-live' : ''}`}>
      <FlowLines id={`qxt-flow-${rawId}`} live={live} />
      <div className="qxt-halo" />
      <div className="qxt-hdr">
        {back ? (
          <button type="button" className="qxt-back" aria-label="返回上一步" onClick={goBack}>
            <QxTouchIcon name="chevL" size={34} strokeWidth={2.4} />
          </button>
        ) : null}
        <div className="qxt-brand">
          <div className="qxt-mark">职</div>
          <div>
            <b>职易达</b>
            {placeLabel ? <small>{placeLabel}</small> : null}
          </div>
        </div>
        <div className="qxt-hdr-right">
          {status === false ? null : (
            <span className={`qxt-status qxt-status-${tone}`}>
              <i className="qxt-dot" />
              {statusText}
            </span>
          )}
          <QxTouchClock />
        </div>
      </div>
      <div className="qxt-ask">
        <div className="qxt-ask-t">
          {eyebrow ? <div className="qxt-eyebrow">{eyebrow}</div> : null}
          <h1>{title}</h1>
          {sub ? <p>{sub}</p> : null}
        </div>
        {seal === null ? null : <div className={sealClass} aria-hidden="true">青</div>}
      </div>
      {showRail && rail ? (
        <div className="qxt-rail" role="list" aria-label="办理步骤">
          {rail.labels.map((label, index) => {
            const current = index === rail.now
            const state = index < rail.now ? 'qxt-rail-done' : current ? 'qxt-rail-now' : ''
            return (
              <div
                className={`qxt-rail-st ${state}`.trim()}
                key={`${label}-${index}`}
                role="listitem"
                aria-current={current ? 'step' : undefined}
              >
                <div className="qxt-rail-bar" />
                <span>{index < rail.now ? `✓ ${label}` : label}</span>
              </div>
            )
          })}
        </div>
      ) : null}
      {showPath && path ? (
        <div className="qxt-path">
          <span className="qxt-path-k">{pathLabel ?? `一共 ${path.length} 步`}</span>
          {path.map((label, index) => (
            <Fragment key={`${label}-${index}`}>
              {index > 0 ? <i>→</i> : null}
              <span className="qxt-path-pl"><b>{index + 1}</b>{label}</span>
            </Fragment>
          ))}
        </div>
      ) : null}
    </header>
  )
}
