import { formatDateTime } from '@ai-job-print/shared'
import { Drawer } from '@ai-job-print/ui'
import type { AuditLogRecord } from '../../services/api/audit'
import { getAuditActionLabel, getAuditRoleLabel, getAuditTargetLabel } from '../../lib/auditActionLabels'
import { auditActorText, auditTargetText, auditIpText, parseAuditPayload, PAYLOAD_LABELS, safeAuditText } from './auditPresentation'

function PayloadValue({ value }: { value: unknown }) {
  if (value === null) return <span>—</span>
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>
  if (Array.isArray(value)) return <ul className="space-y-2">{value.map((item, i) => <li key={i}><PayloadValue value={item} /></li>)}</ul>
  if (typeof value === 'object' && value) return (
    <dl className="space-y-2">
      {Object.entries(value).map(([key, item]) => (
        <div key={key} className="rounded-lg bg-neutral-50 p-3">
          <dt className="mb-1 text-xs text-neutral-500">{PAYLOAD_LABELS[key] ?? key}</dt>
          <dd className="break-words text-sm text-neutral-800"><PayloadValue value={item} /></dd>
        </div>
      ))}
    </dl>
  )
  return <span>{String(value)}</span>
}

export function AuditDetailDrawer({ record, onClose }: { record: AuditLogRecord | null; onClose: () => void }) {
  const payload = record ? parseAuditPayload(record.payloadJson) : null
  const fields = record ? [
    ['日志编号', `尾号 ${record.id.slice(-6)}`, record.id],
    ['时间', formatDateTime(record.createdAt), record.createdAt],
    ['操作人', auditActorText(record), record.actorId ?? undefined],
    ['角色', getAuditRoleLabel(record.actorRole), record.actorRole],
    ['动作', getAuditActionLabel(record.action), record.action],
    ['对象类型', getAuditTargetLabel(record.targetType), record.targetType],
    ['目标对象', auditTargetText(record), record.targetId ?? undefined],
    ['终端 IP', auditIpText(record.ipAddress), record.ipAddress ?? undefined],
    ['请求 ID', safeAuditText(record.requestId ?? '—')],
    ['浏览器标识（User-Agent）', safeAuditText(record.userAgent ?? '—')],
  ] : []
  return (
    <Drawer open={!!record} onClose={onClose} title="审计日志详情" size="lg">
      <dl className="space-y-3">
        {fields.map(([label, value, title]) => <div key={label}>
          <dt className="text-xs text-neutral-500">{label}</dt>
          <dd title={title} className="mt-1 break-all text-sm text-neutral-800">{value}</dd>
        </div>)}
      </dl>
      <h3 className="mb-3 mt-6 text-sm font-semibold">操作详情</h3>
      {payload?.invalid ? <div>
        <p className="text-sm text-neutral-500">详情无法解析</p>
        <details className="mt-3"><summary className="cursor-pointer text-xs">查看原文（敏感内容已隐藏）</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{payload.raw}</pre>
        </details>
      </div> : payload && <PayloadValue value={payload.value} />}
    </Drawer>
  )
}
