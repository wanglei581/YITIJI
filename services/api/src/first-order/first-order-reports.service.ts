import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { FirstOrderReport, FirstOrderReportDirectory, FirstOrderReportSnapshot } from '../../../../packages/shared/src/types/firstOrder.contract'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PrismaService } from '../prisma/prisma.service'
import { FirstOrderAccessService } from './first-order-access.service'
import { buildFirstOrderReport } from './first-order-report-builder'
import { monthWindow, previousClosedMonth, reportCsv, reportDirectoryWindow } from './first-order-report-metrics'
import { reportView } from './first-order-mappers'

const MONTH_PREVIEW_STATUS = '本月尚未结束，只能预览' as const

function deploymentCoversMonth(
  deployment: { startedAt: Date; endedAt: Date | null },
  project: { serviceStartAt: Date; serviceEndAt: Date },
  from: Date,
  to: Date,
): boolean {
  const start = Math.max(deployment.startedAt.getTime(), project.serviceStartAt.getTime(), from.getTime())
  const end = Math.min(deployment.endedAt?.getTime() ?? Number.POSITIVE_INFINITY, project.serviceEndAt.getTime(), to.getTime())
  return start < end
}

@Injectable()
export class FirstOrderReportsService {
  constructor(private readonly prisma: PrismaService, private readonly access: FirstOrderAccessService, private readonly audit: AuditService) {}

  async preview(user: AuthedUser, projectId: string, month: string) {
    const project = await this.access.project(user, projectId)
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.serviceProject.findUniqueOrThrow({ where: { id: project.id }, include: { deployments: true } })
      return buildFirstOrderReport(tx, current, month)
    }, { isolationLevel: 'Serializable', timeout: 30_000 })
  }

  async create(user: AuthedUser, projectId: string, month: string): Promise<FirstOrderReport> {
    const project = await this.access.project(user, projectId)
    if (!monthWindow(month).closed) {
      throw new BadRequestException({ error: { code: 'FIRST_ORDER_MONTH_OPEN', message: '本月尚未结束，只能预览；结束后再留存月报' } })
    }
    const existing = await this.prisma.serviceReport.findUnique({ where: { projectId_month: { projectId, month } } })
    if (existing) return this.get(user, existing.id)
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const current = await tx.serviceProject.findUniqueOrThrow({ where: { id: project.id }, include: { deployments: true } })
        const snapshot = await buildFirstOrderReport(tx, current, month)
        const snapshotJson = JSON.stringify(snapshot)
        const created = await tx.serviceReport.create({ data: {
          projectId, orgId: project.orgId, month, snapshotJson,
          checksum: createHash('sha256').update(snapshotJson).digest('hex'),
        } })
        await this.audit.writeRequired(tx, { actorId: user.userId, actorRole: user.role,
          action: 'first_order.report_created', targetType: 'service_report', targetId: created.id,
          payload: { projectId, month, checksum: created.checksum, complete: snapshot.complete } })
        return { ...reportView(created), snapshot }
      }, { isolationLevel: 'Serializable', timeout: 30_000 })
      return result
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const winner = await this.prisma.serviceReport.findUnique({ where: { projectId_month: { projectId, month } } })
        if (winner) return this.get(user, winner.id)
      }
      throw error
    }
  }

  async get(user: AuthedUser, id: string): Promise<FirstOrderReport> {
    const row = await this.access.report(user, id)
    return { ...reportView(row), snapshot: JSON.parse(row.snapshotJson) as FirstOrderReportSnapshot }
  }

  async csv(user: AuthedUser, id: string): Promise<string> {
    const report = await this.get(user, id)
    await this.prisma.$transaction(async (tx) => {
      await this.audit.writeRequired(tx, { actorId: user.userId, actorRole: user.role,
        action: 'first_order.report_exported', targetType: 'service_report', targetId: id,
        payload: { checksum: report.checksum } })
    })
    return reportCsv(report.snapshot, { id: report.id, checksum: report.checksum })
  }

  /** One row per project with a deployment overlapping the month. Read-only; no audit write. */
  async listByMonth(user: AuthedUser, month: string | undefined, limit: number): Promise<FirstOrderReportDirectory> {
    if (user.role !== 'admin') {
      throw new ForbiddenException({ error: { code: 'FIRST_ORDER_SCOPE_REQUIRED', message: '当前账号没有该机构的访问权限' } })
    }
    const resolved = month ?? previousClosedMonth().month
    const window = reportDirectoryWindow(resolved)
    const projects = await this.prisma.serviceProject.findMany({
      where: {
        deployments: {
          some: {
            startedAt: { lt: window.to },
            OR: [{ endedAt: null }, { endedAt: { gt: window.from } }],
          },
        },
      },
      select: {
        id: true, name: true, orgId: true, serviceStartAt: true, serviceEndAt: true,
        org: { select: { name: true } },
        deployments: { select: { startedAt: true, endedAt: true } },
        reports: { where: { month: resolved }, select: { id: true, acknowledgedAt: true } },
      },
    })
    const items = projects.flatMap((project) => {
      const covers = project.deployments.some((deployment) => deploymentCoversMonth(deployment, project, window.from, window.to))
      if (!covers) return []
      const saved = project.reports[0] ?? null
      return [{
        orgId: project.orgId, orgName: project.org.name, projectId: project.id, projectName: project.name,
        month: resolved, reportId: saved?.id ?? null, acknowledgedAt: saved?.acknowledgedAt?.toISOString() ?? null,
        status: window.closed ? null : MONTH_PREVIEW_STATUS,
      }]
    }).sort((a, b) => a.orgName.localeCompare(b.orgName, 'zh') || a.projectName.localeCompare(b.projectName, 'zh') || a.projectId.localeCompare(b.projectId))
    return { month: resolved, items: items.slice(0, limit), total: items.length, truncated: items.length > limit }
  }

  async acknowledge(user: AuthedUser, id: string): Promise<FirstOrderReport> {
    const row = await this.access.report(user, id)
    if (!row.acknowledgedAt) {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.serviceReport.updateMany({ where: { id, acknowledgedAt: null }, data: { acknowledgedAt: new Date() } })
        if (changed.count) await this.audit.writeRequired(tx, { actorId: user.userId, actorRole: user.role,
          action: 'first_order.report_acknowledged', targetType: 'service_report', targetId: id,
          payload: { meaning: 'review_record_only_not_formal_acceptance' } })
      })
    }
    return this.get(user, id)
  }
}
