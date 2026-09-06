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
import type { Prisma } from '../generated/prisma/client'
import { AuditService } from '../audit/audit.service'
import { FairMaterialPrintBridgeService } from './fair-material-print-bridge.service'
import type { ReviewAction } from './dto/review.dto'
import type { PublishAction } from './dto/publish.dto'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { assertOrgContentTrustActive, type OrgTrustReader } from '../common/content-trust'
import {
  assertPublishFieldsComplete,
  JOB_PUBLISH_REQUIRED_FIELDS,
  FAIR_PUBLISH_REQUIRED_FIELDS,
} from '../common/publish-completeness'
import {
  type AdminJobDto,
  type AdminFairDto,
  type AdminImportBatchDto,
  prismaJobToAdminDto,
  prismaFairToAdminDto,
} from './jobs-shared'

export interface AdminSourceListParams {
  page?: string
  pageSize?: string
  reviewStatus?: string
  sourceId?: string
  sourceOrgId?: string
  keyword?: string
}

export interface AdminSourcePage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

function hasPagination(params?: AdminSourceListParams): params is AdminSourceListParams & { page?: string; pageSize?: string } {
  return params?.page !== undefined || params?.pageSize !== undefined
}

function normalizePage(params: AdminSourceListParams): { page: number; pageSize: number; skip: number } {
  const parsedPage = Number.parseInt(params.page ?? '1', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const parsedPageSize = Number.parseInt(params.pageSize ?? '20', 10)
  const pageSize = Math.min(100, Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : 20)
  return { page, pageSize, skip: (page - 1) * pageSize }
}

@Injectable()
export class JobsAdminService {
  private readonly logger = new Logger(JobsAdminService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly printBridges?: FairMaterialPrintBridgeService,
  ) {}

  async getAllJobSources(): Promise<AdminJobDto[]>
  async getAllJobSources(params: AdminSourceListParams): Promise<AdminJobDto[] | AdminSourcePage<AdminJobDto>>
  async getAllJobSources(params?: AdminSourceListParams): Promise<AdminJobDto[] | AdminSourcePage<AdminJobDto>> {
    const where: Prisma.JobWhereInput = {
      ...(params?.reviewStatus ? { reviewStatus: params.reviewStatus } : {}),
      ...(params?.sourceId ? { sourceId: params.sourceId } : {}),
      ...(params?.keyword?.trim()
        ? {
            OR: [
              { title: { contains: params.keyword.trim() } },
              { company: { contains: params.keyword.trim() } },
              { sourceName: { contains: params.keyword.trim() } },
            ],
          }
        : {}),
    }
    if (!hasPagination(params)) {
      const rows = await this.prisma.job.findMany({ where, orderBy: { createdAt: 'desc' } })
      return rows.map(prismaJobToAdminDto)
    }
    const { page, pageSize, skip } = normalizePage(params)
    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      this.prisma.job.count({ where }),
    ])
    return { items: rows.map(prismaJobToAdminDto), total, page, pageSize }
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
      // 发布闸门:来源机构必须 contentTrustStatus='active' 且未归档(fail-closed)。
      // 只拦 publish;unpublish（下架）永远放行，否则不可信内容将无法被撤下。
      await assertOrgContentTrustActive(this.prisma as unknown as OrgTrustReader, job.sourceOrgId, {
        contentType: '岗位',
        contentId: id,
      })
      // 发布闸门:来源必须可追溯(CLAUDE.md §10)。空字符串能过 Prisma 的 NOT NULL,
      // 所以这道校验必须在发布路径上,不能只指望各条导入路径都写对。
      // 见 src/common/publish-completeness.ts。
      assertPublishFieldsComplete('岗位', job as unknown as Record<string, unknown>, JOB_PUBLISH_REQUIRED_FIELDS)
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

  async getAllFairSources(): Promise<AdminFairDto[]>
  async getAllFairSources(params: AdminSourceListParams): Promise<AdminFairDto[] | AdminSourcePage<AdminFairDto>>
  async getAllFairSources(params?: AdminSourceListParams): Promise<AdminFairDto[] | AdminSourcePage<AdminFairDto>> {
    const where: Prisma.JobFairWhereInput = {
      ...(params?.reviewStatus ? { reviewStatus: params.reviewStatus } : {}),
      ...(params?.sourceOrgId ? { sourceOrgId: params.sourceOrgId } : {}),
      ...(params?.keyword?.trim()
        ? {
            OR: [
              { title: { contains: params.keyword.trim() } },
              { sourceName: { contains: params.keyword.trim() } },
              { venue: { contains: params.keyword.trim() } },
            ],
          }
        : {}),
    }
    if (!hasPagination(params)) {
      const rows = await this.prisma.jobFair.findMany({ where, orderBy: { createdAt: 'desc' } })
      return rows.map(prismaFairToAdminDto)
    }
    const { page, pageSize, skip } = normalizePage(params)
    const [rows, total] = await Promise.all([
      this.prisma.jobFair.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      this.prisma.jobFair.count({ where }),
    ])
    return { items: rows.map(prismaFairToAdminDto), total, page, pageSize }
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
    if (action === 'publish') {
      // 发布闸门:见 publishJobSource 同处注释。
      await assertOrgContentTrustActive(this.prisma as unknown as OrgTrustReader, fair.sourceOrgId, {
        contentType: '招聘会',
        contentId: id,
      })
      assertPublishFieldsComplete('招聘会', fair as unknown as Record<string, unknown>, FAIR_PUBLISH_REQUIRED_FIELDS)
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
