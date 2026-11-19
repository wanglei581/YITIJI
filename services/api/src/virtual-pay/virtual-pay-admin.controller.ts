import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { UpdateMiniappVirtualPayDto, UpdateMiniappVirtualPayGoodsDto } from './dto/virtual-pay-admin.dto'
import { VirtualPayAdminService } from './virtual-pay-admin.service'

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
}
