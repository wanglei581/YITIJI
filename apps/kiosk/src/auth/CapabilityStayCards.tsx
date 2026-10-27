import { useNavigate } from 'react-router-dom'
import { QxTouchCallout } from '../components/qingxu/touch/QxTouchCallout'
import { QxTouchIcon, type QxTouchIconName } from '../components/qingxu/touch/QxTouchIcon'
import { helpNeededLine } from '../copy/unattendedCopy'
import { useSupportContact } from '../hooks/useSupportContact'

/**
 * 大卡：左边 210 宽的图标列，右边 36px 标题、24px 说明、一句去处（稿的 fy-big）。
 * 卡按内容高度，不撑满整屏；图标列是内容，不是装饰。
 */
export function P10BigCard({
  icon,
  title,
  desc,
  cta = '进入',
  onClick,
}: {
  icon: QxTouchIconName
  title: string
  desc: string
  cta?: string
  onClick: () => void
}) {
  return (
    <button type="button" className="p10-big" onClick={onClick}>
      <span className="p10-big-v" aria-hidden="true">
        <QxTouchIcon name={icon} size={96} strokeWidth={1.5} />
      </span>
      <span className="p10-big-t">
        <b>{title}</b>
        <span>{desc}</span>
        <em>{cta}</em>
      </span>
    </button>
  )
}

/** 求助句：只在后台读得到服务电话时出现，读不到整句不显示。 */
export function P10HelpRemind() {
  const contact = useSupportContact()
  if (!contact.servicePhone) return null
  return <QxTouchCallout kind="remind" icon="call">{`${helpNeededLine(contact)}。`}</QxTouchCallout>
}

/** 逐项「本机暂未开通」小卡（稿的 fy-offgrid）。只列这一项能力本来就有的入口名。 */
export function CapabilityOffTiles({ items }: { items: readonly { title: string; hint?: string }[] }) {
  return (
    <div className="p10-offgrid" data-rows={Math.ceil(items.length / 2)}>
      {items.map((item) => (
        <div className="p10-offtile" key={item.title} role="group" aria-disabled="true">
          <b>{item.title}</b>
          <small>本机暂未开通</small>
          {item.hint ? <small>{item.hint}</small> : null}
        </div>
      ))}
    </div>
  )
}

/** 未开启页下面两张去处。检查中不渲染，避免在确认完成前放出按钮。 */
export function CapabilityStayCards() {
  const navigate = useNavigate()
  return (
    <section className="p10-stay" aria-label="这些不受影响">
      <h2>这些不受影响</h2>
      <P10BigCard
        icon="printer"
        title="打印扫描"
        desc="打印和扫描照常可用"
        onClick={() => navigate('/print-scan')}
      />
      <P10BigCard
        icon="clipboard"
        title="查政策"
        desc="查看已发布的政策和办事说明"
        onClick={() => navigate('/policy-service')}
      />
    </section>
  )
}
