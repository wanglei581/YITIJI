// Partner 数据统计 HTTP 端点
//
//   GET /partner/stats?period=week|month|quarter
//
// orgId 取自 JWT token（user.orgId），不接受外部传参 → 跨机构不可达。
// 后端计算所有聚合，前端只做展示，不在客户端拼凑经营数据。

import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { IsEnum, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { PartnerStatsService, type StatsPeriod } from './partner-stats.service'

export class PartnerStatsQueryDto {
  @IsOptional()
  @IsEnum(['week', 'month', 'quarter'])
  period?: StatsPeriod
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerStatsController {
  constructor(private readonly stats: PartnerStatsService) {}

  /** GET /partner/stats */
  @Get('partner/stats')
  getStats(
    @CurrentUser() user: AuthedUser,
    @Query() query: PartnerStatsQueryDto,
  ) {
    // orgId 来自 token；partner 角色必有 orgId，guard 已拦截无 orgId 情况
    return this.stats.getStats(user.orgId!, query.period ?? 'week')
  }
}
