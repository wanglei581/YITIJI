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

/**
 * 为什么看到这一页：三句话。只讲「是否开通由谁定、没开通时不显示什么、开通后入口在哪」，
 * 不写这项能力里具体有哪些入口（总关闭时不得露出任何业务内容）。
 */
export function CapabilityExplain({ opensAt }: { opensAt: string }) {
  return (
    <section className="p10-explain" aria-label="这项还没开通">
      <span className="p10-explain-v" aria-hidden="true">
        <QxTouchIcon name="eye" size={96} strokeWidth={1.5} />
      </span>
      <div className="p10-explain-t">
        <b>这项还没开通</b>
        <ul>
          <li>是否开通，由运营机构按本机配置决定。</li>
          <li>没开通时，这里不显示相关内容，也不能进入。</li>
          <li>开通之后，入口会出现在{opensAt}。</li>
        </ul>
      </div>
    </section>
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
