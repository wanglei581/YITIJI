import { formatDate, formatDateTime } from '@ai-job-print/shared'
import type { ConsoleColumn } from '@ai-job-print/ui'
import type { AdminTerminalRecord } from '../../services/api/devices'
import {
  credentialExpiryTone,
  identityLabel,
  identityTone,
  provisionHover,
  provisionSummaryLabel,
  type ExpiryTone,
  type IdentityTone,
} from './terminalProvisionViews'

const TONE_CLASS: Record<IdentityTone | ExpiryTone, string> = {
  ok: 'text-neutral-800',
  danger: 'font-medium text-error-fg',
  warning: 'font-medium text-warning-fg',
  muted: 'text-neutral-500',
  none: 'text-neutral-700',
  error: 'font-medium text-error-fg',
}

/** 列表上新增的三列。运行状态列留在终端页，那边的相对时间门禁要看见 formatRelativeTime。 */
export function provisionListColumns(): ConsoleColumn<AdminTerminalRecord>[] {
  return [
    {
      id: 'provision',
      header: '装机自检',
      cellClassName: 'whitespace-nowrap',
      cell: (terminal) => {
        const report = terminal.lastProvisionReport ?? null
        const hover = provisionHover(report)
        return (
          <span className="whitespace-nowrap text-xs" title={hover || undefined}>
            {provisionSummaryLabel(report)}
          </span>
        )
      },
    },
    {
      id: 'identity',
      header: '身份',
      cellClassName: 'whitespace-nowrap',
      cell: (terminal) => (
        <span className={`whitespace-nowrap text-xs ${TONE_CLASS[identityTone(terminal.identityStatus)]}`}>
          {identityLabel(terminal.identityStatus)}
        </span>
      ),
    },
    {
      id: 'credentialExpires',
      header: '令牌到期日',
      cellClassName: 'whitespace-nowrap',
      cell: (terminal) => {
        const tone = credentialExpiryTone(terminal.credentialExpiresAt, new Date())
        const text = terminal.credentialExpiresAt ? formatDate(terminal.credentialExpiresAt) : '—'
        return (
          <span
            className={`whitespace-nowrap text-xs ${TONE_CLASS[tone]}`}
            title={terminal.credentialExpiresAt ? formatDateTime(terminal.credentialExpiresAt) : undefined}
          >
            {text}
          </span>
        )
      },
    },
  ]
}
