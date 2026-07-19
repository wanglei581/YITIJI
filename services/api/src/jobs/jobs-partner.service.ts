// ============================================================
// JobsPartnerService — Partner 数据源/岗位/招聘会/同步日志端点
// N1 拆分子服务：零行为变化。
// ============================================================

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { JobQualityService } from '../job-ai/job-quality.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { encryptSecret, generateWebhookSecret } from '../common/crypto/secret-cipher'
import type { CreateDataSourceDto } from './dto/data-source.dto'
import type { ImportJobItemDto } from './dto/import-jobs.dto'
import type { ImportFairsDto } from './dto/import-fairs.dto'
import type { UpdatePartnerFairDto, UpdatePartnerJobDto } from './dto/partner-edit.dto'
import {
  type PartnerDataSourceDto,
  type PartnerJobDto,
  type PartnerFairDto,
  type ImportResult,
  type SyncLogDto,
  prismaJobSourceToPartnerDto,
  prismaJobToPartnerDto,
  prismaFairToPartnerDto,
  buildJobTags,
  mapWorkTypeToCategory,
  normalizeOptionalHttpUrl,
  fmtSyncTime,
} from './jobs-shared'

@Injectable()
export class JobsPartnerService {
  private readonly logger = new Logger(JobsPartnerService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobQuality: JobQualityService,
  ) {}

