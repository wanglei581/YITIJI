import type { LucideIcon } from 'lucide-react'
import type { CapabilityKind } from './serviceHubModel'

/** 常用入口：可点时进路由，不可点时把原因写在副文案上。 */
export function HubQuickEntry({
  title,
  description,
  reason,
  kind,
  icon: Icon,
  onOpen,
}: {
  title: string
  description: string
  reason: string | null
  kind: CapabilityKind
  icon: LucideIcon
  onOpen: () => void
}) {
  if (reason) {
    return (
      <div
        className="qx-hub-quick-item is-unavailable"
        role="group"
        aria-disabled="true"
        aria-label={`${title}：${reason}`}
        data-disabled-reason={`capability:${kind}`}
      >
        <Icon size={26} aria-hidden="true" />
        <span>
          <b>{title}</b>
          <span>{reason}</span>
        </span>
      </div>
    )
  }
  return (
    <button type="button" className="qx-hub-quick-item" onClick={onOpen}>
      <Icon size={26} aria-hidden="true" />
      <span>
        <b>{title}</b>
        <span>{description}</span>
      </span>
    </button>
  )
}

/** 目标分段：和能力卡共用同一条不可用原因，不另开可点通道。 */
export function HubGoalEntry({
  label,
  reason,
  kind,
  onOpen,
}: {
  label: string
  reason: string | null
  kind: CapabilityKind
  onOpen: () => void
}) {
  if (reason) {
    return (
      <div
        className="qx-hub-goal is-unavailable"
        role="group"
        aria-disabled="true"
        aria-label={`${label}：${reason}`}
        data-disabled-reason={`capability:${kind}`}
      >
        {label}
      </div>
    )
  }
  return (
    <button type="button" className="qx-hub-goal" onClick={onOpen}>
      {label}
    </button>
  )
}
