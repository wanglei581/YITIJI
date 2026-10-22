import { useEffect, useRef, useState } from 'react'
import { formatDateTime, type FirstOrderReport, type FirstOrderReportSnapshot, type FirstOrderReportSummary } from '@ai-job-print/shared'
import { Button } from '@ai-job-print/ui'
import { firstOrderApi } from '../../services/api/firstOrder'

const metricLabels = { sessions: '服务会话数', printedTasks: '出纸记录任务数', printedFaces: '系统记录的出纸印面数', unconfirmedPrints: '未确认出纸任务数', failedPrints: '失败打印任务数', completedScans: '已完成扫描任务数', offlineMinutes: '心跳推导离线分钟' } as const
const stateLabels = { measured: '', sample_suppressed: '样本不足，不显示', not_recorded: '暂无可用记录', unverified: '暂不能核验' } as const
const currentMonth = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date())

export function ReportPanel({ projectId, reports, onChanged }: { projectId: string; reports: FirstOrderReportSummary[]; onChanged: () => Promise<void> }) {
  const [month, setMonth] = useState(currentMonth)
  const [view, setView] = useState<{ snapshot: FirstOrderReportSnapshot; saved: FirstOrderReport | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  useEffect(() => () => { sequence.current++; controller.current?.abort() }, [])

  function cancelView() { sequence.current++; controller.current?.abort(); setView(null); setError(''); setBusy(false) }
  async function showReport(id?: string) {
    controller.current?.abort()
    const control = new AbortController(); controller.current = control
    const task = ++sequence.current
    setBusy(true); setError(''); setView(null)
    try {
      if (id) {
        const report = await firstOrderApi.report(id, control.signal)
        if (task === sequence.current) setView({ snapshot: report.snapshot, saved: report })
      } else {
        const snapshot = await firstOrderApi.preview(projectId, month, control.signal)
        if (task === sequence.current) setView({ snapshot, saved: null })
      }
    } catch (failure) { if (task === sequence.current && !control.signal.aborted) setError(failure instanceof Error ? failure.message : '报告暂时未能读取，请重试。') }
    finally { if (task === sequence.current) setBusy(false) }
  }
  async function seal() {
    setBusy(true); setError('')
    try {
      const report = await firstOrderApi.seal(projectId, month)
      setView({ snapshot: report.snapshot, saved: report }); await onChanged()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '月报未能生成，请刷新核对后重试。') }
    finally { setBusy(false) }
  }
  async function acknowledge() {
    if (!view?.saved) return
    setBusy(true); setError('')
    try {
      const report = await firstOrderApi.acknowledge(view.saved.id)
      setView({ snapshot: report.snapshot, saved: report }); await onChanged()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '核对记录未能保存，请刷新后重试。') }
    finally { setBusy(false) }
  }
  async function download(report: FirstOrderReportSummary) {
    setBusy(true); setError('')
    try { await firstOrderApi.downloadReport(report.id, report.month) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '导出未完成，请重试。') }
    finally { setBusy(false) }
  }

  return <section aria-label="自然月报与交付资料" className="space-y-4 rounded-xl border border-neutral-200 p-4">
    <h4 className="font-semibold text-neutral-900">自然月报与交付资料</h4>
    <p className="text-xs leading-relaxed text-neutral-500">按北京时间自然月统计。当前月仅作预览；已结束月份可生成留存月报，同月再次生成会读取原快照。报告保留缺失说明，不代表正式验收或法定电子签章。</p>
    <div className="flex flex-wrap items-end gap-2"><label className="text-sm">统计月份<input type="month" aria-label="统计月份" max={currentMonth()} className="mt-1 block min-h-12 rounded-lg border border-neutral-300 px-3" value={month} disabled={busy} onChange={(event) => { cancelView(); setMonth(event.target.value) }} /></label><Button size="sm" variant="outline" disabled={busy || !month} onClick={() => void showReport()}>{busy ? '正在读取…' : '预览自然月报'}</Button><Button size="sm" disabled={busy || !month || month >= currentMonth()} onClick={() => void seal()}>生成留存月报</Button></div>
    {month >= currentMonth() && <p className="text-xs text-neutral-500">本月尚未结束，暂不能生成留存月报。</p>}
    {error && <p role="alert" className="text-sm text-error-fg">{error}</p>}
    {view && <div className="space-y-3 rounded-lg bg-neutral-50 p-3" data-testid="first-order-report-view">
      <h5 className="font-semibold">{view.snapshot.month} · {view.saved ? '已留存月报' : '临时预览'}</h5>
      <p className="text-xs text-neutral-500">统计于 {formatDateTime(view.snapshot.generatedAt)} · {view.snapshot.complete ? '统计范围完整，仍需核对业务结果' : '存在统计边界或缺失，请查看说明'}</p>
      <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(view.snapshot.metrics).map(([key, metric]) => <div key={key}><dt className="text-xs text-neutral-500">{metricLabels[key as keyof typeof metricLabels]}</dt><dd className="text-sm font-semibold">{metric.state === 'measured' && metric.value !== null ? metric.value : stateLabels[metric.state] || '暂不能统计'}</dd><dd className="text-xs text-neutral-500">{metric.note}</dd></div>)}</dl>
      {view.snapshot.limitations.length > 0 && <div><h6 className="text-sm font-semibold">统计说明与缺失</h6><ul className="list-disc space-y-1 pl-4 text-xs text-neutral-600">{view.snapshot.limitations.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
      <p className="text-xs text-neutral-500">AI可用率当前尚未接入可信的机构终端统计，本报告不提供该数值。印面数不等于纸张数，也不含面板复印量。</p>
      {view.saved && !view.saved.acknowledgedAt && <div className="space-y-2"><p className="text-xs text-neutral-500">请先核对报告的范围、统计说明和缺失项，再记录已核对。这不等同于正式采购验收通过。</p><Button size="sm" disabled={busy} onClick={() => void acknowledge()}>记录已核对月报</Button></div>}
      {view.saved && <p className="break-all text-xs text-neutral-500">报告编号：{view.saved.id}<br />文件校验摘要：{view.saved.checksum}<br />{view.saved.acknowledgedAt ? `机构核对于 ${formatDateTime(view.saved.acknowledgedAt)}` : '机构尚未记录已核对'}</p>}
    </div>}
    <div className="space-y-2"><h5 className="text-sm font-semibold">已留存报告</h5>{reports.length ? reports.map((report) => <div key={report.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-3 text-sm"><span className="mr-auto">{report.month} · {report.acknowledgedAt ? '机构已核对' : '待机构核对'}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => void showReport(report.id)}>查看 {report.month} 月报</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void download(report)}>下载 {report.month} CSV</Button></div>) : <p className="text-sm text-neutral-500">尚无已留存月报。当前月可先预览。</p>}</div>
  </section>
}