  private async refreshJobQualitySnapshots(jobIds: string[]): Promise<void> {
    try {
      await this.jobQuality.refreshJobQualitySnapshots(jobIds)
    } catch (error) {
      this.logger.warn(`refresh job quality snapshots failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  async getPartnerDataSources(user: AuthedUser): Promise<PartnerDataSourceDto[]> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const sources = await this.prisma.jobSource.findMany({
      where: { orgId: user.orgId },
      orderBy: { updatedAt: 'desc' },
    })
    return sources.map(prismaJobSourceToPartnerDto)
  }

  async createPartnerDataSource(dto: CreateDataSourceDto, user: AuthedUser): Promise<PartnerDataSourceDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const accessMode = dto.accessMode ?? 'excel'
    const sourceKind = dto.sourceKind ?? 'manual'
    const syncFreq = dto.syncFreq ?? 'manual'
    if (accessMode === 'api' && !dto.endpoint) {
      throw new BadRequestException({ error: { code: 'API_ENDPOINT_REQUIRED', message: 'API 数据源必须填写 endpoint' } })
    }
    const webhookSecretOnce = accessMode === 'webhook'
      ? (dto.credential ?? generateWebhookSecret())
      : undefined
    const source = await this.prisma.jobSource.create({
      data: {
        orgId: user.orgId,
        name: dto.name.trim(),
        sourceKind,
        accessMode,
        syncFreq,
        description: dto.description,
        endpoint: dto.endpoint,
        authType: dto.authType,
        encryptedCredential: accessMode === 'api' && dto.credential ? encryptSecret(dto.credential) : undefined,
        webhookSecret: webhookSecretOnce ? encryptSecret(webhookSecretOnce) : undefined,
        webhookSecretRotatedAt: webhookSecretOnce ? new Date() : undefined,
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'data_source.create',
      targetType: 'job_source',
      targetId: source.id,
      payload: { accessMode, sourceKind, credentialConfigured: Boolean(dto.credential || webhookSecretOnce) },
    })
    return {
      ...prismaJobSourceToPartnerDto(source),
      webhookUrl: accessMode === 'webhook' ? `/api/v1/sync/webhook?source=${source.id}` : undefined,
      webhookSecretOnce,
    }
  }

  async togglePartnerDataSource(id: string, user: AuthedUser): Promise<PartnerDataSourceDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const source = await this.prisma.jobSource.findUnique({ where: { id } })
    if (!source || source.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }
    const updated = await this.prisma.jobSource.update({
      where: { id },
      data: { enabled: !source.enabled },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'data_source.toggle',
      targetType: 'job_source',
      targetId: id,
      payload: { enabled: updated.enabled },
    })
    return prismaJobSourceToPartnerDto(updated)
  }

  async getPartnerJobs(user: AuthedUser): Promise<PartnerJobDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.job.findMany({
      where: { sourceOrgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(prismaJobToPartnerDto)
  }

  async importJobs(items: ImportJobItemDto[], user: AuthedUser): Promise<ImportResult<PartnerJobDto>> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()
    const out: PartnerJobDto[] = []
    const touchedJobIds: string[] = []
    for (const item of items) {
      try {
        const job = await this.prisma.job.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId, externalId: item.externalId } },
          create: {
            sourceOrgId, externalId: item.externalId, sourceName,
            sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            reviewStatus: 'pending', publishStatus: 'draft',
            syncTime: sync,
          },
          update: {
            sourceName, sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            syncTime: sync,
          },
        })
        touchedJobIds.push(job.id)
        out.push(prismaJobToPartnerDto(job))
      } catch (e) {
        this.logger.error(`importJobs upsert failed: orgId=${sourceOrgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({ error: { code: 'IMPORT_FAILED', message: '岗位导入失败,请稍后重试' } })
      }
    }
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'job.import',
      targetType: 'job',
      targetId: null,
      payload: { count: out.length, externalIds: out.map((o) => o.externalId).slice(0, 20) },
    })
    this.logger.log(`importJobs: orgId=${sourceOrgId} count=${out.length}`)
    await this.refreshJobQualitySnapshots(touchedJobIds)
    return { imported: out.length, items: out }
  }

  async importJobsFromWebhook(orgId: string, sourceId: string, items: ImportJobItemDto[]): Promise<ImportResult<PartnerJobDto>> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const sourceName = org.name
    const sync = new Date()
    const out: PartnerJobDto[] = []
    const touchedJobIds: string[] = []
    for (const item of items) {
      try {
        const job = await this.prisma.job.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId: orgId, externalId: item.externalId } },
          create: {
            sourceOrgId: orgId, sourceId, externalId: item.externalId, sourceName,
            sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            reviewStatus: 'pending', publishStatus: 'draft',
            syncTime: sync,
          },
          update: {
            sourceId,
            sourceName, sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            syncTime: sync,
          },
        })
        touchedJobIds.push(job.id)
        out.push(prismaJobToPartnerDto(job))
      } catch (e) {
        this.logger.error(`importJobsFromWebhook upsert failed: orgId=${orgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({ error: { code: 'IMPORT_FAILED', message: 'Webhook 导入失败,请稍后重试' } })
      }
    }
    await this.refreshJobQualitySnapshots(touchedJobIds)
    return { imported: out.length, items: out }
  }

  async unpublishPartnerJob(id: string, user: AuthedUser): Promise<PartnerJobDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job || job.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }
    const updated = await this.prisma.job.update({
      where: { id },
      data: { publishStatus: 'unpublished' },
    })
    return prismaJobToPartnerDto(updated)
  }

  async updatePartnerJob(id: string, dto: UpdatePartnerJobDto, user: AuthedUser): Promise<PartnerJobDto> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job || job.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }
    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.company !== undefined ? { company: dto.company } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.sourceUrl !== undefined ? { sourceUrl: dto.sourceUrl } : {}),
        ...(dto.salary !== undefined ? { salary: dto.salary } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.requirements !== undefined ? { requirements: dto.requirements } : {}),
        ...(dto.tags !== undefined ? { tagsJson: JSON.stringify(dto.tags) } : {}),
        ...(dto.workType !== undefined ? { category: mapWorkTypeToCategory(dto.workType) } : {}),
        reviewStatus: 'pending',
        publishStatus: 'draft',
        rejectReason: null,
        reviewedBy: null,
        reviewedAt: null,
        syncTime: new Date(),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'job.partner_update',
      targetType: 'job',
      targetId: id,
      payload: { changedFields, fromReviewStatus: job.reviewStatus, fromPublishStatus: job.publishStatus },
    })
    await this.refreshJobQualitySnapshots([updated.id])
    this.logger.log(`updatePartnerJob: id=${id} orgId=${user.orgId} fields=${changedFields.join(',')}`)
    return prismaJobToPartnerDto(updated)
  }

  async getPartnerFairs(user: AuthedUser): Promise<PartnerFairDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.jobFair.findMany({
      where: { sourceOrgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(prismaFairToPartnerDto)
  }

  async importFairs(dto: ImportFairsDto, user: AuthedUser): Promise<ImportResult<PartnerFairDto>> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()
    const out: PartnerFairDto[] = []
    for (const item of dto.items) {
      const startAt = new Date(item.startAt)
      const endAt   = new Date(item.endAt)
      const checkinUrl = normalizeOptionalHttpUrl(item.checkinUrl, 'checkinUrl')
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        throw new BadRequestException({
          error: { code: 'INVALID_DATETIME', message: `招聘会 ${item.externalId} 的时间格式无效(需 ISO 8601)` },
        })
      }
      if (endAt.getTime() <= startAt.getTime()) {
        throw new BadRequestException({
          error: { code: 'INVALID_DATE_RANGE', message: `招聘会 ${item.externalId} 的结束时间必须晚于开始时间` },
        })
      }
      try {
        const fair = await this.prisma.jobFair.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId, externalId: item.externalId } },
          create: {
            sourceOrgId, externalId: item.externalId, sourceName,
            sourceUrl: item.sourceUrl,
            checkinUrl,
            title: item.title,
            theme: item.theme ?? 'general',
            startAt, endAt,
            venue: item.venue, city: item.city,
            address: item.address,
            mapImageUrl: item.mapImageUrl,
            coverImageUrl: item.coverImageUrl,
            description: item.description,
            companyCount: item.companyCount ?? 0,
            jobCount: item.jobCount ?? 0,
            reviewStatus: 'pending', publishStatus: 'draft',
            syncTime: sync,
          },
          update: {
            sourceName, sourceUrl: item.sourceUrl,
            checkinUrl: normalizeOptionalHttpUrl(item.checkinUrl, 'checkinUrl'),
            title: item.title,
            theme: item.theme ?? 'general',
            startAt, endAt,
            venue: item.venue, city: item.city,
            address: item.address,
            mapImageUrl: item.mapImageUrl,
            coverImageUrl: item.coverImageUrl,
            description: item.description,
            companyCount: item.companyCount ?? undefined,
            jobCount: item.jobCount ?? undefined,
            syncTime: sync,
          },
        })
        out.push(prismaFairToPartnerDto(fair))
      } catch (e) {
        this.logger.error(`importFairs upsert failed: orgId=${sourceOrgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({ error: { code: 'IMPORT_FAILED', message: '招聘会导入失败,请稍后重试' } })
      }
    }
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'fair.import',
      targetType: 'fair',
      targetId: null,
      payload: { count: out.length, externalIds: out.map((o) => o.externalId).slice(0, 20) },
    })
    this.logger.log(`importFairs: orgId=${sourceOrgId} count=${out.length}`)
    return { imported: out.length, items: out }
  }

  async unpublishPartnerFair(id: string, user: AuthedUser): Promise<PartnerFairDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair || fair.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }
    const updated = await this.prisma.jobFair.update({
      where: { id },
      data: { publishStatus: 'unpublished' },
    })
    return prismaFairToPartnerDto(updated)
  }

  async updatePartnerFair(id: string, dto: UpdatePartnerFairDto, user: AuthedUser): Promise<PartnerFairDto> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair || fair.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }
    const startAt = dto.startAt ? new Date(dto.startAt) : fair.startAt
    const endAt   = dto.endAt ? new Date(dto.endAt) : fair.endAt
    const checkinUrlUpdate = dto.checkinUrl !== undefined
      ? { checkinUrl: normalizeOptionalHttpUrl(dto.checkinUrl, 'checkinUrl') }
      : {}
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException({ error: { code: 'INVALID_DATE_RANGE', message: '结束时间必须晚于开始时间' } })
    }
    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    const updated = await this.prisma.jobFair.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
        ...(dto.startAt !== undefined ? { startAt } : {}),
        ...(dto.endAt !== undefined ? { endAt } : {}),
        ...(dto.venue !== undefined ? { venue: dto.venue } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.sourceUrl !== undefined ? { sourceUrl: dto.sourceUrl } : {}),
        ...checkinUrlUpdate,
        reviewStatus: 'pending',
        publishStatus: 'draft',
        rejectReason: null,
        reviewedBy: null,
        reviewedAt: null,
        syncTime: new Date(),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'fair.partner_update',
      targetType: 'fair',
      targetId: id,
      payload: { changedFields, fromReviewStatus: fair.reviewStatus, fromPublishStatus: fair.publishStatus },
    })
    this.logger.log(`updatePartnerFair: id=${id} orgId=${user.orgId} fields=${changedFields.join(',')}`)
    return prismaFairToPartnerDto(updated)
  }

  async getPartnerDashboard(user: AuthedUser) {
    if (!user.orgId) {
      throw new ForbiddenException({ error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' } })
    }
    const orgId = user.orgId
    const [
      jobsTotal, jobsPublished, jobsPending,
      fairsTotal, fairsPublished, fairsPending,
      policiesTotal, policiesPublished, policiesPending,
      sourcesTotal, sourcesEnabled,
      recentSyncRows,
    ] = await Promise.all([
      this.prisma.job.count({ where: { sourceOrgId: orgId } }),
      this.prisma.job.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.job.count({ where: { sourceOrgId: orgId, reviewStatus: 'pending' } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId, reviewStatus: 'pending' } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId, reviewStatus: 'pending' } }),
      this.prisma.jobSource.count({ where: { orgId } }),
      this.prisma.jobSource.count({ where: { orgId, enabled: true } }),
      this.prisma.syncLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { source: { select: { name: true } } },
      }),
    ])
    return {
      jobs: { total: jobsTotal, published: jobsPublished, pending: jobsPending },
      fairs: { total: fairsTotal, published: fairsPublished, pending: fairsPending },
      policies: { total: policiesTotal, published: policiesPublished, pending: policiesPending },
      pendingTotal: jobsPending + fairsPending + policiesPending,
      sources: { total: sourcesTotal, enabled: sourcesEnabled },
      recentSyncs: recentSyncRows.map((r) => ({
        id: r.id,
        source: r.source?.name ?? r.sourceId,
        dataType: r.dataType,
        status: r.result,
        addedCount: r.addedCount,
        updatedCount: r.updatedCount,
        errorCount: r.errorCount,
        syncTime: fmtSyncTime(r.createdAt),
      })),
    }
  }

  async getPartnerSyncLogs(user: AuthedUser): Promise<SyncLogDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.syncLog.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { source: { select: { name: true } } },
    })
    return rows.map((r, i) => ({
      id: r.id,
      no: `SYNC-${r.createdAt.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(4, '0')}`,
      source: r.source?.name ?? r.sourceId,
      dataType: r.dataType as 'job' | 'fair',
      addedCount: r.addedCount,
      updatedCount: r.updatedCount,
      errorCount: r.errorCount,
      dupCount: r.dupCount,
      errorFields: r.errorFields === '[]' ? null : r.errorFields,
      errorDetail: r.errorDetail,
      syncTime: fmtSyncTime(r.createdAt),
      status: r.result as 'success' | 'partial' | 'failed',
    }))
  }
}
