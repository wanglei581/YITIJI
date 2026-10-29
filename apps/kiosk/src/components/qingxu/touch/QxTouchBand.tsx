import { Fragment, useId, type ReactNode } from 'react'
import { QxTouchClock } from './QxTouchClock'
import { QxTouchIcon } from './QxTouchIcon'
import { useQxTouchBack } from './useQxTouchBack'

export type QxTouchBandKind = 'std' | 'compact' | 'hero'
export type QxTouchSeal = 'idle' | 'listen' | 'think'
export type QxTouchStatus =
  | { text: string; tone?: 'ok' | 'warn' | 'unknown' | 'reading' | 'bad' }
  | false

/** 步骤条上某一步的特殊记号：bad 是这一步失败，wait 是这一步结果还没确认。有记号的步不算「当前」。 */
export type QxTouchRailMark = 'bad' | 'wait'
export type QxTouchRail = { labels: readonly string[]; now: number; marks?: Readonly<Record<number, QxTouchRailMark>> }

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
 * 可选参数是各页面包要的，10/28 并成一套；都不传时样子和第一包一样。
 */
export function QxTouchBand({
  kind = 'std',
  eyebrow,
  title,
  sub,
  place,
  seal = 'idle',
  sealNode,
  status,
  statusClassName,
  rail,
  path,
  pathLabel,
  onBack,
  back = true,
  backLabel = '返回上一步',
  backDisabled = false,
  backClassName,
  className,
  titleId,
  titleTag = 'h1',
  titleRole,
  live = false,
  dense = false,
}: {
  kind?: QxTouchBandKind
  eyebrow?: string
  title: ReactNode
  sub?: ReactNode
  place?: string
  seal?: QxTouchSeal | null
  /** 自带的印章位内容（如完成页的对勾）。不传时仍按 seal 画「青」章。 */
  sealNode?: ReactNode
  status?: QxTouchStatus
  /** 追加到状态胶囊上的类名。 */
  statusClassName?: string
  rail?: QxTouchRail
  path?: readonly string[]
  pathLabel?: string
  onBack?: () => void
  back?: boolean
  /** 返回键的读屏名。不传或只有空白时仍是「返回上一步」。 */
  backLabel?: string
  /** 返回键还在、但此刻不能点（提交中、正在清场）。 */
  backDisabled?: boolean
  /** 追加到返回键上的类名。 */
  backClassName?: string
  /** 追加到意图带根上的类名。 */
  className?: string
  /** 标题的 id，给对话框说明之类连到这句标题上。 */
  titleId?: string
  /** 问句标题的标签。不传时是 h1。 */
  titleTag?: 'h1' | 'h2'
  /** 问句标题的角色。不传时就是标题。 */
  titleRole?: 'status'
  live?: boolean
  /** hero 挤版：第三行块数 ≥ 4 时压低意图带。 */
  dense?: boolean
}) {
  const rawId = useId().replace(/:/g, '')
  const goBack = useQxTouchBack(onBack)
  const placeLabel = place?.trim() ? place.trim() : ''
  const tone = status === false ? null : (status?.tone ?? 'unknown')
  const statusText = status === false ? '' : (status?.text ?? '状态未知')
  const showRail = Boolean(rail)
  const showPath = !showRail && Boolean(path && path.length > 0)
  const sealClass = seal === 'listen' ? 'qxt-seal qxt-seal-listen' : seal === 'think' ? 'qxt-seal qxt-seal-think' : 'qxt-seal'
  const hero = kind === 'hero'
  const backName = backLabel.trim() ? backLabel.trim() : '返回上一步'
  const sealEl = sealNode
    ? <div className="qxt-seal-node" aria-hidden="true">{sealNode}</div>
    : seal === null ? null : <div className={hero ? `${sealClass} qxt-seal-xl` : sealClass} aria-hidden="true">青</div>
  const TitleTag = titleTag === 'h2' ? 'h2' : 'h1'

  return (
    <header className={['qxt-band', `qxt-band-${kind}`, live ? 'qxt-band-live' : '', dense ? 'qxt-band-dense' : '', className].filter(Boolean).join(' ')}>
      <FlowLines id={`qxt-flow-${rawId}`} live={live} />
      <div className="qxt-halo" />
      <div className="qxt-hdr">
        {back ? (
          <button type="button" className={['qxt-back', backClassName].filter(Boolean).join(' ')} aria-label={backName} disabled={backDisabled} onClick={goBack}>
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
            <span className={['qxt-status', `qxt-status-${tone}`, statusClassName].filter(Boolean).join(' ')}>
              <i className="qxt-dot" />
              {statusText}
            </span>
          )}
          <QxTouchClock />
        </div>
      </div>
      <div className={hero ? 'qxt-greet' : 'qxt-ask'}>
        {hero ? sealEl : null}
        <div className="qxt-ask-t">
          {eyebrow ? <div className="qxt-eyebrow">{eyebrow}</div> : null}
          <TitleTag id={titleId} role={titleRole}>{title}</TitleTag>
          {sub ? <p>{sub}</p> : null}
        </div>
        {hero ? null : sealEl}
      </div>
      {showRail && rail ? (
        <div className="qxt-rail" role="list" aria-label="办理步骤">
          {rail.labels.map((label, index) => {
            const mark = rail.marks?.[index]
            const current = index === rail.now && !mark
            const state = mark ? `qxt-rail-${mark}` : index < rail.now ? 'qxt-rail-done' : current ? 'qxt-rail-now' : ''
            return (
              <div
                className={`qxt-rail-st ${state}`.trim()}
                key={`${label}-${index}`}
                role="listitem"
                aria-current={current ? 'step' : undefined}
                data-mark={mark}
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
