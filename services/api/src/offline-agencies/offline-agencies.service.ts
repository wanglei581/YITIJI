// ============================================================
// OfflineAgenciesService — G1 线下招聘机构
//
// 合规约束：
//   - Kiosk 公开端点只返回 reviewStatus=approved + publishStatus=published 的机构
//   - 线下机构只做信息展示 + 到店指引，不代收简历、不做平台内投递
//   - externalUrl 只作为到店/外部跳转入口展示，不做平台内处理
//   - Admin 可查所有机构（含草稿/待审）
//   - publish 操作前必须断言 reviewStatus === 'approved'
//   - reject 必须把 publishStatus 强制置回 draft
// ============================================================

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateOfflineAgencyDto, UpdateOfflineAgencyDto } from './dto/create-offline-agency.dto'
import type { CreateOfflineJobDto, UpdateOfflineJobDto } from './dto/create-offline-job.dto'

export interface PaginationQuery {
  page?: number
  pageSize?: number
}

export interface AgencyListQuery extends PaginationQuery {
  district?: string
  orgType?: string
  keyword?: string
}

export interface JobListQuery extends PaginationQuery {
  jobType?: string
  keyword?: string
}

@Injectable()
export class OfflineAgenciesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Kiosk 公开端点（只查已审核已发布）─────────────────────────────────────

  async findAll(query: AgencyListQuery) {
    const { page = 1, pageSize = 20, district, orgType, keyword } = query
    const skip = (page - 1) * pageSize

    const where: Record<string, unknown> = {
      reviewStatus: 'approved',
      publishStatus: 'published',
      status: 'active',
    }
    if (district) where['district'] = district
    if (orgType)  where['orgType']  = orgType
    if (keyword) {
      where['OR'] = [
        { name:        { contains: keyword } },
        { address:     { contains: keyword } },
        { description: { contains: keyword } },
      ]
    }

    const [items, total] = await Promise.all([
      this.prisma.offlineAgency.findMany({
        where: where as never,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, orgType: true, address: true, district: true,
          lat: true, lng: true, openHours: true, phone: true, contactEmail: true,
          website: true, services: true, description: true, logoUrl: true,
          status: true, sourceOrgId: true, externalId: true, syncTime: true,
          createdAt: true, updatedAt: true,
        },
      }),
      this.prisma.offlineAgency.count({ where: where as never }),
    ])

    return { data: items, total, page, pageSize }
  }

  async findOne(id: string) {
    const agency = await this.prisma.offlineAgency.findFirst({
      where: { id, reviewStatus: 'approved', publishStatus: 'published', status: 'active' },
      include: {
        jobs: {
          where: { status: 'active' },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!agency) throw new NotFoundException(`线下机构 ${id} 不存在或未发布`)
    return agency
  }

  async findJobsByAgency(agencyId: string, query: JobListQuery) {
    // 先确认机构已发布
    const agency = await this.prisma.offlineAgency.findFirst({
      where: { id: agencyId, reviewStatus: 'approved', publishStatus: 'published', status: 'active' },
      select: { id: true, name: true },
    })
    if (!agency) throw new NotFoundException(`线下机构 ${agencyId} 不存在或未发布`)

    const { page = 1, pageSize = 20, jobType, keyword } = query
    const skip = (page - 1) * pageSize

    const where: Record<string, unknown> = { agencyId, status: 'active' }
    if (jobType) where['jobType'] = jobType
    if (keyword) {
      where['OR'] = [
        { title:        { contains: keyword } },
        { description:  { contains: keyword } },
        { requirements: { contains: keyword } },
      ]
    }

    const [items, total] = await Promise.all([
      this.prisma.offlineJob.findMany({
        where: where as never,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.offlineJob.count({ where: where as never }),
    ])

    return { agencyId, agencyName: agency.name, data: items, total, page, pageSize }
  }

  async findOneJob(id: string) {
    const job = await this.prisma.offlineJob.findFirst({
      where: { id, status: 'active' },
      include: {
        agency: {
          select: {
            id: true, name: true, orgType: true, address: true, district: true,
            phone: true, openHours: true, website: true, reviewStatus: true, publishStatus: true,
          },
        },
      },
    })
    if (!job) throw new NotFoundException(`岗位 ${id} 不存在`)
    // 岗位所属机构必须已发布
    if (job.agency.reviewStatus !== 'approved' || job.agency.publishStatus !== 'published') {
      throw new NotFoundException(`岗位 ${id} 不存在或机构未发布`)
    }
    return job
  }

  // ─── Admin 管理端点（无状态过滤）────────────────────────────────────────────

  async adminFindAll(query: AgencyListQuery) {
    const { page = 1, pageSize = 20, district, orgType, keyword } = query
    const skip = (page - 1) * pageSize

    const where: Record<string, unknown> = {}
    if (district) where['district'] = district
    if (orgType)  where['orgType']  = orgType
    if (keyword) {
      where['OR'] = [
        { name:        { contains: keyword } },
        { address:     { contains: keyword } },
        { description: { contains: keyword } },
      ]
    }

    const [items, total] = await Promise.all([
      this.prisma.offlineAgency.findMany({
        where: where as never,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { jobs: true } } },
      }),
      this.prisma.offlineAgency.count({ where: where as never }),
    ])

    return { data: items, total, page, pageSize }
  }

  async adminFindOne(id: string) {
    const agency = await this.prisma.offlineAgency.findUnique({
      where: { id },
      include: { jobs: { orderBy: { createdAt: 'desc' } } },
    })
    if (!agency) throw new NotFoundException(`线下机构 ${id} 不存在`)
    return agency
  }

  async adminCreate(dto: CreateOfflineAgencyDto) {
    return this.prisma.offlineAgency.create({
      data: {
        name:         dto.name,
        orgType:      dto.orgType      ?? 'recruitment',
        address:      dto.address,
        district:     dto.district,
        lat:          dto.lat,
        lng:          dto.lng,
        openHours:    dto.openHours,
        phone:        dto.phone,
        contactEmail: dto.contactEmail,
        website:      dto.website,
        services:     dto.services     ?? '[]',
        description:  dto.description,
        logoUrl:      dto.logoUrl,
        sourceOrgId:  dto.sourceOrgId,
        externalId:   dto.externalId,
      },
    })
  }

  async adminUpdate(id: string, dto: UpdateOfflineAgencyDto) {
    await this._assertAgencyExists(id)
    return this.prisma.offlineAgency.update({
      where: { id },
      data: {
        name:         dto.name,
        orgType:      dto.orgType,
        address:      dto.address,
        district:     dto.district,
        lat:          dto.lat,
        lng:          dto.lng,
        openHours:    dto.openHours,
        phone:        dto.phone,
        contactEmail: dto.contactEmail,
        website:      dto.website,
        services:     dto.services,
        description:  dto.description,
        logoUrl:      dto.logoUrl,
        sourceOrgId:  dto.sourceOrgId,
        externalId:   dto.externalId,
        ...(dto.status ? { status: dto.status } : {}),
      },
    })
  }

  async adminReview(id: string, action: 'reviewing' | 'approve' | 'reject', _reason?: string) {
    await this._assertAgencyExists(id)
    const statusMap: Record<string, string> = {
      reviewing: 'reviewing',
      approve:   'approved',
      reject:    'rejected',
    }
    const reviewStatus = statusMap[action]
    if (!reviewStatus) throw new BadRequestException(`无效审核操作: ${action}`)

    // reject 时强制将 publishStatus 置回 draft，防止已发布机构继续展示
    const publishStatusOverride = action === 'reject' ? { publishStatus: 'draft' } : {}

    return this.prisma.offlineAgency.update({
      where: { id },
      data: { reviewStatus, ...publishStatusOverride },
    })
  }

  async adminPublish(id: string, publishStatus: string) {
    const agency = await this._assertAgencyExists(id)

    if (publishStatus === 'published' && agency.reviewStatus !== 'approved') {
      throw new BadRequestException('只有已审核通过（approved）的机构才能发布')
    }

    const allowed = ['draft', 'published', 'unpublished']
    if (!allowed.includes(publishStatus)) {
      throw new BadRequestException(`无效发布状态: ${publishStatus}`)
    }

    return this.prisma.offlineAgency.update({
      where: { id },
      data: { publishStatus },
    })
  }

  async adminDelete(id: string) {
    await this._assertAgencyExists(id)
    // 先删子岗位，再删机构（SQLite FK restrict 约束）
    await this.prisma.offlineJob.deleteMany({ where: { agencyId: id } })
    return this.prisma.offlineAgency.delete({ where: { id } })
  }

  // ─── Admin 岗位管理 ──────────────────────────────────────────────────────────

  async adminFindJobsByAgency(agencyId: string, query: JobListQuery) {
    await this._assertAgencyExists(agencyId)
    const { page = 1, pageSize = 20, jobType, keyword } = query
    const skip = (page - 1) * pageSize

    const where: Record<string, unknown> = { agencyId }
    if (jobType) where['jobType'] = jobType
    if (keyword) {
      where['OR'] = [
        { title:        { contains: keyword } },
        { description:  { contains: keyword } },
        { requirements: { contains: keyword } },
      ]
    }

    const [items, total] = await Promise.all([
      this.prisma.offlineJob.findMany({
        where: where as never,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.offlineJob.count({ where: where as never }),
    ])

    return { data: items, total, page, pageSize }
  }

  async adminCreateJob(agencyId: string, dto: CreateOfflineJobDto) {
    await this._assertAgencyExists(agencyId)
    return this.prisma.offlineJob.create({
      data: {
        agencyId,
        title:        dto.title,
        jobType:      dto.jobType      ?? 'fulltime',
        salaryMin:    dto.salaryMin,
        salaryMax:    dto.salaryMax,
        salaryUnit:   dto.salaryUnit   ?? 'month',
        requirements: dto.requirements,
        description:  dto.description,
        headcount:    dto.headcount    ?? 1,
        location:     dto.location,
        education:    dto.education,
        experience:   dto.experience,
        externalUrl:  dto.externalUrl,
        externalId:   dto.externalId,
      },
    })
  }

  async adminUpdateJob(agencyId: string, jobId: string, dto: UpdateOfflineJobDto) {
    await this._assertJobExists(agencyId, jobId)
    return this.prisma.offlineJob.update({
      where: { id: jobId },
      data: {
        title:        dto.title,
        jobType:      dto.jobType,
        salaryMin:    dto.salaryMin,
        salaryMax:    dto.salaryMax,
        salaryUnit:   dto.salaryUnit,
        requirements: dto.requirements,
        description:  dto.description,
        headcount:    dto.headcount,
        location:     dto.location,
        education:    dto.education,
        experience:   dto.experience,
        externalUrl:  dto.externalUrl,
        externalId:   dto.externalId,
        ...(dto.status ? { status: dto.status } : {}),
      },
    })
  }

  async adminDeleteJob(agencyId: string, jobId: string) {
    await this._assertJobExists(agencyId, jobId)
    return this.prisma.offlineJob.delete({ where: { id: jobId } })
  }

  // ─── 私有工具 ────────────────────────────────────────────────────────────────

  private async _assertAgencyExists(id: string) {
    const agency = await this.prisma.offlineAgency.findUnique({ where: { id } })
    if (!agency) throw new NotFoundException(`线下机构 ${id} 不存在`)
    return agency
  }

  private async _assertJobExists(agencyId: string, jobId: string) {
    const job = await this.prisma.offlineJob.findFirst({ where: { id: jobId, agencyId } })
    if (!job) throw new NotFoundException(`岗位 ${jobId} 不存在或不属于机构 ${agencyId}`)
    return job
  }
}
