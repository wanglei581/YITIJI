import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common'
import { Equals, IsBoolean } from 'class-validator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { ServiceOrderService } from './service-order.service'

/** 二次确认后才能原路退。没带 confirm:true 时校验直接拒绝，不会打到渠道。 */
class AdminServiceRefundConfirmDto {
  @IsBoolean()
  @Equals(true)
  confirm!: boolean
}

/** 退款中的服务单，管理员再试一次原路退款。卡住的已付、未结案单也可以原路退。打印订单的退款仍走原来的入口。 */
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

  @Post('admin/orders/:id/refund-service')
  @HttpCode(HttpStatus.OK)
  refund(@Param('id') id: string, @Body() dto: AdminServiceRefundConfirmDto, @CurrentUser() user: AuthedUser) {
    return this.orders.adminRefund(id, user.userId, dto.confirm)
  }
}
