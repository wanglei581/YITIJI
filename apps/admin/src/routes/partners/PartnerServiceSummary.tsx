import { useState } from 'react'
import { formatCount } from '@ai-job-print/shared'
import {
  PREVIEW_INCIDENTS_AND_REPORTS,
  QUEUE_MISS,
  groupByOrg,
  incidentCountText,
  type PartnerSection,
} from '../../components/first-order/serviceQueueModel'
import { useIncidentQueue, useReportQueue, type IncidentQueue, type ReportQueue } from '../../components/first-order/useServiceQueues'

const ROW_CLASS = 'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 text-left hover:bg-neutral-50'

function uniqueOrgs(items: { orgId: string; orgName: string }[]): { orgId: string; orgName: string }[] {
  const seen = new Set<string>()
  const rows: { orgId: string; orgName: string }[] = []
  for (const item of items) {
    if (seen.has(item.orgId)) continue
    seen.add(item.orgId)
    rows.push({ orgId: item.orgId, orgName: item.orgName })
  }
  return rows
}

export function PartnerServiceSummary({ onOpen }: { onOpen: (orgId: string, section: PartnerSection, projectId?: string | null) => void }) {
  const incidents = useIncidentQueue()
  const reports = useReportQueue()
  const [expanded, setExpanded] = useState(false)
  const incidentState = incidents.state
  const reportState = reports.state

  if (incidentState.status === 'preview' || reportState.status === 'preview') {
    return <p className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-700">{PREVIEW_INCIDENTS_AND_REPORTS}</p>
  }

  const monthText = (data: ReportQueue) => data.truncated ? '上月月报这次没有完整读完' : `上月未留存月报 ${formatCount(data.missing.length)}`

  return (
    <div className="mb-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800">
      {incidentState.status === 'loading' && <p>机构报障正在读取</p>}
      {incidentState.status === 'error' && (
        <p>机构报障：{QUEUE_MISS}<button type="button" className="ml-3 font-semibold text-primary-700" onClick={incidents.retry}>重试</button></p>
      )}
      {reportState.status === 'loading' && <p>月报正在读取</p>}
      {reportState.status === 'error' && (
        <p>月报：{QUEUE_MISS}<button type="button" className="ml-3 font-semibold text-primary-700" onClick={reports.retry}>重试</button></p>
      )}
      {incidentState.status === 'ready' && reportState.status === 'ready' && (
        <>
          <button type="button" aria-expanded={expanded} className="text-left font-semibold" onClick={() => setExpanded((open) => !open)}>
            {incidentCountText(incidentState.data, '待机构核对')} · {monthText(reportState.data)}
          </button>
          {expanded && <SummaryList incidents={incidentState.data} reports={reportState.data} onOpen={onOpen} />}
        </>
      )}
      {incidentState.status === 'ready' && reportState.status !== 'ready' && <p>{incidentCountText(incidentState.data, '待机构核对')}</p>}
      {reportState.status === 'ready' && incidentState.status !== 'ready' && <p>{monthText(reportState.data)}</p>}
    </div>
  )
}

function SummaryList({
  incidents,
  reports,
  onOpen,
}: {
  incidents: IncidentQueue
  reports: ReportQueue
  onOpen: (orgId: string, section: PartnerSection, projectId?: string | null) => void
}) {
  const incidentRows = incidents.orgCounts ?? uniqueOrgs(incidents.earliest).map((org) => ({ ...org, count: null as number | null }))
  const reportRows = reports.truncated ? [] : groupByOrg(reports.missing)
  return (
    <div className="mt-2 border-t border-neutral-100 pt-2">
      {incidents.truncated && incidents.shown > 0 && (
        <p className="px-2 py-1 text-xs text-neutral-500">共 {formatCount(incidents.total)} 条，先显示最早的 {formatCount(incidents.shown)} 条</p>
      )}
      {incidentRows.map((org) => (
        <button key={`incident-${org.orgId}`} type="button" className={ROW_CLASS} onClick={() => onOpen(org.orgId, 'incidents', incidents.earliest.find((item) => item.orgId === org.orgId)?.projectId)}>
          <span className="min-w-0 truncate">{org.orgName}</span>
          {org.count !== null && <span className="shrink-0 text-neutral-500">未结报障 {formatCount(org.count)}</span>}
        </button>
      ))}
      {reports.truncated && <p className="px-2 py-1 text-xs text-neutral-500">项目较多，月报情况请打开各机构查看</p>}
      {reportRows.map((org) => (
        <button key={`report-${org.orgId}`} type="button" className={ROW_CLASS} onClick={() => onOpen(org.orgId, 'reports', reports.missing.find((item) => item.orgId === org.orgId)?.projectId)}>
          <span className="min-w-0 truncate">{org.orgName}</span>
          <span className="shrink-0 text-neutral-500">未留存 {formatCount(org.count)}</span>
        </button>
      ))}
      {incidentRows.length === 0 && reportRows.length === 0 && !reports.truncated && (
        <p className="px-2 py-2 text-neutral-500">没有要跟进的机构</p>
      )}
    </div>
  )
}
