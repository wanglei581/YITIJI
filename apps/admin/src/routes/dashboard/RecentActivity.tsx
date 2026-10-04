import { formatDateTime, formatRelativeTime } from '@ai-job-print/shared'
import { SectionCard } from '@ai-job-print/ui'
import { ScrollTextIcon } from 'lucide-react'
import type { AuditLogRecord } from '../../services/api/audit'
import { getAuditActionLabel, getAuditActorLabel, getAuditTargetLabel } from '../../lib/auditActionLabels'
import { getUser } from '../../services/auth'
import { BlockError, BlockLoading, SectionLink } from './DashboardWidgets'

export function RecentActivity({ logs, loading, error, onRetry }: { logs: AuditLogRecord[]; loading: boolean; error: boolean; onRetry: () => void }) {
  return (
    <SectionCard title="最近操作" action={<SectionLink href="/audit">日志审计</SectionLink>}>
      {loading ? <BlockLoading /> : error ? <BlockError message="审计日志加载失败" onRetry={onRetry} /> : logs.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-400">暂无审计记录</p>
      ) : (
        <div>
          {logs.map((log, index) => {
            const target = getAuditTargetLabel(log.targetType)
            const actor = getAuditActorLabel({
              actorRole: log.actorRole,
              actorId: log.actorId,
              payloadJson: log.payloadJson,
              currentUser: getUser(),
              record: log,
            })
            return (
              <div
                key={log.id}
                className={
                  'flex items-center gap-3 py-[11px] text-[13px]' +
                  (index === 0 ? '' : ' border-t border-neutral-900/[0.06]')
                }
              >
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-primary-100 text-primary-700"
                >
                  <ScrollTextIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-neutral-900">
                    {getAuditActionLabel(log.action)}
                  </p>
                  <p className="mt-0.5 truncate text-[11.5px] text-neutral-500">
                    {actor}
                    {target ? ` · ${target}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-neutral-500" title={log.createdAt ? formatDateTime(log.createdAt) : undefined}>
                  {formatRelativeTime(log.createdAt)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

