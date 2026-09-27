import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import {
  assertEmergencyReason,
  type EmergencyReasonCode,
} from './recruitment-hosting'

export type EmergencyTargetType = 'job' | 'job_fair' | 'company' | 'policy' | 'fair_material' | 'offline_agency' | 'official_channel'

const TARGET_LABEL: Record<EmergencyTargetType, string> = {
  job: '岗位',
  job_fair: '招聘会',
  company: '企业资料',
  policy: '政策',
  fair_material: '招聘会资料',
  offline_agency: '线下机构',
  official_channel: '本机构官方渠道',
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
    return this.prisma.$transaction(async (tx) => {
      if (scope === 'org') {
        const org = await tx.organization.findUnique({ where: { id: trimmed }, select: { id: true } })
        if (!org) throw new NotFoundException({ error: { code: 'CONTENT_NOT_FOUND', message: '机构不存在' } })
      } else {
        const source = await tx.jobSource.findUnique({ where: { id: trimmed }, select: { id: true } })
        if (!source) throw new NotFoundException({ error: { code: 'CONTENT_NOT_FOUND', message: '来源不存在' } })
        await tx.jobSource.update({ where: { id: trimmed }, data: { enabled: false } })
      }
      await tx.recruitmentCircuitBreak.upsert({
        where: { scope_targetId: { scope, targetId: trimmed } },
        create: { scope, targetId: trimmed, reasonCode: reason.reasonCode, reasonText: reason.reasonText, actorId: actor.userId },
        update: {},
      })
      const rows = await this.loadScope(tx, scope, trimmed)
      for (const item of rows) await this.applyOneInTx(tx, item.targetType, item.row, reason, actor, 'circuit_break')
      await this.audit.writeRequired(tx, {
        actorId: actor.userId, actorRole: 'admin', action: 'recruitment.circuit_break',
        targetType: scope === 'org' ? 'organization' : 'job_source', targetId: trimmed,
        payload: { scope, reasonCode: reason.reasonCode, reasonText: reason.reasonText,
          count: rows.length, orgIds: [...new Set(rows.map((item) => item.row.orgId))] },
      })
      return { scope, id: trimmed, unpublished: rows.length, irreversible: true }
    })
  }

  /** 机构看到的下架 / 熔断通知，最新 50 条；超过时如实返回总数与截断标记，不让前端以为这就是全部。 */
  async listNotices(orgId: string) {
    const where = { orgId }
    const [items, total] = await Promise.all([
      this.prisma.partnerOrgNotice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, kind: true, title: true, body: true, payloadJson: true, readAt: true, createdAt: true },
      }),
      this.prisma.partnerOrgNotice.count({ where }),
    ])
    return { items, total, truncated: total > items.length }
  }

  private async loadOne(targetType: EmergencyTargetType, targetId: string): Promise<TargetRow> {
    const row = await this.findRow(targetType, targetId)
    if (!row) {
      throw new NotFoundException({ error: { code: 'CONTENT_NOT_FOUND', message: '内容不存在' } })
    }
    return row
  }

  private async findRow(targetType: EmergencyTargetType, targetId: string): Promise<TargetRow | null> {
    if (targetType === 'official_channel') {
      const row = await this.prisma.onlinePlatformDirectory.findFirst({
        where: { id: targetId, category: 'official_channel', archivedAt: null, organizationId: { not: null } },
        select: { id: true, organizationId: true, name: true, status: true },
      })
      return row && row.organizationId
        ? { id: row.id, orgId: row.organizationId, sourceId: null, title: row.name, publishStatus: row.status === 'active' ? 'published' : 'unpublished' }
        : null
    }
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
    if (targetType === 'fair_material') {
      const row = await this.prisma.fairMaterial.findUnique({
        where: { id: targetId },
        select: {
          id: true, name: true, publishStatus: true,
          jobFair: { select: { sourceOrgId: true, sourceId: true } },
        },
      })
      return row
        ? { id: row.id, orgId: row.jobFair.sourceOrgId, sourceId: row.jobFair.sourceId, title: row.name, publishStatus: row.publishStatus }
        : null
    }
    if (targetType === 'offline_agency') {
      const row = await this.prisma.offlineAgency.findUnique({
        where: { id: targetId },
        select: { id: true, name: true, publishStatus: true, sourceOrgId: true },
      })
      return row
        ? { id: row.id, orgId: row.sourceOrgId ?? '', sourceId: null, title: row.name, publishStatus: row.publishStatus }
        : null
    }
    const row = await this.prisma.policyPost.findUnique({
      where: { id: targetId },
      select: { id: true, sourceOrgId: true, title: true, publishStatus: true },
    })
    return row ? { id: row.id, orgId: row.sourceOrgId, sourceId: null, title: row.title, publishStatus: row.publishStatus } : null
  }

  private async loadScope(tx: PrismaTransactionClient, scope: 'org' | 'source', id: string): Promise<Array<{ targetType: EmergencyTargetType; row: TargetRow }>> {
    const orgWhere = scope === 'org' ? { sourceOrgId: id } : undefined
    const sourceWhere = scope === 'source' ? { sourceId: id } : undefined
    const [jobs, fairs, companies, policies, materials, agencies, channels] = await Promise.all([
      tx.job.findMany({
        where: { ...(orgWhere ?? sourceWhere) },
        select: { id: true, sourceOrgId: true, sourceId: true, title: true, publishStatus: true },
      }),
      tx.jobFair.findMany({
        where: { ...(orgWhere ?? sourceWhere) },
        select: { id: true, sourceOrgId: true, sourceId: true, title: true, publishStatus: true },
      }),
      scope === 'org'
        ? tx.companyProfile.findMany({
            where: { sourceOrgId: id },
            select: { id: true, sourceOrgId: true, name: true, publishStatus: true },
          })
        : Promise.resolve([]),
      scope === 'org'
        ? tx.policyPost.findMany({
            where: { sourceOrgId: id },
            select: { id: true, sourceOrgId: true, title: true, publishStatus: true },
          })
        : Promise.resolve([]),
      tx.fairMaterial.findMany({
        where: {
          deletedAt: null,
          jobFair: scope === 'org' ? { sourceOrgId: id } : { sourceId: id },
        },
        select: {
          id: true, name: true, publishStatus: true,
          jobFair: { select: { sourceOrgId: true, sourceId: true } },
        },
      }),
      scope === 'org'
        ? tx.offlineAgency.findMany({
            where: { sourceOrgId: id },
            select: { id: true, name: true, publishStatus: true, sourceOrgId: true },
          })
        : Promise.resolve([]),
      scope === 'org'
        ? tx.onlinePlatformDirectory.findMany({
            where: { organizationId: id, category: 'official_channel', archivedAt: null },
            select: { id: true, organizationId: true, name: true, status: true },
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
      ...materials.map((row) => ({
        targetType: 'fair_material' as const,
        row: {
          id: row.id,
          orgId: row.jobFair.sourceOrgId,
          sourceId: row.jobFair.sourceId,
          title: row.name,
          publishStatus: row.publishStatus,
        },
      })),
      ...agencies.map((row) => ({
        targetType: 'offline_agency' as const,
        row: {
          id: row.id,
          orgId: row.sourceOrgId ?? '',
          sourceId: null,
          title: row.name,
          publishStatus: row.publishStatus,
        },
      })),
      ...channels.filter((row) => row.organizationId !== null).map((row) => ({
        targetType: 'official_channel' as const,
        row: {
          id: row.id, orgId: row.organizationId!, sourceId: null, title: row.name,
          publishStatus: row.status === 'active' ? 'published' : 'unpublished',
        },
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
    await this.prisma.$transaction((tx) => this.applyOneInTx(tx, targetType, row, reason, actor, mode))
  }

  private async applyOneInTx(
    tx: PrismaTransactionClient,
    targetType: EmergencyTargetType,
    row: TargetRow,
    reason: { reasonCode: EmergencyReasonCode; reasonText: string },
    actor: AuthedUser,
    mode: 'single' | 'circuit_break',
  ) {
    if (targetType === 'official_channel') {
      await tx.onlinePlatformDirectory.update({ where: { id: row.id }, data: { status: 'inactive' } })
    }
    const existing = await tx.recruitmentEmergencyHold.findFirst({
      where: { targetType, targetId: row.id },
      select: { id: true },
    })
    if (targetType !== 'official_channel' && row.publishStatus !== 'unpublished') {
      await this.markUnpublished(tx, targetType, row.id)
    }
    if (!existing) {
      await tx.recruitmentEmergencyHold.create({
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
      await tx.partnerOrgNotice.create({
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
    await this.audit.writeRequired(tx, {
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

  private async markUnpublished(tx: PrismaTransactionClient, targetType: EmergencyTargetType, id: string) {
    const data = { publishStatus: 'unpublished' }
    if (targetType === 'job') await tx.job.update({ where: { id }, data })
    else if (targetType === 'job_fair') await tx.jobFair.update({ where: { id }, data })
    else if (targetType === 'company') await tx.companyProfile.update({ where: { id }, data })
    else if (targetType === 'fair_material') await tx.fairMaterial.update({ where: { id }, data })
    else if (targetType === 'offline_agency') await tx.offlineAgency.update({ where: { id }, data })
    else await tx.policyPost.update({ where: { id }, data })
  }
}
