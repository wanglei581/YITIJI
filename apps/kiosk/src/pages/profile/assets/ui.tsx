// ProfilePage 本次会话记录的行内操作按钮。
// 旧「账号资产」分组外壳已删除；明细展示归位到对应业务页面。

import type { LucideIcon } from 'lucide-react'

/** 列表项图标操作按钮：触控区 ≥48px（h-12 w-12）。 */
export function RowIconButton({
  icon: Icon,
  title,
  tone = 'neutral',
  onClick,
}: {
  icon: LucideIcon
  title: string
  tone?: 'neutral' | 'danger'
  onClick: () => void
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-neutral-400 hover:bg-error-bg hover:text-error-fg'
      : 'text-neutral-500 hover:bg-neutral-50'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-neutral-200 ${toneCls}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}
