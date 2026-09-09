import { ArrowRightIcon, type LucideIcon } from 'lucide-react'
import type { HomeV6ActionId } from '../homeV6Domains'

export interface HomeTileProps {
  actionId: HomeV6ActionId
  title: string
  description: string
  foot?: string
  badge?: string
  icon: LucideIcon
  tone?: 'teal' | 'slate' | 'clay' | 'neutral'
  size?: 'feature' | 'regular' | 'slim'
  disabled?: boolean
  statusText?: string
  /** 挂在磁贴根节点上的额外 data-* 标记（如设备/招聘会面板的状态标记）。 */
  panelAttrs?: Record<string, string>
  onAction: (actionId: HomeV6ActionId) => void
}

export function HomeTile({
  actionId,
  title,
  description,
  foot,
  badge,
  icon: Icon,
  tone = 'teal',
  size = 'regular',
  disabled = false,
  statusText,
  panelAttrs,
  onAction,
}: HomeTileProps) {
  return (
    <button
      type="button"
      className="qx-home-tile"
      data-action={actionId}
      data-tone={tone}
      data-size={size}
      disabled={disabled}
      onClick={() => onAction(actionId)}
      aria-describedby={statusText ? `qx-home-${actionId}-status` : undefined}
      {...panelAttrs}
    >
      <span className="qx-home-tile-head">
        <span className="qx-home-tile-icon"><Icon aria-hidden="true" /></span>
        {badge ? <span className="qx-home-tile-badge">{badge}</span> : null}
      </span>
      <strong>{title}</strong>
      <span className="qx-home-tile-desc">{description}</span>
      {statusText ? <span id={`qx-home-${actionId}-status`} className="qx-home-tile-status">{statusText}</span> : null}
      {foot ? <span className="qx-home-tile-foot">{foot} <ArrowRightIcon aria-hidden="true" /></span> : null}
    </button>
  )
}
