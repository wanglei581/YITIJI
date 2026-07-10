import { Module } from '@nestjs/common'
import { CodePaymentConvergenceTask } from './code-payment-convergence.task'
import { OnlinePaymentService } from './online-payment.service'
import { OrderStatusService } from './order-status.service'
import { PaymentController } from './payment.controller'
import { PAYMENT_PROVIDER_TOKEN, resolvePaymentProviders } from './payment-provider.factory'
import { PricingService } from './pricing.service'
import { RefundConvergenceTask } from './refund-convergence.task'
import { RefundService } from './refund.service'

/**
 * 支付域模块。
 * - P0a/C5-1：PricingService（报价）+ OrderStatusService（线下/免费/人工确认状态机 + C5-4 markPaidByRedemption）。
 * - C5-2：PaymentProvider（sandbox，fail-closed 工厂）+ OnlinePaymentService（出码/回调/查询）
 *   + PaymentController（pay / pay-status / callback / sandbox simulate）。
 * - C5-4：RefundService（canonical 退款，Refund 账本 + sandbox provider 退款 + refunding→refunded 状态机）。
 * - C5-6：多通道注册表（sandbox / wechat / alipay，互斥规则见工厂）+ reconcile 主动查单 + channels 端点。
 * - W-C/C5-8：退款与付款码的 pending 自动收敛 cron，均 env 门控并复用支付域幂等路径。
 * PrismaService / AuditService 为全局，无需在此 import。
 */
@Module({
  controllers: [PaymentController],
  providers: [
    PricingService,
    OrderStatusService,
    OnlinePaymentService,
    CodePaymentConvergenceTask,
    RefundService,
    RefundConvergenceTask,
    // 启动期解析注册表（fail-closed）：sandbox 缺密钥 / 生产配 sandbox / 真实通道缺配置 /
    // sandbox 与真实通道混配 / 未知取值 → 直接拒绝启动。
    { provide: PAYMENT_PROVIDER_TOKEN, useFactory: () => resolvePaymentProviders(process.env) },
  ],
  exports: [PricingService, OrderStatusService, OnlinePaymentService, RefundService],
})
export class PaymentModule {}
