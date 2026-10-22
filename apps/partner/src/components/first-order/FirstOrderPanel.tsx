import { useCallback, useEffect, useRef, useState } from 'react'
import type { FirstOrderOverview } from '@ai-job-print/shared'
import { Button, Card, ErrorState, LoadingState } from '@ai-job-print/ui'
import { FIRST_ORDER_HTTP, firstOrderApi } from '../../services/api/firstOrder'
import { ProjectDetails } from './ProjectDetails'
import { IncidentPanel } from './IncidentPanel'
import { ReportPanel } from './ReportPanel'

const tabs = [{ key: 'details', label: '项目资料' }, { key: 'incidents', label: '报障与恢复' }, { key: 'reports', label: '月报资料' }] as const
type Tab = (typeof tabs)[number]['key']

export function FirstOrderPanel() {
  const [data, setData] = useState<FirstOrderOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState<Tab>('details')
  const request = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    if (!FIRST_ORDER_HTTP) { setLoading(false); return }
    request.current?.abort()
    const control = new AbortController(); request.current = control
    const task = ++sequence.current
    setLoading(true); setError('')
    try {
      const next = await firstOrderApi.overview(control.signal)
      if (task === sequence.current && !control.signal.aborted) setData(next)
    } catch (failure) {
      if (task === sequence.current && !control.signal.aborted) {
        const message = failure instanceof Error ? failure.message : '项目服务数据未能读取，请重试。'
        setError(message); throw new Error(message)
      }
    } finally { if (task === sequence.current) setLoading(false) }
  }, [])
  const cancelRequest = useCallback(() => { sequence.current++; request.current?.abort() }, [])
  useEffect(() => {
    void reload().catch(() => undefined)
    return cancelRequest
  }, [reload, cancelRequest])
  useEffect(() => {
    if (data && !data.projects.some((project) => project.id === selectedId)) setSelectedId(data.projects[0]?.id ?? '')
  }, [data, selectedId])

  const project = data?.projects.find((item) => item.id === selectedId) ?? null
  return <Card aria-label="首单交付与服务" className="mt-6 space-y-4" data-testid="first-order-panel">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-bold text-neutral-900">项目交付与服务</h3><p className="mt-1 text-sm text-neutral-500">核对本机构项目资料、了解设备处理进度、查看自然月报。</p></div>{FIRST_ORDER_HTTP && <Button size="sm" variant="outline" disabled={loading} onClick={() => void reload().catch(() => undefined)}>刷新项目服务</Button>}</div>
    {!FIRST_ORDER_HTTP ? <p className="text-sm text-neutral-500">项目交付与服务需要连接真实后端。当前为预览模式，不提供演示数据或模拟操作。</p> : loading && !data ? <LoadingState className="py-8" /> : !data ? <ErrorState title="项目服务数据读取失败" message={error} onRetry={() => void reload().catch(() => undefined)} className="py-6" /> : <>
      {error && <p role="alert" className="text-sm text-error-fg">{error} 现有内容尚未刷新，请核对后再操作。</p>}
      {data.projects.length === 0 ? <p className="text-sm text-neutral-500">本机构尚未登记服务项目，请联系平台核对采购与安装资料。终端现有运营数据仍可在上方查看。</p> : <label className="block text-sm">服务项目<select aria-label="服务项目" disabled={loading} className="mt-1 min-h-12 w-full rounded-lg border border-neutral-300 bg-white px-3 sm:max-w-xl" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">选择服务项目</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {project && <>
        <div role="tablist" aria-label="项目服务分组" className="flex flex-wrap gap-2">{tabs.map((item) => <Button key={item.key} size="sm" role="tab" aria-selected={tab === item.key} variant={tab === item.key ? 'primary' : 'outline'} onClick={() => setTab(item.key)}>{item.label}</Button>)}</div>
        {tab === 'details' && <ProjectDetails project={project} terminals={data.terminals} />}
        {tab === 'incidents' && <IncidentPanel key={project.id} deployments={project.deployments} incidents={data.incidents.filter((item) => item.projectId === project.id)} onChanged={reload} />}
        {tab === 'reports' && <ReportPanel key={project.id} projectId={project.id} reports={data.reports.filter((item) => item.projectId === project.id)} onChanged={reload} />}
      </>}
    </>}
  </Card>
}
