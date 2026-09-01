import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { resolveClientIp } from '../common/client-ip'
import { CreateReleaseObservationPlanDto } from './dto/create-release-observation-plan.dto'
import { UpdateReleaseObservationPlanDto } from './dto/update-release-observation-plan.dto'
import { ReleaseObservationService } from './release-observation.service'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

@Controller('admin/release-observation-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminReleaseObservationController {
  constructor(private readonly releases: ReleaseObservationService) {}

  @Post()
  async create(
    @Body() dto: CreateReleaseObservationPlanDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    return ApiResponse.ok(await this.releases.createPlan(dto, auditContext(user, req)))
  }

  @Patch(':planId')
  async update(
    @Param('planId') planId: string,
    @Body() dto: UpdateReleaseObservationPlanDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    return ApiResponse.ok(await this.releases.updatePlan(planId, dto, auditContext(user, req)))
  }

  @Get()
  async list() {
    return ApiResponse.ok(await this.releases.listPlans())
  }
}

function auditContext(user: AuthedUser, req: AuditReq) {
  const userAgent = req.headers['user-agent']
  return {
    actorId: user.userId,
    actorRole: user.role,
    ipAddress: resolveClientIp(req),
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    requestId: req.requestId ?? null,
  }
}
