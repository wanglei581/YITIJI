import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { CreatePackageOrderDto } from './dto/create-package-order.dto'
import { PackageOrderService } from './package-order.service'

/** 小程序材料包：订单、支付与到机码仍复用既有 Order / pickup 链路。 */
@Controller('orders/package')
@UseGuards(EndUserAuthGuard)
export class PackageOrdersController {
  constructor(private readonly packages: PackageOrderService) {}

  @Post()
  async create(@CurrentEndUser() user: AuthedEndUser, @Body() dto: CreatePackageOrderDto) {
    return ApiResponse.ok(await this.packages.create(user.endUserId, dto))
  }

  @Get(':id')
  async detail(@CurrentEndUser() user: AuthedEndUser, @Param('id') id: string) {
    return ApiResponse.ok(await this.packages.detail(user.endUserId, id))
  }
}
