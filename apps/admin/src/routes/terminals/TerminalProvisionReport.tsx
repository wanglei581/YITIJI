import { formatDateTime } from '@ai-job-print/shared'
import type { AdminTerminalRecord } from '../../services/api/devices'
import { checkTone, failedCheckLine, provisionSummaryLabel } from './terminalProvisionViews'

const TONE_CLASS = {
  warning: 'text-warning-fg',
  error: 'text-error-fg',
} as const

/** 详情里的装机自检：摘要、未通过项、回报时间、终端程序版本。 */
export function TerminalProvisionReport({ terminal }: { terminal: AdminTerminalRecord }) {
  const report = terminal.lastProvisionReport ?? null
  return (
    <section data-testid="terminal-provision-report" className="rounded-lg border border-neutral-900/[0.08] px-4 py-3">
      <h3 className="text-[13px] font-bold text-neutral-800">装机自检</h3>
      <p className="mt-2 text-sm text-neutral-900">{provisionSummaryLabel(report)}</p>
      {report && !report.ok && report.failedChecks.length > 0 && (
        <ul className="mt-2 space-y-1">
          {report.failedChecks.map((check) => (
            <li key={`${check.key}:${check.code}`} className={`text-xs ${TONE_CLASS[checkTone(check.code)]}`}>
              {failedCheckLine(check)}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-neutral-500" title={report ? formatDateTime(report.reportedAt) : undefined}>
        回报时间：{report ? formatDateTime(report.reportedAt) : '—'}
      </p>
      <p className="mt-1 text-[11px] text-neutral-500">终端程序版本：{report?.agentVersion || '—'}</p>
    </section>
  )
}
