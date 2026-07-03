import { Module } from '@nestjs/common'
import { OrderStatusService } from './order-status.service'
import { PricingService } from './pricing.service'

/**
 * 支付域模块（P0a 后端底座，无 live 网关）。
 * 提供 PricingService（报价）+ OrderStatusService（支付/退款状态机）；
 * Admin 订单动作 controller 在 Task 7 加入。PrismaService / AuditService 为全局，无需在此 import。
 */
@Module({
  providers: [PricingService, OrderStatusService],
  exports: [PricingService, OrderStatusService],
})
export class PaymentModule {}
