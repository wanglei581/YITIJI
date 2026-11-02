import { useRef, useState, type FormEvent } from 'react'
import { FIRST_ORDER_ISSUES, FIRST_ORDER_ISSUE_LABELS, formatDateTime, type FirstOrderDeployment, type FirstOrderIncident, type FirstOrderIssue } from '@ai-job-print/shared'
import { Button, StatusBadge } from '@ai-job-print/ui'
import { firstOrderApi } from '../../services/api/firstOrder'

const input = 'mt-1 min-h-12 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm'
const labels = { open: '待平台受理', processing: '平台处理中', resolved: '技术恢复，待您核对', closed: '已确认恢复' } as const
const eventLabels: Record<string, string> = { create: '提交报障', created: '提交报障', start: '平台开始处理', resolve: '平台记录技术恢复', confirm: '机构确认恢复', reopen: '重新报障' }

function Incident({ item, onChanged, onSaved }: { item: FirstOrderIncident; onChanged: () => Promise<void>; onSaved: (saved: FirstOrderIncident) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const writing = useRef(false)
  async function update(action: 'confirm' | 'reopen') {
    if (writing.current) return
    writing.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      const saved = await firstOrderApi.updateIncident(item.id, { action, version: item.version, note: note.trim() })
      onSaved(saved); setNote('')
      const message = action === 'confirm' ? '恢复核对已记录。' : '已重新报障，等待平台处理。'
      setNotice(message)
      try { await onChanged() } catch { /* Parent reload displays its error; the write is already committed. */ }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请刷新核对后重试。') }
    finally { writing.current = false; setBusy(false) }
  }
  return <article className="space-y-3 rounded-lg border border-neutral-200 p-3" data-testid={`first-order-incident-${item.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="text-sm font-semibold">{item.terminalCode} · {FIRST_ORDER_ISSUE_LABELS[item.issueCode]}</h5><StatusBadge label={labels[item.status]} status={item.status === 'closed' ? 'success' : item.status === 'open' ? 'error' : 'warning'} /></div>
    <p className="whitespace-pre-wrap break-words text-sm">{item.note}</p>
    <p className="text-xs text-neutral-500">报障于 {formatDateTime(item.createdAt)} · 最近更新 {formatDateTime(item.updatedAt)}</p>
    {item.assignee && <p className="text-sm">平台处理负责人：{item.assignee}</p>}
    {item.resolution && <p className="whitespace-pre-wrap break-words text-sm">恢复说明：{item.resolution}</p>}
    {item.resolvedAt && <p className="text-xs text-neutral-500">技术恢复于 {formatDateTime(item.resolvedAt)}{item.closedAt ? `，您确认恢复于 ${formatDateTime(item.closedAt)}` : '，请现场核对后确认'}</p>}
    {item.events.length > 0 && <details className="text-sm"><summary className="min-h-10 cursor-pointer py-2">查看处理过程</summary><ol className="space-y-2">{item.events.map((event, index) => <li key={`${event.createdAt}-${index}`} className="border-l-2 border-neutral-200 pl-3"><p className="text-xs text-neutral-500">{formatDateTime(event.createdAt)} · {eventLabels[event.action] ?? '处理记录'}</p><p className="whitespace-pre-wrap break-words">{event.note}</p></li>)}</ol>{item.historyTruncated && <p className="mt-2 text-xs text-neutral-500">本页显示近期处理过程，其余记录保留在审计中。</p>}</details>}
    {error && <p role="alert" className="text-sm text-error-fg">{error}</p>}
    {notice && <p role="status" className="text-sm text-success-fg">{notice}</p>}
    {(item.status === 'resolved' || item.status === 'closed') && <>
      <label className="block text-sm">现场核对说明<textarea disabled={busy} rows={2} maxLength={300} className={input} value={note} onChange={(event) => setNote(event.target.value)} placeholder="核对后如实填写；不要写群众个人信息。" /></label>
      <div className="flex flex-wrap gap-2">{item.status === 'resolved' && <Button size="sm" disabled={busy || !note.trim()} onClick={() => void update('confirm')}>确认恢复</Button>}<Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void update('reopen')}>故障仍在，重新报障</Button></div>
    </>}
  </article>
}

export function IncidentPanel({ deployments, incidents, onChanged, onSaved }: { deployments: FirstOrderDeployment[]; incidents: FirstOrderIncident[]; onChanged: () => Promise<void>; onSaved: (saved: FirstOrderIncident) => void }) {
  const active = deployments.filter((item) => !item.endedAt)
  const [deploymentId, setDeploymentId] = useState('')
  const [issueCode, setIssueCode] = useState<FirstOrderIssue>('offline')
  const [note, setNote] = useState('')
  const requestKey = useRef(crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const writing = useRef(false)
  const changed = () => { requestKey.current = crypto.randomUUID(); setNotice('') }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (writing.current) return
    writing.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      const saved = await firstOrderApi.createIncident({ deploymentId, issueCode, note: note.trim(), requestKey: requestKey.current })
      onSaved(saved); setNote(''); requestKey.current = crypto.randomUUID(); setNotice('报障已提交，平台会按项目服务范围受理。')
      try { await onChanged() } catch { /* Parent reload displays its error; the write is already committed. */ }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '报障未完成，请刷新核对后重试。') }
    finally { writing.current = false; setBusy(false) }
  }
  return <section aria-label="设备报障与处理" className="space-y-4 rounded-xl border border-neutral-200 p-4">
    <h4 className="font-semibold">设备报障与处理</h4>
    <p className="text-xs text-neutral-500">填写设备问题即可，请勿上传或填写群众姓名、联系方式、文件内容。平台负责处理，您可以核对恢复或再次提出故障。</p>
    {error && <p role="alert" className="text-sm text-error-fg">{error}</p>}
    {notice && <p role="status" className="text-sm text-success-fg">{notice}</p>}
    {active.length ? <form aria-label="提交设备报障" className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
      <label className="text-sm">报障设备<select aria-label="报障设备" required disabled={busy} className={input} value={deploymentId} onChange={(event) => { changed(); setDeploymentId(event.target.value) }}><option value="">选择本项目当前设备</option>{active.map((item) => <option key={item.id} value={item.id}>{item.terminalCode} · {item.locationLabel}</option>)}</select></label>
      <label className="text-sm">设备问题<select aria-label="设备问题" disabled={busy} className={input} value={issueCode} onChange={(event) => { changed(); setIssueCode(event.target.value as FirstOrderIssue) }}>{FIRST_ORDER_ISSUES.map((issue) => <option key={issue} value={issue}>{FIRST_ORDER_ISSUE_LABELS[issue]}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">故障情况<textarea required disabled={busy} rows={2} maxLength={300} className={input} value={note} onChange={(event) => { changed(); setNote(event.target.value) }} /></label>
      <div className="sm:col-span-2"><Button type="submit" disabled={busy || !deploymentId || !note.trim()}>{busy ? '正在提交…' : '提交设备报障'}</Button></div>
    </form> : <p className="text-sm text-neutral-500">本项目暂无当前部署设备，请通过项目服务联系渠道核对；历史报障仍可查看。</p>}
    {incidents.length ? incidents.map((item) => <Incident key={item.id} item={item} onChanged={onChanged} onSaved={onSaved} />) : <p className="text-sm text-neutral-500">本项目暂无报障记录。</p>}
  </section>
}
