// 职业规划操作钮。置灰一律 aria-disabled，原生 disabled 会让读屏跳过。
import type { ReactNode } from 'react'

export function Action({ label, variant, onClick, busy, icon }: {
  label: ReactNode
  variant: 'ghost' | 'primary' | 'teal'
  onClick: () => void
  busy?: boolean
  icon?: ReactNode
}) {
  return (
    <button type="button" className="qx-btn rdq-aria-btn" data-variant={variant} aria-disabled={busy} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}
