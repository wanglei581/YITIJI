import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import '../../../styles/qingxu/tokens.css' /* 触屏件也用 --qx-* 底色与字族；不靠别的页面先加载 */
import '../../../styles/qingxu/tokens-touch.css'
import '../../../styles/qingxu/touch.css'
import '../../../styles/qingxu/touch-hero.css'
import '../../../styles/qingxu/touch-legacy-parts.css' /* 旧共享件（选择弹窗、扫码面板、U 盘面板）在触屏屏里的补样式 */

export type QxTouchMotion = 'enter' | 'back' | 'leave' | 'none'

/**
 * 触屏版一屏：上意图带、中选择区、下按区、底导航。覆盖层盖在这一屏上。
 * 触屏样式只随本组件引入，不进全站主 CSS。
 * 可选参数是各页面包要的，10/28 并成一套；业务屏不带开发样板标记 data-qxt-gallery。
 */
export function QxTouchScreen({
  band,
  children,
  dock,
  nav,
  overlay,
  motion = 'enter',
  bodyClassName,
  className,
  testId,
  stateId,
  page,
  gallery = false,
  legacyFrame = false,
  buttonReset = true,
  intro,
  dataAttrs,
  rootRef,
}: {
  band: ReactNode
  children: ReactNode
  dock?: ReactNode
  nav?: ReactNode
  overlay?: ReactNode
  motion?: QxTouchMotion
  bodyClassName?: string
  /** 追加到 .qxt-screen 上的类名。 */
  className?: string
  testId?: string
  stateId?: string
  /** 页面样式挂点，写成 data-qx-page。页面专用样式都挂在 [data-qx-page='<本页>'] 下。 */
  page?: string
  /** 开发样板标记 data-qxt-gallery。只有开发样板传 true。 */
  gallery?: boolean
  /** 写上青序页框的 data-qx-frame="true"，给仍按旧页框找元素的用例和返回出口门禁用。 */
  legacyFrame?: boolean
  /** 重置屏内裸按钮的字体与颜色（默认开）。已有自己按钮样式的页可以关掉。 */
  buttonReset?: boolean
  /** 写成 data-qx-intro，进场动画放完时传 'done'。 */
  intro?: 'done'
  /** 额外的 data-* 标记：键不带 data- 前缀，值为 undefined 的不写。 */
  dataAttrs?: Record<string, string | undefined>
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
    Object.entries(dataAttrs ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [`data-${key}`, value]),
  )
  return (
    <div
      ref={rootRef}
      className={['qxt-screen', buttonReset ? 'qxt-btn-reset' : '', motionClass, className].filter(Boolean).join(' ')}
      data-qxt-screen=""
      data-qxt-gallery={gallery ? '' : undefined}
      data-qx-frame={legacyFrame ? 'true' : undefined}
      data-qx-page={page}
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
