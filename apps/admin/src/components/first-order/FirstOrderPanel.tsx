import { useCallback, useEffect, useRef, useState } from 'react'
import type { FirstOrderDeployment, FirstOrderIncident, FirstOrderOverview, FirstOrderProject, FirstOrderReportSummary } from '@ai-job-print/shared'
import { Button, ErrorState, LoadingState } from '@ai-job-print/ui'
import { FIRST_ORDER_HTTP, firstOrderApi } from '../../services/api/firstOrder'
import { ProjectLedger } from './ProjectLedger'
import { IncidentPanel } from './IncidentPanel'
import { ReportPanel } from './ReportPanel'

const tabs = [{ key: 'ledger', label: '项目台账' }, { key: 'incidents', label: '报障处理' }, { key: 'reports', label: '月报资料' }] as const
type Tab = (typeof tabs)[number]['key']

export function FirstOrderPanel({ orgId }: { orgId: string }) {
  const [data, setData] = useState<FirstOrderOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState<Tab>('ledger')
  const request = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    if (!FIRST_ORDER_HTTP) { setLoading(false); return }
    request.current?.abort()
    const control = new AbortController(); request.current = control
    const task = ++sequence.current
    setLoading(true); setError('')
    try {
      const next = await firstOrderApi.overview(orgId, control.signal)
      if (task === sequence.current && !control.signal.aborted) setData(next)
    } catch (failure) {
      if (task === sequence.current && !control.signal.aborted) {
        const message = failure instanceof Error ? failure.message : '项目服务数据未能读取，请重试。'
        setError(message); throw new Error(message)
      }
    } finally { if (task === sequence.current) setLoading(false) }
  }, [orgId])
  const cancelRequest = useCallback(() => { sequence.current++; request.current?.abort() }, [])
  useEffect(() => {
    void reload().catch(() => undefined)
    return cancelRequest
  }, [reload, cancelRequest])
  useEffect(() => {
    if (!creating && data && !data.projects.some((project) => project.id === selectedId)) setSelectedId(data.projects[0]?.id ?? '')
  }, [creating, data, selectedId])

  function projectSaved(saved: FirstOrderProject) {
    setData((current) => current ? { ...current, projects: [saved, ...current.projects.filter((item) => item.id !== saved.id)] } : current)
    setCreating(false); setSelectedId(saved.id); setNotice(`项目「${saved.name}」资料已保存。`)
  }
  function deploymentChanged(saved: FirstOrderDeployment) {
    setData((current) => current ? { ...current, projects: current.projects.map((item) => item.id === saved.projectId
      ? { ...item, deployments: [...item.deployments.filter((row) => row.id !== saved.id), saved] } : item) } : current)
  }
  function incidentSaved(saved: FirstOrderIncident) {
    setData((current) => current ? { ...current, incidents: [saved, ...current.incidents.filter((item) => item.id !== saved.id)] } : current)
  }
  function reportSaved(saved: FirstOrderReportSummary) {
    setData((current) => current ? { ...current, reports: [saved, ...current.reports.filter((item) => item.id !== saved.id)] } : current)
  }

  const project = creating ? null : data?.projects.find((item) => item.id === selectedId) ?? null
  return <section aria-label="首单交付与服务" className="space-y-4 rounded-xl border border-primary-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-bold text-neutral-900">项目交付与服务</h3>{FIRST_ORDER_HTTP && <Button size="sm" variant="outline" disabled={loading} onClick={() => void reload().catch(() => undefined)}>刷新项目服务</Button>}</div>
    {!FIRST_ORDER_HTTP ? <p className="text-sm text-neutral-500">项目交付与服务需要连接真实后端。当前为预览模式，不提供演示数据或模拟操作。</p> : loading && !data ? <LoadingState className="py-8" /> : !data ? <ErrorState title="项目服务数据读取失败" message={error} onRetry={() => void reload().catch(() => undefined)} className="py-6" /> : <>
      {error && <p role="alert" className="text-sm text-error-fg">{error} 现有内容尚未刷新，请核对后再操作。</p>}
      {notice && <p role="status" className="break-words text-sm text-success-fg">{notice}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm">服务项目<select aria-label="服务项目" disabled={loading} className="mt-1 min-h-12 w-full rounded-lg border border-neutral-300 bg-white px-3" value={creating ? '' : selectedId} onChange={(event) => { setCreating(false); setSelectedId(event.target.value); setNotice('') }}><option value="">{creating ? '正在新建服务项目' : '选择服务项目'}</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <Button size="sm" disabled={loading || creating} onClick={() => { setCreating(true); setTab('ledger'); setNotice('') }}>新建服务项目</Button>
        {creating && data.projects.length > 0 && <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>取消新建</Button>}
      </div>
      {!data.projects.length && !creating && <p className="text-sm text-neutral-500">该机构尚未建立服务项目。请先登记采购或合同资料，再关联实际部署设备。</p>}
      {(project || creating) && <>
        <div role="tablist" aria-label="项目服务分组" className="flex flex-wrap gap-2">{tabs.map((item) => <Button key={item.key} size="sm" role="tab" aria-selected={tab === item.key} variant={tab === item.key ? 'primary' : 'outline'} disabled={creating && item.key !== 'ledger'} onClick={() => setTab(item.key)}>{item.label}</Button>)}</div>
        {tab === 'ledger' && <ProjectLedger key={project?.id ?? 'new'} orgId={orgId} project={project} terminals={data.terminals} assignedTerminalIds={data.projects.flatMap((item) => item.deployments.filter((deployment) => !deployment.endedAt).map((deployment) => deployment.terminalId))} onChanged={reload} onSaved={projectSaved} onDeploymentChanged={deploymentChanged} />}
        {tab === 'incidents' && project && <IncidentPanel key={project.id} incidents={data.incidents.filter((item) => item.projectId === project.id)} onChanged={reload} onSaved={incidentSaved} />}
        {tab === 'reports' && project && <ReportPanel key={project.id} projectId={project.id} reports={data.reports.filter((item) => item.projectId === project.id)} onChanged={reload} onSaved={reportSaved} />}
      </>}
    </>}
  </section>
}
