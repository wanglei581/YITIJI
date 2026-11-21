import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import {
  MemberServiceOrderService,
  parseMemberServiceOrdersQuery,
  type MemberServiceOrderPage,
} from './member-service-order.service'

export class ListMemberServiceOrdersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string

  @IsOptional()
  @IsString()
  @MaxLength(20)
  pageSize?: string
}

/**
 * 会员侧 AI/扫描服务单列表（只读，零 PII）。路由：GET /api/v1/me/service-orders。
 *
 * 仅按 EndUserAuthGuard 注入的本人 endUserId 读取；不接受查询串里的用户标识，
 * 多余参数由全局 ValidationPipe(forbidNonWhitelisted) 拒成 400 VALIDATION_FAILED。
 */
@Controller('me/service-orders')
@UseGuards(EndUserAuthGuard)
export class MemberServiceOrderController {
  constructor(private readonly serviceOrders: MemberServiceOrderService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query() query: ListMemberServiceOrdersQueryDto,
  ): Promise<ApiResponse<MemberServiceOrderPage>> {
    const parsed = parseMemberServiceOrdersQuery({
      cursor: query.cursor,
      pageSize: query.pageSize,
    })
    return ApiResponse.ok(await this.serviceOrders.list(user.endUserId, parsed))
  }
}
