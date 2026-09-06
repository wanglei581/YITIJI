import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PublishActionDto } from '../jobs/dto/publish.dto'
import {
  CreateJobMaterialTemplateDto,
  UpdateJobMaterialTemplateDto,
} from './dto/admin-job-material-template.dto'
import { GenerateJobMaterialDto } from './dto/generate-job-material.dto'
import { JobMaterialsService } from './job-materials.service'
import type {
  JobMaterialAdminSummaryView,
  JobMaterialGenerateView,
  JobMaterialTemplateAdminView,
  JobMaterialTemplateView,
} from './job-materials.types'

import { resolveClientIp } from '../common/client-ip'
interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
  ip?: string
  requestId?: string
}

function ipOf(req: unknown): string | null {
  return resolveClientIp(req)
}

function uaOf(req: ReqLike): string | null {
  const ua = req.headers?.['user-agent']
  return typeof ua === 'string' ? ua : null
}

@Controller('job-materials')
export class JobMaterialsController {
  constructor(private readonly materials: JobMaterialsService) {}

  @Get('templates')
  async templates(): Promise<ApiResponse<JobMaterialTemplateView[]>> {
    return ApiResponse.ok(await this.materials.listTemplates())
  }

  @Post('generate')
  @UseGuards(EndUserAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async generate(
    @Body() dto: GenerateJobMaterialDto,
    @CurrentEndUser() user: AuthedEndUser,
    @Req() req: ReqLike
  ): Promise<ApiResponse<JobMaterialGenerateView>> {
    return ApiResponse.ok(
      await this.materials.generate(dto, {
        endUserId: user.endUserId,
        ipAddress: ipOf(req),
        userAgent: uaOf(req),
        requestId: req.requestId ?? null,
      })
    )
  }
}

@Controller('admin/job-materials')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminJobMaterialsController {
  constructor(private readonly materials: JobMaterialsService) {}

  @Get('summary')
  async summary(
    @CurrentUser() _user: AuthedUser
  ): Promise<ApiResponse<JobMaterialAdminSummaryView>> {
    return ApiResponse.ok(await this.materials.adminSummary())
  }

  /** 管理员模板目录：含未发布 / 已下架，按 sortOrder 排序。 */
  @Get('templates')
  async templates(
    @CurrentUser() _user: AuthedUser
  ): Promise<ApiResponse<JobMaterialTemplateAdminView[]>> {
    return ApiResponse.ok(await this.materials.adminListTemplates())
  }

  /** 新建模板：初始 status=disabled（未发布），发布走 :id/publish 端点。 */
  @Post('templates')
  async createTemplate(
    @Body() dto: CreateJobMaterialTemplateDto,
    @CurrentUser() user: AuthedUser
  ): Promise<ApiResponse<JobMaterialTemplateAdminView>> {
    return ApiResponse.ok(await this.materials.adminCreateTemplate(dto, user.userId))
  }

  @Patch('templates/:id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateJobMaterialTemplateDto,
    @CurrentUser() user: AuthedUser
  ): Promise<ApiResponse<JobMaterialTemplateAdminView>> {
    return ApiResponse.ok(await this.materials.adminUpdateTemplate(id, dto, user.userId))
  }

  /** 发布 / 下架：body { action: 'publish' | 'unpublish' }，与招聘会资料 PublishAction 同口径。 */
  @Patch('templates/:id/publish')
  async publishTemplate(
    @Param('id') id: string,
    @Body() dto: PublishActionDto,
    @CurrentUser() user: AuthedUser
  ): Promise<ApiResponse<JobMaterialTemplateAdminView>> {
    return ApiResponse.ok(await this.materials.adminSetTemplatePublish(id, dto.action, user.userId))
  }
}
