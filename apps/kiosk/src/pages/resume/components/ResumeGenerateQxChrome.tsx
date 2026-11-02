import type { ReactNode } from 'react'

export function ResumeGenerateAdvisor({
  eyebrow,
  ask,
  doing,
}: {
  eyebrow: string
  ask: ReactNode
  doing: ReactNode
}) {
  return (
    <section className="rg-xq" aria-label="小青提示">
      <div className="rg-xq-face" aria-hidden="true">青</div>
      <div className="rg-xq-main">
        <p className="rg-xq-eyebrow">{eyebrow}</p>
        <p className="rg-xq-ask">{ask}</p>
        <p className="rg-xq-doing">{doing}</p>
      </div>
    </section>
  )
}
