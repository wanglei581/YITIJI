import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AdminBillingController } from './admin-billing.controller'
import { AdminBillingService } from './admin-billing.service'
import { AdminOrderActionsController } from './admin-order-actions.controller'
import { PaymentModule } from './payment.module'
import { ReconciliationService } from './reconciliation.service'

/**
 * Admin 支付域管理端点模块（订单动作 P0a + 计费配置/对账 W-C）。
 * 复用 PaymentModule 的 OrderStatusService；AuthModule 提供 JwtAuthGuard / RolesGuard。
 * - AdminBillingService：PriceConfig 唯一合法改价路径（old/new 快照必审计）。
 * - ReconciliationService：本地账本交叉核对（只读，差异清单）。
 */
@Module({
  imports: [AuthModule, PaymentModule],
  controllers: [AdminOrderActionsController, AdminBillingController],
  providers: [AdminBillingService, ReconciliationService],
})
export class AdminOrderActionsModule {}
