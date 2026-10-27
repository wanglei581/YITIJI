import { Fragment, useEffect, useId, useState } from 'react'
import { QxTouchIcon } from './QxTouchIcon'

export type QxTouchBandKind = 'std' | 'compact' | 'hero'
export type QxTouchSeal = 'idle' | 'listen' | 'think'
export type QxTouchStatus =
  | { text: string; tone?: 'ok' | 'warn' | 'unknown' | 'reading' }
  | false

export type QxTouchRail = { labels: readonly string[]; now: number }

function shanghaiNow(now: Date) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { time, date: `${pick('month')}月${pick('day')}日 ${pick('weekday')}` }
}

function useShanghaiClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return shanghaiNow(now)
}

function FlowLines({ id, live }: { id: string; live: boolean }) {
  return (
    <div className="qxt-flow" aria-hidden="true" data-live={live ? 'on' : 'off'}>
      <svg viewBox="0 0 1200 600" preserveAspectRatio="none">
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop offset="0" stopColor="var(--qx-emerald)" stopOpacity="0" />
            <stop offset="0.5" stopColor="var(--qx-emerald)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--qx-emerald)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M-20 468 C 260 300, 520 588, 820 372 S 1150 180, 1240 264" fill="none" stroke={`url(#${id})`} strokeWidth="2.2" />
        <path d="M-20 540 C 300 396, 560 636, 860 444 S 1160 276, 1240 348" fill="none" stroke={`url(#${id})`} strokeWidth="1.2" opacity="0.7" />
        <path d="M-20 216 C 340 72, 640 300, 900 156 S 1180 12, 1240 84" fill="none" stroke={`url(#${id})`} strokeWidth="1" opacity="0.45" />
      </svg>
    </div>
  )
}

/**
 * 意图带。进度条 rail 与路径胶囊 path 只渲染一种；两者都传时只留 rail。
 * 印章只有 listen / think 才动。不传 status 时写「状态未知」，不假装就绪。
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
  title: string
  sub?: string
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
  const clock = useShanghaiClock()
  const placeLabel = place?.trim() ? place.trim() : ''
  const tone = status === false ? null : (status?.tone ?? (status ? 'ok' : 'unknown'))
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
          <button type="button" className="qxt-back" aria-label="返回上一步" onClick={onBack}>
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
          <div className="qxt-clock">
            <b>{clock.time}</b>
            <small>{clock.date}</small>
          </div>
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
        <div className="qxt-rail">
          {rail.labels.map((label, index) => {
            const state = index < rail.now ? 'qxt-rail-done' : index === rail.now ? 'qxt-rail-now' : ''
            return (
              <div className={`qxt-rail-st ${state}`.trim()} key={label}>
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
