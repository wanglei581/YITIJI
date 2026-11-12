/**
 * 机构在后台提交、尚未关闭的报障。只进平台总通知，不进机构自己的群。
 * 正文不含报障备注、处理人和任何使用者信息。
 */

import { formatBeijingMinute } from '../common/beijing-display-time'
import type { PrismaService } from '../prisma/prisma.service'
import { buildSubjectKey, type DerivedAlertType } from './derived-alert-identity'

const ISSUE_LABELS: Record<string, string> = {
  offline: '设备离线',
  paper: '缺纸',
  jam: '卡纸',
  quality: '打印质量',
  scan: '扫描故障',
  other: '其他设备问题',
}

const OPEN_STATUSES = ['open', 'processing'] as const

export interface PartnerIncidentAlert {
  id: string
  subjectKey: string
  subjectId: string
  episodeToken: string
  type: 'partner_incident'
  severity: 'error'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
}

type IncidentRow = {
  id: string
  orgId: string
  terminalCode: string
  issueCode: string
  createdAt: Date
}

type IncidentDb = {
  serviceIncident?: {
    findMany?: (args: unknown) => Promise<IncidentRow[]>
    findFirst?: (args: unknown) => Promise<IncidentRow | null>
  }
  serviceIncidentEvent?: {
    findMany?: (args: unknown) => Promise<Array<{ incidentId: string; createdAt: Date }>>
  }
  organization?: {
    findMany?: (args: unknown) => Promise<Array<{ id: string; name: string }>>
  }
}

function issueLabel(code: string): string {
  return ISSUE_LABELS[code] ?? '其他设备问题'
}

function buildAlert(row: IncidentRow, orgName: string, episodeAt: Date): PartnerIncidentAlert {
  const subjectKey = buildSubjectKey('partner_incident' as DerivedAlertType, row.id)
  return {
    id: subjectKey,
    subjectKey,
    subjectId: row.id,
    episodeToken: episodeAt.toISOString(),
    type: 'partner_incident',
    severity: 'error',
    title: `机构报障未关闭：${orgName}的${row.terminalCode}（${issueLabel(row.issueCode)}）`,
    detail: `提交于 ${formatBeijingMinute(row.createdAt)}，仍未关闭`,
    terminalCode: row.terminalCode,
    occurredAt: episodeAt.toISOString(),
  }
}

async function orgNames(prisma: IncidentDb, orgIds: string[]): Promise<Map<string, string>> {
  const findMany = prisma.organization?.findMany
  if (typeof findMany !== 'function' || orgIds.length === 0) return new Map()
  const rows = await findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
  return new Map(rows.map((row) => [row.id, row.name]))
}

async function latestReopen(prisma: IncidentDb, incidentIds: string[]): Promise<Map<string, Date>> {
  const findMany = prisma.serviceIncidentEvent?.findMany
  if (typeof findMany !== 'function' || incidentIds.length === 0) return new Map()
  const events = await findMany({
    where: { incidentId: { in: incidentIds }, action: 'reopen' },
    orderBy: { createdAt: 'desc' },
    select: { incidentId: true, createdAt: true },
  })
  const latest = new Map<string, Date>()
  for (const event of events) {
    if (!latest.has(event.incidentId)) latest.set(event.incidentId, event.createdAt)
  }
  return latest
}

export async function collectPartnerIncidents(prisma: PrismaService, _now: Date): Promise<PartnerIncidentAlert[]> {
  const findMany = (prisma as unknown as IncidentDb).serviceIncident?.findMany
  if (typeof findMany !== 'function') return []
  const rows = await findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    select: { id: true, orgId: true, terminalCode: true, issueCode: true, createdAt: true },
  })
  if (rows.length === 0) return []
  const db = prisma as unknown as IncidentDb
  const [names, reopened] = await Promise.all([
    orgNames(db, [...new Set(rows.map((row) => row.orgId))]),
    latestReopen(db, rows.map((row) => row.id)),
  ])
  return rows.map((row) => buildAlert(row, names.get(row.orgId)?.trim() || '机构', reopened.get(row.id) ?? row.createdAt))
}

export async function resolvePartnerIncident(
  prisma: PrismaService,
  subjectId: string,
  now: Date,
): Promise<PartnerIncidentAlert | null> {
  const findFirst = (prisma as unknown as IncidentDb).serviceIncident?.findFirst
  if (typeof findFirst !== 'function') return null
  const row = await findFirst({
    where: { id: subjectId, status: { in: [...OPEN_STATUSES] } },
    select: { id: true, orgId: true, terminalCode: true, issueCode: true, createdAt: true },
  })
  if (!row) return null
  const db = prisma as unknown as IncidentDb
  const [names, reopened] = await Promise.all([
    orgNames(db, [row.orgId]),
    latestReopen(db, [row.id]),
  ])
  void now
  return buildAlert(row, names.get(row.orgId)?.trim() || '机构', reopened.get(row.id) ?? row.createdAt)
}
