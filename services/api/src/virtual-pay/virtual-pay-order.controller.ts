import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { CreateVirtualPayOrderDto } from './dto/create-virtual-pay-order.dto'
import { VirtualPayOrderService } from './virtual-pay-order.service'

@Controller('member')
@UseGuards(EndUserAuthGuard)
export class VirtualPayOrderController {
  constructor(private readonly orders: VirtualPayOrderService) {}

  @Post('virtual-pay/orders')
  create(@CurrentEndUser() user: AuthedEndUser, @Body() body: CreateVirtualPayOrderDto) {
    return this.orders.createOrder(user.endUserId, body.serviceKind, body.code)
  }
}
