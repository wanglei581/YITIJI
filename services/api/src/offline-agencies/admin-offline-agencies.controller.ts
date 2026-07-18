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
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { OfflineAgenciesService, type AgencyListQuery, type JobListQuery } from './offline-agencies.service'
import { CreateOfflineAgencyDto, UpdateOfflineAgencyDto } from './dto/create-offline-agency.dto'
import { CreateOfflineJobDto, UpdateOfflineJobDto } from './dto/create-offline-job.dto'
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

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
  constructor(private readonly service: OfflineAgenciesService) {}

  @Get()
  async findAll(@Query() query: AgencyListQuery) {
    return this.service.adminFindAll(query)
  }

  @Post()
  async create(@Body() dto: CreateOfflineAgencyDto) {
    return this.service.adminCreate(dto)
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateOfflineAgencyDto) {
    return this.service.adminUpdate(id, dto)
  }

  @Patch(':id/review')
  async review(@Param('id') id: string, @Body() body: ReviewActionDto) {
    return this.service.adminReview(id, body.action, body.reason)
  }

  @Patch(':id/publish')
  async publish(@Param('id') id: string, @Body() body: PublishStatusDto) {
    return this.service.adminPublish(id, body.publishStatus)
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.adminDelete(id)
  }

  // ─── 机构岗位管理 ────────────────────────────────────────────────────────────

  @Get(':id/jobs')
  async getJobs(@Param('id') agencyId: string, @Query() query: JobListQuery) {
    return this.service.adminFindJobsByAgency(agencyId, query)
  }

  @Post(':id/jobs')
  async createJob(@Param('id') agencyId: string, @Body() dto: CreateOfflineJobDto) {
    return this.service.adminCreateJob(agencyId, dto)
  }

  @Put(':id/jobs/:jobId')
  async updateJob(
    @Param('id') agencyId: string,
    @Param('jobId') jobId: string,
    @Body() dto: UpdateOfflineJobDto,
  ) {
    return this.service.adminUpdateJob(agencyId, jobId, dto)
  }

  @Delete(':id/jobs/:jobId')
  async deleteJob(@Param('id') agencyId: string, @Param('jobId') jobId: string) {
    return this.service.adminDeleteJob(agencyId, jobId)
  }
}
