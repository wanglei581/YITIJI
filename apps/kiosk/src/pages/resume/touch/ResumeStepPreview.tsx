// 从零生成每一步下面的预览卡：左边是一张纸的小样，右边只复述这一步已经填上的内容。
// 没填的格子写「未填」「不填写」，不放示例岗位、示例学校或示例数字。
import { useLayoutEffect, useRef } from 'react'
import { ResumeTouchArt, type ResumeTouchArtKind } from './ResumeTouchArt'

export function ResumeStepPreview({
  kicker,
  title,
  lines,
  note,
  need = false,
  art = 'resume',
  className,
}: {
  kicker: string
  title: string
  lines: readonly string[]
  note?: string
  /** 必填的格子还空着时，标题用赭色提醒。 */
  need?: boolean
  /** 小样的纸型。不传是简历。 */
  art?: ResumeTouchArtKind
  /** 追加到卡片上的类名（如 rtp-hero-min：纸张区至少 190 高，内容多时整屏滚动而不是把纸收没）。 */
  className?: string
}) {
  const ref = useRef<HTMLElement>(null)
  // 放进滚动区时不留半张卡：滚动区第一屏放得下整张就整张画；放不下收成一行；一行也放不下就不画。
  // 量的是卡片在滚动内容里的位置（含 scrollTop），与用户滚到哪无关。表单变长、变短都会重新量。
  useLayoutEffect(() => {
    const el = ref.current
    // 最近的会滚动的祖先（生成页里是表单卡 .qx-rg-card，不是外面的 .qx-scroll）。
    let scroller: HTMLElement | null = el?.parentElement ?? null
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    if (!el || !scroller) return undefined
    const box = scroller
    const fit = () => {
      for (const mode of ['full', 'row'] as const) {
        el.dataset.fit = mode
        const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
        if (top + el.offsetHeight <= box.clientHeight + 1) return
      }
      el.dataset.fit = 'none'
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    if (el.previousElementSibling) observer.observe(el.previousElementSibling)
    return () => observer.disconnect()
  })
  return (
    <aside ref={ref} className={className ? `rtp-hero ${className}` : 'rtp-hero'} aria-label={kicker}>
      <div className="rtp-hero-art"><ResumeTouchArt kind={art} /></div>
      <div className="rtp-hero-tx">
        <p className="rtp-hero-k">{kicker}</p>
        <b className={need ? 'rtp-hero-need' : undefined}>{title}</b>
        {lines.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}
        {note ? <small>{note}</small> : null}
      </div>
    </aside>
  )
}
