import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AdminBillingController } from './admin-billing.controller'
import { AdminBillingService } from './admin-billing.service'
import { AdminOrderActionsController } from './admin-order-actions.controller'
import { PaymentModule } from './payment.module'

/**
 * Admin 支付域管理端点模块（订单动作 P0a + 计费配置 W-C part1）。
 * 复用 PaymentModule 的 OrderStatusService；AuthModule 提供 JwtAuthGuard / RolesGuard。
 * AdminBillingController/Service：PriceConfig 唯一合法改价路径（old/new 快照必审计）。
 */
@Module({
  imports: [AuthModule, PaymentModule],
  controllers: [AdminOrderActionsController, AdminBillingController],
  providers: [AdminBillingService],
})
export class AdminOrderActionsModule {}
