import { Module } from '@nestjs/common'
import { OnlinePaymentService } from './online-payment.service'
import { OrderStatusService } from './order-status.service'
import { PaymentController } from './payment.controller'
import { PAYMENT_PROVIDER_TOKEN, resolvePaymentProvider } from './payment-provider.factory'
import { PricingService } from './pricing.service'

/**
 * 支付域模块。
 * - P0a/C5-1：PricingService（报价）+ OrderStatusService（线下/免费/人工确认状态机）。
 * - C5-2：PaymentProvider（sandbox，fail-closed 工厂）+ OnlinePaymentService（出码/回调/查询）
 *   + PaymentController（pay / pay-status / callback / sandbox simulate）。
 * PrismaService / AuditService 为全局，无需在此 import。
 */
@Module({
  controllers: [PaymentController],
  providers: [
    PricingService,
    OrderStatusService,
    OnlinePaymentService,
    // 启动期解析（fail-closed）：sandbox 缺密钥 / 生产配 sandbox / 未知取值 → 直接拒绝启动。
    { provide: PAYMENT_PROVIDER_TOKEN, useFactory: () => resolvePaymentProvider(process.env) },
  ],
  exports: [PricingService, OrderStatusService, OnlinePaymentService],
})
export class PaymentModule {}
