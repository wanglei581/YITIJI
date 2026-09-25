import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import {
  assertEmergencyReason,
  type EmergencyReasonCode,
} from './recruitment-hosting'

export type EmergencyTargetType = 'job' | 'job_fair' | 'company' | 'policy'

const TARGET_LABEL: Record<EmergencyTargetType, string> = {
  job: '岗位',
  job_fair: '招聘会',
  company: '企业资料',
  policy: '政策',
}

interface TargetRow {
  id: string
  orgId: string
  sourceId: string | null
  title: string
  publishStatus: string
}

@Injectable()
export class RecruitmentEmergencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async takedown(
    targetType: EmergencyTargetType,
    targetId: string,
    reasonCode: string | undefined,
    reasonText: string | undefined,
    actor: AuthedUser,
  ) {
    const reason = assertEmergencyReason(reasonCode, reasonText)
    const row = await this.loadOne(targetType, targetId)
    await this.applyOne(targetType, row, reason, actor, 'single')
    return { targetType, targetId, publishStatus: 'unpublished', irreversible: true }
  }

  async circuitBreak(
    scope: 'org' | 'source',
    id: string,
    reasonCode: string | undefined,
    reasonText: string | undefined,
    actor: AuthedUser,
  ) {
    const reason = assertEmergencyReason(reasonCode, reasonText)
    const trimmed = id.trim()
    if (!trimmed) {
      throw new BadRequestException({ error: { code: 'CIRCUIT_BREAK_TARGET_REQUIRED', message: '请指定机构或来源' } })
    }
    const rows = await this.loadScope(scope, trimmed)
    for (const item of rows) {
      await this.applyOne(item.targetType, item.row, reason, actor, 'circuit_break')
    }
    const orgIds = [...new Set(rows.map((item) => item.row.orgId))]
    await this.audit.write({
      actorId: actor.userId,
      actorRole: 'admin',
      action: 'recruitment.circuit_break',
      targetType: scope === 'org' ? 'organization' : 'job_source',
      targetId: trimmed,
      payload: {
        scope,
        reasonCode: reason.reasonCode,
        reasonText: reason.reasonText,
        count: rows.length,
        orgIds,
      },
    })
    return { scope, id: trimmed, unpublished: rows.length, irreversible: true }
  }

  async listNotices(orgId: string) {
    return this.prisma.partnerOrgNotice.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, kind: true, title: true, body: true, payloadJson: true, readAt: true, createdAt: true },
    })
  }

  private async loadOne(targetType: EmergencyTargetType, targetId: string): Promise<TargetRow> {
    const row = await this.findRow(targetType, targetId)
    if (!row) {
      throw new NotFoundException({ error: { code: 'CONTENT_NOT_FOUND', message: '内容不存在' } })
    }
    return row
  }

  private async findRow(targetType: EmergencyTargetType, targetId: string): Promise<TargetRow | null> {
    if (targetType === 'job') {
      const row = await this.prisma.job.findUnique({
        where: { id: targetId },
        select: { id: true, sourceOrgId: true, sourceId: true, title: true, publishStatus: true },
      })
      return row ? { id: row.id, orgId: row.sourceOrgId, sourceId: row.sourceId, title: row.title, publishStatus: row.publishStatus } : null
    }
    if (targetType === 'job_fair') {
      const row = await this.prisma.jobFair.findUnique({
        where: { id: targetId },
        select: { id: true, sourceOrgId: true, sourceId: true, title: true, publishStatus: true },
      })
      return row ? { id: row.id, orgId: row.sourceOrgId, sourceId: row.sourceId, title: row.title, publishStatus: row.publishStatus } : null
    }
    if (targetType === 'company') {
      const row = await this.prisma.companyProfile.findUnique({
        where: { id: targetId },
        select: { id: true, sourceOrgId: true, name: true, publishStatus: true },
      })
      return row ? { id: row.id, orgId: row.sourceOrgId, sourceId: null, title: row.name, publishStatus: row.publishStatus } : null
    }
    const row = await this.prisma.policyPost.findUnique({
      where: { id: targetId },
      select: { id: true, sourceOrgId: true, title: true, publishStatus: true },
    })
    return row ? { id: row.id, orgId: row.sourceOrgId, sourceId: null, title: row.title, publishStatus: row.publishStatus } : null
  }

  private async loadScope(scope: 'org' | 'source', id: string): Promise<Array<{ targetType: EmergencyTargetType; row: TargetRow }>> {
    const orgWhere = scope === 'org' ? { sourceOrgId: id } : undefined
    const sourceWhere = scope === 'source' ? { sourceId: id } : undefined
    const published = { publishStatus: 'published' as const }
    const [jobs, fairs, companies, policies] = await Promise.all([
      this.prisma.job.findMany({
        where: { ...published, ...(orgWhere ?? sourceWhere) },
        select: { id: true, sourceOrgId: true, sourceId: true, title: true, publishStatus: true },
      }),
      this.prisma.jobFair.findMany({
        where: { ...published, ...(orgWhere ?? sourceWhere) },
        select: { id: true, sourceOrgId: true, sourceId: true, title: true, publishStatus: true },
      }),
      scope === 'org'
        ? this.prisma.companyProfile.findMany({
            where: { ...published, sourceOrgId: id },
            select: { id: true, sourceOrgId: true, name: true, publishStatus: true },
          })
        : Promise.resolve([]),
      scope === 'org'
        ? this.prisma.policyPost.findMany({
            where: { ...published, sourceOrgId: id },
            select: { id: true, sourceOrgId: true, title: true, publishStatus: true },
          })
        : Promise.resolve([]),
    ])
    return [
      ...jobs.map((row) => ({
        targetType: 'job' as const,
        row: { id: row.id, orgId: row.sourceOrgId, sourceId: row.sourceId, title: row.title, publishStatus: row.publishStatus },
      })),
      ...fairs.map((row) => ({
        targetType: 'job_fair' as const,
        row: { id: row.id, orgId: row.sourceOrgId, sourceId: row.sourceId, title: row.title, publishStatus: row.publishStatus },
      })),
      ...companies.map((row) => ({
        targetType: 'company' as const,
        row: { id: row.id, orgId: row.sourceOrgId, sourceId: null, title: row.name, publishStatus: row.publishStatus },
      })),
      ...policies.map((row) => ({
        targetType: 'policy' as const,
        row: { id: row.id, orgId: row.sourceOrgId, sourceId: null, title: row.title, publishStatus: row.publishStatus },
      })),
    ]
  }

  private async applyOne(
    targetType: EmergencyTargetType,
    row: TargetRow,
    reason: { reasonCode: EmergencyReasonCode; reasonText: string },
    actor: AuthedUser,
    mode: 'single' | 'circuit_break',
  ) {
    const existing = await this.prisma.recruitmentEmergencyHold.findFirst({
      where: { targetType, targetId: row.id },
      select: { id: true },
    })
    if (row.publishStatus !== 'unpublished') {
      await this.markUnpublished(targetType, row.id)
    }
    if (!existing) {
      await this.prisma.recruitmentEmergencyHold.create({
        data: {
          targetType,
          targetId: row.id,
          orgId: row.orgId,
          sourceId: row.sourceId,
          reasonCode: reason.reasonCode,
          reasonText: reason.reasonText,
          actorId: actor.userId,
        },
      })
      await this.prisma.partnerOrgNotice.create({
        data: {
          orgId: row.orgId,
          kind: 'recruitment_emergency_takedown',
          title: `${TARGET_LABEL[targetType]}已紧急下架`,
          body: `「${row.title}」已由平台紧急下架。事由：${reason.reasonText}。此下架不能由管理员恢复。`,
          payloadJson: JSON.stringify({
            targetType,
            targetId: row.id,
            reasonCode: reason.reasonCode,
            mode,
          }),
        },
      })
    }
    await this.audit.write({
      actorId: actor.userId,
      actorRole: 'admin',
      action: 'recruitment.emergency_takedown',
      targetType,
      targetId: row.id,
      payload: {
        orgId: row.orgId,
        reasonCode: reason.reasonCode,
        reasonText: reason.reasonText,
        mode,
        alreadyHeld: Boolean(existing),
      },
    })
  }

  private async markUnpublished(targetType: EmergencyTargetType, id: string) {
    const data = { publishStatus: 'unpublished' }
    if (targetType === 'job') await this.prisma.job.update({ where: { id }, data })
    else if (targetType === 'job_fair') await this.prisma.jobFair.update({ where: { id }, data })
    else if (targetType === 'company') await this.prisma.companyProfile.update({ where: { id }, data })
    else await this.prisma.policyPost.update({ where: { id }, data })
  }
}
