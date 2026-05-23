type BadgeStatus = 'success' | 'warning' | 'error' | 'info' | 'default'

interface StatusBadgeProps {
  status: BadgeStatus
  label: string
  className?: string
}

const statusClasses: Record<BadgeStatus, string> = {
  success: 'bg-green-100 text-green-700',
  warning: 'bg-orange-100 text-orange-700',
  error: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  default: 'bg-gray-100 text-gray-600',
}

export function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        statusClasses[status],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {label}
    </span>
  )
}
