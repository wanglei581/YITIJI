import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { CreatePackageOrderDto } from './dto/create-package-order.dto'
import { PackageOrderService } from './package-order.service'
import { parseMemberPageQuery } from '../common/utils/member-page'

/** 小程序材料包：订单、支付与到机码仍复用既有 Order / pickup 链路。 */
@Controller('orders/package')
@UseGuards(EndUserAuthGuard)
export class PackageOrdersController {
  constructor(private readonly packages: PackageOrderService) {}

  @Post()
  async create(@CurrentEndUser() user: AuthedEndUser, @Body() dto: CreatePackageOrderDto) {
    return ApiResponse.ok(await this.packages.create(user.endUserId, dto))
  }

  /**
   * 列表必须声明在 `@Get(':id')` **之前**：Nest 按声明顺序匹配，反过来的话
   * `GET /orders/package` 会被 `:id` 当成 id='' 吃掉。
   */
  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ApiResponse.ok(await this.packages.list(user.endUserId, parseMemberPageQuery(cursor, pageSize)))
  }

  @Get(':id')
  async detail(@CurrentEndUser() user: AuthedEndUser, @Param('id') id: string) {
    return ApiResponse.ok(await this.packages.detail(user.endUserId, id))
  }
}
