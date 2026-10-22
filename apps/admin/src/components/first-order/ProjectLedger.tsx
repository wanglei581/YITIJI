import { useState, type FormEvent } from 'react'
import { formatDate, formatDateTime, type FirstOrderProject, type FirstOrderProjectInput, type FirstOrderTerminal } from '@ai-job-print/shared'
import { Button } from '@ai-job-print/ui'
import { firstOrderApi } from '../../services/api/firstOrder'

const input = 'mt-1 min-h-12 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm'
const day = (value: string) => formatDate(value, '')
const initial = (project: FirstOrderProject | null): FirstOrderProjectInput => project ? { ...project } : {
  name: '', reference: '', serviceStartAt: '', serviceEndAt: '', serviceScope: '', supportContact: '',
}

export function ProjectLedger({ orgId, project, terminals, assignedTerminalIds, onChanged, onCreated }: {
  orgId: string; project: FirstOrderProject | null; terminals: FirstOrderTerminal[]; assignedTerminalIds: string[]
  onChanged: () => Promise<void>; onCreated: (id: string) => void
}) {
  const [editing, setEditing] = useState(!project)
  const [form, setForm] = useState(() => initial(project))
  const [terminalId, setTerminalId] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [endingId, setEndingId] = useState<string | null>(null)
  const available = terminals.filter((terminal) => !assignedTerminalIds.includes(terminal.id))

  async function perform(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请刷新核对后重试。') }
    finally { setBusy(false) }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    await perform(async () => {
      const payload = {
        name: form.name.trim(), reference: form.reference.trim(), serviceScope: form.serviceScope.trim(), supportContact: form.supportContact.trim(),
        serviceStartAt: project?.deployments.length ? project.serviceStartAt : new Date(`${day(form.serviceStartAt)}T00:00:00+08:00`).toISOString(),
        serviceEndAt: project?.deployments.length ? project.serviceEndAt : new Date(`${day(form.serviceEndAt)}T23:59:59+08:00`).toISOString(),
      }
      const result = project ? await firstOrderApi.updateProject(project.id, payload, project.version) : await firstOrderApi.createProject(orgId, payload)
      await onChanged(); onCreated(result.id); setEditing(false); setNotice('项目资料已保存。')
    })
  }

  return (
    <section aria-label="项目与点位台账" className="space-y-4 rounded-xl border border-neutral-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-neutral-900">项目与点位台账</h4>
        {project && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setForm(initial(project)); setEditing(!editing) }}>{editing ? '收起项目编辑' : '编辑项目资料'}</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-error-fg">{error}</p>}
      {notice && <p role="status" className="text-sm text-success-fg">{notice}</p>}
      {editing ? (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" aria-label={project ? '编辑服务项目' : '新建服务项目'}>
          <label className="text-sm">项目名称<input disabled={busy} required maxLength={100} className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="text-sm">合同或采购编号<input disabled={busy} required maxLength={100} className={input} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
          <label className="text-sm">服务开始日<input disabled={busy || !!project?.deployments.length} required type="date" className={input} value={day(form.serviceStartAt)} onChange={(e) => setForm({ ...form, serviceStartAt: e.target.value ? `${e.target.value}T00:00:00+08:00` : '' })} /></label>
          <label className="text-sm">服务截止日<input disabled={busy || !!project?.deployments.length} required type="date" min={day(form.serviceStartAt) || undefined} className={input} value={day(form.serviceEndAt)} onChange={(e) => setForm({ ...form, serviceEndAt: e.target.value ? `${e.target.value}T23:59:59+08:00` : '' })} /></label>
          {!!project?.deployments.length && <p className="text-xs text-neutral-500 sm:col-span-2">已有设备登记，续期请新建项目，历史日期不改；项目名称、范围和联系方式仍可编辑。</p>}
          <label className="text-sm sm:col-span-2">免费服务与维保范围<textarea disabled={busy} required maxLength={1000} rows={3} className={input} value={form.serviceScope} onChange={(e) => setForm({ ...form, serviceScope: e.target.value })} placeholder="如实填写免费服务、耗材和上门维保覆盖范围。" /></label>
          <label className="text-sm sm:col-span-2">服务联系渠道<input disabled={busy} required maxLength={200} className={input} value={form.supportContact} onChange={(e) => setForm({ ...form, supportContact: e.target.value })} placeholder="填写机构可以联系到的服务电话或服务方式。" /></label>
          <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? '正在保存…' : project ? '保存项目资料' : '创建服务项目'}</Button></div>
        </form>
      ) : project && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-neutral-500">合同或采购编号</dt><dd className="break-words">{project.reference}</dd></div>
          <div><dt className="text-neutral-500">服务期限（北京时间）</dt><dd>{day(project.serviceStartAt)} 至 {day(project.serviceEndAt)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-neutral-500">免费服务与维保范围</dt><dd className="whitespace-pre-wrap break-words">{project.serviceScope}</dd></div>
          <div className="sm:col-span-2"><dt className="text-neutral-500">服务联系渠道</dt><dd className="whitespace-pre-wrap break-words">{project.supportContact}</dd></div>
        </dl>
      )}
      {project && <>
        <h5 className="text-sm font-semibold">设备部署记录</h5>
        {!project.deployments.length && <p className="text-sm text-neutral-500">尚未登记项目设备。登记后从当时开始记录本项目的数据范围。</p>}
        {project.deployments.map((deployment) => <div key={deployment.id} className="rounded-lg bg-neutral-50 p-3 text-sm" data-testid={`first-order-deployment-${deployment.id}`}>
          <p className="font-semibold">{deployment.terminalCode} · {deployment.locationLabel}</p>
          <p className="mt-1 text-xs text-neutral-500">登记于 {formatDateTime(deployment.startedAt)}{deployment.endedAt ? `，结束于 ${formatDateTime(deployment.endedAt)}` : '，当前在此项目服务'}</p>
          {!deployment.endedAt && <div className="mt-2">
            {endingId === deployment.id ? <div className="space-y-2"><p>确认结束这台设备在本项目的部署？历史记录保留，之后的使用不再计入本次部署。</p><div className="flex gap-2"><Button size="sm" variant="danger" disabled={busy} onClick={() => void perform(async () => { await firstOrderApi.endDeployment(deployment.id); setEndingId(null); await onChanged(); setNotice('本次部署已结束，历史记录已保留。') })}>确认结束部署</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEndingId(null)}>取消</Button></div></div> : <Button size="sm" variant="outline" disabled={busy} onClick={() => setEndingId(deployment.id)}>结束本次部署</Button>}
          </div>}
        </div>)}
        <form aria-label="登记项目设备" className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await firstOrderApi.createDeployment(project.id, terminalId, location.trim()); setTerminalId(''); setLocation(''); await onChanged(); setNotice('项目设备已登记。统计从本次登记时刻开始，不补造历史。') }) }}>
          <label className="text-sm">待登记终端<select aria-label="待登记终端" disabled={busy} required className={input} value={terminalId} onChange={(e) => { setTerminalId(e.target.value); setLocation(terminals.find((item) => item.id === e.target.value)?.locationLabel ?? '') }}><option value="">选择本机构尚未部署的终端</option>{available.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.terminalCode} · {terminal.displayName ?? '未命名终端'}</option>)}</select></label>
          <label className="text-sm">安装位置<input disabled={busy} required maxLength={200} className={input} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          <div className="sm:col-span-2"><Button type="submit" disabled={busy || !available.length || !terminalId || !location.trim()}>登记项目设备</Button></div>
        </form>
        {!available.length && <p className="text-xs text-neutral-500">本机构暂无可登记设备，请先在设备管理中绑定终端，或核对它是否已在其他项目服务。</p>}
      </>}
    </section>
  )
}
