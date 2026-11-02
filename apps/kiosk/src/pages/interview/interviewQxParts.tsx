import { useEffect, useRef, useState, type ReactNode } from 'react'
import { INTERVIEW_SCROLLER_SELECTOR } from './interviewScroll'

/** 练面试各页共用的小件。样式在 styles/interview-touch.css（挂在 [data-qx-page="interview"] 下）。 */

/** 三格状态：小字说是什么，粗字说现在怎样。 */
export function InterviewStatus({
  label,
  items,
}: {
  label: string
  items: Array<{ k: string; v: string; tone?: 'ok' | 'off' }>
}) {
  return (
    <section className="qxt-iv-cells" aria-label={label}>
      {items.map((item) => (
        <div key={item.k}>
          <small>{item.k}</small>
          <b className={item.tone ?? ''}>{item.v}</b>
        </div>
      ))}
    </section>
  )
}

/** 说明卡：粗体首句加几行说明。 */
export function InterviewNote({
  lead,
  children,
}: {
  lead?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="qxt-iv-note">
      {lead ? <b>{lead}</b> : null}
      {children}
    </div>
  )
}

/**
 * 「下面还有内容」。盯住页内唯一的滚动容器：内容超出一屏、又没滑到底时才出现，滑到底或放得下就收起。
 * 提示占位，不盖住下面的字；读屏不读它（内容本身可以用手指或读屏顺序读到）。
 * 滚动容器可能随状态换成另一个元素，所以每次都重新找，监听挂在正文外层上。
 */
export function InterviewScrollCue() {
  const cueRef = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    const body = cueRef.current?.parentElement
    if (!body) return
    let watched: HTMLElement | null = null
    const resize = new ResizeObserver(() => update())
    function update() {
      const scroller = body!.querySelector<HTMLElement>(INTERVIEW_SCROLLER_SELECTOR)
      if (scroller !== watched) {
        if (watched) resize.unobserve(watched)
        if (scroller) resize.observe(scroller)
        watched = scroller
      }
      if (!scroller) {
        setShow(false)
        return
      }
      // 差几个像素就算有余：最后一行被底栏压住一截却没提示，比多一条提示更糟。
      const overflow = scroller.scrollHeight - scroller.clientHeight > 8
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8
      setShow(overflow && !atEnd)
    }
    update()
    body.addEventListener('scroll', update, { capture: true, passive: true })
    resize.observe(body)
    const changed = new MutationObserver(update)
    changed.observe(body, { childList: true, subtree: true, characterData: true })
    return () => {
      body.removeEventListener('scroll', update, true)
      resize.disconnect()
      changed.disconnect()
    }
  }, [])
  return (
    <div ref={cueRef} className="iv-scrollcue" hidden={!show} aria-hidden="true">
      <em>↓</em>
      下面还有内容，手指往上滑
    </div>
  )
}
