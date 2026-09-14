import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common'
import type { ScreenSnapshot } from './console-screen.types'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminScreenQueryDto, PartnerScreenQueryDto } from './console-screen.dto'
import { ConsoleScreenService } from './console-screen.service'

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminScreenController {
  constructor(private readonly screen: ConsoleScreenService) {}

  @Get('admin/screen/snapshot')
  async getAdminSnapshot(@Query() query: AdminScreenQueryDto): Promise<ApiResponse<ScreenSnapshot>> {
    return ApiResponse.ok(await this.screen.getAdminSnapshot(query.profile))
  }
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerScreenController {
  constructor(private readonly screen: ConsoleScreenService) {}

  /**
   * GET /partner/screen/snapshot
   *
   * orgId 只来自 JwtAuthGuard 回源后的 AuthedUser（JWT sub → User.orgId）。
   * 不读 query/body，也不采信 JWT payload 里的 orgId 声明。
   * 响应保持裸对象，与 /partner/stats 同模块信封裁定一致。
   */
  @Get('partner/screen/snapshot')
  getPartnerSnapshot(
    @CurrentUser() user: AuthedUser,
    @Query() _query: PartnerScreenQueryDto,
  ): Promise<ScreenSnapshot> {
    if (!user.orgId) {
      throw new ForbiddenException({
        error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' },
      })
    }
    return this.screen.getPartnerSnapshot(user.orgId)
  }
}
