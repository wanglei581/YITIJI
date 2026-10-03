import { formatDateTime } from '@ai-job-print/shared'
import { StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import type { AuditLogRecord } from '../../services/api/audit'
import { getAuditActionLabel, getAuditRoleLabel } from '../../lib/auditActionLabels'
import { auditActorText, auditTargetText, auditIpText } from './auditPresentation'

export function auditColumns(onOpen: (record: AuditLogRecord) => void): ConsoleColumn<AuditLogRecord>[] {
  // 六个单元格均提供相同的详情按钮，点击一行任意字段即可打开；键盘也能进入。
  const cell = (record: AuditLogRecord, text: string, title?: string) => (
    <button type="button" onClick={() => onOpen(record)} title={title ?? text}
      aria-label={`查看审计详情：${text}`} className="w-full min-w-0 py-1 text-left text-xs">
      <span className="block truncate">{text}</span>
    </button>
  )
  const roleTone = (role: string) => role === 'admin' ? 'info' : role === 'partner' ? 'success' : role === 'kiosk' ? 'warning' : 'default'
  return [
    { id: 'time', header: '时间', cellClassName: 'whitespace-nowrap', cell: (r) => cell(r, formatDateTime(r.createdAt)) },
    { id: 'actor', header: '操作人', cell: (r) => cell(r, auditActorText(r), r.actorId ?? undefined) },
    { id: 'role', header: '角色', cell: (r) => <button type="button" onClick={() => onOpen(r)} aria-label="查看审计详情"><StatusBadge label={getAuditRoleLabel(r.actorRole)} status={roleTone(r.actorRole)} /></button> },
    { id: 'action', header: '动作', truncate: true, cell: (r) => cell(r, getAuditActionLabel(r.action)) },
    { id: 'target', header: '目标对象', cell: (r) => cell(r, auditTargetText(r), r.targetId ?? undefined) },
    { id: 'ip', header: '终端 IP', cell: (r) => cell(r, auditIpText(r.ipAddress), r.ipAddress ?? undefined) },
  ]
}
