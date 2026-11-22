import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import {
  RefundMiniappVirtualPayOrderDto,
  UpdateMiniappVirtualPayDto,
  UpdateMiniappVirtualPayGoodsDto,
} from './dto/virtual-pay-admin.dto'
import { VirtualPayAdminService } from './virtual-pay-admin.service'

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback
  const value = Number(raw.trim())
  return Number.isInteger(value) && value >= 1 ? value : fallback
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class VirtualPayAdminController {
  constructor(private readonly admin: VirtualPayAdminService) {}

  @Get('admin/billing/miniapp-virtual-pay')
  getSettings() {
    return this.admin.getSettings()
  }

  @Put('admin/billing/miniapp-virtual-pay')
  setEnabled(@Body() body: UpdateMiniappVirtualPayDto, @CurrentUser() user: AuthedUser) {
    return this.admin.setEnabled(body.enabled, body.confirm, user.userId)
  }

  @Put('admin/billing/miniapp-virtual-pay/goods/:serviceKind')
  setGoods(
    @Param('serviceKind') serviceKind: string,
    @Body() body: UpdateMiniappVirtualPayGoodsDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.admin.setGoods(serviceKind, body.productId, body.priceCents, body.confirm, user.userId)
  }

  @Get('admin/billing/miniapp-virtual-pay/orders')
  listOrders(
    @Query('status') status?: string,
    @Query('serviceKind') serviceKind?: string,
    @Query('outTradeNo') outTradeNo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.admin.listOrders({
      status,
      serviceKind,
      outTradeNo,
      page: parsePositiveInt(page, 1),
      pageSize: parsePositiveInt(pageSize, 20),
    })
  }

  @Get('admin/billing/miniapp-virtual-pay/orders/:id')
  getOrder(@Param('id') id: string) {
    return this.admin.getOrder(id)
  }

  @Post('admin/billing/miniapp-virtual-pay/orders/:id/refund')
  @HttpCode(HttpStatus.OK)
  refundOrder(
    @Param('id') id: string,
    @Body() body: RefundMiniappVirtualPayOrderDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.admin.refundOrder(id, {
      confirm: body.confirm,
      reason: body.reason,
      operatorId: user.userId,
    })
  }

  @Post('admin/billing/miniapp-virtual-pay/orders/:id/sync')
  @HttpCode(HttpStatus.OK)
  syncOrder(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.admin.syncOrder(id, user.userId)
  }
}
