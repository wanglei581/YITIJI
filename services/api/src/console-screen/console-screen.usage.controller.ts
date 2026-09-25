import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common'
import { Module } from '@nestjs/common'
import { IsIn, IsOptional } from 'class-validator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AuthModule } from '../auth/auth.module'
import { ScreenSnapshotCache } from './console-screen.cache'
import { PartnerOrgRequiredError, requirePartnerOrgId } from './console-screen.org'
import type { ScreenUsageRange, ScreenUsageSnapshot } from './console-screen.types'
import { ConsoleScreenUsageService } from './console-screen.usage.service'

/** 缺省 today。非法值由 forbidNonWhitelisted / IsIn 返回 400。不接受 orgId。 */
class UsageRangeQueryDto {
  @IsOptional()
  @IsIn(['today', '7d', '30d'])
  range?: ScreenUsageRange
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsageController {
  constructor(private readonly usage: ConsoleScreenUsageService) {}

  /**
   * GET /admin/screen/usage?range=today|7d|30d
   * 与 snapshot 一样：已登录 admin 会话，响应走 ApiResponse。
   */
  @Get('admin/screen/usage')
  @Roles('admin')
  async getAdminUsage(@Query() query: UsageRangeQueryDto): Promise<ApiResponse<ScreenUsageSnapshot>> {
    return ApiResponse.ok(await this.usage.getAdminUsage(query.range ?? 'today'))
  }
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerUsageController {
  constructor(private readonly usage: ConsoleScreenUsageService) {}

  /**
   * GET /partner/screen/usage?range=today|7d|30d
   * orgId 只来自 JwtAuthGuard 回源后的 AuthedUser，不读 query。
   * 响应保持裸对象，与 /partner/screen/snapshot 一致。
   */
  @Get('partner/screen/usage')
  @Roles('partner')
  getPartnerUsage(
    @CurrentUser() user: AuthedUser,
    @Query() query: UsageRangeQueryDto,
  ): Promise<ScreenUsageSnapshot> {
    try {
      return this.usage.getPartnerUsage(requirePartnerOrgId(user.orgId), query.range ?? 'today')
    } catch (error) {
      if (error instanceof PartnerOrgRequiredError) {
        throw new ForbiddenException({
          error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' },
        })
      }
      throw error
    }
  }
}

@Module({
  imports: [AuthModule],
  controllers: [AdminUsageController, PartnerUsageController],
  providers: [ConsoleScreenUsageService, ScreenSnapshotCache],
})
export class ConsoleScreenUsageModule {}

export { UsageRangeQueryDto }
