import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { MeArt, type MeArtName } from './MeIllus'

/**
 * 我的与权益各屏共用的版式件，对应触屏稿 fix-me.js 的 fe-* 类：分段、行卡、静态卡、操作行、大卡。
 * 只放版式，不放数据和动作；各页把自己的处理函数传进来。样式在 me-touch.css（状态屏在 me-states.css），全部挂在 [data-qx-page="me"] 下。
 */

export type MeSegItem = { id: string; label: string; testId?: string; aria?: string }

/** 分段。current 那一项只做标记（aria-current / aria-pressed 二选一），点别的才触发。 */
export function MeSeg({
  items,
  current,
  onPick,
  label,
  mode = 'current',
  testId,
  className,
  disabled = false,
}: {
  items: readonly MeSegItem[]
  current: string
  onPick: (id: string) => void
  label: string
  mode?: 'current' | 'pressed'
  testId?: string
  className?: string
  /** 整排不能改（例如反馈已经关联到某张打印订单，分类固定）。 */
  disabled?: boolean
}) {
  return (
    <div className={['me-seg', className].filter(Boolean).join(' ')} role="group" aria-label={label} data-testid={testId} data-n={items.length}>
      {items.map((item) => {
        const on = item.id === current
        return (
          <button
            key={item.id}
            type="button"
            className="me-seg-b"
            data-testid={item.testId}
            disabled={disabled}
            aria-label={item.aria}
            aria-current={mode === 'current' && on ? 'true' : undefined}
            aria-pressed={mode === 'pressed' ? on : undefined}
            onClick={() => { if (!on) onPick(item.id) }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export function MeBtn({
  v = 'sec',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { v?: 'pri' | 'sec' | 'danger' | 'ghost' }) {
  return <button type="button" {...rest} className={['me-btn', className].filter(Boolean).join(' ')} data-v={v} />
}

export function MeActs({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="me-acts" role="group" aria-label={label}>{children}</div>
}

export function MeP({ children, tone }: { children: ReactNode; tone?: 'reason' }) {
  return <p className={tone === 'reason' ? 'me-reason' : 'me-p'}>{children}</p>
}

export function MeFine({ children }: { children: ReactNode }) {
  return <p className="me-fine">{children}</p>
}

export function MeRows({ children, few = false, testId, label }: { children: ReactNode; few?: boolean; testId?: string; label?: string }) {
  return <section className={`me-rows${few ? ' me-few' : ''}`} data-testid={testId} aria-label={label}>{children}</section>
}

/**
 * 行卡。整张卡是一颗按钮，点开后下面出现操作行；open 时 aria-expanded 为真。
 * data-* 与 aria-* 属性原样落在外层 div 上（例如 data-server-slot、data-order-status）。
 */
export function MeRow({
  title,
  lines,
  chips,
  open,
  onToggle,
  actions,
  extra,
  foot,
  toggleLabel,
  dim = false,
  ...rest
}: {
  title: ReactNode
  lines: readonly ReactNode[]
  chips?: ReactNode
  open: boolean
  onToggle: () => void
  actions?: ReactNode
  extra?: ReactNode
  /** 不管开没开都显示的一行（例如「该文件格式暂不支持打印」）。 */
  foot?: ReactNode
  toggleLabel?: string
  dim?: boolean
} & Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'onToggle' | 'children'>) {
  return (
    <div className="me-line" data-open={open ? 'true' : undefined} data-dim={dim ? 'true' : undefined} {...rest}>
      <button type="button" className="me-open" aria-expanded={open} aria-label={toggleLabel} onClick={onToggle}>
        <b>{title}</b>
        {lines.map((line, index) => <small key={index}>{line}</small>)}
        {chips}
      </button>
      {foot}
      {open ? <>{actions}{extra}</> : null}
    </div>
  )
}

export function MeStatic({
  title,
  lines,
  extra,
  ...rest
}: { title: ReactNode; lines: readonly ReactNode[]; extra?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'>) {
  return (
    <div className="me-static" {...rest}>
      <b>{title}</b>
      {lines.map((line, index) => <small key={index}>{line}</small>)}
      {extra}
    </div>
  )
}

/** 左边插画、右边标题加说明的大卡（稿 fe-hero）。 */
export function MeHero({
  art,
  artWidth = 150,
  title,
  children,
  pin = false,
  testId,
  className,
}: {
  art: MeArtName
  artWidth?: number
  title: ReactNode
  children?: ReactNode
  pin?: boolean
  testId?: string
  className?: string
}) {
  return (
    <section className={['me-hero', pin ? 'me-pin' : '', className].filter(Boolean).join(' ')} data-testid={testId}>
      <MeArt name={art} width={artWidth} />
      <div className="me-hero-tx">
        <b>{title}</b>
        {children}
      </div>
    </section>
  )
}

export function MeRules({ title, rules }: { title: string; rules: readonly string[] }) {
  return (
    <section className="me-static me-pin" aria-label={title}>
      <b>{title}</b>
      {rules.map((text, index) => (
        <div className="me-rule" key={text}><i>{index + 1}</i><span>{text}</span></div>
      ))}
    </section>
  )
}

export function MeKinds({ items }: { items: readonly { title: string; note: string }[] }) {
  return (
    <div className="me-kinds">
      {items.map((item) => <div key={item.title}><b>{item.title}</b><span>{item.note}</span></div>)}
    </div>
  )
}
