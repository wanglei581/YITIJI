// 空状态的「一句说明 + 大行动卡」。去向由各页传入，这里不写路由。
// 一屏只有这一句说明（可省略，由页面自己的状态卡出这句）和两三张大卡；不再叠第二套出口。
import type { ReactNode } from 'react'
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { QxTouchIcon, type QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import { QxTouchSlab } from '../../../components/qingxu/touch/QxTouchSlab'
import { ResumeTouchArt, type ResumeTouchArtKind } from './ResumeTouchArt'

export type ResumeTouchActItem = {
  title: string
  desc: string
  take: string
  onClick: () => void
  /** 左侧小样。不传时用 icon。 */
  art?: ResumeTouchArtKind
  icon?: QxTouchIconName
}

export function ResumeTouchActs({
  note,
  heading,
  items,
  fine,
  before,
  after,
}: {
  note?: string
  /** 大卡上面的小标题（可带一句提示）。 */
  heading?: { title: string; hint?: string }
  items: ReadonlyArray<ResumeTouchActItem>
  /** 一屏最多一句边界声明，放在大卡下面。 */
  fine?: string
  /** 放在大卡上面的整块（如失败屏的原因卡）。 */
  before?: ReactNode
  /** 放在大卡下面、边界声明上面的整块（如求助句）。 */
  after?: ReactNode
}) {
  return (
    <div className="rtp-acts">
      {before}
      {note ? <QxTouchCallout kind="howto">{note}</QxTouchCallout> : null}
      {heading ? <div className="qxt-sec">{heading.title}{heading.hint ? <small>{heading.hint}</small> : null}</div> : null}
      {items.map((item, index) => (
        <QxTouchSlab
          key={item.title}
          row
          index={index}
          title={item.title}
          desc={item.desc}
          take={item.take}
          takeStyle="plain"
          onClick={item.onClick}
          visual={item.art ? <ResumeTouchArt kind={item.art} /> : <QxTouchIcon name={item.icon ?? 'file'} size={64} strokeWidth={1.8} />}
        />
      ))}
      {after}
      {fine ? <QxTouchCallout kind="fine">{fine}</QxTouchCallout> : null}
    </div>
  )
}
