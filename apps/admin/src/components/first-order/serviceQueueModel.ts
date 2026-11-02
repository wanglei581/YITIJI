import { FIRST_ORDER_ISSUE_LABELS, formatCount, type FirstOrderIncidentDirectoryItem, type FirstOrderReportDirectoryItem } from '@ai-job-print/shared'

export type PartnerSection = 'project' | 'incidents' | 'reports'

export const PREVIEW_INCIDENTS_AND_REPORTS = '演示模式不显示机构报障与月报'
export const PREVIEW_UNCONFIRMED = '演示模式不显示出纸未确认'
export const QUEUE_MISS = '这类这次没读到'
export const EARLIEST_INCIDENTS = 3

const SECTIONS: readonly PartnerSection[] = ['project', 'incidents', 'reports']

export function parsePartnerSection(value: string | null): PartnerSection | null {
  return SECTIONS.find((section) => section === value) ?? null
}

export function partnerSectionHref(orgId: string, section: PartnerSection, projectId?: string | null): string {
  const base = `/partners?org=${encodeURIComponent(orgId)}&section=${section}`
  return projectId ? `${base}&projectId=${encodeURIComponent(projectId)}` : base
}

/** 首单客户端和出纸未确认在演示模式都会抛这句，不能当成读取失败。 */
export function isPreviewFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('需要连接真实后端') || error.message.includes('当前预览模式')
}

export function waitedText(createdAt: string, now = Date.now()): string {
  const start = Date.parse(createdAt)
  if (!Number.isFinite(start)) return '等待时长未读到'
  const minutes = Math.max(0, Math.floor((now - start) / 60_000))
  if (minutes < 1) return '刚提交'
  if (minutes < 60) return `等了 ${formatCount(minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `等了 ${formatCount(hours)} 小时`
  return `等了 ${formatCount(Math.floor(hours / 24))} 天`
}

export function incidentCountText(
  counts: { total: number; open: number; processing: number; resolved: number },
  resolvedLabel: string,
): string {
  return `未结报障 ${formatCount(counts.total)}（待受理 ${formatCount(counts.open)} · 处理中 ${formatCount(counts.processing)} · ${resolvedLabel} ${formatCount(counts.resolved)}）`
}

export function incidentLine(item: FirstOrderIncidentDirectoryItem, now = Date.now()): string {
  const issue = FIRST_ORDER_ISSUE_LABELS[item.issueCode] ?? '其他设备问题'
  return `${item.orgName} · ${item.terminalCode} · ${issue} · ${waitedText(item.createdAt, now)}`
}

export function earliestIncidents(items: FirstOrderIncidentDirectoryItem[]): FirstOrderIncidentDirectoryItem[] {
  return [...items]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(0, EARLIEST_INCIDENTS)
}

export function countIncidentStatuses(items: FirstOrderIncidentDirectoryItem[]): { open: number; processing: number; resolved: number } {
  const counts = { open: 0, processing: 0, resolved: 0 }
  for (const item of items) {
    if (item.status === 'open' || item.status === 'processing' || item.status === 'resolved') counts[item.status] += 1
  }
  return counts
}

/** 未结束月份的空 reportId 是预览，不是没留存。 */
export function missingReports(items: FirstOrderReportDirectoryItem[]): FirstOrderReportDirectoryItem[] {
  return items.filter((item) => item.status === null && item.reportId === null)
}

export function unacknowledgedReports(items: FirstOrderReportDirectoryItem[]): FirstOrderReportDirectoryItem[] {
  return items.filter((item) => item.status === null && item.reportId !== null && !item.acknowledgedAt)
}

export function groupByOrg(items: { orgId: string; orgName: string }[]): { orgId: string; orgName: string; count: number }[] {
  const grouped = new Map<string, { orgId: string; orgName: string; count: number }>()
  for (const item of items) {
    const current = grouped.get(item.orgId)
    if (current) current.count += 1
    else grouped.set(item.orgId, { orgId: item.orgId, orgName: item.orgName, count: 1 })
  }
  return [...grouped.values()]
}
