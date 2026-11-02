import type { ReactNode } from 'react'
import { DocStackArt, SignArt } from '../ToolArt'

/** 说明格：一个标题加一句话（稿的 .fs-fact）。 */
export function Fact({ title, children, wide }: { title: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`fs-fact${wide ? ' wide' : ''}`}>
      <b>{title}</b>
      <span>{children}</span>
    </div>
  )
}

/** 一块示意小样：多出来的高度给它，不撑空卡。只作示意，不代表任何真实文件。 */
export function Sample({ art = 'sign' }: { art?: 'sign' | 'doc' }) {
  const Art = art === 'doc' ? DocStackArt : SignArt
  return (
    <div className="ss-sample" data-testid="sign-stamp-sample" aria-hidden="true">
      <Art />
    </div>
  )
}

/** 步骤条：选 PDF · 传签名图 · 放置。 */
export function Pips({ current }: { current: 0 | 1 | 2 }) {
  const items = ['选 PDF', '传签名图', '放置']
  return (
    <div className="ss-pips" aria-label="签名的三步">
      {items.map((label, i) => (
        <span key={label} className={i === current ? 'on' : undefined} aria-current={i === current ? 'step' : undefined}>
          {label}
        </span>
      ))}
    </div>
  )
}
