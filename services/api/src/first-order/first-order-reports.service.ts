import { BadRequestException, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { FirstOrderReport, FirstOrderReportSnapshot } from '../../../../packages/shared/src/types/firstOrder.contract'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PrismaService } from '../prisma/prisma.service'
import { FirstOrderAccessService } from './first-order-access.service'
import { buildFirstOrderReport } from './first-order-report-builder'
import { monthWindow, reportCsv } from './first-order-report-metrics'
import { reportView } from './first-order-mappers'

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
