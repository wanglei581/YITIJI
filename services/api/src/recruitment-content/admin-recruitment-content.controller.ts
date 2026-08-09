import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { resolveClientIp } from '../common/client-ip'
import {
  AgencyProfileListQueryDto,
  DirectoryListQueryDto,
  QualificationListQueryDto,
} from './dto/admin-recruitment-content-query.dto'
import { RecruitmentContentReadService } from './recruitment-content-read.service'

interface AuditRequest {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/recruitment-content')
export class AdminRecruitmentContentController {
  constructor(private readonly service: RecruitmentContentReadService) {}

  @Get('platform-directories')
  async listDirectories(@Query() query: DirectoryListQueryDto) {
    return ApiResponse.ok(await this.service.listDirectories(query))
  }

  @Get('platform-directories/:id')
  async getDirectory(@Param('id') id: string) {
    return ApiResponse.ok(await this.service.getDirectory(id))
  }

  @Get('agency-profiles')
  async listAgencyProfiles(@Query() query: AgencyProfileListQueryDto) {
    return ApiResponse.ok(await this.service.listAgencyProfiles(query))
  }

  @Get('agency-profiles/:profileId')
  async getAgencyProfile(@Param('profileId') profileId: string) {
    return ApiResponse.ok(await this.service.getAgencyProfile(profileId))
  }

  @Get('agency-profiles/:profileId/branches/:branchId')
  async getAgencyBranch(
    @Param('profileId') profileId: string,
    @Param('branchId') branchId: string,
  ) {
    return ApiResponse.ok(await this.service.getAgencyBranch(profileId, branchId))
  }

  @Get('organizations/:organizationId/qualifications')
  async listQualifications(
    @Param('organizationId') organizationId: string,
    @Query() query: QualificationListQueryDto,
  ) {
    return ApiResponse.ok(await this.service.listQualifications(organizationId, query))
  }

  @Get('organizations/:organizationId/qualifications/:qualificationId')
  async getQualification(
    @Param('organizationId') organizationId: string,
    @Param('qualificationId') qualificationId: string,
  ) {
    return ApiResponse.ok(await this.service.getQualification(organizationId, qualificationId))
  }

  @Get('organizations/:organizationId/qualifications/:qualificationId/evidence-access')
  async getQualificationEvidence(
    @Param('organizationId') organizationId: string,
    @Param('qualificationId') qualificationId: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditRequest,
  ) {
    const userAgent = req.headers['user-agent']
    return ApiResponse.ok(await this.service.getQualificationEvidence(
      organizationId,
      qualificationId,
      user,
      {
        ipAddress: resolveClientIp(req),
        userAgent: typeof userAgent === 'string' ? userAgent : null,
        requestId: req.requestId ?? null,
      },
    ))
  }
}
