import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { GenerateJobMaterialDto } from './dto/generate-job-material.dto'
import { JobMaterialsService } from './job-materials.service'
import type { JobMaterialAdminSummaryView, JobMaterialGenerateView, JobMaterialTemplateView } from './job-materials.types'

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
  ip?: string
  requestId?: string
}

function ipOf(req: ReqLike): string | null {
  const fwd = req.headers?.['x-forwarded-for']
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim()
  return req.ip ?? null
}

function uaOf(req: ReqLike): string | null {
  const ua = req.headers?.['user-agent']
  return typeof ua === 'string' ? ua : null
}

@Controller('job-materials')
export class JobMaterialsController {
  constructor(private readonly materials: JobMaterialsService) {}

  @Get('templates')
  templates(): ApiResponse<JobMaterialTemplateView[]> {
    return ApiResponse.ok(this.materials.listTemplates())
  }

  @Post('generate')
  @UseGuards(EndUserAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async generate(
    @Body() dto: GenerateJobMaterialDto,
    @CurrentEndUser() user: AuthedEndUser,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<JobMaterialGenerateView>> {
    return ApiResponse.ok(await this.materials.generate(dto, {
      endUserId: user.endUserId,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    }))
  }
}

@Controller('admin/job-materials')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminJobMaterialsController {
  constructor(private readonly materials: JobMaterialsService) {}

  @Get('summary')
  async summary(@CurrentUser() _user: unknown): Promise<ApiResponse<JobMaterialAdminSummaryView>> {
    return ApiResponse.ok(await this.materials.adminSummary())
  }
}
