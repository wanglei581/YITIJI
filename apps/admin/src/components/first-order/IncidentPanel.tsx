import { useState } from 'react'
import { FIRST_ORDER_ISSUE_LABELS, formatDateTime, type FirstOrderIncident, type FirstOrderIncidentAction } from '@ai-job-print/shared'
import { Button, StatusBadge } from '@ai-job-print/ui'
import { firstOrderApi } from '../../services/api/firstOrder'

const labels = { open: '待受理', processing: '处理中', resolved: '技术恢复，待机构核对', closed: '机构已确认恢复' } as const
const eventLabels: Record<string, string> = { create: '提交报障', created: '提交报障', start: '开始处理', resolve: '记录技术恢复', confirm: '确认恢复', reopen: '重新报障' }
const input = 'mt-1 min-h-12 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm'

function Incident({ item, onChanged }: { item: FirstOrderIncident; onChanged: () => Promise<void> }) {
  const [assignee, setAssignee] = useState(item.assignee ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function update(action: FirstOrderIncidentAction) {
    setBusy(true); setError(''); setNotice('')
    try {
      await firstOrderApi.updateIncident(item.id, { action, version: item.version, note: note.trim(), ...(action === 'start' ? { assignee: assignee.trim() } : {}) })
      setNote(''); setNotice('处理记录已保存。'); await onChanged()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请刷新核对后重试。') }
    finally { setBusy(false) }
  }

  return <article className="space-y-3 rounded-lg border border-neutral-200 p-3" data-testid={`first-order-incident-${item.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="text-sm font-semibold">{item.terminalCode} · {FIRST_ORDER_ISSUE_LABELS[item.issueCode]}</h5><StatusBadge label={labels[item.status]} status={item.status === 'closed' ? 'success' : item.status === 'open' ? 'error' : 'warning'} /></div>
    <p className="whitespace-pre-wrap break-words text-sm">{item.note}</p>
    <p className="text-xs text-neutral-500">报障于 {formatDateTime(item.createdAt)} · 最近更新 {formatDateTime(item.updatedAt)}</p>
    {item.assignee && <p className="text-sm">处理负责人：{item.assignee}</p>}
    {item.resolution && <p className="whitespace-pre-wrap break-words text-sm">恢复说明：{item.resolution}</p>}
    {item.resolvedAt && <p className="text-xs text-neutral-500">技术恢复时间：{formatDateTime(item.resolvedAt)}；机构核对单独记录。</p>}
    {item.events.length > 0 && <details className="text-sm"><summary className="min-h-10 cursor-pointer py-2">查看处理过程</summary><ol className="space-y-2">{item.events.map((event, index) => <li key={`${event.createdAt}-${index}`} className="border-l-2 border-neutral-200 pl-3"><p className="text-xs text-neutral-500">{formatDateTime(event.createdAt)} · {event.actorRole === 'admin' ? '平台运维' : '机构'} · {eventLabels[event.action] ?? '处理记录'}</p><p className="whitespace-pre-wrap break-words">{event.note}</p></li>)}</ol>{item.historyTruncated && <p className="mt-2 text-xs text-neutral-500">本页只显示近期处理过程，完整记录保留在审计中。</p>}</details>}
    {error && <p role="alert" className="text-sm text-error-fg">{error}</p>}
    {notice && <p role="status" className="text-sm text-success-fg">{notice}</p>}
    {item.status === 'open' && <label className="block text-sm">处理负责人<input disabled={busy} maxLength={80} className={input} value={assignee} onChange={(event) => setAssignee(event.target.value)} /></label>}
    <label className="block text-sm">处理说明<textarea disabled={busy} maxLength={300} rows={2} className={input} value={note} onChange={(event) => setNote(event.target.value)} placeholder="只填写设备处置情况，不填写群众姓名、电话或个人材料。" /></label>
    <div className="flex flex-wrap gap-2">
      {item.status === 'open' && <Button size="sm" disabled={busy || !assignee.trim()} onClick={() => void update('start')}>开始处理</Button>}
      {item.status === 'processing' && <Button size="sm" disabled={busy || !note.trim()} onClick={() => void update('resolve')}>记录技术恢复</Button>}
      {(item.status === 'resolved' || item.status === 'closed') && <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void update('reopen')}>重新打开故障</Button>}
    </div>
  </article>
}

export function IncidentPanel({ incidents, onChanged }: { incidents: FirstOrderIncident[]; onChanged: () => Promise<void> }) {
  return <section aria-label="设备报障与处理" className="space-y-3 rounded-xl border border-neutral-200 p-4">
    <h4 className="font-semibold text-neutral-900">设备报障与处理</h4>
    <p className="text-xs text-neutral-500">报障由机构提交，平台负责受理与修复。技术恢复与机构核对分开记录，不能用主机在线代替出纸验证。</p>
    {incidents.length === 0 ? <p className="text-sm text-neutral-500">本项目暂无报障记录；这不代表设备已经通过现场验收。</p> : incidents.map((item) => <Incident key={item.id} item={item} onChanged={onChanged} />)}
  </section>
}
