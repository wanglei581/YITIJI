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
  /** 单独一张时横跨两列，避免旁边空一格。 */
  span?: 'full'
  disabled?: boolean
  /**
   * 为什么点不动。**只允许填能力闸门**（`capability:<配置项>`）——
   * 「本机没开通这项服务」是真实状态，用户看得懂、运营改配置就能变。
   * 功能没做完不属于这一类：那种情况不该在首页摆一颗按钮，直接不渲染。
   */
  disabledReason?: `capability:${string}`
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
  span,
  disabled = false,
  disabledReason,
  statusText,
  panelAttrs,
  onAction,
}: HomeTileProps) {
  const titleId = `qx-home-${actionId}-title`
  const descId = `qx-home-${actionId}-desc`
  const statusId = statusText ? `qx-home-${actionId}-status` : undefined
  return (
    <button
      type="button"
      className="qx-home-tile"
      data-action={actionId}
      data-tone={tone}
      data-size={size}
      data-span={span}
      disabled={disabled}
      data-disabled-reason={disabled ? disabledReason : undefined}
      onClick={() => onAction(actionId)}
      aria-labelledby={titleId}
      aria-describedby={[descId, statusId].filter(Boolean).join(' ')}
      {...panelAttrs}
    >
      <span className="qx-home-tile-head">
        <span className="qx-home-tile-icon"><Icon aria-hidden="true" /></span>
        {badge ? <span className="qx-home-tile-badge">{badge}</span> : null}
      </span>
      <strong id={titleId}>{title}</strong>
      <span id={descId} className="qx-home-tile-desc">{description}</span>
      {statusText ? <span id={statusId} className="qx-home-tile-status">{statusText}</span> : null}
      {foot ? <span className="qx-home-tile-foot">{foot} <ArrowRightIcon aria-hidden="true" /></span> : null}
    </button>
  )
}
