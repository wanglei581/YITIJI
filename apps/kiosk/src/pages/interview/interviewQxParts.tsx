import { useEffect, useState, type ReactNode } from 'react'

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

/** 稿 29 的深绿头卡：青圆章、眉题、大标题、一句说明。标题用普通行内排，句号跟在强调词后面。 */
export function InterviewHero({
  ask,
  doing,
  live = false,
}: {
  ask: ReactNode
  doing?: ReactNode
  live?: boolean
}) {
  return (
    <section className="iv-hero" data-iv-head="xq" aria-label="AI 模拟面试">
      <div className="iv-hero-row">
        <div className={live ? 'iv-hero-face is-live' : 'iv-hero-face'} aria-hidden="true">青</div>
        <div className="iv-hero-main">
          <div className="iv-hero-eyebrow">AI 模拟面试</div>
          <p className="iv-hero-ask">{ask}</p>
          {doing ? <p className="iv-hero-doing">{doing}</p> : null}
        </div>
      </div>
    </section>
  )
}

/** 稿里的「下面还有内容」。内容不满一屏或已经滑到底时不占位。 */
export function InterviewScrollCue() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const shell = document.querySelector('.iv-shell')
    const scroller = shell?.querySelector<HTMLElement>('.interview-flow__scroll, .interview-session__content')
    if (!scroller) return
    const update = () => {
      const overflow = scroller.scrollHeight - scroller.clientHeight > 32
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 32
      setShow(overflow && !atEnd)
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observed = new ResizeObserver(update)
    observed.observe(scroller)
    const changed = new MutationObserver(update)
    changed.observe(scroller, { childList: true, subtree: true, characterData: true })
    return () => {
      scroller.removeEventListener('scroll', update)
      observed.disconnect()
      changed.disconnect()
    }
  }, [])
  return (
    <div className="iv-scrollcue" hidden={!show} aria-hidden="true">
      <em>↓</em>
      下面还有内容，手指往上滑
    </div>
  )
}

/** 稿里的「接下来」：一条一个去向，说明写在按钮里，不另开菜单。 */
export function InterviewOptList({
  rows,
}: {
  rows: Array<{ k: string; title: string; desc: string; onClick: () => void; go?: boolean }>
}) {
  return (
    <div className="iv-optlist">
      {rows.map((row) => (
        <button key={row.title} type="button" className={row.go ? 'is-go' : undefined} onClick={row.onClick}>
          <i aria-hidden="true">{row.k}</i>
          <span>
            <b>{row.title}</b>
            <small>{row.desc}</small>
          </span>
          <em aria-hidden="true">›</em>
        </button>
      ))}
    </div>
  )
}

/** 卡片头：标题 + 右侧一句提示。`as="h2"` 时标题是真正的标题（读屏与测试都按标题找）。 */
export function InterviewCardHead({ title, hint, as = 'b', id }: { title: string; hint?: string; as?: 'b' | 'h2'; id?: string }) {
  const Title = as
  return (
    <div className="iv-head">
      <Title id={id}>{title}</Title>
      {hint ? <span>{hint}</span> : null}
    </div>
  )
}
