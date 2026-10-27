/**
 * 公共与系统页的版块：稿 fix-public.js 里 fp-hit / fp-card / fp-well / fp-k / fp-note 的 React 版。
 * 只排版，不取数、不跳转；点击由调用方传入。类名都在 public-touch.css，挂在 .qxt-screen 下。
 */
import type { ReactNode } from 'react'
import { QxTouchChip } from '../../components/qingxu/touch/QxTouchChip'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'

/** 一行入口：左 64 见方图标，中标题加副标题，右小胶囊或箭头。有 onClick 时是按钮，没有时是静态块。 */
export function Hit({
  icon,
  title,
  sub,
  chip,
  chevron = false,
  onClick,
  className,
  testId,
  label,
  disabled = false,
  pressed,
  describedBy,
}: {
  icon?: ReactNode
  title: ReactNode
  sub?: ReactNode
  chip?: string
  chevron?: boolean
  onClick?: () => void
  className?: string
  testId?: string
  label?: string
  disabled?: boolean
  pressed?: boolean
  describedBy?: string
}) {
  const cls = ['qxp-hit', disabled ? 'qxp-hit-off' : '', className].filter(Boolean).join(' ')
  const body = (
    <>
      {icon ? <span className="qxp-ic" aria-hidden="true">{icon}</span> : null}
      <span className="qxp-tx"><b>{title}</b>{sub ? <small>{sub}</small> : null}</span>
      {chip ? <QxTouchChip>{chip}</QxTouchChip> : null}
      {chevron ? <span className="qxp-go" aria-hidden="true"><QxTouchIcon name="chevR" size={26} strokeWidth={2.2} /></span> : null}
    </>
  )
  if (!onClick) return <div className={cls} data-testid={testId}>{body}</div>
  return (
    <button
      type="button"
      className={cls}
      data-testid={testId}
      aria-label={label}
      aria-describedby={describedBy}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
    >
      {body}
    </button>
  )
}

/** 一张块：可选青色小标题。 */
export function Card({ k, children, className, testId }: { k?: ReactNode; children?: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={['qxp-card', className].filter(Boolean).join(' ')} data-testid={testId}>
      {k ? <p className="qxp-k">{k}</p> : null}
      {children}
    </div>
  )
}

/** 说明底块（米色）。 */
export function Well({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['qxp-well', className].filter(Boolean).join(' ')}>{children}</div>
}

/** 一段话。 */
export function Note({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <p id={id} className={['qxp-note', className].filter(Boolean).join(' ')}>{children}</p>
}

/** 青色小标题（稿 fp-k）。 */
export function K({ children }: { children: ReactNode }) {
  return <p className="qxp-k">{children}</p>
}

/** 插画槽：把一张插画放进卡里，吸收卡里剩下的高度。 */
export function ArtBox({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['qxp-artbox', className].filter(Boolean).join(' ')} aria-hidden="true">{children}</div>
}

/**
 * 没有码、没有任务、页面打不开时的「去处卡」：标题居中、一行说明、下面一张插画吸收余高。
 * 两张并排放在 `.qxp-pair.qxp-pair-grow` 里。有 onClick 时是按钮。
 */
export function PairCard({
  title,
  desc,
  art,
  onClick,
  testId,
}: {
  title: string
  desc: string
  art: ReactNode
  onClick?: () => void
  testId?: string
}) {
  const body = (
    <>
      <span className="qxp-k">{title}</span>
      <span className="qxp-note">{desc}</span>
      <ArtBox>{art}</ArtBox>
    </>
  )
  if (!onClick) return <div className="qxp-card qxp-pair-card" data-testid={testId}>{body}</div>
  return (
    <button type="button" className="qxp-card qxp-pair-card" data-testid={testId} aria-label={title} onClick={onClick}>
      {body}
    </button>
  )
}
