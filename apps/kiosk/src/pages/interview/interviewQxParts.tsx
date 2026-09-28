import type { ReactNode } from 'react'

export function InterviewStatus({
  label,
  items,
}: {
  label: string
  items: Array<{ k: string; v: string; tone?: 'ok' | 'off' }>
}) {
  return (
    <section className="iv-status" aria-label={label}>
      {items.map((item) => (
        <div key={item.k}>
          <small>{item.k}</small>
          <b className={item.tone ?? ''}>{item.v}</b>
        </div>
      ))}
    </section>
  )
}

export function InterviewNotice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'danger'
  children: ReactNode
}) {
  return (
    <section className={tone === 'danger' ? 'iv-notice is-danger' : 'iv-notice'}>
      <i aria-hidden="true">{tone === 'danger' ? '!' : 'i'}</i>
      <div>{children}</div>
    </section>
  )
}

export function InterviewRail() {
  return (
    <div className="interview-rail" aria-label="练习边界">
      <span>只供本人练习参考</span>
      <span>不发送给任何企业</span>
      <span>不预测录用结果</span>
    </div>
  )
}

export function InterviewSteps({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <div className="iv-steps">
      {rows.map(([k, title, desc]) => (
        <div key={k} className="iv-step">
          <small>{k}</small>
          <b>{title}</b>
          <p>{desc}</p>
        </div>
      ))}
    </div>
  )
}

export function InterviewCardHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="iv-head">
      <b>{title}</b>
      {hint ? <span>{hint}</span> : null}
    </div>
  )
}
