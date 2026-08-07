// ============================================================
// AdminOfflineAgenciesController — Admin 管理端点
//
// 路由前缀：/api/v1（由 main.ts 全局设置）
//
// GET    /admin/offline-agencies                          — 全量机构列表（含草稿/待审）
// POST   /admin/offline-agencies                          — 创建机构
// PUT    /admin/offline-agencies/:id                      — 更新机构
// PATCH  /admin/offline-agencies/:id/review               — 审核（body: {action, reason?}）
// PATCH  /admin/offline-agencies/:id/publish              — 发布控制（body: {publishStatus}）
// DELETE /admin/offline-agencies/:id                      — 删除机构
// GET    /admin/offline-agencies/:id/jobs                 — 机构岗位列表
// POST   /admin/offline-agencies/:id/jobs                 — 新增岗位
// PUT    /admin/offline-agencies/:id/jobs/:jobId          — 更新岗位
// DELETE /admin/offline-agencies/:id/jobs/:jobId          — 删除岗位
// ============================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AuditService } from '../audit/audit.service'
import { resolveClientIp } from '../common/client-ip'
import { OfflineAgenciesService, type AgencyListQuery, type JobListQuery } from './offline-agencies.service'
import { CreateOfflineAgencyDto, UpdateOfflineAgencyDto } from './dto/create-offline-agency.dto'
import { CreateOfflineJobDto, UpdateOfflineJobDto } from './dto/create-offline-job.dto'
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

function extractIp(req: unknown): string | null {
  return resolveClientIp(req)
}

function extractUa(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua : null
}

class ReviewActionDto {
  @IsIn(['reviewing', 'approve', 'reject'])
  action!: 'reviewing' | 'approve' | 'reject'

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}

class PublishStatusDto {
  @IsNotEmpty()
  @IsIn(['draft', 'published', 'unpublished'])
  publishStatus!: string
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/offline-agencies')
export class AdminOfflineAgenciesController {
  constructor(
    private readonly service: OfflineAgenciesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async findAll(@Query() query: AgencyListQuery) {
    return this.service.adminFindAll(query)
  }

  @Post()
  async create(
    @Body() dto: CreateOfflineAgencyDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.service.adminCreate(dto)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'offline_agency.create',
      targetType: 'offline_agency',
      targetId: result.id,
      payload: { name: dto.name, orgType: dto.orgType ?? 'recruitment' },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOfflineAgencyDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.service.adminUpdate(id, dto)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'offline_agency.update',
      targetType: 'offline_agency',
      targetId: id,
      payload: { fields: Object.keys(dto).filter((k) => (dto as unknown as Record<string, unknown>)[k] !== undefined) },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  @Patch(':id/review')
  async review(
    @Param('id') id: string,
    @Body() body: ReviewActionDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.service.adminReview(id, body.action, body.reason)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'offline_agency.review',
      targetType: 'offline_agency',
      targetId: id,
      payload: { action: body.action, reason: body.reason ?? null, reviewStatus: result.reviewStatus },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  @Patch(':id/publish')
  async publish(
    @Param('id') id: string,
    @Body() body: PublishStatusDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.service.adminPublish(id, body.publishStatus)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'offline_agency.publish',
      targetType: 'offline_agency',
      targetId: id,
      payload: { publishStatus: body.publishStatus },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.service.adminDelete(id)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'offline_agency.delete',
      targetType: 'offline_agency',
      targetId: id,
      payload: { deletedJobs: result.deletedJobs ?? null },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  // ─── 机构岗位管理 ────────────────────────────────────────────────────────────

  @Get(':id/jobs')
  async getJobs(@Param('id') agencyId: string, @Query() query: JobListQuery) {
    return this.service.adminFindJobsByAgency(agencyId, query)
  }

  @Post(':id/jobs')
  async createJob(
    @Param('id') agencyId: string,
    @Body() dto: CreateOfflineJobDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.service.adminCreateJob(agencyId, dto)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'offline_agency_job.create',
      targetType: 'offline_agency_job',
      targetId: result.id,
      payload: { agencyId, title: dto.title, jobType: dto.jobType ?? 'fulltime' },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  @Put(':id/jobs/:jobId')
  async updateJob(
    @Param('id') agencyId: string,
    @Param('jobId') jobId: string,
    @Body() dto: UpdateOfflineJobDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.service.adminUpdateJob(agencyId, jobId, dto)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'offline_agency_job.update',
      targetType: 'offline_agency_job',
      targetId: jobId,
      payload: { agencyId, fields: Object.keys(dto).filter((k) => (dto as unknown as Record<string, unknown>)[k] !== undefined) },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return result
  }

  @Delete(':id/jobs/:jobId')
  async deleteJob(
    @Param('id') agencyId: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.service.adminDeleteJob(agencyId, jobId)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'offline_agency_job.delete',
      targetType: 'offline_agency_job',
      targetId: jobId,
      payload: { agencyId },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return result
  }
}
