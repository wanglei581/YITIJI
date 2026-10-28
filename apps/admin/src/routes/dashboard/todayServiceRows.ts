import { formatCount } from '@ai-job-print/shared'
import {
  PREVIEW_INCIDENTS_AND_REPORTS,
  PREVIEW_UNCONFIRMED,
  QUEUE_MISS,
  groupByOrg,
  incidentCountText,
  incidentLine,
  partnerSectionHref,
} from '../../components/first-order/serviceQueueModel'
import type { IncidentQueue, QueueState, ReportQueue } from '../../components/first-order/useServiceQueues'

export interface TodayLine {
  key: string
  text: string
  href: string
  action: string
}

export interface TodayRow {
  key: string
  title: string
  detail: string
  href?: string
  action: string
  onRetry?: () => void
  lines?: TodayLine[]
  note?: string
}

function loadingRow(key: string, title: string): TodayRow {
  return { key, title, detail: '正在读取', action: '' }
}

function errorRow(key: string, title: string, onRetry: () => void): TodayRow {
  return { key, title, detail: QUEUE_MISS, action: '重试', onRetry }
}

function previewRow(key: string, title: string): TodayRow {
  return { key, title, detail: '', action: '' }
}

/** 报障比离线名单更急：已经有机构在等受理。演示模式两块合成一句，不画数字。 */
export function incidentTodayRows(
  incidents: QueueState<IncidentQueue>,
  onRetry: () => void,
): TodayRow[] {
  if (incidents.status === 'loading') return [loadingRow('incidents-loading', '机构报障')]
  if (incidents.status === 'preview') return [previewRow('first-order-preview', PREVIEW_INCIDENTS_AND_REPORTS)]
  if (incidents.status === 'error') return [errorRow('incidents-error', '机构报障', onRetry)]
  if (incidents.data.total <= 0) return []
  const data = incidents.data
  return [{
    key: 'incidents',
    title: incidentCountText(data, '技术恢复待机构核对'),
    detail: '',
    action: '',
    lines: data.earliest.map((item) => ({
      key: item.id,
      text: incidentLine(item),
      href: partnerSectionHref(item.orgId, 'incidents'),
      action: '去处理',
    })),
    note: data.truncated && data.shown > 0
      ? `共 ${formatCount(data.total)} 条，先显示最早的 ${formatCount(data.shown)} 条`
      : undefined,
  }]
}

/** 月报是上月留存，晚于正在影响使用的设备问题。机构没核对的只读提示，不给代核对。 */
export function reportTodayRows(
  reports: QueueState<ReportQueue>,
  incidents: QueueState<IncidentQueue>,
  onRetry: () => void,
): TodayRow[] {
  if (incidents.status === 'preview') return []
  if (reports.status === 'loading') return [loadingRow('reports-loading', '月报')]
  if (reports.status === 'preview') return [previewRow('reports-preview', '演示模式不显示月报')]
  if (reports.status === 'error') return [errorRow('reports-error', '月报', onRetry)]
  if (reports.data.truncated) {
    return [{
      key: 'reports-truncated',
      title: '上月月报这次没有完整读完',
      detail: '项目较多，请到合作机构管理逐家查看',
      href: '/partners',
      action: '去查看',
    }]
  }
  const rows: TodayRow[] = []
  const missing = reports.data.missing
  if (missing.length > 0) {
    rows.push({
      key: 'reports-missing',
      title: `${formatCount(missing.length)} 个项目上月还没留存月报`,
      detail: '',
      action: '',
      lines: groupByOrg(missing).map((org) => ({
        key: org.orgId,
        text: `${org.orgName} · ${formatCount(org.count)} 个项目`,
        href: partnerSectionHref(org.orgId, 'reports'),
        action: '去处理',
      })),
    })
  }
  if (reports.data.awaitingAck > 0) {
    rows.push({
      key: 'reports-ack',
      title: `${formatCount(reports.data.awaitingAck)} 份等机构核对`,
      detail: '由机构自行核对',
      action: '',
    })
  }
  return rows
}

export function unconfirmedTodayRows(state: QueueState<number>, onRetry: () => void): TodayRow[] {
  if (state.status === 'loading') return [loadingRow('unconfirmed-loading', '出纸未确认')]
  if (state.status === 'preview') return [previewRow('unconfirmed-preview', PREVIEW_UNCONFIRMED)]
  if (state.status === 'error') return [errorRow('unconfirmed-error', '出纸未确认', onRetry)]
  if (state.data <= 0) return []
  return [{
    key: 'unconfirmed',
    title: `${formatCount(state.data)} 单出纸未确认，去核查`,
    detail: '',
    href: '/print-scan?unconfirmed=1',
    action: '去核查',
  }]
}
