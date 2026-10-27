import { useLayoutEffect, useRef, type ReactNode } from 'react'
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
  className,
  gallery = true,
  page,
  frameMarker = false,
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
  /** 挂在 `.qxt-screen` 上的附加类。默认不改变样板页。 */
  className?: string
  /** 开发样板标记。业务页传 false，样板页保持默认 true。 */
  gallery?: boolean
  /** 业务页标记。不传则不挂 data-qx-page，样板页行为不变。 */
  page?: string
  /** 为 true 时挂 data-qx-frame，供仍按青序页框查找的用例识别。默认不挂。 */
  frameMarker?: boolean
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
  return (
    <div
      className={['qxt-screen', motionClass, className].filter(Boolean).join(' ')}
      data-qxt-screen=""
      {...(page ? { 'data-qx-page': page } : {})}
      {...(frameMarker ? { 'data-qx-frame': 'true' } : {})}
      {...(gallery ? { 'data-qxt-gallery': '' } : {})}
      data-qxt-state={stateId}
      data-testid={testId}
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
