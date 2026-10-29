import type { ReactNode } from 'react'
import { QxTouchIcon, type QxTouchIconName } from '../../../../components/qingxu/touch/QxTouchIcon'
import { MANUAL_CHECKS } from '../../resume-report-model'

/** 报告页的一行出路（稿 st-ai-down 的 exit）：左图标、中标题与说明、「去…」小字。可点或置灰（aria-disabled，不用原生 disabled，读屏读得到原因）。 */
export function ExitRow({
  icon,
  title,
  desc,
  take,
  onClick,
  disabled = false,
  describedBy,
  testId,
  route,
  index = 0,
}: {
  icon: QxTouchIconName
  title: string
  desc: string
  take?: string
  onClick?: () => void
  disabled?: boolean
  describedBy?: string
  testId?: string
  route?: string
  index?: number
}): ReactNode {
  return (
    <button
      type="button"
      className={`qxt-slab qxt-slab-row qxt-slab-compact qxt-rise${disabled ? ' qxt-slab-off' : ''}`}
      style={{ ['--i' as string]: index + 1 }}
      aria-disabled={disabled || undefined}
      aria-describedby={disabled ? describedBy : undefined}
      data-testid={testId}
      data-route={route}
      onClick={() => { if (!disabled) onClick?.() }}
    >
      <div className="qxt-vis"><QxTouchIcon name={icon} size={40} strokeWidth={2} /></div>
      <div className="qxt-slab-txt">
        <h3>{title}</h3>
        <p>{desc}</p>
        {take && !disabled ? <div className="qxt-take"><QxTouchIcon name="arrowR" size={26} strokeWidth={2.4} /><span>{take}</span></div> : null}
      </div>
    </button>
  )
}

/** 不等 AI，先自己核一遍：6 条自查，纸质简历同样适用。 */
export function ManualChecks({ delay = 0 }: { delay?: number }) {
  return (
    <section className="qxt-olist qxt-rise" style={{ ['--i' as string]: delay }} data-testid="resume-report-fallback">
      <div className="qxt-olist-t">不等 AI，先自己核一遍<span className="qxt-ck">6 项 · 纸质简历同样适用</span></div>
      <div data-testid="resume-report-list">
        {MANUAL_CHECKS.map((item, i) => (
          <div className="qxt-check" key={item}><i>{i + 1}</i><span>{item}</span></div>
        ))}
      </div>
    </section>
  )
}
