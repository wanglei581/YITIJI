import type { ReactNode } from 'react'
import { QxTouchArtChecklist } from '../../components/qingxu/touch/QxTouchArt'
import { QxTouchIcon, type QxTouchIconName } from '../../components/qingxu/touch/QxTouchIcon'

/** 状态屏：左边说明，右边清单小样，小样下面是稿上那行标签。 */
export function PolicyStatusCard({ icon, title, chip, artWidth = 280, children }: {
  icon: QxTouchIconName
  title: string
  chip: string
  artWidth?: number
  children: ReactNode
}) {
  return <section className="policy-min-section policy-status-card" role="status">
    <div className="policy-status-copy">
      <h2><QxTouchIcon name={icon} size={30} />{title}</h2>
      {children}
    </div>
    <div className="policy-status-art">
      <QxTouchArtChecklist width={artWidth} />
      <span className="qxt-chip qxt-chip-slate">{chip}</span>
    </div>
  </section>
}

/** 稿上的整行：图标、标题、可选说明、右箭头。仍带 policy-min-row，授权收尾时一起停用。 */
export function PolicyLinkRow({ icon, title, detail, onClick, disabled }: {
  icon: QxTouchIconName
  title: string
  detail?: string
  onClick: () => void
  disabled?: boolean
}) {
  return <button type="button" className="policy-min-row policy-link-row" disabled={disabled} onClick={onClick}>
    <QxTouchIcon name={icon} size={32} />
    <span><b>{title}</b>{detail ? <small> · {detail}</small> : null}</span>
    <span className="policy-link-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
  </button>
}

/** 两条出路：图标在上、标题、副标题。读屏名用标题。停用时不跳转。 */
export function PolicyExitCard({ icon, title, desc, onClick, off = false }: {
  icon: QxTouchIconName
  title: string
  desc: string
  onClick: () => void
  off?: boolean
}) {
  return <button type="button" className={off ? 'policy-exit-card policy-exit-off' : 'policy-exit-card'}
    aria-label={title} aria-disabled={off || undefined} onClick={() => { if (!off) onClick() }}>
    <span className="qxt-ic"><QxTouchIcon name={icon} size={38} /></span>
    <b>{title}</b>
    <small>{desc}</small>
  </button>
}
