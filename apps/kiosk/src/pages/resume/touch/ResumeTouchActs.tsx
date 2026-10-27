// 空状态的「一句说明 + 大行动卡」。出口由各页传入，这里不写去向。
import { QxTouchIcon, type QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import { QxTouchSlab } from '../../../components/qingxu/touch/QxTouchSlab'

export function ResumeTouchActs({
  note,
  items,
}: {
  note: string
  items: ReadonlyArray<{
    title: string
    desc: string
    take: string
    icon: QxTouchIconName
    onClick: () => void
  }>
}) {
  return (
    <div className="rtp-acts">
      <p className="rtp-howto">{note}</p>
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
          visual={<QxTouchIcon name={item.icon} size={64} strokeWidth={1.8} />}
        />
      ))}
    </div>
  )
}
