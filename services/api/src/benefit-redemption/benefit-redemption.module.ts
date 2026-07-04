import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { PaymentModule } from '../payment/payment.module'
import { BenefitRedemptionService } from './benefit-redemption.service'
import { OrderRedeemController } from './order-redeem.controller'

/**
 * 权益核销模块（P1 核销 SSOT + C5-4 订单核销扩展）。PrismaModule / AuditModule 均为 @Global。
 *
 * - P1：导出 service 供服务点位（AI 简历优化）内部调用。
 * - C5-4：新增 `POST /orders/:id/redeem`（会员本人订单核销，EndUserAuthGuard）；
 *   redeemForOrder 依赖 PaymentModule 的 OrderStatusService（markPaidByRedemption 免费单联动）。
 *   自带 enduser 专用 JwtModule（同 JWT_SECRET + audience='enduser'）+ 本地 EndUserAuthGuard。
 */
@Module({
  imports: [
    PaymentModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env['JWT_SECRET']
        if (!secret || secret.length < 16) {
          throw new Error('JWT_SECRET 未配置或长度不足 16 字符。请在 services/api/.env 中设置一个强随机值。')
        }
        return { secret, signOptions: { expiresIn: '30m', audience: 'enduser' } }
      },
    }),
  ],
  controllers: [OrderRedeemController],
  providers: [BenefitRedemptionService, EndUserAuthGuard],
  exports: [BenefitRedemptionService],
})
export class BenefitRedemptionModule {}
