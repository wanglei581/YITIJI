import { BadRequestException, Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminMarkPaidDto, AdminRefundDto } from './dto/order-action.dto'
import { OrderStatusService } from './order-status.service'

// Admin 端点只放行线下/人工确认；free 只由 0 元建单自动产生，绝不经 Admin 手动置 free；
// wechat/alipay/benefit 为未来扩展，禁止写入。
const ADMIN_ALLOWED_PAYMENT_SOURCES = ['offline', 'manual_confirmed'] as const

/**
 * Admin 订单动作（P0a 支付域，无 live 网关）。
 *
 * 只做后端端点 + 审计，**无 Admin 前端 UI**（前端联动另批）。
 * 状态机复用 OrderStatusService，不在 controller 重写；操作员身份由 OrderStatusService
 * 写入审计 payload（actorId 为 User 外键，服务级动作置 null，避免非 User 标识触发外键约束）。
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOrderActionsController {
  constructor(private readonly orderStatus: OrderStatusService) {}

  @Post('admin/orders/:id/mark-paid')
  async markPaid(
    @Param('id') id: string,
    @Body() body: AdminMarkPaidDto,
    @CurrentUser() user: AuthedUser,
  ) {
    // 防御纵深：即便绕过 ValidationPipe，controller 也强制只放行 offline / manual_confirmed。
    if (!(ADMIN_ALLOWED_PAYMENT_SOURCES as readonly string[]).includes(body.paymentSource)) {
      throw new BadRequestException('PAYMENT_SOURCE_NOT_ADMIN_ALLOWED')
    }
    return this.orderStatus.markPaid(id, { paymentSource: body.paymentSource, operatorId: user.userId })
  }

  @Post('admin/orders/:id/refund')
  async refund(
    @Param('id') id: string,
    @Body() body: AdminRefundDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.orderStatus.refund(id, { reason: body.refundReason, operatorId: user.userId })
  }
}
