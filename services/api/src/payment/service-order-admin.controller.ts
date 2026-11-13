import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { ServiceOrderService } from './service-order.service'

/** 退款中的服务单，管理员再试一次原路退款。打印订单的退款仍走原来的入口。 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ServiceOrderAdminController {
  constructor(private readonly orders: ServiceOrderService) {}

  @Post('admin/orders/:id/retry-service-refund')
  @HttpCode(HttpStatus.OK)
  retry(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.orders.retryRefund(id, user.userId)
  }
}
