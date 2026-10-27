import type { ReactNode } from 'react'
import '../../../styles/qingxu/index.css'

export type QxTouchMotion = 'enter' | 'back' | 'leave' | 'none'

/**
 * 触屏版一屏：上意图带、中选择区、下按区、底导航。覆盖层盖在这一屏上。
 * 样式随本组件引入，业务页不引用就不带上这套规则。
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
}) {
  const motionClass = motion === 'none' ? '' : motion === 'back' ? 'qxt-enter qxt-back' : motion === 'leave' ? 'qxt-leave' : 'qxt-enter'
  return (
    <div
      className={`qxt-screen ${motionClass}`.trim()}
      data-qxt-screen=""
      data-qxt-gallery=""
      data-qxt-state={stateId}
      data-testid={testId}
    >
      {band}
      <main className={['qxt-body', bodyClassName].filter(Boolean).join(' ')}>{children}</main>
      {dock}
      {nav}
      {overlay}
    </div>
  )
}
