import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { PartnerDashboardService } from './partner-dashboard.service'
import type { PartnerDashboard } from './partner-dashboard.types'

/**
 * 合作机构运营数据看板（Sprint 1 / Task 5）。路由前缀 /api/v1/partner/dashboard。
 * **Partner 鉴权**（@Roles('partner')），orgId 强制取自 JWT，partner 不能查其它机构数据。
 *
 * 只读端点，不写 AuditLog（无写操作）。
 * 合规：合作机构数据运营概览，不涉招聘闭环。
 */
@Controller('partner/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerDashboardController {
  constructor(private readonly dashboard: PartnerDashboardService) {}

  @Get()
  async get(@CurrentUser() user: AuthedUser): Promise<ApiResponse<PartnerDashboard>> {
    return ApiResponse.ok(await this.dashboard.getDashboard(user))
  }
}
