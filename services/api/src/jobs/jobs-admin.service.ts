// ============================================================
// JobsAdminService — Admin 审核 / 发布 / 批次管理端点
// N1 拆分子服务：零行为变化。
// ============================================================

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { FairMaterialPrintBridgeService } from './fair-material-print-bridge.service'
import type { ReviewAction } from './dto/review.dto'
import type { PublishAction } from './dto/publish.dto'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import {
  type AdminJobDto,
  type AdminFairDto,
  type AdminImportBatchDto,
  prismaJobToAdminDto,
  prismaFairToAdminDto,
} from './jobs-shared'

@Injectable()
export class JobsAdminService {
  private readonly logger = new Logger(JobsAdminService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly printBridges?: FairMaterialPrintBridgeService,
  ) {}

  async getAllJobSources(): Promise<AdminJobDto[]> {
    const rows = await this.prisma.job.findMany({ orderBy: { createdAt: 'desc' } })
    return rows.map(prismaJobToAdminDto)
  }

  async reviewJobSource(id: string, action: ReviewAction, reason: string | undefined, user: AuthedUser): Promise<AdminJobDto> {
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }
    if (job.reviewStatus === 'approved' || job.reviewStatus === 'rejected') {
      throw new BadRequestException({
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `审核终态 ${job.reviewStatus} 不可回退,需走 reopen 流程`,
        },
      })
    }

    let data: {
      reviewStatus:  string
      publishStatus?: string
      rejectReason?:  string | null
    }
    if (action === 'reviewing') {
      data = { reviewStatus: 'reviewing' }
    } else if (action === 'approve') {
      data = { reviewStatus: 'approved', publishStatus: 'draft', rejectReason: null }
    } else {
      const trimmed = (reason ?? '').trim()
      if (trimmed.length === 0) {
        throw new BadRequestException({
          error: { code: 'REJECT_REASON_REQUIRED', message: 'reject 必须提供 reason' },
        })
      }
      data = { reviewStatus: 'rejected', publishStatus: 'draft', rejectReason: trimmed }
    }

    try {
      const updated = await this.prisma.job.update({
        where: { id },
        data: { ...data, reviewedBy: user.userId, reviewedAt: new Date() },
      })
      await this.audit.write({
        actorId: user.userId,
        actorRole: 'admin',
        action: 'job.review',
        targetType: 'job',
        targetId: id,
        payload: { action, reason: data.rejectReason ?? null, fromReviewStatus: job.reviewStatus, toReviewStatus: data.reviewStatus },
      })
      this.logger.log(`reviewJobSource: id=${id} action=${action} by=${user.userId}`)
      return prismaJobToAdminDto(updated)
    } catch (e) {
      this.logger.error(`reviewJobSource failed: id=${id}`, e as Error)
      throw new InternalServerErrorException({ error: { code: 'REVIEW_FAILED', message: '审核动作失败' } })
    }
  }

  async publishJobSource(id: string, action: PublishAction, user: AuthedUser): Promise<AdminJobDto> {
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }
    if (action === 'publish') {
      if (job.reviewStatus !== 'approved') {
        throw new BadRequestException({
          error: { code: 'PUBLISH_REQUIRES_APPROVAL', message: '未通过审核的岗位不得发布' },
        })
      }
    }
    const toStatus = action === 'publish' ? 'published' : 'unpublished'
    const updated = await this.prisma.job.update({
      where: { id },
      data: { publishStatus: toStatus },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action: 'job.publish',
      targetType: 'job',
      targetId: id,
      payload: { action, fromPublishStatus: job.publishStatus, toPublishStatus: toStatus },
    })
    this.logger.log(`publishJobSource: id=${id} action=${action}`)
    return prismaJobToAdminDto(updated)
  }

  async getAllFairSources(): Promise<AdminFairDto[]> {
    const rows = await this.prisma.jobFair.findMany({ orderBy: { createdAt: 'desc' } })
    return rows.map(prismaFairToAdminDto)
  }

  async reviewFairSource(id: string, action: ReviewAction, reason: string | undefined, user: AuthedUser): Promise<AdminFairDto> {
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }
    if (fair.reviewStatus === 'approved' || fair.reviewStatus === 'rejected') {
      throw new BadRequestException({
        error: { code: 'INVALID_STATE_TRANSITION', message: `审核终态 ${fair.reviewStatus} 不可回退,需走 reopen 流程` },
      })
    }

    let data: { reviewStatus: string; publishStatus?: string; rejectReason?: string | null }
    if (action === 'reviewing') {
      data = { reviewStatus: 'reviewing' }
    } else if (action === 'approve') {
      data = { reviewStatus: 'approved', publishStatus: 'draft', rejectReason: null }
    } else {
      const trimmed = (reason ?? '').trim()
      if (trimmed.length === 0) {
        throw new BadRequestException({ error: { code: 'REJECT_REASON_REQUIRED', message: 'reject 必须提供 reason' } })
      }
      data = { reviewStatus: 'rejected', publishStatus: 'draft', rejectReason: trimmed }
    }

    try {
      const updated = await this.prisma.jobFair.update({
        where: { id },
        data: { ...data, reviewedBy: user.userId, reviewedAt: new Date() },
      })
      await this.audit.write({
        actorId: user.userId,
        actorRole: 'admin',
        action: 'fair.review',
        targetType: 'fair',
        targetId: id,
        payload: { action, reason: data.rejectReason ?? null, fromReviewStatus: fair.reviewStatus, toReviewStatus: data.reviewStatus },
      })
      this.logger.log(`reviewFairSource: id=${id} action=${action} by=${user.userId}`)
      return prismaFairToAdminDto(updated)
    } catch (e) {
      this.logger.error(`reviewFairSource failed: id=${id}`, e as Error)
      throw new InternalServerErrorException({ error: { code: 'REVIEW_FAILED', message: '审核动作失败' } })
    }
  }

  async publishFairSource(id: string, action: PublishAction, user: AuthedUser): Promise<AdminFairDto> {
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }
    if (action === 'publish' && fair.reviewStatus !== 'approved') {
      throw new BadRequestException({
        error: { code: 'PUBLISH_REQUIRES_APPROVAL', message: '未通过审核的招聘会不得发布' },
      })
    }
    const toStatus = action === 'publish' ? 'published' : 'unpublished'
    const updated = await this.prisma.jobFair.update({
      where: { id },
      data: { publishStatus: toStatus },
    })
    if (action === 'unpublish') {
      await this.printBridges?.revokeForFair(id, 'fair_unpublished')
    }
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action: 'fair.publish',
      targetType: 'fair',
      targetId: id,
      payload: { action, fromPublishStatus: fair.publishStatus, toPublishStatus: toStatus },
    })
    this.logger.log(`publishFairSource: id=${id} action=${action}`)
    return prismaFairToAdminDto(updated)
  }

  async getAdminImportBatches(): Promise<AdminImportBatchDto[]> {
    const batches = await this.prisma.importBatch.findMany({
      include: { source: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    const orgIds = [...new Set(batches.map((b) => b.orgId))]
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    })
    const orgMap = new Map(orgs.map((o) => [o.id, o.name]))
    return batches.map((b) => ({
      id: b.id,
      sourceId: b.sourceId,
      sourceName: b.source.name,
      orgId: b.orgId,
      orgName: orgMap.get(b.orgId) ?? b.orgId,
      dataType: b.dataType as 'job' | 'fair',
      fileName: b.fileName,
      totalRows: b.totalRows,
      validRows: b.validRows,
      invalidRows: b.invalidRows,
      dupRows: b.dupRows,
      status: b.status as AdminImportBatchDto['status'],
      createdBy: b.createdBy,
      confirmedAt: b.confirmedAt ? b.confirmedAt.toISOString() : null,
      createdAt: b.createdAt.toISOString(),
    }))
  }

  async cancelExcelImport(batchId: string, user: AuthedUser): Promise<void> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } })
    if (!batch || batch.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'BATCH_NOT_FOUND', message: '导入批次不存在' } })
    }
    if (batch.status !== 'pending') {
      throw new BadRequestException({ error: { code: 'BATCH_ALREADY_PROCESSED', message: '只能取消 pending 状态的批次' } })
    }
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'cancelled' },
    })
  }
}
