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
  buttonReset = true,
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
  /** 默认重置屏内按钮，避免裸按钮带出系统样式。已有自己按钮样式的页可关掉。 */
  buttonReset?: boolean
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
      className={['qxt-screen', buttonReset ? 'qxt-btn-reset' : '', motionClass].filter(Boolean).join(' ')}
      data-qxt-screen=""
      data-qxt-gallery=""
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
