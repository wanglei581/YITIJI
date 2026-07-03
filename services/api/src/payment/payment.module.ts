import { Module } from '@nestjs/common'
import { PricingService } from './pricing.service'

/**
 * 支付域模块（P0a 后端底座，无 live 网关）。
 * 本批只提供 PricingService（报价）；OrderStatusService（状态机）与 Admin 订单动作
 * controller 分别在 Task 6 / Task 7 加入并导出。PrismaService 为全局，无需在此 import。
 */
@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PaymentModule {}
