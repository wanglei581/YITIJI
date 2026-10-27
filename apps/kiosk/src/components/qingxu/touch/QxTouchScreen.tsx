import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import '../../../styles/qingxu/tokens.css' /* 触屏件也用 --qx-* 底色与字族；不靠别的页面先加载 */
import '../../../styles/qingxu/tokens-touch.css'
import '../../../styles/qingxu/touch.css'

export type QxTouchMotion = 'enter' | 'back' | 'leave' | 'none'

/**
 * 触屏版一屏：上意图带、中选择区、下按区、底导航。覆盖层盖在这一屏上。
 * 触屏样式只随本组件引入，不进全站主 CSS。
 */
export function QxTouchScreen({
  band,
  children,
  dock,
  nav,
  overlay,
  motion = 'enter',
  bodyClassName,
  testId,
  stateId,
  gallery = false,
  pageId,
  intro,
  markers,
  rootRef,
}: {
  band: ReactNode
  children: ReactNode
  dock?: ReactNode
  nav?: ReactNode
  overlay?: ReactNode
  motion?: QxTouchMotion
  bodyClassName?: string
  testId?: string
  stateId?: string
  /** 只有开发样板传 true。业务屏不带 data-qxt-gallery。 */
  gallery?: boolean
  pageId?: string
  intro?: 'done'
  markers?: Record<string, string | undefined>
  rootRef?: Ref<HTMLDivElement>
}) {
  const underRef = useRef<HTMLDivElement>(null)
  const covered = Boolean(overlay)
  useLayoutEffect(() => {
    const node = underRef.current
    if (!node) return
    if (covered) node.setAttribute('inert', '')
    else node.removeAttribute('inert')
  }, [covered])
  const motionClass = motion === 'none' ? '' : motion === 'back' ? 'qxt-enter qxt-back' : motion === 'leave' ? 'qxt-leave' : 'qxt-enter'
  const markerProps = Object.fromEntries(
    Object.entries(markers ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [`data-${key}`, value]),
  )
  return (
    <div
      ref={rootRef}
      className={`qxt-screen ${motionClass}`.trim()}
      data-qxt-screen=""
      {...(gallery ? { 'data-qxt-gallery': '' } : {})}
      data-qx-page={pageId}
      data-qx-intro={intro}
      data-qxt-state={stateId}
      data-testid={testId}
      {...markerProps}
    >
      <div ref={underRef} className="qxt-under" aria-hidden={covered ? true : undefined}>
        {band}
        <div className={['qxt-body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
        {dock}
        {nav}
      </div>
      {overlay}
    </div>
  )
}
