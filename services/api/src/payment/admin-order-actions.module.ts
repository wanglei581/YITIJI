import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AdminOrderActionsController } from './admin-order-actions.controller'
import { PaymentModule } from './payment.module'

/**
 * Admin 订单动作端点模块（P0a 支付域，无 live 网关、无 Admin 前端 UI）。
 * 复用 PaymentModule 的 OrderStatusService；AuthModule 提供 JwtAuthGuard / RolesGuard。
 */
@Module({
  imports: [AuthModule, PaymentModule],
  controllers: [AdminOrderActionsController],
})
export class AdminOrderActionsModule {}
